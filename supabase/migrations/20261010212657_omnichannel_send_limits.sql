-- Operational budgets, not assertions about Meta/provider commercial limits.
CREATE TABLE private.channel_send_budgets (
  scope_id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  connection_id uuid, limit_per_minute integer NOT NULL CHECK(limit_per_minute BETWEEN 1 AND 10000),
  window_started_at timestamptz NOT NULL DEFAULT clock_timestamp(), used integer NOT NULL DEFAULT 0 CHECK(used>=0),
  blocked_until timestamptz NOT NULL DEFAULT 'epoch',
  CHECK(scope_id=coalesce(connection_id,workspace_id)),
  FOREIGN KEY(workspace_id,connection_id) REFERENCES public.channel_connections(workspace_id,id) ON DELETE CASCADE
);
CREATE INDEX channel_receipts_operation_reference ON private.channel_delivery_receipts(workspace_id,connection_id,external_operation_id)
  WHERE external_operation_id IS NOT NULL;
ALTER TABLE private.channel_send_budgets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.channel_send_budgets FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON private.channel_send_budgets TO service_role;

CREATE FUNCTION private.channel_budget_delay(job public.message_jobs) RETURNS timestamptz
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE budget private.channel_send_budgets; wait_until timestamptz := clock_timestamp(); scope uuid;
BEGIN
  -- One lock order for every conversation: workspace, then physical connection.
  INSERT INTO private.channel_send_budgets(scope_id,workspace_id,limit_per_minute)
    VALUES(job.workspace_id,job.workspace_id,60) ON CONFLICT DO NOTHING;
  INSERT INTO private.channel_send_budgets(scope_id,workspace_id,connection_id,limit_per_minute)
    VALUES(job.connection_id,job.workspace_id,job.connection_id,30) ON CONFLICT DO NOTHING;
  FOREACH scope IN ARRAY ARRAY[job.workspace_id,job.connection_id] LOOP
    SELECT * INTO STRICT budget FROM private.channel_send_budgets WHERE scope_id=scope FOR UPDATE NOWAIT;
    IF budget.workspace_id IS DISTINCT FROM job.workspace_id THEN
      RAISE EXCEPTION 'BUDGET_SCOPE_MISMATCH' USING ERRCODE='23514'; END IF;
    IF budget.window_started_at <= clock_timestamp()-interval '1 minute' THEN
      UPDATE private.channel_send_budgets SET used=0,window_started_at=clock_timestamp() WHERE scope_id=scope;
      budget.used := 0;
    END IF;
    wait_until := greatest(wait_until,budget.blocked_until);
    IF budget.used >= budget.limit_per_minute THEN
      wait_until := greatest(wait_until,budget.window_started_at+interval '1 minute');
    END IF;
  END LOOP;
  RETURN wait_until;
END;
$$;

ALTER FUNCTION public.begin_channel_send(uuid,uuid,uuid,bigint,text,timestamptz) SET SCHEMA private;
CREATE FUNCTION public.begin_channel_send(p_workspace_id uuid,p_operation_id uuid,p_worker_id uuid,
  p_fence bigint,p_evidence_id text,p_valid_until timestamptz) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE job public.message_jobs; conversation uuid; wait_until timestamptz;
BEGIN
  SELECT conversation_id INTO conversation FROM public.message_jobs
    WHERE workspace_id=p_workspace_id AND operation_id=p_operation_id;
  PERFORM 1 FROM public.conversations WHERE workspace_id=p_workspace_id AND id=conversation FOR UPDATE;
  SELECT * INTO job FROM public.message_jobs WHERE workspace_id=p_workspace_id AND operation_id=p_operation_id FOR UPDATE;
  IF NOT FOUND OR job.state<>'leased' OR job.lease_owner IS DISTINCT FROM p_worker_id
    OR job.fence IS DISTINCT FROM p_fence OR job.lease_until<=clock_timestamp() THEN RETURN false; END IF;
  IF job.attempts>1 AND EXISTS(SELECT 1 FROM private.channel_delivery_receipts WHERE workspace_id=job.workspace_id
    AND connection_id=job.connection_id AND external_operation_id=job.operation_id) THEN
    UPDATE public.message_jobs SET state='unknown',last_error_code='receipt_rejection_conflict',
      lease_owner=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE operation_id=p_operation_id;
    RETURN false;
  END IF;
  wait_until := private.channel_budget_delay(job);
  IF wait_until>clock_timestamp() THEN
    UPDATE public.message_jobs SET state='pending',run_after=wait_until,attempts=greatest(attempts-1,0),
      lease_owner=NULL,lease_until=NULL,last_error_code='quota_wait',updated_at=clock_timestamp()
      WHERE operation_id=p_operation_id;
    RETURN false;
  END IF;
  IF NOT private.begin_channel_send(p_workspace_id,p_operation_id,p_worker_id,p_fence,p_evidence_id,p_valid_until)
    THEN RETURN false; END IF;
  UPDATE private.channel_send_budgets SET used=used+1 WHERE scope_id IN(job.workspace_id,job.connection_id);
  RETURN true;
EXCEPTION WHEN lock_not_available THEN RETURN false;
END;
$$;

CREATE FUNCTION public.begin_channel_send_status(p_workspace_id uuid,p_operation_id uuid,p_worker_id uuid,
  p_fence bigint,p_evidence_id text,p_valid_until timestamptz) RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF public.begin_channel_send(p_workspace_id,p_operation_id,p_worker_id,p_fence,p_evidence_id,p_valid_until)
    THEN RETURN 'permitted'; END IF;
  IF EXISTS(SELECT 1 FROM public.message_jobs WHERE workspace_id=p_workspace_id AND operation_id=p_operation_id
    AND fence=p_fence AND state='pending' AND last_error_code='quota_wait') THEN RETURN 'deferred'; END IF;
  RETURN 'lost_lease';
