-- Immutable server-owned context for a batch, separate from client-writable meta.
-- This increment prepares the producer; the legacy buffer is not switched yet.
CREATE TABLE private.ai_reply_preparations (
  batch_id uuid PRIMARY KEY REFERENCES public.message_batches(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('legacy','queue')),
  eligible boolean NOT NULL DEFAULT false,
  expected_revision bigint NOT NULL,
  connection_id uuid, identity_id uuid, event_id uuid, recipient text,
  reply text CHECK (reply IS NULL OR length(btrim(reply)) BETWEEN 1 AND 4096),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ai_reply_preparations_workspace_conversation
  ON private.ai_reply_preparations(workspace_id,conversation_id);
ALTER TABLE private.ai_reply_preparations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.ai_reply_preparations FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON private.ai_reply_preparations TO service_role;

CREATE FUNCTION private.ai_reply_context_current(prep private.ai_reply_preparations, conv public.conversations)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE job public.message_jobs;
BEGIN
  IF NOT prep.eligible OR prep.mode <> 'queue' OR conv.state <> 'ai_active' OR NOT conv.ai_enabled
    OR (conv.workspace_id,conv.id,conv.state_revision,conv.connection_id,conv.identity_id) IS DISTINCT FROM
      (prep.workspace_id,prep.conversation_id,prep.expected_revision,prep.connection_id,prep.identity_id)
    THEN RETURN false; END IF;
  job.workspace_id:=prep.workspace_id; job.conversation_id:=prep.conversation_id;
  job.connection_id:=prep.connection_id; job.event_id:=prep.event_id; job.actor:='ai';
  job.request:=jsonb_build_object('channel','whatsapp','action','text','recipient',prep.recipient,'body','context probe');
  RETURN coalesce(private.channel_permit_until(job,conv) > clock_timestamp(),false);
END;
$$;

CREATE FUNCTION public.prepare_ai_channel_reply(p_workspace_id uuid,p_batch_id uuid,p_mode text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE batch public.message_batches; conv public.conversations; prep private.ai_reply_preparations;
  state text;
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN ('legacy','queue') THEN
    RAISE EXCEPTION 'AI_INPUT_INVALID' USING ERRCODE='22023'; END IF;
  SELECT * INTO batch FROM public.message_batches WHERE workspace_id=p_workspace_id AND id=p_batch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'AI_SCOPE_INVALID' USING ERRCODE='42501'; END IF;
  SELECT * INTO conv FROM public.conversations WHERE workspace_id=p_workspace_id AND id=batch.conversation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AI_SCOPE_INVALID' USING ERRCODE='42501'; END IF;
  SELECT * INTO batch FROM public.message_batches WHERE workspace_id=p_workspace_id AND id=p_batch_id
    AND conversation_id=conv.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AI_SCOPE_INVALID' USING ERRCODE='42501'; END IF;
  SELECT * INTO prep FROM private.ai_reply_preparations WHERE workspace_id=p_workspace_id AND batch_id=p_batch_id;
  IF NOT FOUND THEN
    IF batch.status <> 'processing' THEN RAISE EXCEPTION 'AI_BATCH_NOT_PROCESSING' USING ERRCODE='23514'; END IF;
    -- Never migrate a legacy attempt whose model/tools/send may already have run.
    IF batch.meta ?| ARRAY['llm_reservation_id','jev_verdict','write_tools_ran','pending_reply','pending_handoff']
      OR coalesce(batch.meta->>'retry_count','0') <> '0' THEN p_mode:='legacy'; END IF;
    prep.batch_id:=batch.id; prep.workspace_id:=p_workspace_id; prep.conversation_id:=conv.id;
    prep.mode:=p_mode; prep.expected_revision:=conv.state_revision;
    prep.connection_id:=conv.connection_id; prep.identity_id:=conv.identity_id; prep.eligible:=false;
    IF p_mode='queue' THEN
      UPDATE public.message_batches SET meta=meta || '{"isolated":true}'::jsonb
        WHERE workspace_id=p_workspace_id AND id=p_batch_id;
      SELECT external_user_id INTO prep.recipient FROM public.contact_identities
        WHERE workspace_id=p_workspace_id AND connection_id=conv.connection_id AND id=conv.identity_id;
      SELECT e.id INTO prep.event_id FROM public.inbound_events e
        WHERE e.workspace_id=p_workspace_id AND e.connection_id=conv.connection_id AND e.kind='message' AND NOT e.historical
          AND e.envelope->>'externalActorId'=prep.recipient AND e.envelope->'content'->>'rawType' IS DISTINCT FROM 'reaction'
          AND EXISTS (SELECT 1 FROM public.messages m WHERE m.workspace_id=p_workspace_id AND m.conversation_id=conv.id
            AND m.batch_id=batch.id AND m.direction='in' AND m.wamid=e.envelope->>'externalMessageId')
        ORDER BY e.received_at DESC,e.id DESC LIMIT 1;
      prep.eligible:=true;
      prep.eligible:=private.ai_reply_context_current(prep,conv);
    END IF;
    INSERT INTO private.ai_reply_preparations(batch_id,workspace_id,conversation_id,mode,eligible,
      expected_revision,connection_id,identity_id,event_id,recipient)
      VALUES(prep.batch_id,prep.workspace_id,prep.conversation_id,prep.mode,prep.eligible,
        prep.expected_revision,prep.connection_id,prep.identity_id,prep.event_id,prep.recipient) RETURNING * INTO prep;
  END IF;
  SELECT j.state INTO state FROM public.message_jobs j WHERE j.workspace_id=p_workspace_id AND j.operation_id=p_batch_id
    AND j.conversation_id=conv.id AND j.actor='ai' AND j.idempotency_key='ai-batch:' || p_batch_id::text;
  RETURN jsonb_build_object('mode',prep.mode,'operationId',prep.batch_id,'reply',prep.reply,'state',state,
    'eligible',batch.status='processing' AND private.ai_reply_context_current(prep,conv));
END;
$$;

CREATE FUNCTION public.enqueue_ai_channel_reply(p_workspace_id uuid,p_batch_id uuid,p_body text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE batch public.message_batches; conv public.conversations; prep private.ai_reply_preparations;
  job public.message_jobs; request jsonb; operation uuid;
BEGIN
  IF p_body IS NULL OR length(btrim(p_body)) NOT BETWEEN 1 AND 4096 THEN
    RAISE EXCEPTION 'AI_INPUT_INVALID' USING ERRCODE='22023'; END IF;
  SELECT * INTO batch FROM public.message_batches WHERE workspace_id=p_workspace_id AND id=p_batch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'AI_SCOPE_INVALID' USING ERRCODE='42501'; END IF;
  SELECT * INTO conv FROM public.conversations WHERE workspace_id=p_workspace_id AND id=batch.conversation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AI_SCOPE_INVALID' USING ERRCODE='42501'; END IF;
  SELECT * INTO batch FROM public.message_batches WHERE workspace_id=p_workspace_id AND id=p_batch_id
    AND conversation_id=conv.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AI_SCOPE_INVALID' USING ERRCODE='42501'; END IF;
  SELECT * INTO prep FROM private.ai_reply_preparations WHERE workspace_id=p_workspace_id AND batch_id=p_batch_id FOR UPDATE;
  IF NOT FOUND OR prep.mode <> 'queue' OR prep.conversation_id IS DISTINCT FROM conv.id THEN
    RAISE EXCEPTION 'AI_PREPARATION_REQUIRED' USING ERRCODE='23514'; END IF;
  IF prep.reply IS NOT NULL AND prep.reply IS DISTINCT FROM p_body THEN
    RAISE EXCEPTION 'AI_REPLY_CONFLICT' USING ERRCODE='23514'; END IF;
  request:=jsonb_build_object('operationId',p_batch_id,'channel','whatsapp','action','text','recipient',prep.recipient,'body',p_body);
  SELECT * INTO job FROM public.message_jobs WHERE operation_id=p_batch_id FOR UPDATE;
  IF FOUND THEN
    IF (job.workspace_id,job.conversation_id,job.connection_id,job.event_id,job.actor,job.expected_state_revision,job.request)
      IS DISTINCT FROM (p_workspace_id,conv.id,prep.connection_id,prep.event_id,'ai'::text,prep.expected_revision,request) THEN
      RAISE EXCEPTION 'AI_REPLY_CONFLICT' USING ERRCODE='23514'; END IF;
    RETURN jsonb_build_object('operationId',p_batch_id,'queued',true,'duplicate',true,'state',job.state,'reason',null);
  END IF;
  -- Save text even when stale/blocked: recovering this batch must not regenerate it.
  UPDATE private.ai_reply_preparations SET reply=p_body WHERE workspace_id=p_workspace_id AND batch_id=p_batch_id;
  IF batch.status <> 'processing' OR NOT private.ai_reply_context_current(prep,conv) THEN
    RETURN jsonb_build_object('operationId',p_batch_id,'queued',false,'duplicate',false,'state',null,'reason','context_unavailable'); END IF;
  operation:=public.enqueue_channel_job(p_workspace_id,prep.connection_id,conv.id,prep.event_id,
    'ai-batch:' || p_batch_id::text,'ai',prep.expected_revision,request);
  RETURN jsonb_build_object('operationId',operation,'queued',true,'duplicate',false,'state','pending','reason',null);
END;
$$;
REVOKE ALL ON FUNCTION private.ai_reply_context_current(private.ai_reply_preparations,public.conversations)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.ai_reply_context_current(private.ai_reply_preparations,public.conversations) TO service_role;
REVOKE ALL ON FUNCTION public.prepare_ai_channel_reply(uuid,uuid,text),public.enqueue_ai_channel_reply(uuid,uuid,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_ai_channel_reply(uuid,uuid,text),public.enqueue_ai_channel_reply(uuid,uuid,text)
  TO service_role;
