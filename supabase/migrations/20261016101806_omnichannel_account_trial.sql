-- Explicit one-message initial trial. No account-wide grant, opt-in, flags or backfill.
BEGIN;
CREATE TABLE private.whatsapp_account_trials (
  operation_id uuid PRIMARY KEY,workspace_id uuid NOT NULL,connection_id uuid NOT NULL,
  conversation_id uuid NOT NULL,actor_id uuid NOT NULL,event_id uuid NOT NULL,request jsonb NOT NULL,
  expected_revision bigint NOT NULL,source_fingerprint bytea NOT NULL,
  verification_checked_at timestamptz NOT NULL,expected_callback text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),valid_until timestamptz NOT NULL,revoked_at timestamptz,
  FOREIGN KEY(workspace_id,operation_id) REFERENCES public.message_jobs(workspace_id,operation_id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(workspace_id,connection_id) REFERENCES public.channel_connections(workspace_id,id) ON DELETE CASCADE,
  CHECK(valid_until>created_at AND valid_until<=created_at+interval '10 minutes')
);
CREATE INDEX whatsapp_account_trials_scope ON private.whatsapp_account_trials(workspace_id,connection_id);
ALTER TABLE private.whatsapp_account_trials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.whatsapp_account_trials FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE(revoked_at) ON private.whatsapp_account_trials TO service_role;

CREATE FUNCTION private.whatsapp_trial_blockers(c public.channel_connections,v private.whatsapp_account_verifications,p_callback text)
RETURNS text[] LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE blockers text[];
BEGIN
  blockers:=array_remove(private.whatsapp_account_permission_blockers(c,v,p_callback),'delivery_proof_required');
  IF c.status IS DISTINCT FROM 'needs_permissions' OR c.capabilities NOT IN ('{}'::jsonb,'{"version":1,"grants":[]}'::jsonb)
    THEN blockers:=array_append(blockers,'initial_trial_only'); END IF;
  RETURN blockers;
END;
$$;

-- Explicit trial consent replaces opt_in ONLY for this immutable operation; STOP still wins.
CREATE FUNCTION private.whatsapp_trial_recipient(job public.message_jobs,conv public.conversations) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE identity public.contact_identities; recipient_key text;
BEGIN
  SELECT * INTO identity FROM public.contact_identities WHERE workspace_id=job.workspace_id
    AND connection_id=job.connection_id AND id=conv.identity_id FOR SHARE NOWAIT;
  IF NOT FOUND OR identity.contact_id IS DISTINCT FROM conv.contact_id
    OR identity.external_user_id IS DISTINCT FROM job.request->>'recipient'
    OR identity.verified_at IS NULL OR identity.verified_at>clock_timestamp() THEN RETURN false; END IF;
  PERFORM 1 FROM public.contacts WHERE workspace_id=job.workspace_id AND id=identity.contact_id FOR SHARE NOWAIT;
  IF NOT FOUND THEN RETURN false; END IF;
  recipient_key:=public.contact_phone_key(identity.external_user_id);
  IF recipient_key IS NULL OR NOT pg_try_advisory_xact_lock(hashtextextended('channel-suppression:'||job.workspace_id||':'||recipient_key,0))
    OR EXISTS(SELECT 1 FROM public.contact_opt_outs WHERE workspace_id=job.workspace_id AND phone_key=recipient_key) THEN RETURN false; END IF;
  PERFORM 1 FROM public.memberships WHERE workspace_id=job.workspace_id AND user_id=job.sender_user_id
    AND is_active AND role='admin' FOR SHARE NOWAIT;
  RETURN FOUND;
END;
$$;