END;
$$;

-- Preserve every attempt in outbox. Only a confirmed non-acceptance can requeue.
ALTER FUNCTION public.finish_channel_send(uuid,uuid,uuid,bigint,jsonb) SET SCHEMA private;
CREATE FUNCTION public.finish_channel_send(p_workspace_id uuid,p_operation_id uuid,p_worker_id uuid,
  p_fence bigint,p_result jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE job public.message_jobs; delay_seconds double precision; due timestamptz; retry_after bigint;
BEGIN
  IF p_result ? 'retryAfterSeconds' THEN
    IF jsonb_typeof(p_result->'retryAfterSeconds') IS DISTINCT FROM 'number'
      OR (p_result->>'retryAfterSeconds') !~ '^\d+$' THEN
      RAISE EXCEPTION 'INVALID_RETRY_AFTER' USING ERRCODE='23514'; END IF;
    retry_after := (p_result->>'retryAfterSeconds')::bigint;
    IF retry_after NOT BETWEEN 0 AND 2147483647 THEN
      RAISE EXCEPTION 'INVALID_RETRY_AFTER' USING ERRCODE='23514'; END IF;
  END IF;
  IF NOT private.finish_channel_send(p_workspace_id,p_operation_id,p_worker_id,p_fence,p_result) THEN RETURN false; END IF;
  IF p_result->>'status' IS DISTINCT FROM 'rejected' OR p_result->'retryable' IS DISTINCT FROM 'true'::jsonb
    THEN RETURN true; END IF;
  SELECT * INTO STRICT job FROM public.message_jobs WHERE operation_id=p_operation_id;
  delay_seconds := greatest(30*power(4,job.attempts-1)*(1+random()*0.1),coalesce(retry_after,0));
  due := clock_timestamp()+make_interval(secs=>delay_seconds);
  PERFORM private.channel_budget_delay(job);
  UPDATE private.channel_send_budgets SET blocked_until=greatest(blocked_until,due) WHERE scope_id=job.connection_id;
  UPDATE public.message_jobs SET state=CASE WHEN attempts>=5 OR due>=created_at+interval '24 hours'
    THEN 'dead_letter' ELSE 'pending' END,run_after=due,updated_at=clock_timestamp() WHERE operation_id=p_operation_id;
  RETURN true;
END;
$$;

-- The visible message stays unique across retries. Never insert a second row.
CREATE OR REPLACE FUNCTION private.sync_channel_job_message() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.state='sending' AND OLD.state='leased' THEN
    INSERT INTO public.messages(workspace_id,conversation_id,connection_id,channel_operation_id,
      direction,type,body,status,sender_user_id,meta)
    VALUES(NEW.workspace_id,NEW.conversation_id,NEW.connection_id,NEW.operation_id,'out','text',
      NEW.request->>'body','queued',NEW.sender_user_id,jsonb_build_object('channel_actor',NEW.actor,'send_outcome','sending'))
    ON CONFLICT(channel_operation_id) WHERE channel_operation_id IS NOT NULL DO UPDATE SET
      status='queued',error_message=NULL,meta=public.messages.meta||jsonb_build_object('send_outcome','sending');
  ELSIF NEW.state IN('accepted','rejected','unknown') AND (OLD.state='sending'
    OR NEW.state='unknown' AND OLD.state='leased' AND NEW.last_error_code='receipt_rejection_conflict') THEN
    UPDATE public.messages SET status=(CASE WHEN NEW.state='accepted' THEN 'sent' ELSE 'failed' END)::public.message_status,
      wamid=NEW.result_wamid,error_message=CASE WHEN NEW.state='unknown' THEN
        'No pudimos confirmar el envío. No lo reenvíes hasta verificarlo para evitar duplicados.'
        WHEN NEW.state='rejected' THEN 'El proveedor rechazó el envío. El mensaje no fue aceptado.' END,
      meta=meta||jsonb_strip_nulls(jsonb_build_object('send_outcome',NEW.state,
        'provider_message_id',NEW.result_provider_message_id,
        'ycloud_id',CASE WHEN provider='ycloud' THEN NEW.result_provider_message_id END))
      WHERE workspace_id=NEW.workspace_id AND channel_operation_id=NEW.operation_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'CHANNEL_MESSAGE_MISSING' USING ERRCODE='23514'; END IF;
  ELSIF NEW.state='pending' AND OLD.state='rejected' THEN
    UPDATE public.messages SET status='queued',error_message=NULL,meta=meta||jsonb_build_object('send_outcome','retry_pending')
      WHERE workspace_id=NEW.workspace_id AND channel_operation_id=NEW.operation_id;
  ELSIF NEW.state IN('cancelled','dead_letter') AND OLD.state IN('pending','leased','rejected') THEN
    UPDATE public.messages SET status='failed',error_message='El envío se detuvo. No se volverá a intentar automáticamente.',
      meta=meta||jsonb_build_object('send_outcome',NEW.state)
      WHERE workspace_id=NEW.workspace_id AND channel_operation_id=NEW.operation_id;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.channel_budget_delay(public.message_jobs),
  public.begin_channel_send(uuid,uuid,uuid,bigint,text,timestamptz),
  public.begin_channel_send_status(uuid,uuid,uuid,bigint,text,timestamptz),
  public.finish_channel_send(uuid,uuid,uuid,bigint,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.channel_budget_delay(public.message_jobs),
  public.begin_channel_send(uuid,uuid,uuid,bigint,text,timestamptz),
  public.begin_channel_send_status(uuid,uuid,uuid,bigint,text,timestamptz),
  public.finish_channel_send(uuid,uuid,uuid,bigint,jsonb) TO service_role;
