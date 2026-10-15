-- Additive account registration. No migration of credentials, enablement or cutover.
BEGIN;
CREATE FUNCTION private.require_account_operator(p_workspace uuid,p_actor uuid,p_write boolean)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  PERFORM 1 FROM public.memberships WHERE workspace_id=p_workspace AND user_id=p_actor
    AND is_active AND (role='admin' OR (NOT p_write AND role='manager')) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ACCOUNT_OPERATOR_FORBIDDEN' USING ERRCODE='42501'; END IF;
END;
$$;

CREATE FUNCTION public.read_whatsapp_accounts(p_workspace uuid,p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
  PERFORM private.require_account_operator(p_workspace,p_actor,false);
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',cc.id,'provider',cc.provider,
    'externalAccountId',cc.external_account_id,'displayName',cc.display_name,'status',cc.status,
    'managed',cc.legacy_integration_id IS NULL,'updatedAt',cc.updated_at,
    'credentialsStored',EXISTS(SELECT 1 FROM private.channel_credentials k
      WHERE k.workspace_id=p_workspace AND k.connection_id=cc.id)
      OR EXISTS(SELECT 1 FROM public.integrations i WHERE i.workspace_id=p_workspace
        AND i.id=cc.legacy_integration_id AND length(i.credentials->>'api_key')>0))
    ORDER BY cc.created_at,cc.id),'[]'::jsonb) INTO result
    FROM public.channel_connections cc WHERE cc.workspace_id=p_workspace AND cc.channel='whatsapp';
  RETURN result;
END;
$$;

CREATE FUNCTION public.register_whatsapp_account(p_workspace uuid,p_actor uuid,p_connection uuid,
  p_provider text,p_account text,p_label text,p_payload text,p_key_version integer) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE previous public.channel_connections; secret private.channel_credentials;
BEGIN
  PERFORM private.require_account_operator(p_workspace,p_actor,true);
  PERFORM 1 FROM public.workspaces WHERE id=p_workspace FOR UPDATE;
  IF p_connection IS NULL OR (p_provider IN ('ycloud','kapso')) IS NOT TRUE
    OR p_account IS NULL OR length(p_account) NOT BETWEEN 1 AND 512 OR p_account ~ '[[:space:][:cntrl:]]'
    OR (p_provider='ycloud' AND p_account !~ '^\+[1-9][0-9]{7,14}$')
    OR p_label IS NULL OR length(p_label) NOT BETWEEN 1 AND 80 OR btrim(p_label)<>p_label
    OR p_payload IS NULL OR length(p_payload)>32768
    OR p_payload !~ '^enc:v[1-9][0-9]{0,3}:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$'
    OR p_key_version IS NULL OR p_key_version NOT BETWEEN 1 AND 9999
    OR split_part(p_payload,':',2)<>'v'||p_key_version::text THEN
    RAISE EXCEPTION 'ACCOUNT_REGISTRATION_INVALID' USING ERRCODE='22023'; END IF;
  SELECT * INTO previous FROM public.channel_connections WHERE id=p_connection FOR UPDATE;
  IF FOUND THEN
    SELECT * INTO secret FROM private.channel_credentials WHERE workspace_id=p_workspace AND connection_id=p_connection;
    IF previous.workspace_id<>p_workspace OR previous.legacy_integration_id IS NOT NULL
      OR previous.provider<>p_provider OR previous.external_account_id<>p_account OR previous.display_name IS DISTINCT FROM p_label
      OR previous.revoked_at IS NOT NULL OR previous.status<>'needs_permissions'
      OR secret.encrypted_payload IS DISTINCT FROM p_payload OR secret.key_version IS DISTINCT FROM p_key_version THEN
      RAISE EXCEPTION 'ACCOUNT_REGISTRATION_CONFLICT' USING ERRCODE='40001'; END IF;
    RETURN previous.id;
  END IF;
  INSERT INTO public.channel_connections(id,workspace_id,channel,provider,external_account_id,display_name,status,capabilities)
    VALUES(p_connection,p_workspace,'whatsapp',p_provider,p_account,p_label,'needs_permissions','{}');
  INSERT INTO private.channel_credentials(connection_id,workspace_id,encrypted_payload,key_version)
    VALUES(p_connection,p_workspace,p_payload,p_key_version);
  INSERT INTO public.events(workspace_id,type,level,payload) VALUES(p_workspace,'channel_account_registered','info',
    jsonb_build_object('connectionId',p_connection,'provider',p_provider,'actorId',p_actor));
  RETURN p_connection;
END;
$$;

CREATE FUNCTION public.revoke_whatsapp_account(p_workspace uuid,p_actor uuid,p_connection uuid,p_expected_updated_at timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE connection public.channel_connections;
BEGIN
  PERFORM private.require_account_operator(p_workspace,p_actor,true);
  SELECT * INTO STRICT connection FROM public.channel_connections WHERE workspace_id=p_workspace AND id=p_connection FOR UPDATE;
  IF connection.channel<>'whatsapp' OR connection.legacy_integration_id IS NOT NULL
    OR NOT EXISTS(SELECT 1 FROM private.channel_credentials WHERE workspace_id=p_workspace AND connection_id=p_connection) THEN
    RAISE EXCEPTION 'ACCOUNT_REVOKE_UNAVAILABLE' USING ERRCODE='23514'; END IF;
  IF connection.revoked_at IS NOT NULL THEN RETURN true; END IF;
  IF p_expected_updated_at IS DISTINCT FROM connection.updated_at THEN
    RAISE EXCEPTION 'ACCOUNT_REVOKE_STALE' USING ERRCODE='40001'; END IF;
  UPDATE public.channel_connections SET status='revoked',revoked_at=clock_timestamp(),capabilities='{}'
    WHERE workspace_id=p_workspace AND id=p_connection;
  INSERT INTO public.events(workspace_id,type,level,payload) VALUES(p_workspace,'channel_account_revoked','info',
    jsonb_build_object('connectionId',p_connection,'actorId',p_actor));
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION private.require_account_operator(uuid,uuid,boolean),
  public.read_whatsapp_accounts(uuid,uuid),public.register_whatsapp_account(uuid,uuid,uuid,text,text,text,text,integer),
  public.revoke_whatsapp_account(uuid,uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.require_account_operator(uuid,uuid,boolean),
  public.read_whatsapp_accounts(uuid,uuid),public.register_whatsapp_account(uuid,uuid,uuid,text,text,text,text,integer),
  public.revoke_whatsapp_account(uuid,uuid,uuid,timestamptz) TO service_role;
COMMIT;
