-- Scope provider IDs to the verified connection; NULL legacy routing stays one scope.
-- Derived from server-bound connection_id, never accepted as a client-selected scope.
-- Leaves nullable wamid behavior and all IDs/history/roles/RLS unchanged.
BEGIN;
-- Ordinary column preserves REPLICA IDENTITY FULL / Realtime compatibility.
ALTER TABLE public.messages ADD COLUMN message_account_scope text NOT NULL DEFAULT 'legacy';
UPDATE public.messages SET message_account_scope=connection_id::text WHERE connection_id IS NOT NULL;
CREATE FUNCTION private.bind_message_account_scope() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  NEW.message_account_scope:=coalesce(NEW.connection_id::text,'legacy');
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.bind_message_account_scope() FROM PUBLIC,anon,authenticated;
-- Runs after trg_messages_bind_channel has validated/filled connection_id.
CREATE TRIGGER trg_messages_z_account_scope BEFORE INSERT OR UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION private.bind_message_account_scope();
ALTER TABLE public.messages ADD CONSTRAINT ck_message_account_scope
  CHECK (message_account_scope=coalesce(connection_id::text,'legacy'));
ALTER TABLE public.messages DROP CONSTRAINT uq_messages_wamid;
ALTER TABLE public.messages ADD CONSTRAINT uq_messages_wamid
  UNIQUE (workspace_id,message_account_scope,wamid);
COMMENT ON COLUMN public.messages.message_account_scope IS
  'Server-derived dedup scope: verified connection UUID, or legacy for unmapped history. Not routing authority.';

CREATE OR REPLACE FUNCTION private.apply_business_app_echo(echo private.business_app_echoes)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE conv public.conversations; msg public.messages; inserted_id uuid; changed boolean:=false;
BEGIN
  SELECT c.* INTO conv FROM public.conversations c JOIN public.contact_identities i
    ON i.workspace_id=c.workspace_id AND i.id=c.identity_id AND i.connection_id=c.connection_id AND i.contact_id=c.contact_id
    WHERE c.workspace_id=echo.workspace_id AND c.connection_id=echo.connection_id AND c.channel='whatsapp'
      AND i.external_user_id=echo.recipient AND i.verified_at IS NOT NULL FOR UPDATE OF c;
  IF NOT FOUND THEN
    UPDATE private.business_app_echoes SET state='ignored',reason='identity_unavailable' WHERE id=echo.id;
    RETURN jsonb_build_object('conversationId',NULL,'inserted',false,'aiDisabled',false);
  END IF;
  INSERT INTO public.messages(workspace_id,conversation_id,connection_id,direction,type,body,wamid,status,meta,created_at)
    VALUES(echo.workspace_id,conv.id,echo.connection_id,'out',echo.type,echo.body,echo.wamid,'sent',
      jsonb_build_object('origin','business_app','channel_actor','human'),echo.occurred_at)
    ON CONFLICT(workspace_id,message_account_scope,wamid) DO NOTHING RETURNING id INTO inserted_id;
  SELECT * INTO msg FROM public.messages WHERE workspace_id=echo.workspace_id AND connection_id=echo.connection_id AND wamid=echo.wamid FOR UPDATE;
  IF FOUND AND (msg.conversation_id<>conv.id OR msg.direction<>'out' OR msg.channel_operation_id IS NOT NULL
    OR msg.meta->>'origin' IS DISTINCT FROM 'business_app') THEN
    RAISE EXCEPTION 'ECHO_MESSAGE_CONFLICT' USING ERRCODE='23514'; END IF;
  -- New evidence older than an explicit control change may update history, never undo a resume/close.
  IF conv.state<>'closed' AND (conv.channel_control_changed_at IS NULL OR echo.occurred_at>conv.channel_control_changed_at)
    AND (conv.state<>'human_active' OR conv.ai_enabled) THEN
    UPDATE public.conversations SET state='human_active',ai_enabled=false WHERE workspace_id=echo.workspace_id AND id=conv.id;
    INSERT INTO public.events(workspace_id,conversation_id,type,level,payload) VALUES(echo.workspace_id,conv.id,'state_change','info',
      jsonb_build_object('from',conv.state,'to','human_active','trigger','business_app','echoId',echo.id));
    changed:=true;
  END IF;
  UPDATE public.conversations SET last_message_at=greatest(last_message_at,echo.occurred_at)
    WHERE workspace_id=echo.workspace_id AND id=conv.id;
  UPDATE private.business_app_echoes SET state='planned',conversation_id=conv.id,
    reason=CASE WHEN conv.channel_control_changed_at IS NOT NULL AND echo.occurred_at<=conv.channel_control_changed_at
      THEN 'older_than_control' END WHERE id=echo.id;
  RETURN jsonb_build_object('conversationId',conv.id,'inserted',inserted_id IS NOT NULL,'aiDisabled',changed);