CREATE FUNCTION private.whatsapp_trial_until(job public.message_jobs,conv public.conversations) RETURNS timestamptz
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE trial private.whatsapp_account_trials; c public.channel_connections; v private.whatsapp_account_verifications; event_until timestamptz;
BEGIN
  SELECT * INTO trial FROM private.whatsapp_account_trials WHERE operation_id=job.operation_id FOR SHARE NOWAIT;
  IF NOT FOUND OR trial.revoked_at IS NOT NULL OR trial.valid_until<=clock_timestamp()
    OR (trial.workspace_id,trial.connection_id,trial.conversation_id,trial.actor_id,trial.event_id,trial.request,trial.expected_revision)
      IS DISTINCT FROM (job.workspace_id,job.connection_id,job.conversation_id,job.sender_user_id,job.event_id,job.request,job.expected_state_revision)
    OR job.actor<>'human' OR conv.state<>'human_active' OR conv.ai_enabled
    OR conv.state_revision IS DISTINCT FROM trial.expected_revision OR conv.connection_id IS DISTINCT FROM trial.connection_id
    OR EXISTS(SELECT 1 FROM public.message_outbox WHERE operation_id=job.operation_id) THEN RETURN NULL; END IF;
  SELECT * INTO c FROM public.channel_connections WHERE workspace_id=job.workspace_id AND id=job.connection_id FOR SHARE NOWAIT;
  PERFORM 1 FROM private.channel_credentials WHERE workspace_id=c.workspace_id AND connection_id=c.id FOR SHARE NOWAIT;
  SELECT * INTO v FROM private.whatsapp_account_verifications WHERE workspace_id=c.workspace_id AND connection_id=c.id FOR SHARE NOWAIT;
  IF NOT FOUND OR cardinality(private.whatsapp_trial_blockers(c,v,trial.expected_callback))<>0
    OR v.checked_at IS DISTINCT FROM trial.verification_checked_at
    OR private.whatsapp_account_fingerprint(c.workspace_id,c.id) IS DISTINCT FROM trial.source_fingerprint
    OR NOT private.whatsapp_trial_recipient(job,conv) THEN RETURN NULL; END IF;
  event_until:=private.channel_event_until(job,c);
  IF event_until IS NULL THEN RETURN NULL; END IF;
  RETURN least(trial.valid_until,event_until);
END;
$$;

ALTER FUNCTION private.channel_permit_until(public.message_jobs,public.conversations) RENAME TO standard_channel_permit_until;
CREATE FUNCTION private.channel_permit_until(job public.message_jobs,conv public.conversations) RETURNS timestamptz
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM private.whatsapp_account_trials WHERE operation_id=job.operation_id) THEN
    RETURN private.whatsapp_trial_until(job,conv); END IF;
  RETURN private.standard_channel_permit_until(job,conv);
END;
$$;

