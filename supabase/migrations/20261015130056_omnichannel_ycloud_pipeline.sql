-- Durable text intake. Never infer consent, resume AI, run a model or send.
-- Reuses verified inbox evidence, but preserves an existing explicit AI state.
CREATE FUNCTION private.ycloud_pipeline_conversation(p_workspace uuid,p_connection uuid,p_contact uuid,p_identity uuid)
RETURNS public.conversations LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE conv public.conversations;
BEGIN
  INSERT INTO public.conversations(workspace_id,contact_id,channel,connection_id,identity_id,state,ai_enabled,source_context)
    VALUES(p_workspace,p_contact,'whatsapp',p_connection,p_identity,'human_active',false,
      '{"channel":"whatsapp","sourceType":"direct_message"}'::jsonb)
    ON CONFLICT ON CONSTRAINT uq_conversations_contact DO NOTHING;
  SELECT * INTO STRICT conv FROM public.conversations WHERE workspace_id=p_workspace
    AND contact_id=p_contact AND channel='whatsapp' FOR UPDATE;
  IF conv.connection_id IS DISTINCT FROM p_connection OR conv.identity_id IS DISTINCT FROM p_identity THEN
    RAISE EXCEPTION 'INBOX_CONVERSATION_COLLISION' USING ERRCODE='23514'; END IF;
  RETURN conv;
END;
$$;

CREATE FUNCTION private.ycloud_pipeline_message(p_workspace uuid,stored public.inbound_events,p_name text)
RETURNS public.messages LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE contact_id uuid; identity_id uuid; conv public.conversations; msg public.messages; occurred timestamptz;
BEGIN
  contact_id := private.ycloud_inbox_contact(p_workspace,stored.envelope->>'externalActorId',p_name);
  identity_id := private.ycloud_inbox_identity(p_workspace,stored.connection_id,contact_id,
    stored.envelope->>'externalActorId',stored.historical);
  conv := private.ycloud_pipeline_conversation(p_workspace,stored.connection_id,contact_id,identity_id);
  occurred := private.channel_timestamp(stored.envelope->>'occurredAt');
  INSERT INTO public.messages(workspace_id,conversation_id,connection_id,provider,external_message_id,
    direction,type,body,wamid,status,created_at,meta)
    VALUES(p_workspace,conv.id,stored.connection_id,'ycloud',stored.envelope->>'externalMessageId',
      'in','text',stored.envelope->'content'->>'text',stored.envelope->>'externalMessageId','delivered',occurred,
      jsonb_build_object('inbound_event_id',stored.id,'durable_ingress',true,'historical',stored.historical))
    RETURNING * INTO msg;
  UPDATE public.conversations SET unread_count=unread_count+1,
    last_message_at=greatest(last_message_at,occurred),window_expires_at=greatest(window_expires_at,occurred+interval '24 hours')
    WHERE workspace_id=p_workspace AND id=conv.id;
  RETURN msg;
END;
$$;

CREATE FUNCTION private.ycloud_pipeline_batch(p_workspace uuid,stored public.inbound_events,msg public.messages,
  p_queue_ai boolean,p_silence_ms integer)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE conv public.conversations; probe public.message_jobs; buffer_id uuid;
