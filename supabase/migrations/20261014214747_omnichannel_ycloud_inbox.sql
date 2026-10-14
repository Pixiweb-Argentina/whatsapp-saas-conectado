-- Receive-only YCloud materialization. No grants, jobs, sends, CRM or AI.
CREATE FUNCTION private.ycloud_inbox_event(p_workspace uuid,p_integration uuid,p_event jsonb,p_historical boolean)
RETURNS public.inbound_events LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE connection public.channel_connections; stored public.inbound_events; event_id uuid;
BEGIN
  SELECT cc.* INTO STRICT connection FROM public.channel_connections cc JOIN public.integrations i
    ON i.id=cc.legacy_integration_id AND i.workspace_id=cc.workspace_id
    WHERE cc.workspace_id=p_workspace AND cc.id=(p_event->>'connectionId')::uuid
    AND i.id=p_integration AND i.provider='ycloud' AND i.enabled
    AND i.config->>'phone_number'=cc.external_account_id AND cc.channel='whatsapp'
    AND cc.provider='ycloud' AND cc.revoked_at IS NULL;
  IF (p_event->>'workspaceId'=p_workspace::text AND p_event->>'schemaVersion'='1'
    AND p_event->>'channel'='whatsapp' AND p_event->>'provider'='ycloud' AND p_event->>'kind'='message'
    AND p_event->>'externalActorId' ~ '^\+[1-9][0-9]{7,14}$'
    AND p_event->>'externalMessageId'=p_event->>'providerEventId'
    AND p_event->'content'->>'type'='text' AND jsonb_typeof(p_event->'content'->'text')='string'
    AND length(p_event->'content'->>'text') BETWEEN 1 AND 16000
    AND private.channel_timestamp(p_event->>'occurredAt')<=clock_timestamp()
    AND private.channel_timestamp(p_event->>'receivedAt')<=clock_timestamp()
    AND private.channel_timestamp(p_event->>'occurredAt')<=private.channel_timestamp(p_event->>'receivedAt')
    AND p_historical IS NOT NULL) IS NOT TRUE THEN
    RAISE EXCEPTION 'INBOX_EVENT_INVALID' USING ERRCODE='23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('ycloud-inbox:'||p_workspace::text||':'||
    connection.id::text||':'||(p_event->>'externalActorId'),0));
  event_id := public.persist_channel_event(p_event,p_historical);
  SELECT * INTO STRICT stored FROM public.inbound_events WHERE workspace_id=p_workspace AND id=event_id;
  IF stored.envelope-'receivedAt' IS DISTINCT FROM p_event-'receivedAt' THEN
    RAISE EXCEPTION 'INBOX_EVENT_COLLISION' USING ERRCODE='23514';
  END IF;
  RETURN stored;
END;
$$;

