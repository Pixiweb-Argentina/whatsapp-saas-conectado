-- RPCs run as the service caller; all EXECUTE permissions are restricted below.
CREATE FUNCTION public.persist_channel_event(p_event jsonb, p_historical boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE event_id uuid; connection public.channel_connections;
BEGIN
  SELECT * INTO STRICT connection FROM public.channel_connections
    WHERE workspace_id = (p_event->>'workspaceId')::uuid AND id = (p_event->>'connectionId')::uuid;
  IF (connection.channel::text = p_event->>'channel' AND connection.provider = p_event->>'provider') IS NOT TRUE THEN
    RAISE EXCEPTION 'EVENT_SCOPE_MISMATCH' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.inbound_events(workspace_id,connection_id,provider_event_id,kind,envelope,historical,state)
    VALUES (connection.workspace_id,connection.id,p_event->>'providerEventId',p_event->>'kind',p_event,p_historical,
      CASE WHEN p_historical OR p_event->>'kind' IN ('outbound_echo','delivery_receipt') THEN 'ignored' ELSE 'pending' END)
    ON CONFLICT (workspace_id,connection_id,provider_event_id) DO NOTHING RETURNING id INTO event_id;
  IF event_id IS NULL THEN
    SELECT id INTO STRICT event_id FROM public.inbound_events WHERE workspace_id = connection.workspace_id
      AND connection_id = connection.id AND provider_event_id = p_event->>'providerEventId';
  END IF;
  RETURN event_id;
END;
$$;

CREATE FUNCTION public.enqueue_channel_job(p_workspace_id uuid, p_connection_id uuid, p_conversation_id uuid,
  p_event_id uuid, p_idempotency_key text, p_actor text, p_expected_revision bigint, p_request jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE conv public.conversations; connection public.channel_connections; job_id uuid;
  actor_id text; event public.inbound_events; existing public.message_jobs;
BEGIN
  SELECT * INTO STRICT connection FROM public.channel_connections
    WHERE workspace_id = p_workspace_id AND id = p_connection_id;
  IF (connection.channel::text = p_request->>'channel') IS NOT TRUE THEN
    RAISE EXCEPTION 'JOB_CHANNEL_MISMATCH' USING ERRCODE = '23514';
  END IF;
  IF p_conversation_id IS NOT NULL THEN
    SELECT * INTO STRICT conv FROM public.conversations WHERE workspace_id = p_workspace_id
      AND id = p_conversation_id AND connection_id = p_connection_id FOR UPDATE;
    SELECT external_user_id INTO STRICT actor_id FROM public.contact_identities
      WHERE workspace_id = p_workspace_id AND connection_id = p_connection_id AND id = conv.identity_id;
    IF conv.state_revision IS DISTINCT FROM p_expected_revision OR conv.state = 'closed'
      OR (p_actor <> 'human' AND (conv.state <> 'ai_active' OR NOT conv.ai_enabled)) THEN
      RAISE EXCEPTION 'JOB_STALE_CONVERSATION' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF p_event_id IS NOT NULL THEN
    SELECT * INTO STRICT event FROM public.inbound_events
      WHERE workspace_id = p_workspace_id AND connection_id = p_connection_id AND id = p_event_id;
    IF event.historical OR event.kind NOT IN ('message','comment') THEN
      RAISE EXCEPTION 'EVENT_NOT_ACTIONABLE' USING ERRCODE = '23514';
    END IF;
    IF p_conversation_id IS NULL THEN actor_id := event.envelope->>'externalActorId'; END IF;
    IF (event.envelope->>'externalActorId' = p_request->>'recipient') IS NOT TRUE THEN
      RAISE EXCEPTION 'EVENT_RECIPIENT_MISMATCH' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF p_request->>'action' IN ('private_reply','public_reply') AND
    (event.kind = 'comment' AND event.envelope->>'externalCommentId' = p_request->>'commentId') IS NOT TRUE THEN
    RAISE EXCEPTION 'COMMENT_REQUIRED' USING ERRCODE = '23514';
  END IF;
  IF (actor_id = p_request->>'recipient') IS NOT TRUE THEN
    RAISE EXCEPTION 'JOB_RECIPIENT_MISMATCH' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.message_jobs(operation_id,workspace_id,connection_id,conversation_id,event_id,
    idempotency_key,actor,expected_state_revision,request)
    VALUES ((p_request->>'operationId')::uuid,p_workspace_id,p_connection_id,p_conversation_id,p_event_id,
      p_idempotency_key,p_actor,p_expected_revision,p_request)
    ON CONFLICT (workspace_id,connection_id,idempotency_key) DO NOTHING RETURNING operation_id INTO job_id;
  IF job_id IS NULL THEN
    SELECT * INTO STRICT existing FROM public.message_jobs WHERE workspace_id = p_workspace_id
      AND connection_id = p_connection_id AND idempotency_key = p_idempotency_key;
    IF (existing.conversation_id,existing.event_id,existing.actor,existing.request - 'operationId') IS DISTINCT FROM
      (p_conversation_id,p_event_id,p_actor,p_request - 'operationId') THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE = '23514';
    END IF;
    job_id := existing.operation_id;
  END IF;
  UPDATE public.inbound_events SET state = 'planned' WHERE workspace_id = p_workspace_id AND id = p_event_id;
  RETURN job_id;
END;
$$;

-- Recover at most 100 rows per tick. Only PRE-send leases are retryable.
CREATE FUNCTION public.recover_channel_jobs(p_workspace_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE recovered integer;
BEGIN
  WITH expired AS (
    SELECT operation_id FROM public.message_jobs WHERE workspace_id = p_workspace_id
      AND ((state IN ('leased','sending') AND lease_until <= clock_timestamp())
        OR (state = 'pending' AND (attempts >= 5 OR created_at < clock_timestamp() - interval '24 hours')))
      ORDER BY created_at,operation_id LIMIT 100 FOR UPDATE SKIP LOCKED
  ), changed AS (
    UPDATE public.message_jobs j SET
      state = CASE WHEN j.state = 'sending' THEN 'unknown'
        WHEN attempts >= 5 OR created_at < clock_timestamp() - interval '24 hours' THEN 'dead_letter' ELSE 'pending' END,
      last_error_code = CASE WHEN j.state = 'sending' THEN 'send_lease_expired' ELSE 'worker_lease_expired' END,
      lease_owner = NULL, lease_until = NULL, updated_at = clock_timestamp()
      FROM expired e WHERE j.operation_id = e.operation_id RETURNING j.*
  ), receipts AS (
    UPDATE public.message_outbox o SET state = 'unknown', error_code = 'send_lease_expired', finished_at = clock_timestamp()
      FROM changed j WHERE j.state = 'unknown' AND o.workspace_id = j.workspace_id
        AND o.operation_id = j.operation_id AND o.fence = j.fence AND o.state = 'sending' RETURNING o.operation_id
  ) SELECT count(*) INTO recovered FROM changed;
  RETURN recovered;
END;
$$;

CREATE FUNCTION public.claim_channel_job(p_workspace_id uuid, p_worker_id uuid)
RETURNS SETOF public.message_jobs LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF p_worker_id IS NULL THEN RAISE EXCEPTION 'WORKER_REQUIRED' USING ERRCODE = '23514'; END IF;
  RETURN QUERY WITH candidate AS (
    SELECT operation_id FROM public.message_jobs WHERE workspace_id = p_workspace_id AND state = 'pending'
      AND run_after <= clock_timestamp() AND attempts < 5 AND created_at >= clock_timestamp() - interval '24 hours'
      ORDER BY run_after,created_at,operation_id LIMIT 1 FOR UPDATE SKIP LOCKED
  ) UPDATE public.message_jobs j SET state = 'leased', attempts = attempts + 1, fence = fence + 1,
      lease_owner = p_worker_id, lease_until = clock_timestamp() + interval '90 seconds', updated_at = clock_timestamp()
    FROM candidate c WHERE j.operation_id = c.operation_id RETURNING j.*;
END;
$$;

-- Lock order: conversation -> job -> outbox, matching the takeover trigger.
-- The committed permit is the start of an in-flight send, not remote delivery.
CREATE FUNCTION public.begin_channel_send(p_workspace_id uuid, p_operation_id uuid, p_worker_id uuid,
  p_fence bigint, p_evidence_id text, p_valid_until timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE job public.message_jobs; conv public.conversations; conversation uuid;
BEGIN
  SELECT conversation_id INTO conversation FROM public.message_jobs
    WHERE workspace_id = p_workspace_id AND operation_id = p_operation_id;
  IF conversation IS NOT NULL THEN
    SELECT * INTO conv FROM public.conversations WHERE workspace_id = p_workspace_id AND id = conversation FOR UPDATE;
  END IF;
  SELECT * INTO job FROM public.message_jobs WHERE workspace_id = p_workspace_id AND operation_id = p_operation_id FOR UPDATE;
  IF NOT FOUND OR job.state <> 'leased' OR job.lease_owner IS DISTINCT FROM p_worker_id
    OR job.fence IS DISTINCT FROM p_fence OR job.lease_until <= clock_timestamp() THEN RETURN false; END IF;
  IF p_valid_until IS NULL OR p_valid_until <= clock_timestamp() OR p_evidence_id IS NULL THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.channel_connections WHERE workspace_id = p_workspace_id
    AND id = job.connection_id AND status = 'ready' AND revoked_at IS NULL) THEN RETURN false; END IF;
  IF conversation IS NOT NULL AND (conv.state_revision IS DISTINCT FROM job.expected_state_revision
    OR conv.state = 'closed' OR (job.actor <> 'human' AND (NOT conv.ai_enabled OR conv.state <> 'ai_active'))) THEN
    UPDATE public.message_jobs SET state = 'cancelled', last_error_code = 'conversation_changed',
      lease_owner = NULL, lease_until = NULL, updated_at = clock_timestamp() WHERE operation_id = p_operation_id;
    RETURN false;
  END IF;
  INSERT INTO public.message_outbox(workspace_id,operation_id,fence,policy_evidence_id,policy_valid_until)
    VALUES (p_workspace_id,p_operation_id,p_fence,p_evidence_id,p_valid_until);
  UPDATE public.message_jobs SET state = 'sending', updated_at = clock_timestamp()
    WHERE operation_id = p_operation_id;
  RETURN true;
END;
$$;

CREATE FUNCTION public.cancel_channel_job(p_workspace_id uuid, p_operation_id uuid, p_worker_id uuid,
  p_fence bigint, p_reason text) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  UPDATE public.message_jobs SET state = 'cancelled', last_error_code = left(p_reason,100),
    lease_owner = NULL, lease_until = NULL, updated_at = clock_timestamp()
    WHERE workspace_id = p_workspace_id AND operation_id = p_operation_id AND state = 'leased'
      AND lease_owner = p_worker_id AND fence = p_fence AND lease_until > clock_timestamp();
  RETURN FOUND;
END;
$$;

CREATE FUNCTION public.finish_channel_send(p_workspace_id uuid, p_operation_id uuid, p_worker_id uuid,
  p_fence bigint, p_result jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE outcome text := p_result->>'status'; external_id text := p_result->>'externalId';
BEGIN
  IF outcome IS NULL OR outcome NOT IN ('accepted','rejected','unknown') OR
    (outcome = 'accepted' AND (external_id IS NULL OR length(btrim(external_id)) = 0)) THEN
    RAISE EXCEPTION 'INVALID_SEND_RESULT' USING ERRCODE = '23514';
  END IF;
  UPDATE public.message_jobs SET state = outcome,
    result_external_id = CASE WHEN outcome = 'accepted' THEN external_id END,
    last_error_code = CASE WHEN outcome = 'rejected' THEN left(p_result->>'errorCode',100)
      WHEN outcome = 'unknown' THEN 'provider_unconfirmed' END,
    lease_owner = NULL, lease_until = NULL, updated_at = clock_timestamp()
    WHERE workspace_id = p_workspace_id AND operation_id = p_operation_id AND state = 'sending'
      AND lease_owner = p_worker_id AND fence = p_fence AND lease_until > clock_timestamp();
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.message_outbox SET state = outcome,
    result_external_id = CASE WHEN outcome = 'accepted' THEN external_id END,
    error_code = CASE WHEN outcome = 'rejected' THEN left(p_result->>'errorCode',100)
      WHEN outcome = 'unknown' THEN 'provider_unconfirmed' END, finished_at = clock_timestamp()
    WHERE workspace_id = p_workspace_id AND operation_id = p_operation_id AND fence = p_fence;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.persist_channel_event(jsonb,boolean),
  public.enqueue_channel_job(uuid,uuid,uuid,uuid,text,text,bigint,jsonb),
  public.recover_channel_jobs(uuid), public.claim_channel_job(uuid,uuid),
  public.begin_channel_send(uuid,uuid,uuid,bigint,text,timestamptz),
  public.cancel_channel_job(uuid,uuid,uuid,bigint,text), public.finish_channel_send(uuid,uuid,uuid,bigint,jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.persist_channel_event(jsonb,boolean),
  public.enqueue_channel_job(uuid,uuid,uuid,uuid,text,text,bigint,jsonb),
  public.recover_channel_jobs(uuid), public.claim_channel_job(uuid,uuid),
  public.begin_channel_send(uuid,uuid,uuid,bigint,text,timestamptz),
  public.cancel_channel_job(uuid,uuid,uuid,bigint,text), public.finish_channel_send(uuid,uuid,uuid,bigint,jsonb)
  TO service_role;
