-- A physical human reply is evidence of activity, never consent or a new send permit.
ALTER TABLE public.conversations ADD COLUMN channel_control_changed_at timestamptz;
CREATE FUNCTION private.stamp_channel_control() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF TG_OP='INSERT' THEN NEW.channel_control_changed_at:=NULL; RETURN NEW; END IF;
  NEW.channel_control_changed_at:=CASE WHEN (NEW.state,NEW.ai_enabled,NEW.assigned_to)
    IS DISTINCT FROM (OLD.state,OLD.ai_enabled,OLD.assigned_to) THEN clock_timestamp() ELSE OLD.channel_control_changed_at END;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_channel_control_stamp BEFORE INSERT OR UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION private.stamp_channel_control();
REVOKE ALL ON FUNCTION private.stamp_channel_control() FROM PUBLIC,anon,authenticated;

CREATE TABLE private.business_app_echoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,connection_id uuid NOT NULL,
  wamid text NOT NULL CHECK(length(wamid) BETWEEN 1 AND 512),
  recipient text NOT NULL CHECK(recipient ~ '^\+[1-9][0-9]{7,14}$'),
  type public.message_type NOT NULL,body text CHECK(length(body)<=4096),occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','planned','ignored')),
  conversation_id uuid,reason text,
  FOREIGN KEY(workspace_id,connection_id) REFERENCES public.channel_connections(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id,conversation_id) REFERENCES public.conversations(workspace_id,id) ON DELETE CASCADE,
  UNIQUE(workspace_id,connection_id,wamid)
);
ALTER TABLE private.business_app_echoes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.business_app_echoes FROM PUBLIC,anon,authenticated;
GRANT ALL ON private.business_app_echoes TO service_role;

CREATE FUNCTION private.apply_business_app_echo(echo private.business_app_echoes)
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
    ON CONFLICT(workspace_id,wamid) DO NOTHING RETURNING id INTO inserted_id;
  SELECT * INTO msg FROM public.messages WHERE workspace_id=echo.workspace_id AND wamid=echo.wamid FOR UPDATE;
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

CREATE FUNCTION public.persist_business_app_echo(p_workspace_id uuid,p_integration_id uuid,p_echo jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE connection public.channel_connections; echo private.business_app_echoes; inserted_id uuid;
BEGIN
  SELECT * INTO connection FROM public.channel_connections WHERE workspace_id=p_workspace_id
    AND id=(p_echo->>'connectionId')::uuid AND legacy_integration_id=p_integration_id AND channel='whatsapp'
    AND provider='kapso' AND external_account_id=p_echo->>'externalAccountId';
  IF NOT FOUND THEN RAISE EXCEPTION 'ECHO_SCOPE_INVALID' USING ERRCODE='42501'; END IF;
  IF (p_echo->>'occurredAt')::timestamptz>clock_timestamp() OR p_echo->>'occurredAt' IS NULL
    OR p_echo->>'wamid' IS NULL THEN RAISE EXCEPTION 'ECHO_INPUT_INVALID' USING ERRCODE='22023'; END IF;
  INSERT INTO private.business_app_echoes(workspace_id,connection_id,wamid,recipient,type,body,occurred_at,state,reason)
    VALUES(p_workspace_id,connection.id,p_echo->>'wamid',p_echo->>'recipient',(p_echo->>'type')::public.message_type,
      p_echo->>'body',(p_echo->>'occurredAt')::timestamptz,
      CASE WHEN connection.revoked_at IS NOT NULL OR connection.status='revoked' THEN 'ignored' ELSE 'pending' END,
      CASE WHEN connection.revoked_at IS NOT NULL OR connection.status='revoked' THEN 'revoked' END)
    ON CONFLICT(workspace_id,connection_id,wamid) DO NOTHING RETURNING id INTO inserted_id;
  SELECT * INTO echo FROM private.business_app_echoes WHERE workspace_id=p_workspace_id AND connection_id=connection.id
    AND wamid=p_echo->>'wamid' FOR UPDATE;
  IF (echo.recipient,echo.type,echo.body,echo.occurred_at) IS DISTINCT FROM
    (p_echo->>'recipient',(p_echo->>'type')::public.message_type,p_echo->>'body',(p_echo->>'occurredAt')::timestamptz) THEN
    RAISE EXCEPTION 'ECHO_CONFLICT' USING ERRCODE='23514'; END IF;
  IF inserted_id IS NULL OR echo.state='ignored' THEN
    RETURN jsonb_build_object('conversationId',echo.conversation_id,'inserted',false,'aiDisabled',false); END IF;
  RETURN private.apply_business_app_echo(echo);
END;
$$;
REVOKE ALL ON FUNCTION private.apply_business_app_echo(private.business_app_echoes),public.persist_business_app_echo(uuid,uuid,jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.apply_business_app_echo(private.business_app_echoes),public.persist_business_app_echo(uuid,uuid,jsonb) TO service_role;