CREATE FUNCTION private.ycloud_inbox_contact(p_workspace uuid,p_actor text,p_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE contact_id uuid;
BEGIN
  IF p_name IS NOT NULL AND length(p_name)>200 THEN
    RAISE EXCEPTION 'INBOX_NAME_INVALID' USING ERRCODE='23514';
  END IF;
  -- Reception is not consent for campaigns. The legacy NOT NULL boolean uses
  -- false for new unconsented contacts. Existing consent/suppression is untouched.
  INSERT INTO public.contacts(workspace_id,phone,name,opt_in)
    VALUES(p_workspace,p_actor,p_name,false) ON CONFLICT(workspace_id,phone) DO NOTHING
    RETURNING id INTO contact_id;
  IF contact_id IS NULL THEN
    SELECT id INTO STRICT contact_id FROM public.contacts WHERE workspace_id=p_workspace AND phone=p_actor;
  END IF;
  RETURN contact_id;
END;
$$;

CREATE FUNCTION private.ycloud_inbox_identity(p_workspace uuid,p_connection uuid,p_contact uuid,p_actor text,p_historical boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE identity_row public.contact_identities;
BEGIN
  INSERT INTO public.contact_identities(workspace_id,connection_id,contact_id,external_user_id,verified_at)
    VALUES(p_workspace,p_connection,p_contact,p_actor,CASE WHEN p_historical THEN NULL ELSE clock_timestamp() END)
    ON CONFLICT(workspace_id,connection_id,external_user_id) DO NOTHING;
  SELECT * INTO STRICT identity_row FROM public.contact_identities WHERE workspace_id=p_workspace
    AND connection_id=p_connection AND external_user_id=p_actor FOR UPDATE;
  IF identity_row.contact_id<>p_contact THEN RAISE EXCEPTION 'INBOX_IDENTITY_COLLISION' USING ERRCODE='23514'; END IF;
  IF NOT p_historical AND identity_row.verified_at IS NULL THEN
    UPDATE public.contact_identities SET verified_at=clock_timestamp() WHERE workspace_id=p_workspace AND id=identity_row.id;
  END IF;
  RETURN identity_row.id;
END;
$$;

CREATE FUNCTION private.ycloud_inbox_conversation(p_workspace uuid,p_connection uuid,p_contact uuid,p_identity uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE conv public.conversations;
BEGIN
  INSERT INTO public.conversations(workspace_id,contact_id,channel,connection_id,identity_id,state,ai_enabled,source_context)
    VALUES(p_workspace,p_contact,'whatsapp',p_connection,p_identity,'human_active',false,
      '{"channel":"whatsapp","sourceType":"direct_message"}'::jsonb)
    ON CONFLICT ON CONSTRAINT uq_conversations_contact DO NOTHING;
  SELECT * INTO STRICT conv FROM public.conversations WHERE workspace_id=p_workspace
    AND contact_id=p_contact AND channel='whatsapp' FOR UPDATE;
  -- Preserve the legacy one-contact/channel constraint: never silently adopt or
  -- merge a different account. Broad multi-account upgrade remains separate.
  IF conv.connection_id IS DISTINCT FROM p_connection OR conv.identity_id IS DISTINCT FROM p_identity THEN
    RAISE EXCEPTION 'INBOX_CONVERSATION_COLLISION' USING ERRCODE='23514';
  END IF;
  IF conv.ai_enabled THEN RAISE EXCEPTION 'INBOX_AI_MUST_BE_PAUSED' USING ERRCODE='23514'; END IF;
  RETURN conv.id;
END;
$$;

CREATE FUNCTION public.materialize_ycloud_inbound(p_workspace uuid,p_integration uuid,p_event jsonb,
  p_customer_name text DEFAULT NULL,p_historical boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE stored public.inbound_events; existing public.messages; contact_id uuid; identity_id uuid;
  conversation_id uuid; message_id uuid; occurred timestamptz;
BEGIN
  stored := private.ycloud_inbox_event(p_workspace,p_integration,p_event,p_historical);
  SELECT * INTO existing FROM public.messages WHERE workspace_id=p_workspace AND connection_id=stored.connection_id
    AND external_message_id=stored.envelope->>'externalMessageId';
  IF FOUND THEN
    IF existing.direction<>'in' OR existing.type<>'text' OR existing.body IS DISTINCT FROM stored.envelope->'content'->>'text'
      OR existing.meta->>'inbound_event_id' IS DISTINCT FROM stored.id::text THEN
      RAISE EXCEPTION 'INBOX_MESSAGE_COLLISION' USING ERRCODE='23514';
    END IF;
    RETURN jsonb_build_object('eventId',stored.id,'conversationId',existing.conversation_id,'messageId',existing.id,'inserted',false);
  END IF;
  contact_id := private.ycloud_inbox_contact(p_workspace,stored.envelope->>'externalActorId',p_customer_name);
  identity_id := private.ycloud_inbox_identity(p_workspace,stored.connection_id,contact_id,
    stored.envelope->>'externalActorId',stored.historical);
  conversation_id := private.ycloud_inbox_conversation(p_workspace,stored.connection_id,contact_id,identity_id);
  occurred := private.channel_timestamp(stored.envelope->>'occurredAt');
  INSERT INTO public.messages(workspace_id,conversation_id,connection_id,provider,external_message_id,
    direction,type,body,wamid,status,created_at,meta)
    VALUES(p_workspace,conversation_id,stored.connection_id,'ycloud',stored.envelope->>'externalMessageId',
      'in','text',stored.envelope->'content'->>'text',stored.envelope->>'externalMessageId','delivered',occurred,
      jsonb_build_object('inbound_event_id',stored.id,'receive_only',true,'historical',stored.historical))
    RETURNING id INTO message_id;
  UPDATE public.conversations SET unread_count=unread_count+1,
    last_message_at=greatest(last_message_at,occurred),window_expires_at=greatest(window_expires_at,occurred+interval '24 hours')
    WHERE workspace_id=p_workspace AND id=conversation_id;
  RETURN jsonb_build_object('eventId',stored.id,'conversationId',conversation_id,'messageId',message_id,'inserted',true);
END;
$$;

REVOKE ALL ON FUNCTION private.ycloud_inbox_event(uuid,uuid,jsonb,boolean),
  private.ycloud_inbox_contact(uuid,text,text),private.ycloud_inbox_identity(uuid,uuid,uuid,text,boolean),
  private.ycloud_inbox_conversation(uuid,uuid,uuid,uuid),
  public.materialize_ycloud_inbound(uuid,uuid,jsonb,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.ycloud_inbox_event(uuid,uuid,jsonb,boolean),
  private.ycloud_inbox_contact(uuid,text,text),private.ycloud_inbox_identity(uuid,uuid,uuid,text,boolean),
  private.ycloud_inbox_conversation(uuid,uuid,uuid,uuid),
  public.materialize_ycloud_inbound(uuid,uuid,jsonb,text,boolean) TO service_role;