CREATE FUNCTION public.authorize_whatsapp_account_trial(p_workspace uuid,p_actor uuid,p_connection uuid,p_conversation uuid,
  p_operation uuid,p_recipient text,p_expected_updated_at timestamptz,p_expected_verification timestamptz,p_callback text,p_acknowledge boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE conv public.conversations; c public.channel_connections; v private.whatsapp_account_verifications;
  prior private.whatsapp_account_trials; job public.message_jobs; until_time timestamptz;
BEGIN
  PERFORM private.require_account_operator(p_workspace,p_actor,true);
  SELECT * INTO STRICT conv FROM public.conversations WHERE workspace_id=p_workspace AND id=p_conversation FOR UPDATE;
  SELECT * INTO STRICT c FROM public.channel_connections WHERE workspace_id=p_workspace AND id=p_connection FOR UPDATE;
  SELECT * INTO prior FROM private.whatsapp_account_trials WHERE operation_id=p_operation;
  IF FOUND THEN
    IF (prior.workspace_id,prior.connection_id,prior.conversation_id,prior.actor_id,prior.request->>'recipient')
      IS DISTINCT FROM (p_workspace,p_connection,p_conversation,p_actor,p_recipient) OR p_acknowledge IS NOT TRUE THEN
      RAISE EXCEPTION 'TRIAL_COLLISION' USING ERRCODE='23514'; END IF;
    RETURN jsonb_build_object('operationId',prior.operation_id,'duplicate',true);
  END IF;
  PERFORM 1 FROM private.channel_credentials WHERE workspace_id=p_workspace AND connection_id=p_connection FOR SHARE;
  SELECT * INTO v FROM private.whatsapp_account_verifications WHERE workspace_id=p_workspace AND connection_id=p_connection FOR SHARE;
  IF p_operation IS NULL OR p_acknowledge IS NOT TRUE OR cardinality(private.whatsapp_trial_blockers(c,v,p_callback))<>0
    OR c.updated_at IS DISTINCT FROM p_expected_updated_at OR v.checked_at IS DISTINCT FROM p_expected_verification
    OR conv.connection_id IS DISTINCT FROM c.id OR conv.channel<>'whatsapp' OR conv.state<>'human_active' OR conv.ai_enabled THEN
    RAISE EXCEPTION 'TRIAL_NOT_ELIGIBLE' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM private.whatsapp_account_trials t JOIN public.message_jobs j ON j.operation_id=t.operation_id
    WHERE t.workspace_id=p_workspace AND t.connection_id=p_connection AND (j.state NOT IN ('cancelled','rejected')
      OR EXISTS(SELECT 1 FROM public.message_outbox o WHERE o.operation_id=t.operation_id AND o.state<>'rejected'))) THEN
    RAISE EXCEPTION 'TRIAL_UNRESOLVED' USING ERRCODE='23514'; END IF;
  job.operation_id:=p_operation;job.workspace_id:=p_workspace;job.connection_id:=p_connection;job.conversation_id:=p_conversation;
  job.actor:='human';job.sender_user_id:=p_actor;job.expected_state_revision:=conv.state_revision;
  job.request:=jsonb_build_object('operationId',p_operation,'channel','whatsapp','action','text','recipient',p_recipient,
    'body','Hola, este es un mensaje de prueba de Pixiweb. Recibimos tu mensaje correctamente.');
  SELECT e.id INTO job.event_id FROM public.inbound_events e JOIN public.messages m
    ON m.workspace_id=e.workspace_id AND m.connection_id=e.connection_id AND m.meta->>'inbound_event_id'=e.id::text
    WHERE e.workspace_id=p_workspace AND e.connection_id=p_connection AND e.kind='message' AND NOT e.historical
      AND e.envelope->>'externalActorId'=p_recipient AND e.envelope->'content'->>'rawType'='text'
      AND m.conversation_id=p_conversation AND m.direction='in' AND m.type='text' ORDER BY e.received_at DESC,e.id DESC LIMIT 1;
  IF job.event_id IS NULL OR NOT private.whatsapp_trial_recipient(job,conv) THEN
    RAISE EXCEPTION 'TRIAL_RECIPIENT_UNAVAILABLE' USING ERRCODE='23514'; END IF;
  until_time:=private.channel_event_until(job,c);
  IF until_time IS NULL OR until_time<=clock_timestamp() THEN RAISE EXCEPTION 'TRIAL_WINDOW_EXPIRED' USING ERRCODE='23514'; END IF;
  SELECT least(until_time,clock_timestamp()+interval '10 minutes',v.checked_at+interval '24 hours',expires_at)
    INTO until_time FROM private.channel_credentials WHERE workspace_id=p_workspace AND connection_id=p_connection;
  INSERT INTO private.whatsapp_account_trials(operation_id,workspace_id,connection_id,conversation_id,actor_id,event_id,request,
    expected_revision,source_fingerprint,verification_checked_at,expected_callback,valid_until)
    VALUES(p_operation,p_workspace,p_connection,p_conversation,p_actor,job.event_id,job.request,conv.state_revision,
      private.whatsapp_account_fingerprint(p_workspace,p_connection),v.checked_at,p_callback,until_time);
  PERFORM public.enqueue_channel_job(p_workspace,p_connection,p_conversation,job.event_id,'trial:'||p_operation,'human',conv.state_revision,job.request,p_actor);
  RETURN jsonb_build_object('operationId',p_operation,'duplicate',false);
END;
$$;

-- Ordinary drains must never consume an explicitly confirmed trial.
CREATE OR REPLACE FUNCTION public.claim_channel_job(p_workspace_id uuid,p_worker_id uuid)
RETURNS SETOF public.message_jobs LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF p_worker_id IS NULL THEN RAISE EXCEPTION 'WORKER_REQUIRED' USING ERRCODE='23514'; END IF;
  RETURN QUERY WITH candidate AS (
    SELECT operation_id FROM public.message_jobs j WHERE workspace_id=p_workspace_id AND state='pending'
      AND run_after<=clock_timestamp() AND attempts<5 AND created_at>=clock_timestamp()-interval '24 hours'
      AND NOT EXISTS(SELECT 1 FROM private.whatsapp_account_trials t WHERE t.operation_id=j.operation_id)
      ORDER BY run_after,created_at,operation_id LIMIT 1 FOR UPDATE SKIP LOCKED
  ) UPDATE public.message_jobs j SET state='leased',attempts=attempts+1,fence=fence+1,
    lease_owner=p_worker_id,lease_until=clock_timestamp()+interval '90 seconds',updated_at=clock_timestamp()
    FROM candidate c WHERE j.operation_id=c.operation_id RETURNING j.*;
END;
$$;

