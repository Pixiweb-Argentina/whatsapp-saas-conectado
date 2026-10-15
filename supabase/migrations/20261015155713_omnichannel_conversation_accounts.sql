-- Preserve legacy NULL routing while separating each explicit account.
ALTER TABLE public.conversations DROP CONSTRAINT uq_conversations_contact;
ALTER TABLE public.conversations ADD CONSTRAINT uq_conversations_contact
  UNIQUE NULLS NOT DISTINCT (workspace_id,contact_id,channel,connection_id);

-- Trigger-only authority: inspect all sibling rows, including ones hidden by RLS.
-- Locking the contact also serializes legacy creation, binding and new intake.
CREATE FUNCTION private.guard_conversation_account_scope() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM 1 FROM public.contacts WHERE workspace_id=NEW.workspace_id AND id=NEW.contact_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.conversations c WHERE c.workspace_id=NEW.workspace_id
    AND c.contact_id=NEW.contact_id AND c.channel=NEW.channel AND c.id<>NEW.id
    AND ((NEW.connection_id IS NULL) <> (c.connection_id IS NULL))) THEN
    RAISE EXCEPTION 'CONVERSATION_LEGACY_ACCOUNT_COLLISION' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.guard_conversation_account_scope() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER trg_conversation_account_scope BEFORE INSERT OR UPDATE OF
  workspace_id,contact_id,channel,connection_id,identity_id ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION private.guard_conversation_account_scope();

CREATE FUNCTION private.ycloud_account_conversation(p_workspace uuid,p_connection uuid,p_contact uuid,p_identity uuid)
RETURNS public.conversations LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE conv public.conversations;
BEGIN
  PERFORM 1 FROM public.contacts WHERE workspace_id=p_workspace AND id=p_contact FOR UPDATE;
  INSERT INTO public.conversations(workspace_id,contact_id,channel,connection_id,identity_id,state,ai_enabled,source_context)
    VALUES(p_workspace,p_contact,'whatsapp',p_connection,p_identity,'human_active',false,
      '{"channel":"whatsapp","sourceType":"direct_message"}'::jsonb)
    ON CONFLICT ON CONSTRAINT uq_conversations_contact DO NOTHING;
  SELECT * INTO STRICT conv FROM public.conversations WHERE workspace_id=p_workspace
    AND contact_id=p_contact AND channel='whatsapp' AND connection_id=p_connection FOR UPDATE;
  IF conv.identity_id IS DISTINCT FROM p_identity THEN
    RAISE EXCEPTION 'INBOX_CONVERSATION_COLLISION' USING ERRCODE='23514'; END IF;
  RETURN conv;
END;
$$;
CREATE OR REPLACE FUNCTION private.ycloud_inbox_conversation(p_workspace uuid,p_connection uuid,p_contact uuid,p_identity uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE conv public.conversations;
BEGIN
  conv:=private.ycloud_account_conversation(p_workspace,p_connection,p_contact,p_identity);
  IF conv.ai_enabled THEN RAISE EXCEPTION 'INBOX_AI_MUST_BE_PAUSED' USING ERRCODE='23514'; END IF;
  RETURN conv.id;
END;
$$;
CREATE OR REPLACE FUNCTION private.ycloud_pipeline_conversation(p_workspace uuid,p_connection uuid,p_contact uuid,p_identity uuid)
RETURNS public.conversations LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT private.ycloud_account_conversation(p_workspace,p_connection,p_contact,p_identity);
$$;

-- Resolve ONLY the original unambiguous WA thread. No newest-thread fallback.
CREATE FUNCTION private.legacy_whatsapp_conversation(p_workspace uuid,p_contact uuid,
  integration public.integrations,p_account text)
RETURNS public.conversations LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE conv public.conversations;
BEGIN
  PERFORM 1 FROM public.contacts WHERE workspace_id=p_workspace AND id=p_contact FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LEGACY_CONTACT_NOT_FOUND' USING ERRCODE='23503'; END IF;
  IF (SELECT count(*) FROM public.conversations WHERE workspace_id=p_workspace
    AND contact_id=p_contact AND channel='whatsapp')>1 THEN
    RAISE EXCEPTION 'LEGACY_MULTIPLE_CONVERSATIONS' USING ERRCODE='23514'; END IF;
  SELECT * INTO conv FROM public.conversations WHERE workspace_id=p_workspace
    AND contact_id=p_contact AND channel='whatsapp' FOR UPDATE;
  IF conv.id IS NULL THEN RETURN conv; END IF;
  IF conv.source_context<>'{}'::jsonb OR EXISTS (SELECT 1 FROM private.ai_reply_preparations p
    WHERE p.workspace_id=p_workspace AND p.conversation_id=conv.id AND p.mode='queue') THEN
    RAISE EXCEPTION 'LEGACY_DURABLE_CONVERSATION' USING ERRCODE='23514'; END IF;
  IF conv.connection_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.channel_connections cc WHERE cc.workspace_id=p_workspace AND cc.id=conv.connection_id
      AND cc.revoked_at IS NULL AND cc.legacy_integration_id=integration.id AND integration.enabled
      AND cc.provider=integration.provider::text AND cc.external_account_id=p_account
      AND cc.external_account_id=CASE cc.provider WHEN 'ycloud' THEN integration.config->>'phone_number'
        WHEN 'kapso' THEN integration.config->>'phone_number_id' END) THEN
    RAISE EXCEPTION 'LEGACY_ACCOUNT_UNAVAILABLE' USING ERRCODE='23514'; END IF;
  RETURN conv;
