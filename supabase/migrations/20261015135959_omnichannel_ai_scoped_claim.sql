-- Manual pilots consume one exact queue batch; never invoke global recovery.
CREATE FUNCTION public.claim_ai_channel_batch(p_workspace_id uuid,p_batch_id uuid)
RETURNS SETOF public.message_batches LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE conv_id uuid; batch public.message_batches; prep private.ai_reply_preparations; conv public.conversations;
BEGIN
  IF p_workspace_id IS NULL OR p_batch_id IS NULL THEN
    RAISE EXCEPTION 'AI_CLAIM_INPUT_INVALID' USING ERRCODE='22023'; END IF;
  SELECT conversation_id INTO conv_id FROM public.message_batches
    WHERE workspace_id=p_workspace_id AND id=p_batch_id;
  IF NOT FOUND OR NOT pg_try_advisory_xact_lock(hashtextextended(conv_id::text,0)) THEN RETURN; END IF;
  SELECT * INTO batch FROM public.message_batches WHERE workspace_id=p_workspace_id AND id=p_batch_id
    AND status='buffering' AND flush_at<clock_timestamp() FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN; END IF;
  IF EXISTS(SELECT 1 FROM public.message_batches b WHERE b.workspace_id=p_workspace_id
    AND b.conversation_id=conv_id AND b.status IN ('buffering','processing')
    AND (b.created_at,b.id)<(batch.created_at,batch.id)) THEN RETURN; END IF;
  SELECT * INTO prep FROM private.ai_reply_preparations WHERE workspace_id=p_workspace_id AND batch_id=p_batch_id;
  IF NOT FOUND OR prep.mode<>'queue' OR NOT prep.eligible OR prep.reply IS NOT NULL THEN RETURN; END IF;
  SELECT * INTO conv FROM public.conversations WHERE workspace_id=p_workspace_id AND id=conv_id;
  IF NOT FOUND OR NOT private.ai_reply_context_current(prep,conv) THEN RETURN; END IF;
  IF EXISTS(SELECT 1 FROM public.message_jobs WHERE workspace_id=p_workspace_id AND operation_id=p_batch_id) THEN RETURN; END IF;
  RETURN QUERY UPDATE public.message_batches SET status='processing',updated_at=clock_timestamp()
    WHERE workspace_id=p_workspace_id AND id=p_batch_id AND status='buffering' RETURNING *;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_ai_channel_batch(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ai_channel_batch(uuid,uuid) TO service_role;