CREATE FUNCTION public.claim_whatsapp_account_trial(p_workspace uuid,p_actor uuid,p_connection uuid,p_operation uuid,
  p_worker uuid,p_callback text,p_source_revision text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE trial private.whatsapp_account_trials; conv public.conversations; job public.message_jobs; until_time timestamptz;
BEGIN
  PERFORM private.require_account_operator(p_workspace,p_actor,true);
  SELECT * INTO trial FROM private.whatsapp_account_trials WHERE workspace_id=p_workspace AND connection_id=p_connection
    AND operation_id=p_operation AND actor_id=p_actor;
  IF NOT FOUND OR p_worker IS NULL OR trial.expected_callback IS DISTINCT FROM p_callback THEN RETURN NULL; END IF;
  SELECT * INTO conv FROM public.conversations WHERE workspace_id=p_workspace AND id=trial.conversation_id FOR UPDATE;
  SELECT * INTO job FROM public.message_jobs WHERE workspace_id=p_workspace AND operation_id=p_operation FOR UPDATE;
  IF NOT FOUND OR job.state<>'pending' OR job.attempts<>0 OR job.run_after>clock_timestamp()
    OR (public.read_whatsapp_account_source(p_workspace,p_connection)->>'sourceRevision') IS DISTINCT FROM p_source_revision THEN RETURN NULL; END IF;
  until_time:=private.whatsapp_trial_until(job,conv);
  IF until_time IS NULL OR until_time<=clock_timestamp() THEN RETURN NULL; END IF;
  UPDATE public.message_jobs SET state='leased',attempts=1,fence=fence+1,lease_owner=p_worker,
    lease_until=clock_timestamp()+interval '90 seconds',updated_at=clock_timestamp() WHERE operation_id=p_operation RETURNING * INTO job;
  RETURN jsonb_build_object('job',to_jsonb(job),'validUntil',until_time);
END;
$$;

-- Provider rejections in a trial are final, including 429: no automatic retry.
ALTER FUNCTION public.finish_channel_send(uuid,uuid,uuid,bigint,jsonb) RENAME TO finish_standard_channel_send;
ALTER FUNCTION public.finish_standard_channel_send(uuid,uuid,uuid,bigint,jsonb) SET SCHEMA private;
CREATE FUNCTION public.finish_channel_send(p_workspace_id uuid,p_operation_id uuid,p_worker_id uuid,p_fence bigint,p_result jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF p_result->>'status'='rejected' AND EXISTS(SELECT 1 FROM private.whatsapp_account_trials WHERE operation_id=p_operation_id) THEN
    p_result:=jsonb_set(p_result,'{retryable}','false'::jsonb); END IF;
  RETURN private.finish_standard_channel_send(p_workspace_id,p_operation_id,p_worker_id,p_fence,p_result);
END;
$$;

CREATE FUNCTION public.revoke_whatsapp_account_trial(p_workspace uuid,p_actor uuid,p_connection uuid,p_operation uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE trial private.whatsapp_account_trials;
BEGIN
  PERFORM private.require_account_operator(p_workspace,p_actor,true);
  SELECT * INTO trial FROM private.whatsapp_account_trials WHERE workspace_id=p_workspace AND connection_id=p_connection AND operation_id=p_operation;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM 1 FROM public.conversations WHERE workspace_id=p_workspace AND id=trial.conversation_id FOR UPDATE;
  PERFORM 1 FROM public.message_jobs WHERE workspace_id=p_workspace AND operation_id=p_operation FOR UPDATE;
  UPDATE private.whatsapp_account_trials SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE operation_id=p_operation;
  UPDATE public.message_jobs SET state='cancelled',lease_owner=NULL,lease_until=NULL,last_error_code='trial_revoked',updated_at=clock_timestamp()
    WHERE workspace_id=p_workspace AND operation_id=p_operation AND state IN ('pending','leased')
      AND NOT EXISTS(SELECT 1 FROM public.message_outbox WHERE operation_id=p_operation);
  RETURN true;
END;
$$;

CREATE FUNCTION public.read_whatsapp_account_trial(p_workspace uuid,p_actor uuid,p_connection uuid,p_callback text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c public.channel_connections; v private.whatsapp_account_verifications; candidates jsonb; latest jsonb;
BEGIN
  PERFORM private.require_account_operator(p_workspace,p_actor,false);
  SELECT * INTO c FROM public.channel_connections WHERE workspace_id=p_workspace AND id=p_connection AND legacy_integration_id IS NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO v FROM private.whatsapp_account_verifications WHERE workspace_id=p_workspace AND connection_id=p_connection;
  SELECT coalesce(jsonb_agg(to_jsonb(rows)),'[]'::jsonb) INTO candidates FROM (
    SELECT conv.id AS "conversationId",i.external_user_id AS recipient,coalesce(ct.name,'Contacto de prueba') AS name
    FROM public.conversations conv JOIN public.contact_identities i ON i.workspace_id=conv.workspace_id AND i.id=conv.identity_id AND i.connection_id=p_connection
      JOIN public.contacts ct ON ct.workspace_id=conv.workspace_id AND ct.id=conv.contact_id
    WHERE conv.workspace_id=p_workspace AND conv.connection_id=p_connection AND conv.state='human_active' AND NOT conv.ai_enabled
      AND i.contact_id=ct.id AND i.verified_at<=clock_timestamp()
      AND NOT EXISTS(SELECT 1 FROM public.contact_opt_outs o WHERE o.workspace_id=p_workspace AND o.phone_key=public.contact_phone_key(i.external_user_id))
      AND EXISTS(SELECT 1 FROM public.messages m JOIN public.inbound_events e ON e.workspace_id=m.workspace_id
        AND e.id::text=m.meta->>'inbound_event_id' AND e.connection_id=p_connection
        WHERE m.workspace_id=p_workspace AND m.conversation_id=conv.id AND m.direction='in' AND m.type='text'
          AND e.envelope->>'externalActorId'=i.external_user_id AND NOT e.historical AND e.kind='message'
          AND private.channel_timestamp(e.envelope->>'occurredAt') BETWEEN clock_timestamp()-interval '24 hours' AND clock_timestamp())
    ORDER BY conv.id LIMIT 20) rows;
  SELECT jsonb_build_object('operationId',t.operation_id,'conversationId',t.conversation_id,'recipient',t.request->>'recipient',
    'body',t.request->>'body','validUntil',t.valid_until,'revoked',t.revoked_at IS NOT NULL,'state',j.state,
    'deliveryStatus',(SELECT m.status::text FROM public.messages m WHERE m.workspace_id=p_workspace AND m.channel_operation_id=t.operation_id),
    'canSend',j.state='pending' AND j.attempts=0 AND j.run_after<=clock_timestamp() AND t.actor_id=p_actor
      AND t.revoked_at IS NULL AND t.valid_until>clock_timestamp()) INTO latest
    FROM private.whatsapp_account_trials t JOIN public.message_jobs j ON j.operation_id=t.operation_id
    WHERE t.workspace_id=p_workspace AND t.connection_id=p_connection ORDER BY t.created_at DESC,t.operation_id DESC LIMIT 1;
  RETURN jsonb_build_object('connectionUpdatedAt',c.updated_at,'verificationCheckedAt',v.checked_at,
    'blockers',to_jsonb(private.whatsapp_trial_blockers(c,v,p_callback)),'candidates',candidates,'latest',latest);
END;
$$;

REVOKE ALL ON FUNCTION private.whatsapp_trial_blockers(public.channel_connections,private.whatsapp_account_verifications,text),
  private.whatsapp_trial_recipient(public.message_jobs,public.conversations),private.whatsapp_trial_until(public.message_jobs,public.conversations),
  private.channel_permit_until(public.message_jobs,public.conversations),
  public.authorize_whatsapp_account_trial(uuid,uuid,uuid,uuid,uuid,text,timestamptz,timestamptz,text,boolean),
  public.claim_whatsapp_account_trial(uuid,uuid,uuid,uuid,uuid,text,text),public.revoke_whatsapp_account_trial(uuid,uuid,uuid,uuid),
  public.read_whatsapp_account_trial(uuid,uuid,uuid,text),public.finish_channel_send(uuid,uuid,uuid,bigint,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.whatsapp_trial_blockers(public.channel_connections,private.whatsapp_account_verifications,text),
  private.whatsapp_trial_recipient(public.message_jobs,public.conversations),private.whatsapp_trial_until(public.message_jobs,public.conversations),
  private.channel_permit_until(public.message_jobs,public.conversations),
  public.authorize_whatsapp_account_trial(uuid,uuid,uuid,uuid,uuid,text,timestamptz,timestamptz,text,boolean),
  public.claim_whatsapp_account_trial(uuid,uuid,uuid,uuid,uuid,text,text),public.revoke_whatsapp_account_trial(uuid,uuid,uuid,uuid),
  public.read_whatsapp_account_trial(uuid,uuid,uuid,text),public.finish_channel_send(uuid,uuid,uuid,bigint,jsonb) TO service_role;
COMMIT;
