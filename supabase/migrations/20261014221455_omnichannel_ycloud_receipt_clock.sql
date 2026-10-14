-- Bound receipt-clock skew to five seconds; never store a future receipt.
-- Provider occurredAt remains strict. CREATE OR REPLACE preserves service-only ACLs.
CREATE OR REPLACE FUNCTION private.ycloud_inbox_event(p_workspace uuid,p_integration uuid,p_event jsonb,p_historical boolean)
RETURNS public.inbound_events LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE connection public.channel_connections; stored public.inbound_events; event_id uuid;
  database_received timestamptz := clock_timestamp();
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
    AND private.channel_timestamp(p_event->>'occurredAt')<=database_received
    AND private.channel_timestamp(p_event->>'receivedAt')<=database_received+interval '5 seconds'
    AND private.channel_timestamp(p_event->>'occurredAt')<=private.channel_timestamp(p_event->>'receivedAt')
    AND p_historical IS NOT NULL) IS NOT TRUE THEN
    RAISE EXCEPTION 'INBOX_EVENT_INVALID' USING ERRCODE='23514';
  END IF;
  p_event := jsonb_set(p_event,'{receivedAt}',to_jsonb(to_char(
    least(private.channel_timestamp(p_event->>'receivedAt'),database_received) AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
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
