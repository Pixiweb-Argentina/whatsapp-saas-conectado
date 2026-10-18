-- Managed Kapso Business App echoes: a human reply from the phone app becomes an outgoing human message
-- and pauses the AI in that conversation. Never creates contacts, never sends, never touches consent.
BEGIN;
CREATE FUNCTION public.persist_whatsapp_account_echo(p_workspace uuid,p_connection uuid,p_source_revision text,p_echo jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE source jsonb; echo private.business_app_echoes; inserted_id uuid;
BEGIN
  -- Locks connection and credentials until commit; revoke/rotation cannot race this check.
  source:=public.read_whatsapp_account_source(p_workspace,p_connection);
  IF source IS NULL OR p_source_revision IS DISTINCT FROM source->>'sourceRevision' THEN
    RAISE EXCEPTION 'ACCOUNT_SOURCE_STALE' USING ERRCODE='23514'; END IF;
  IF source->>'provider' IS DISTINCT FROM 'kapso' OR p_echo->>'connectionId' IS DISTINCT FROM p_connection::text
    OR p_echo->>'externalAccountId' IS DISTINCT FROM source->>'externalAccountId' THEN
    RAISE EXCEPTION 'ACCOUNT_ECHO_SCOPE_INVALID' USING ERRCODE='42501'; END IF;
  IF p_echo->>'occurredAt' IS NULL OR (p_echo->>'occurredAt')::timestamptz>clock_timestamp()
    OR p_echo->>'wamid' IS NULL OR p_echo->>'recipient' IS NULL OR p_echo->>'recipient' !~ '^\+[1-9][0-9]{7,14}$' THEN
    RAISE EXCEPTION 'ACCOUNT_ECHO_INPUT_INVALID' USING ERRCODE='22023'; END IF;
  -- Same per-contact lock as managed intake, so an echo and an inbound for one contact never interleave.
  PERFORM pg_advisory_xact_lock(hashtextextended('account-inbox:'||p_workspace||':'||p_connection||':'||(p_echo->>'recipient'),0));
  INSERT INTO private.business_app_echoes(workspace_id,connection_id,wamid,recipient,type,body,occurred_at)
    VALUES(p_workspace,p_connection,p_echo->>'wamid',p_echo->>'recipient',(p_echo->>'type')::public.message_type,
      p_echo->>'body',(p_echo->>'occurredAt')::timestamptz)
    ON CONFLICT(workspace_id,connection_id,wamid) DO NOTHING RETURNING id INTO inserted_id;
  SELECT * INTO STRICT echo FROM private.business_app_echoes WHERE workspace_id=p_workspace AND connection_id=p_connection
    AND wamid=p_echo->>'wamid' FOR UPDATE;
  IF (echo.recipient,echo.type,echo.body,echo.occurred_at) IS DISTINCT FROM
    (p_echo->>'recipient',(p_echo->>'type')::public.message_type,p_echo->>'body',(p_echo->>'occurredAt')::timestamptz) THEN
    RAISE EXCEPTION 'ACCOUNT_ECHO_CONFLICT' USING ERRCODE='23514'; END IF;
  IF inserted_id IS NULL OR echo.state='ignored' THEN
    RETURN jsonb_build_object('conversationId',echo.conversation_id,'inserted',false,'aiDisabled',false); END IF;
  -- Finds the conversation only through the verified identity of a contact who already wrote in.
  RETURN private.apply_business_app_echo(echo);
END;
$$;
REVOKE ALL ON FUNCTION public.persist_whatsapp_account_echo(uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.persist_whatsapp_account_echo(uuid,uuid,text,jsonb) TO service_role;
COMMIT;