END;
$$;

-- Legacy status updates lack the durable receipt contract. Never pick one account
-- from repeated provider IDs, or accept another account's sole matching message.
CREATE FUNCTION public.read_legacy_whatsapp_message(p_workspace uuid,p_wamid text,
  p_provider_message_id text,p_routing jsonb)
RETURNS SETOF public.messages LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE integration public.integrations; msg public.messages; conv public.conversations;
  matches uuid[]; contact uuid; configured_account text;
BEGIN
  integration:=private.legacy_whatsapp_integration(p_workspace,p_routing);
  configured_account:=CASE integration.provider::text WHEN 'ycloud' THEN integration.config->>'phone_number'
    WHEN 'kapso' THEN integration.config->>'phone_number_id' END;
  IF configured_account IS NULL OR p_routing->>'accountId' IS DISTINCT FROM configured_account
    OR (p_wamid IS NULL AND p_provider_message_id IS NULL)
    OR length(p_wamid) NOT BETWEEN 1 AND 512 OR length(p_provider_message_id) NOT BETWEEN 1 AND 512 THEN
    RAISE EXCEPTION 'LEGACY_STATUS_INPUT_INVALID' USING ERRCODE='22023'; END IF;
  SELECT array_agg(candidate.id) INTO matches FROM (
    SELECT m.id FROM public.messages m WHERE m.workspace_id=p_workspace
      AND (m.wamid=p_wamid OR (integration.provider='ycloud' AND p_provider_message_id IS NOT NULL
        AND m.meta @> jsonb_build_object('ycloud_id',p_provider_message_id)))
      ORDER BY m.id LIMIT 2) candidate;
  IF coalesce(cardinality(matches),0)=0 THEN RETURN; END IF;
  IF cardinality(matches)>1 THEN RAISE EXCEPTION 'LEGACY_MESSAGE_STATUS_AMBIGUOUS' USING ERRCODE='23514'; END IF;
  SELECT * INTO STRICT msg FROM public.messages WHERE workspace_id=p_workspace AND id=matches[1];
  IF msg.direction<>'out' OR msg.channel_operation_id IS NOT NULL THEN RETURN; END IF;
  IF (p_wamid IS NOT NULL AND msg.wamid IS NOT NULL AND p_wamid<>msg.wamid)
    OR (integration.provider='ycloud' AND p_provider_message_id IS NOT NULL
      AND msg.meta->>'ycloud_id' IS NOT NULL AND msg.meta->>'ycloud_id'<>p_provider_message_id) THEN
    RAISE EXCEPTION 'LEGACY_STATUS_ID_CONFLICT' USING ERRCODE='23514'; END IF;
  SELECT c.contact_id INTO STRICT contact FROM public.conversations c
    WHERE c.workspace_id=p_workspace AND c.id=msg.conversation_id;
  BEGIN
    conv:=private.legacy_whatsapp_conversation(p_workspace,contact,integration,configured_account);
  EXCEPTION WHEN check_violation OR foreign_key_violation THEN RETURN;
  END;
  IF conv.id=msg.conversation_id THEN RETURN NEXT msg; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.read_legacy_whatsapp_message(uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_legacy_whatsapp_message(uuid,text,text,jsonb) TO service_role;
COMMIT;