BEGIN
  SELECT * INTO STRICT conv FROM public.conversations WHERE workspace_id=p_workspace AND id=msg.conversation_id FOR UPDATE;
  IF NOT p_queue_ai OR stored.historical OR NOT conv.ai_enabled OR conv.state<>'ai_active' THEN RETURN NULL; END IF;
  probe.workspace_id:=p_workspace; probe.connection_id:=stored.connection_id; probe.conversation_id:=conv.id;
  probe.event_id:=stored.id; probe.actor:='ai';
  probe.request:=jsonb_build_object('channel','whatsapp','action','text',
    'recipient',stored.envelope->>'externalActorId','body','intake eligibility');
  IF coalesce(private.channel_permit_until(probe,conv)>clock_timestamp(),false) IS NOT TRUE THEN RETURN NULL; END IF;
  -- Only merge into an untouched queue batch from this exact control revision.
  -- The isolated bit keeps legacy batch writers from adopting this batch.
  SELECT b.id INTO buffer_id FROM public.message_batches b JOIN private.ai_reply_preparations p ON p.batch_id=b.id
    WHERE b.workspace_id=p_workspace AND b.conversation_id=conv.id AND b.status='buffering'
    AND p.workspace_id=p_workspace AND p.conversation_id=conv.id AND p.mode='queue' AND p.eligible
    AND p.expected_revision=conv.state_revision AND p.connection_id=stored.connection_id AND p.identity_id=conv.identity_id
    AND p.reply IS NULL AND b.meta->>'queue_intake'='true'
    AND NOT (b.meta ?| ARRAY['llm_reservation_id','jev_verdict','write_tools_ran','pending_reply','pending_handoff',
      'queue_handoff_reason','retry_count','queue_status'])
    AND NOT EXISTS(SELECT 1 FROM public.message_jobs j WHERE j.workspace_id=p_workspace AND j.operation_id=b.id)
    ORDER BY b.created_at DESC,b.id DESC LIMIT 1 FOR UPDATE OF b;
  IF buffer_id IS NOT NULL THEN
    UPDATE public.message_batches SET message_count=message_count+1,
      flush_at=clock_timestamp()+make_interval(secs=>p_silence_ms::double precision/1000),updated_at=clock_timestamp()
      WHERE workspace_id=p_workspace AND id=buffer_id;
    UPDATE public.messages SET batch_id=buffer_id WHERE workspace_id=p_workspace AND id=msg.id;
  ELSE
    buffer_id:=public.upsert_batch_and_link_message(p_workspace,conv.id,msg.id,p_silence_ms,true);
    UPDATE public.message_batches SET meta=meta || '{"isolated":true,"queue_intake":true}'::jsonb
      WHERE workspace_id=p_workspace AND id=buffer_id;
    INSERT INTO private.ai_reply_preparations(batch_id,workspace_id,conversation_id,mode,eligible,
      expected_revision,connection_id,identity_id,event_id,recipient)
      VALUES(buffer_id,p_workspace,conv.id,'queue',true,conv.state_revision,stored.connection_id,
        conv.identity_id,stored.id,stored.envelope->>'externalActorId');
  END IF;
  RETURN buffer_id;
END;
$$;

CREATE FUNCTION public.materialize_ycloud_pipeline(p_workspace uuid,p_integration uuid,p_event jsonb,
  p_customer_name text DEFAULT NULL,p_queue_ai boolean DEFAULT false,p_silence_ms integer DEFAULT 30000)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE stored public.inbound_events; msg public.messages; buffer_id uuid; inserted boolean:=false;
BEGIN
  IF p_queue_ai IS NULL OR p_silence_ms IS NULL OR p_silence_ms NOT BETWEEN 3000 AND 120000 THEN
    RAISE EXCEPTION 'PIPELINE_INPUT_INVALID' USING ERRCODE='22023'; END IF;
  stored:=private.ycloud_inbox_event(p_workspace,p_integration,p_event,false);
  SELECT * INTO msg FROM public.messages WHERE workspace_id=p_workspace AND connection_id=stored.connection_id
    AND external_message_id=stored.envelope->>'externalMessageId';
  IF FOUND THEN
    IF msg.direction<>'in' OR msg.type<>'text' OR msg.body IS DISTINCT FROM stored.envelope->'content'->>'text'
      OR msg.meta->>'inbound_event_id' IS DISTINCT FROM stored.id::text THEN
      RAISE EXCEPTION 'INBOX_MESSAGE_COLLISION' USING ERRCODE='23514'; END IF;
    IF EXISTS(SELECT 1 FROM private.ai_reply_preparations WHERE workspace_id=p_workspace
      AND conversation_id=msg.conversation_id AND ai_reply_preparations.batch_id=msg.batch_id AND mode='queue') THEN buffer_id:=msg.batch_id; END IF;
  ELSE
    msg:=private.ycloud_pipeline_message(p_workspace,stored,p_customer_name); inserted:=true;
    buffer_id:=private.ycloud_pipeline_batch(p_workspace,stored,msg,p_queue_ai,p_silence_ms);
  END IF;
  RETURN jsonb_build_object('eventId',stored.id,'conversationId',msg.conversation_id,'messageId',msg.id,
    'inserted',inserted,'batchId',buffer_id);
END;
$$;

REVOKE ALL ON FUNCTION private.ycloud_pipeline_conversation(uuid,uuid,uuid,uuid),
  private.ycloud_pipeline_message(uuid,public.inbound_events,text),
  private.ycloud_pipeline_batch(uuid,public.inbound_events,public.messages,boolean,integer),
  public.materialize_ycloud_pipeline(uuid,uuid,jsonb,text,boolean,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.ycloud_pipeline_conversation(uuid,uuid,uuid,uuid),
  private.ycloud_pipeline_message(uuid,public.inbound_events,text),
  private.ycloud_pipeline_batch(uuid,public.inbound_events,public.messages,boolean,integer),
  public.materialize_ycloud_pipeline(uuid,uuid,jsonb,text,boolean,integer) TO service_role;
