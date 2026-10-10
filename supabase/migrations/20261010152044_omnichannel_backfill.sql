-- Explicit operator/server invocation only; applying this migration moves no data.
-- Each call is one atomic bounded batch. Re-run until remaining_* are zero.
-- Credentials stay in the legacy integration; no plaintext/ciphertext is copied.
CREATE FUNCTION private.lock_whatsapp_backfill_connection(p_workspace uuid,p_connection uuid)
RETURNS public.channel_connections LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE conn public.channel_connections%ROWTYPE;
BEGIN
  IF NOT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(p_workspace::text,0)) THEN
    RAISE EXCEPTION 'BACKFILL_BUSY' USING ERRCODE = '55P03';
  END IF;
  SELECT * INTO conn FROM public.channel_connections
    WHERE workspace_id = p_workspace AND id = p_connection AND channel = 'whatsapp' FOR UPDATE;
  IF NOT FOUND OR conn.revoked_at IS NOT NULL OR conn.legacy_integration_id IS NULL THEN
    RAISE EXCEPTION 'BACKFILL_CONNECTION_INVALID' USING ERRCODE = '23514';
  END IF;
  PERFORM 1 FROM public.integrations i
    WHERE i.id = conn.legacy_integration_id AND i.workspace_id = p_workspace
      AND i.provider::text = conn.provider AND i.enabled FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BACKFILL_PROVIDER_NOT_ACTIVE' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.channel_connections cc
    WHERE cc.workspace_id = p_workspace AND cc.channel = 'whatsapp' AND cc.id <> p_connection)
    OR (SELECT count(*) FROM public.integrations i WHERE i.workspace_id = p_workspace
      AND i.provider IN ('ycloud','kapso')) > 1 THEN
    RAISE EXCEPTION 'BACKFILL_PROVIDER_HISTORY_AMBIGUOUS' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.conversations c
    WHERE c.workspace_id = p_workspace AND c.channel = 'whatsapp'
      AND c.connection_id IS NOT NULL AND c.connection_id <> p_connection) THEN
    RAISE EXCEPTION 'BACKFILL_EXISTING_CONNECTION_MISMATCH' USING ERRCODE = '23514';
  END IF;
  RETURN conn;
END;
$$;

CREATE FUNCTION private.backfill_whatsapp_conversations(p_workspace uuid,p_connection uuid,p_limit integer)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  conv record; contact_phone text; identity_uuid uuid; identity_contact uuid; updated integer := 0;
BEGIN
  PERFORM private.lock_whatsapp_backfill_connection(p_workspace,p_connection);
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'BATCH_LIMIT_INVALID' USING ERRCODE = '22023';
  END IF;
  FOR conv IN SELECT c.id,c.contact_id FROM public.conversations c
    WHERE c.workspace_id = p_workspace AND c.channel = 'whatsapp' AND c.connection_id IS NULL
    ORDER BY c.id LIMIT p_limit FOR UPDATE SKIP LOCKED
  LOOP
    SELECT phone INTO contact_phone FROM public.contacts
      WHERE workspace_id = p_workspace AND id = conv.contact_id FOR UPDATE;
    IF contact_phone IS NULL OR contact_phone !~ '^\+[1-9][0-9]{7,14}$' THEN
      RAISE EXCEPTION 'BACKFILL_PHONE_INVALID' USING ERRCODE = '23514';
    END IF;
    INSERT INTO public.contact_identities(workspace_id,contact_id,connection_id,external_user_id)
      VALUES (p_workspace,conv.contact_id,p_connection,contact_phone)
      ON CONFLICT (workspace_id,connection_id,external_user_id) DO NOTHING;
    SELECT id,contact_id INTO identity_uuid,identity_contact FROM public.contact_identities
      WHERE workspace_id = p_workspace AND connection_id = p_connection AND external_user_id = contact_phone;
    IF identity_contact IS DISTINCT FROM conv.contact_id THEN
      RAISE EXCEPTION 'BACKFILL_IDENTITY_COLLISION' USING ERRCODE = '23505';
    END IF;
    UPDATE public.conversations SET connection_id = p_connection,identity_id = identity_uuid
      WHERE workspace_id = p_workspace AND id = conv.id;
    updated := updated + 1;
  END LOOP;
  RETURN updated;
END;
$$;

CREATE FUNCTION private.backfill_whatsapp_messages(p_workspace uuid,p_connection uuid,p_limit integer)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE conn public.channel_connections%ROWTYPE; updated integer;
BEGIN
  conn := private.lock_whatsapp_backfill_connection(p_workspace,p_connection);
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'BATCH_LIMIT_INVALID' USING ERRCODE = '22023';
  END IF;
  WITH batch AS (
    SELECT m.id FROM public.messages m JOIN public.conversations c
      ON c.workspace_id = m.workspace_id AND c.id = m.conversation_id
    WHERE m.workspace_id = p_workspace AND c.connection_id = p_connection AND m.connection_id IS NULL
    ORDER BY m.id LIMIT p_limit FOR UPDATE OF m SKIP LOCKED
  )
  UPDATE public.messages m SET connection_id = p_connection,provider = conn.provider,external_message_id = m.wamid
    FROM batch WHERE m.id = batch.id AND m.workspace_id = p_workspace;
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated;
END;
$$;

CREATE FUNCTION private.backfill_whatsapp_workspace(p_workspace uuid,p_connection uuid,p_limit integer DEFAULT 500)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  conversations_updated integer; messages_updated integer;
  remaining_conversations bigint; remaining_messages bigint;
BEGIN
  conversations_updated := private.backfill_whatsapp_conversations(p_workspace,p_connection,p_limit);
  messages_updated := private.backfill_whatsapp_messages(p_workspace,p_connection,p_limit);
  SELECT count(*) INTO remaining_conversations FROM public.conversations
    WHERE workspace_id = p_workspace AND channel = 'whatsapp' AND connection_id IS NULL;
  SELECT count(*) INTO remaining_messages FROM public.messages m JOIN public.conversations c
    ON c.workspace_id = m.workspace_id AND c.id = m.conversation_id
    WHERE m.workspace_id = p_workspace AND c.channel = 'whatsapp' AND m.connection_id IS NULL;
  RETURN jsonb_build_object('conversations_updated',conversations_updated,'messages_updated',messages_updated,
    'remaining_conversations',remaining_conversations,'remaining_messages',remaining_messages);
END;
$$;

REVOKE ALL ON FUNCTION private.lock_whatsapp_backfill_connection(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.backfill_whatsapp_conversations(uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.backfill_whatsapp_messages(uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.backfill_whatsapp_workspace(uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.lock_whatsapp_backfill_connection(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION private.backfill_whatsapp_conversations(uuid,uuid,integer) TO service_role;
GRANT EXECUTE ON FUNCTION private.backfill_whatsapp_messages(uuid,uuid,integer) TO service_role;
GRANT EXECUTE ON FUNCTION private.backfill_whatsapp_workspace(uuid,uuid,integer) TO service_role;
