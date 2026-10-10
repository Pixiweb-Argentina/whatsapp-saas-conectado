-- Private text checkpoint precedes model-side retry/metadata handling. Browser-
-- writable batch meta must never become an outbound body in queue mode.
CREATE FUNCTION public.checkpoint_ai_channel_reply(p_workspace_id uuid,p_batch_id uuid,p_body text)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE prep private.ai_reply_preparations;
BEGIN
  IF p_body IS NULL OR length(btrim(p_body)) NOT BETWEEN 1 AND 4096 THEN
    RAISE EXCEPTION 'AI_INPUT_INVALID' USING ERRCODE='22023'; END IF;
  SELECT * INTO prep FROM private.ai_reply_preparations WHERE workspace_id=p_workspace_id AND batch_id=p_batch_id FOR UPDATE;
  IF NOT FOUND OR prep.mode <> 'queue' THEN RAISE EXCEPTION 'AI_PREPARATION_REQUIRED' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.message_batches WHERE workspace_id=p_workspace_id AND id=p_batch_id AND conversation_id=prep.conversation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'AI_SCOPE_INVALID' USING ERRCODE='42501'; END IF;
  IF prep.reply IS NOT NULL AND prep.reply IS DISTINCT FROM p_body THEN
    RAISE EXCEPTION 'AI_REPLY_CONFLICT' USING ERRCODE='23514'; END IF;
  UPDATE private.ai_reply_preparations SET reply=p_body WHERE workspace_id=p_workspace_id AND batch_id=p_batch_id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.checkpoint_ai_channel_reply(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.checkpoint_ai_channel_reply(uuid,uuid,text) TO service_role;

-- Queue handoff has no provider ACK, email or legacy automation dispatch.
-- It waits for the operation to settle and never overrides a newer control revision.
CREATE FUNCTION public.handoff_ai_channel_reply(p_workspace_id uuid,p_batch_id uuid,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE prep private.ai_reply_preparations; conv public.conversations; batch public.message_batches; job public.message_jobs;
BEGIN
  IF p_reason IS NULL OR p_reason NOT IN ('keyword','jev','cost_cut','tool','retry_exhausted','blocked','write_unconfirmed') THEN
    RAISE EXCEPTION 'AI_INPUT_INVALID' USING ERRCODE='22023'; END IF;
  SELECT * INTO prep FROM private.ai_reply_preparations WHERE workspace_id=p_workspace_id AND batch_id=p_batch_id;
  IF NOT FOUND OR prep.mode <> 'queue' THEN RAISE EXCEPTION 'AI_PREPARATION_REQUIRED' USING ERRCODE='42501'; END IF;
  SELECT * INTO conv FROM public.conversations WHERE workspace_id=p_workspace_id AND id=prep.conversation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AI_SCOPE_INVALID' USING ERRCODE='42501'; END IF;
  SELECT * INTO batch FROM public.message_batches WHERE workspace_id=p_workspace_id AND id=p_batch_id
    AND conversation_id=conv.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AI_SCOPE_INVALID' USING ERRCODE='42501'; END IF;
  IF conv.state <> 'ai_active' OR NOT conv.ai_enabled OR conv.state_revision <> prep.expected_revision THEN
    RETURN jsonb_build_object('settled',true,'changed',false); END IF;
  SELECT * INTO job FROM public.message_jobs WHERE workspace_id=p_workspace_id AND operation_id=p_batch_id FOR UPDATE;
  IF FOUND AND job.state IN ('pending','leased','sending') THEN
    RETURN jsonb_build_object('settled',false,'changed',false); END IF;
  UPDATE public.conversations SET state='handoff_pending',ai_enabled=false
    WHERE workspace_id=p_workspace_id AND id=conv.id;
  INSERT INTO public.events(type,level,workspace_id,conversation_id,payload)
    VALUES('state_change','info',p_workspace_id,conv.id,jsonb_build_object('from','ai_active','to','handoff_pending',
      'actor','system','trigger','ai_queue:' || p_reason,'batch_id',p_batch_id));
  INSERT INTO public.messages(workspace_id,conversation_id,direction,type,body,status,meta)
    VALUES(p_workspace_id,conv.id,'out','system','La IA solicitó atención humana. Revisá el estado del envío y continuá desde la bandeja.',
      'sent',jsonb_build_object('internal',true,'batch_id',p_batch_id,'reason','ai_queue_handoff'));
  RETURN jsonb_build_object('settled',true,'changed',true);
END;
$$;
REVOKE ALL ON FUNCTION public.handoff_ai_channel_reply(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.handoff_ai_channel_reply(uuid,uuid,text) TO service_role;