END;
$$;

CREATE FUNCTION private.legacy_whatsapp_integration(p_workspace uuid,p_routing jsonb)
RETURNS public.integrations LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE integration public.integrations;
BEGIN
  IF p_workspace IS NULL OR jsonb_typeof(p_routing) IS DISTINCT FROM 'object'
    OR (p_routing->>'provider' IN ('ycloud','kapso')) IS NOT TRUE
    OR p_routing->>'integrationId' IS NULL
    OR (p_routing->>'accountId' IS NOT NULL AND length(p_routing->>'accountId') NOT BETWEEN 1 AND 512) THEN
    RAISE EXCEPTION 'INVALID_LEGACY_ROUTING' USING ERRCODE='22023'; END IF;
  SELECT * INTO STRICT integration FROM public.integrations WHERE workspace_id=p_workspace
    AND id=(p_routing->>'integrationId')::uuid AND provider::text=p_routing->>'provider' AND enabled FOR SHARE;
  RETURN integration;
END;
$$;

-- Contact/profile updates roll back if routing is stale, ambiguous or queue-owned.
-- This preserves the original legacy opt-in semantics, not the queue policy.
CREATE FUNCTION public.upsert_legacy_whatsapp_inbound(p_workspace uuid,p_phone text,p_name text,p_routing jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE integration public.integrations; contact public.contacts; conv public.conversations;
BEGIN
  integration:=private.legacy_whatsapp_integration(p_workspace,p_routing);
  IF p_phone IS NULL OR p_phone !~ '^\+[1-9][0-9]{7,14}$' OR length(p_name)>200 THEN
    RAISE EXCEPTION 'INVALID_LEGACY_CONTACT' USING ERRCODE='22023'; END IF;
  INSERT INTO public.contacts(workspace_id,phone,name,opt_in,opt_in_at)
    VALUES(p_workspace,p_phone,p_name,true,clock_timestamp()) ON CONFLICT(workspace_id,phone)
    DO UPDATE SET name=EXCLUDED.name,opt_in=true,opt_in_at=EXCLUDED.opt_in_at RETURNING * INTO contact;
  conv:=private.legacy_whatsapp_conversation(p_workspace,contact.id,integration,p_routing->>'accountId');
  IF conv.id IS NULL THEN
    INSERT INTO public.conversations(workspace_id,contact_id,channel,last_message_at,window_expires_at,unread_count)
      VALUES(p_workspace,contact.id,'whatsapp',clock_timestamp(),clock_timestamp()+interval '24 hours',1)
      RETURNING * INTO conv;
  ELSE
    UPDATE public.conversations SET last_message_at=clock_timestamp(),
      window_expires_at=clock_timestamp()+interval '24 hours',unread_count=1
      WHERE workspace_id=p_workspace AND id=conv.id RETURNING * INTO conv;
  END IF;
  RETURN jsonb_build_object('contact',to_jsonb(contact),'conversation',to_jsonb(conv));
END;
$$;

-- NULL routing is for contact-level legacy automations: only one WA thread,
-- with the current configured account. Explicit routing is for signed echoes.
CREATE FUNCTION public.read_legacy_whatsapp_conversation(p_workspace uuid,p_contact uuid,p_routing jsonb DEFAULT NULL)
RETURNS SETOF public.conversations LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE integration public.integrations; conv public.conversations; account_id text;
BEGIN
  IF p_routing IS NOT NULL THEN
    integration:=private.legacy_whatsapp_integration(p_workspace,p_routing);
    account_id:=p_routing->>'accountId';
  ELSE
    SELECT * INTO integration FROM public.integrations WHERE workspace_id=p_workspace
      AND provider IN ('ycloud','kapso') AND enabled FOR SHARE;
    account_id:=CASE integration.provider::text WHEN 'ycloud' THEN integration.config->>'phone_number'
      WHEN 'kapso' THEN integration.config->>'phone_number_id' END;
  END IF;
  BEGIN
    conv:=private.legacy_whatsapp_conversation(p_workspace,p_contact,integration,account_id);
  EXCEPTION WHEN check_violation OR foreign_key_violation THEN RETURN;
  END;
  IF conv.id IS NOT NULL THEN RETURN NEXT conv; END IF;
END;
$$;

REVOKE ALL ON FUNCTION private.ycloud_account_conversation(uuid,uuid,uuid,uuid),
  private.legacy_whatsapp_conversation(uuid,uuid,public.integrations,text),
  private.legacy_whatsapp_integration(uuid,jsonb),public.upsert_legacy_whatsapp_inbound(uuid,text,text,jsonb),
  public.read_legacy_whatsapp_conversation(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.ycloud_account_conversation(uuid,uuid,uuid,uuid),
  private.legacy_whatsapp_conversation(uuid,uuid,public.integrations,text),
  private.legacy_whatsapp_integration(uuid,jsonb),public.upsert_legacy_whatsapp_inbound(uuid,text,text,jsonb),
  public.read_legacy_whatsapp_conversation(uuid,uuid,jsonb) TO service_role;
