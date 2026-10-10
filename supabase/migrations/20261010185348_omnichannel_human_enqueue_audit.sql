-- Service-only producer. The HTTP boundary owns user/workspace; the DB rechecks
-- active membership and owns recipient, evidence, takeover, revision and dedup.
CREATE OR REPLACE FUNCTION public.enqueue_human_channel_text(p_workspace_id uuid, p_conversation_id uuid,
  p_sender_user_id uuid, p_operation_id uuid, p_body text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE conv public.conversations; job public.message_jobs; recipient text; operation uuid; previous_state text;
BEGIN
  IF p_operation_id IS NULL OR p_body IS NULL OR length(btrim(p_body)) NOT BETWEEN 1 AND 4096 THEN
    RAISE EXCEPTION 'HUMAN_INPUT_INVALID' USING ERRCODE = '22023'; END IF;
  SELECT * INTO conv FROM public.conversations
    WHERE workspace_id=p_workspace_id AND id=p_conversation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HUMAN_NOT_FOUND' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.memberships WHERE workspace_id=p_workspace_id AND user_id=p_sender_user_id
    AND is_active AND role IN ('admin','manager','agent') FOR SHARE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'HUMAN_FORBIDDEN' USING ERRCODE = '42501'; END IF;
  SELECT * INTO job FROM public.message_jobs WHERE operation_id=p_operation_id FOR UPDATE;
  IF FOUND THEN
    IF (job.workspace_id,job.conversation_id,job.sender_user_id,job.actor,job.request->>'action',job.request->>'body')
      IS DISTINCT FROM (p_workspace_id,p_conversation_id,p_sender_user_id,'human'::text,'text'::text,p_body) THEN
      RAISE EXCEPTION 'HUMAN_CONFLICT' USING ERRCODE = '23514'; END IF;
    RETURN jsonb_build_object('operationId',job.operation_id,'state',job.state,'duplicate',true);
  END IF;
  IF conv.channel <> 'whatsapp' OR conv.connection_id IS NULL OR conv.identity_id IS NULL OR conv.state='closed' THEN
    RAISE EXCEPTION 'HUMAN_CONTEXT_UNAVAILABLE' USING ERRCODE = '23514'; END IF;
  SELECT external_user_id INTO recipient FROM public.contact_identities
    WHERE workspace_id=p_workspace_id AND connection_id=conv.connection_id AND id=conv.identity_id;
  job.workspace_id:=p_workspace_id; job.connection_id:=conv.connection_id;
  job.conversation_id:=conv.id; job.actor:='human'; job.sender_user_id:=p_sender_user_id;
  job.request:=jsonb_build_object('operationId',p_operation_id,'channel','whatsapp','action','text',
    'recipient',recipient,'body',p_body);
  SELECT id INTO job.event_id FROM public.inbound_events WHERE workspace_id=p_workspace_id
    AND connection_id=conv.connection_id AND kind='message' AND NOT historical
    AND envelope->>'externalActorId'=recipient
    AND envelope->'content'->>'rawType' IS DISTINCT FROM 'reaction'
    ORDER BY received_at DESC,id DESC LIMIT 1;
  IF coalesce(private.channel_permit_until(job,conv) > clock_timestamp(),false) IS NOT TRUE THEN
    RAISE EXCEPTION 'HUMAN_CONTEXT_UNAVAILABLE' USING ERRCODE = '23514'; END IF;
  previous_state := conv.state::text;
  UPDATE public.conversations SET state='human_active',ai_enabled=false,assigned_to=p_sender_user_id
    WHERE workspace_id=p_workspace_id AND id=p_conversation_id RETURNING * INTO conv;
  operation:=public.enqueue_channel_job(p_workspace_id,conv.connection_id,conv.id,job.event_id,
    'human:' || p_operation_id::text,'human',conv.state_revision,job.request,p_sender_user_id);
  IF previous_state <> 'human_active' THEN
    INSERT INTO public.events(workspace_id,conversation_id,type,level,payload)
      VALUES(p_workspace_id,conv.id,'state_change','info',jsonb_build_object('from',previous_state,
        'to','human_active','actor',p_sender_user_id,'trigger','manual','operationId',operation));
  END IF;
  RETURN jsonb_build_object('operationId',operation,'state','pending','duplicate',false);
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_human_channel_text(uuid,uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_human_channel_text(uuid,uuid,uuid,uuid,text) TO service_role;
