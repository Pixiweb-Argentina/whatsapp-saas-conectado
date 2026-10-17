-- Receive-only media/location/interactive materialization for managed YCloud/Kapso sources.
-- Same gates as the text inbox; template/system stay capture-only. No backfill, enablement, download or send.
BEGIN;
CREATE OR REPLACE FUNCTION private.whatsapp_account_inbox_event(p_workspace uuid,p_connection uuid,p_source_revision text,p_event jsonb)
RETURNS public.inbound_events LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE stored public.inbound_events; event_id uuid; received timestamptz:=clock_timestamp();
BEGIN
  IF (p_event->>'workspaceId'=p_workspace::text AND p_event->>'connectionId'=p_connection::text
    AND p_event->>'schemaVersion'='1' AND p_event->>'channel'='whatsapp' AND p_event->>'kind'='message'
    AND p_event->>'provider' IN ('ycloud','kapso') AND p_event->>'externalActorId' ~ '^\+[1-9][0-9]{7,14}$'
    AND p_event->>'externalMessageId'=p_event->>'providerEventId'
    AND p_event->'content'->>'type' IN ('text','audio','image','document','video','sticker','location')
    AND jsonb_typeof(p_event->'content'->'rawType')='string' AND length(p_event->'content'->>'rawType') BETWEEN 1 AND 64
    AND CASE WHEN p_event->'content'->>'type'='text'
      THEN jsonb_typeof(p_event->'content'->'text')='string' AND length(p_event->'content'->>'text') BETWEEN 1 AND 16000
      ELSE jsonb_typeof(p_event->'content'->'text')='null'
        OR (jsonb_typeof(p_event->'content'->'text')='string' AND length(p_event->'content'->>'text')<=16000) END
    AND jsonb_typeof(p_event->'mediaRefs')='array' AND jsonb_array_length(p_event->'mediaRefs')<=1
    AND private.channel_timestamp(p_event->>'occurredAt')<=received
    AND private.channel_timestamp(p_event->>'receivedAt')<=received+interval '5 seconds'
    AND private.channel_timestamp(p_event->>'occurredAt')<=private.channel_timestamp(p_event->>'receivedAt')) IS NOT TRUE THEN
    RAISE EXCEPTION 'ACCOUNT_INBOX_EVENT_INVALID' USING ERRCODE='23514'; END IF;
  p_event:=jsonb_set(p_event,'{receivedAt}',to_jsonb(to_char(least(private.channel_timestamp(p_event->>'receivedAt'),received)
    AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
  PERFORM pg_advisory_xact_lock(hashtextextended('account-inbox:'||p_workspace||':'||p_connection||':'||(p_event->>'externalActorId'),0));
  event_id:=public.persist_whatsapp_account_delivery(p_workspace,p_connection,p_source_revision,'message',p_event);
  SELECT * INTO STRICT stored FROM public.inbound_events WHERE workspace_id=p_workspace AND connection_id=p_connection AND id=event_id;
  RETURN stored;
END;
$$;

CREATE OR REPLACE FUNCTION public.materialize_whatsapp_account_inbound(p_workspace uuid,p_connection uuid,p_source_revision text,
  p_event jsonb,p_customer_name text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE stored public.inbound_events; existing public.messages; contact_id uuid; identity_id uuid; conversation_id uuid; message_id uuid;
  occurred timestamptz; kind public.message_type; content_body text;
BEGIN
  stored:=private.whatsapp_account_inbox_event(p_workspace,p_connection,p_source_revision,p_event);
  kind:=(stored.envelope->'content'->>'type')::public.message_type;
  -- Media without caption gets the same visible placeholder the legacy inbox uses; the file arrives later in meta.
  content_body:=CASE WHEN kind='text' THEN stored.envelope->'content'->>'text'
    ELSE coalesce(nullif(stored.envelope->'content'->>'text',''),'[Multimedia]') END;
  SELECT * INTO existing FROM public.messages WHERE workspace_id=p_workspace AND connection_id=p_connection
    AND external_message_id=stored.envelope->>'externalMessageId';
  IF FOUND THEN
    IF existing.direction<>'in' OR existing.type<>kind OR existing.provider IS DISTINCT FROM stored.envelope->>'provider'
      OR existing.body IS DISTINCT FROM content_body
      OR existing.meta->>'inbound_event_id' IS DISTINCT FROM stored.id::text THEN
      RAISE EXCEPTION 'ACCOUNT_INBOX_MESSAGE_COLLISION' USING ERRCODE='23514'; END IF;
    RETURN jsonb_build_object('eventId',stored.id,'conversationId',existing.conversation_id,'messageId',existing.id,'inserted',false);
  END IF;
  -- Once known, the verified account identity owns the contact; its editable phone cannot reroute intake.
  SELECT i.contact_id INTO contact_id FROM public.contact_identities i WHERE i.workspace_id=p_workspace
    AND i.connection_id=p_connection AND i.external_user_id=stored.envelope->>'externalActorId' FOR UPDATE;
  IF contact_id IS NULL THEN contact_id:=private.ycloud_inbox_contact(p_workspace,stored.envelope->>'externalActorId',p_customer_name); END IF;
  identity_id:=private.ycloud_inbox_identity(p_workspace,p_connection,contact_id,stored.envelope->>'externalActorId',false);
  conversation_id:=private.ycloud_inbox_conversation(p_workspace,p_connection,contact_id,identity_id);
  occurred:=private.channel_timestamp(stored.envelope->>'occurredAt');
  INSERT INTO public.messages(workspace_id,conversation_id,connection_id,provider,external_message_id,direction,type,body,wamid,status,created_at,meta)
    VALUES(p_workspace,conversation_id,p_connection,stored.envelope->>'provider',stored.envelope->>'externalMessageId',
      'in',kind,content_body,stored.envelope->>'externalMessageId','delivered',occurred,
      jsonb_build_object('inbound_event_id',stored.id,'receive_only',true,'managed_account',true,
        'raw_type',stored.envelope->'content'->>'rawType')) RETURNING id INTO message_id;
  UPDATE public.conversations SET unread_count=unread_count+1,last_message_at=greatest(last_message_at,occurred),
    window_expires_at=greatest(window_expires_at,occurred+interval '24 hours') WHERE workspace_id=p_workspace AND id=conversation_id;
  UPDATE public.inbound_events SET state='planned' WHERE workspace_id=p_workspace AND connection_id=p_connection AND id=stored.id;
  RETURN jsonb_build_object('eventId',stored.id,'conversationId',conversation_id,'messageId',message_id,'inserted',true);
END;
$$;
REVOKE ALL ON FUNCTION private.whatsapp_account_inbox_event(uuid,uuid,text,jsonb),
  public.materialize_whatsapp_account_inbound(uuid,uuid,text,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.whatsapp_account_inbox_event(uuid,uuid,text,jsonb),
  public.materialize_whatsapp_account_inbound(uuid,uuid,text,jsonb,text) TO service_role;
COMMIT;
