-- Managed-account verification and local text permission. No grants/backfill/cutover on migration.
BEGIN;
CREATE TABLE private.whatsapp_account_verifications (
  connection_id uuid PRIMARY KEY, workspace_id uuid NOT NULL, actor_id uuid NOT NULL,
  source_fingerprint bytea NOT NULL, input jsonb NOT NULL, report jsonb NOT NULL,
  checked_at timestamptz NOT NULL,
  FOREIGN KEY(workspace_id,connection_id) REFERENCES public.channel_connections(workspace_id,id) ON DELETE CASCADE,
  CHECK (jsonb_typeof(input)='object' AND jsonb_typeof(report)='object'
    AND report->>'version'='1' AND report->'sendAuthorization'='false'::jsonb)
);
CREATE TABLE private.whatsapp_account_permission_changes (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL, connection_id uuid NOT NULL, actor_id uuid,
  action text NOT NULL CHECK (action IN ('grant','revoke','invalidate')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), valid_until timestamptz,
  source_fingerprint bytea, verification_checked_at timestamptz, expected_callback text, receipt_id uuid,
  FOREIGN KEY(workspace_id,connection_id) REFERENCES public.channel_connections(workspace_id,id) ON DELETE CASCADE,
  CHECK (action<>'grant' OR (valid_until IS NOT NULL AND source_fingerprint IS NOT NULL
    AND verification_checked_at IS NOT NULL AND expected_callback IS NOT NULL AND receipt_id IS NOT NULL))
);
CREATE INDEX account_verifications_workspace ON private.whatsapp_account_verifications(workspace_id);
CREATE INDEX account_permissions_scope ON private.whatsapp_account_permission_changes(workspace_id,connection_id);
ALTER TABLE private.whatsapp_account_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.whatsapp_account_permission_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.whatsapp_account_verifications,private.whatsapp_account_permission_changes FROM PUBLIC,anon,authenticated;
GRANT ALL ON private.whatsapp_account_verifications,private.whatsapp_account_permission_changes TO service_role;

-- Identity proof is stable across status/capability changes; ingress sourceRevision still fences those changes.
CREATE FUNCTION private.whatsapp_account_fingerprint(p_workspace uuid,p_connection uuid) RETURNS bytea
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT sha256(convert_to(jsonb_build_array(c.workspace_id,c.id,c.provider,c.external_account_id,
    k.encrypted_payload,k.key_version,k.expires_at)::text,'UTF8'))
  FROM public.channel_connections c JOIN private.channel_credentials k ON k.workspace_id=c.workspace_id AND k.connection_id=c.id
  WHERE c.workspace_id=p_workspace AND c.id=p_connection AND c.channel='whatsapp' AND c.legacy_integration_id IS NULL
    AND c.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at>clock_timestamp());
$$;
CREATE FUNCTION public.read_whatsapp_account_check_source(p_workspace uuid,p_actor uuid,p_connection uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  PERFORM private.require_account_operator(p_workspace,p_actor,true);
  RETURN public.read_whatsapp_account_source(p_workspace,p_connection);
END;
$$;
CREATE FUNCTION private.whatsapp_account_verification_current(v private.whatsapp_account_verifications) RETURNS boolean
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT coalesce(v.checked_at<=clock_timestamp() AND v.checked_at>clock_timestamp()-interval '24 hours'
    AND v.source_fingerprint=private.whatsapp_account_fingerprint(v.workspace_id,v.connection_id),false);
$$;
CREATE FUNCTION public.save_whatsapp_account_verification(p_workspace uuid,p_actor uuid,p_connection uuid,
  p_source_revision text,p_input jsonb,p_report jsonb) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE source jsonb; checked timestamptz;
BEGIN
  PERFORM private.require_account_operator(p_workspace,p_actor,true);
  PERFORM 1 FROM public.channel_connections WHERE workspace_id=p_workspace AND id=p_connection FOR UPDATE;
  source:=public.read_whatsapp_account_source(p_workspace,p_connection);
  IF source IS NULL OR source->>'provider'<>'ycloud' OR source->>'sourceRevision' IS DISTINCT FROM p_source_revision THEN
    RAISE EXCEPTION 'ACCOUNT_VERIFICATION_STALE' USING ERRCODE='23514'; END IF;
  checked:=(p_report->>'checkedAt')::timestamptz;
  IF checked IS NULL OR checked>clock_timestamp() OR checked<clock_timestamp()-interval '2 minutes'
    OR p_report->>'version' IS DISTINCT FROM '1' OR p_report->'sendAuthorization' IS DISTINCT FROM 'false'::jsonb
    OR jsonb_typeof(p_report->'checks') IS DISTINCT FROM 'object'
    OR p_input IS NULL OR jsonb_typeof(p_input) IS DISTINCT FROM 'object'
    OR (length(p_input->>'endpointId') BETWEEN 1 AND 128) IS NOT TRUE
    OR (p_input->>'callbackUrl' LIKE 'https://%/api/webhooks/whatsapp-accounts/'||p_workspace||'/'||p_connection) IS NOT TRUE THEN
    RAISE EXCEPTION 'ACCOUNT_VERIFICATION_INVALID' USING ERRCODE='23514'; END IF;
  INSERT INTO private.whatsapp_account_verifications(connection_id,workspace_id,actor_id,source_fingerprint,input,report,checked_at)
    VALUES(p_connection,p_workspace,p_actor,private.whatsapp_account_fingerprint(p_workspace,p_connection),p_input,p_report,checked)
    ON CONFLICT(connection_id) DO UPDATE SET actor_id=EXCLUDED.actor_id,source_fingerprint=EXCLUDED.source_fingerprint,
      input=EXCLUDED.input,report=EXCLUDED.report,checked_at=EXCLUDED.checked_at
    WHERE private.whatsapp_account_verifications.checked_at<EXCLUDED.checked_at;
  IF NOT FOUND THEN RAISE EXCEPTION 'ACCOUNT_VERIFICATION_STALE' USING ERRCODE='23514'; END IF;
END;
$$;
CREATE FUNCTION public.read_whatsapp_account_verification(p_workspace uuid,p_actor uuid,p_connection uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
  PERFORM private.require_account_operator(p_workspace,p_actor,false);
  SELECT jsonb_build_object('input',v.input,'report',v.report,'current',private.whatsapp_account_verification_current(v))
    INTO result FROM private.whatsapp_account_verifications v WHERE workspace_id=p_workspace AND connection_id=p_connection;
  RETURN result;
END;
$$;
CREATE FUNCTION private.whatsapp_account_text_capabilities(p private.whatsapp_account_permission_changes) RETURNS jsonb
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT jsonb_build_object('version',1,'grants',jsonb_build_array(jsonb_build_object('workspaceId',p.workspace_id,
    'connectionId',p.connection_id,'capability','text','verifiedAt',to_char(p.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'validUntil',to_char(p.valid_until AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'evidenceRef','wa-account-text:'||p.id)));
$$;
CREATE FUNCTION private.whatsapp_account_owned_permission(c public.channel_connections) RETURNS uuid
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT p.id FROM private.whatsapp_account_permission_changes p WHERE p.workspace_id=c.workspace_id AND p.connection_id=c.id
    AND p.action='grant' AND c.capabilities=private.whatsapp_account_text_capabilities(p) ORDER BY p.created_at DESC LIMIT 1;
$$;
CREATE FUNCTION private.whatsapp_account_permission_blockers(c public.channel_connections,
  v private.whatsapp_account_verifications,p_callback text) RETURNS text[]
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE blockers text[]:='{}';
BEGIN
  IF c.provider IS DISTINCT FROM 'ycloud' THEN blockers:=array_append(blockers,'unsupported_provider'); END IF;
  IF c.legacy_integration_id IS NOT NULL OR c.channel IS DISTINCT FROM 'whatsapp' THEN blockers:=array_append(blockers,'account_mismatch'); END IF;
  IF c.revoked_at IS NOT NULL THEN blockers:=array_append(blockers,'account_revoked'); END IF;
  IF NOT private.whatsapp_account_verification_current(v) OR v.report->>'providerRead' IS DISTINCT FROM 'complete'
    OR v.report->'checks' IS DISTINCT FROM '{"api_access":true,"connected_number":true,"webhook_active":true,"webhook_url":true,"webhook_events":true,"webhook_secret":true}'::jsonb THEN
    blockers:=array_append(blockers,'verification_required'); END IF;
  IF p_callback IS NULL THEN blockers:=array_append(blockers,'public_origin_missing');
  ELSIF v.input->>'callbackUrl' IS DISTINCT FROM p_callback OR v.report->>'destination' IS DISTINCT FROM 'https_unconfirmed' THEN
    blockers:=array_append(blockers,'stable_callback_required'); END IF;
  IF private.ycloud_text_receipt(c) IS NULL THEN blockers:=array_append(blockers,'delivery_proof_required'); END IF;
  IF c.capabilities NOT IN ('{}'::jsonb,'{"version":1,"grants":[]}'::jsonb) AND private.whatsapp_account_owned_permission(c) IS NULL THEN
    blockers:=array_append(blockers,'unmanaged_capabilities'); END IF;
  RETURN blockers;
END;
$$;
CREATE FUNCTION private.whatsapp_account_permission_current(c public.channel_connections) RETURNS boolean
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT coalesce(c.status='ready' AND p.valid_until>clock_timestamp()
    AND p.source_fingerprint=v.source_fingerprint AND cardinality(private.whatsapp_account_permission_blockers(c,v,p.expected_callback))=0,false)
  FROM private.whatsapp_account_permission_changes p JOIN private.whatsapp_account_verifications v
    ON v.workspace_id=p.workspace_id AND v.connection_id=p.connection_id
  WHERE p.id=private.whatsapp_account_owned_permission(c);
$$;
CREATE FUNCTION public.read_whatsapp_account_permission_review(p_workspace uuid,p_actor uuid,p_connection uuid,p_callback text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c public.channel_connections; v private.whatsapp_account_verifications; blockers text[]; owned uuid;
BEGIN
  PERFORM private.require_account_operator(p_workspace,p_actor,false);
  SELECT * INTO c FROM public.channel_connections WHERE workspace_id=p_workspace AND id=p_connection AND legacy_integration_id IS NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO v FROM private.whatsapp_account_verifications WHERE workspace_id=p_workspace AND connection_id=p_connection;
  blockers:=private.whatsapp_account_permission_blockers(c,v,p_callback); owned:=private.whatsapp_account_owned_permission(c);
  RETURN jsonb_build_object('connectionId',c.id,'connectionUpdatedAt',c.updated_at,'storedStatus',c.status,
    'managed',owned IS NOT NULL,'current',coalesce(private.whatsapp_account_permission_current(c),false),
    'validUntil',CASE WHEN owned IS NOT NULL THEN c.capabilities->'grants'->0->>'validUntil' END,
    'canGrant',cardinality(blockers)=0,'canRevoke',owned IS NOT NULL,'verificationCheckedAt',v.checked_at,
    'blockers',to_jsonb(blockers),'callbackUrl',p_callback);
END;
$$;
CREATE FUNCTION public.change_whatsapp_account_text_permission(p_workspace uuid,p_actor uuid,p_connection uuid,p_operation uuid,
  p_action text,p_expected_updated_at timestamptz,p_expected_verification timestamptz,p_callback text) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c public.channel_connections; v private.whatsapp_account_verifications; prior private.whatsapp_account_permission_changes;
  change private.whatsapp_account_permission_changes; until_time timestamptz;
BEGIN
  PERFORM private.require_account_operator(p_workspace,p_actor,true);
  SELECT * INTO STRICT c FROM public.channel_connections WHERE workspace_id=p_workspace AND id=p_connection
    AND channel='whatsapp' AND legacy_integration_id IS NULL FOR UPDATE;
  PERFORM 1 FROM private.channel_credentials WHERE workspace_id=p_workspace AND connection_id=p_connection FOR SHARE;
  IF p_operation IS NULL OR (p_action IN ('grant','revoke')) IS NOT TRUE THEN
    RAISE EXCEPTION 'ACCOUNT_PERMISSION_INVALID' USING ERRCODE='23514'; END IF;
  SELECT * INTO prior FROM private.whatsapp_account_permission_changes WHERE id=p_operation;
  IF FOUND THEN
    IF (prior.workspace_id,prior.connection_id,prior.actor_id,prior.action) IS DISTINCT FROM (p_workspace,p_connection,p_actor,p_action) THEN
      RAISE EXCEPTION 'ACCOUNT_PERMISSION_COLLISION' USING ERRCODE='23514'; END IF;
    RETURN false;
  END IF;
  IF c.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'ACCOUNT_PERMISSION_STALE' USING ERRCODE='23514'; END IF;
  SELECT * INTO v FROM private.whatsapp_account_verifications WHERE workspace_id=p_workspace AND connection_id=p_connection FOR SHARE;
  IF p_action='grant' THEN
    IF v.checked_at IS DISTINCT FROM p_expected_verification OR cardinality(private.whatsapp_account_permission_blockers(c,v,p_callback))<>0 THEN
      RAISE EXCEPTION 'ACCOUNT_PERMISSION_NOT_ELIGIBLE' USING ERRCODE='23514'; END IF;
    SELECT least(v.checked_at+interval '24 hours',expires_at) INTO until_time FROM private.channel_credentials WHERE connection_id=p_connection;
    INSERT INTO private.whatsapp_account_permission_changes(id,workspace_id,connection_id,actor_id,action,valid_until,
      source_fingerprint,verification_checked_at,expected_callback,receipt_id)
      VALUES(p_operation,p_workspace,p_connection,p_actor,p_action,until_time,v.source_fingerprint,v.checked_at,p_callback,
        private.ycloud_text_receipt(c)) RETURNING * INTO change;
    UPDATE public.channel_connections SET status='ready',capabilities=private.whatsapp_account_text_capabilities(change),last_verified_at=change.created_at
      WHERE workspace_id=p_workspace AND id=p_connection;
  ELSE
    IF private.whatsapp_account_owned_permission(c) IS NULL THEN RAISE EXCEPTION 'ACCOUNT_PERMISSION_UNMANAGED' USING ERRCODE='23514'; END IF;
    INSERT INTO private.whatsapp_account_permission_changes(id,workspace_id,connection_id,actor_id,action) VALUES(p_operation,p_workspace,p_connection,p_actor,p_action);
    UPDATE public.channel_connections SET capabilities='{"version":1,"grants":[]}',status=CASE WHEN revoked_at IS NULL THEN 'needs_permissions' ELSE 'revoked' END
      WHERE workspace_id=p_workspace AND id=p_connection;
  END IF;
  RETURN true;
END;
$$;

CREATE FUNCTION private.invalidate_whatsapp_account_permission() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE workspace uuid; connection uuid; c public.channel_connections;
BEGIN
  IF TG_OP='DELETE' THEN workspace:=OLD.workspace_id; connection:=OLD.connection_id;
  ELSE workspace:=NEW.workspace_id; connection:=NEW.connection_id; END IF;
  SELECT * INTO c FROM public.channel_connections WHERE workspace_id=workspace AND id=connection FOR UPDATE;
  IF private.whatsapp_account_owned_permission(c) IS NOT NULL AND NOT coalesce(private.whatsapp_account_permission_current(c),false) THEN
    INSERT INTO private.whatsapp_account_permission_changes(id,workspace_id,connection_id,action) VALUES(gen_random_uuid(),workspace,connection,'invalidate');
    UPDATE public.channel_connections SET capabilities='{"version":1,"grants":[]}',status=CASE WHEN revoked_at IS NULL THEN 'needs_permissions' ELSE 'revoked' END
      WHERE workspace_id=workspace AND id=connection;
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER invalidate_account_credential_permission AFTER UPDATE OR DELETE ON private.channel_credentials
  FOR EACH ROW EXECUTE FUNCTION private.invalidate_whatsapp_account_permission();
CREATE TRIGGER invalidate_account_verification_permission AFTER INSERT OR UPDATE OR DELETE ON private.whatsapp_account_verifications
  FOR EACH ROW EXECUTE FUNCTION private.invalidate_whatsapp_account_permission();

-- Fail closed at the final SQL send boundary too, including proof deletion/expiry or identity drift.
CREATE OR REPLACE FUNCTION private.channel_text_grant_until(connection public.channel_connections) RETURNS timestamptz
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE grant_record jsonb; expires timestamptz; verified timestamptz; latest timestamptz;
BEGIN
  IF connection.capabilities->'version' IS DISTINCT FROM '1'::jsonb
    OR jsonb_typeof(connection.capabilities->'grants') IS DISTINCT FROM 'array' THEN RETURN NULL; END IF;
  IF jsonb_array_length(connection.capabilities->'grants')>32 THEN RETURN NULL; END IF;
  FOR grant_record IN SELECT value FROM jsonb_array_elements(connection.capabilities->'grants') LOOP
    IF grant_record->>'evidenceRef' LIKE 'wa-account-text:%' AND NOT coalesce(private.whatsapp_account_permission_current(connection),false) THEN RETURN NULL; END IF;
    verified:=private.channel_timestamp(grant_record->>'verifiedAt'); expires:=private.channel_timestamp(grant_record->>'validUntil');
    IF (grant_record->>'workspaceId'=connection.workspace_id::text AND grant_record->>'connectionId'=connection.id::text
      AND grant_record->>'capability'='text' AND length(btrim(grant_record->>'evidenceRef')) BETWEEN 1 AND 512
      AND verified<=clock_timestamp() AND expires>clock_timestamp()) IS TRUE THEN latest:=greatest(latest,expires); END IF;
  END LOOP;
  RETURN latest;
END;
$$;
REVOKE ALL ON FUNCTION private.whatsapp_account_fingerprint(uuid,uuid),public.read_whatsapp_account_check_source(uuid,uuid,uuid),
  private.whatsapp_account_verification_current(private.whatsapp_account_verifications),
  public.save_whatsapp_account_verification(uuid,uuid,uuid,text,jsonb,jsonb),public.read_whatsapp_account_verification(uuid,uuid,uuid),
  private.whatsapp_account_text_capabilities(private.whatsapp_account_permission_changes),private.whatsapp_account_owned_permission(public.channel_connections),
  private.whatsapp_account_permission_blockers(public.channel_connections,private.whatsapp_account_verifications,text),
  private.whatsapp_account_permission_current(public.channel_connections),public.read_whatsapp_account_permission_review(uuid,uuid,uuid,text),
  public.change_whatsapp_account_text_permission(uuid,uuid,uuid,uuid,text,timestamptz,timestamptz,text),
  private.invalidate_whatsapp_account_permission() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.whatsapp_account_fingerprint(uuid,uuid),public.read_whatsapp_account_check_source(uuid,uuid,uuid),
  private.whatsapp_account_verification_current(private.whatsapp_account_verifications),
  public.save_whatsapp_account_verification(uuid,uuid,uuid,text,jsonb,jsonb),public.read_whatsapp_account_verification(uuid,uuid,uuid),
  private.whatsapp_account_text_capabilities(private.whatsapp_account_permission_changes),private.whatsapp_account_owned_permission(public.channel_connections),
  private.whatsapp_account_permission_blockers(public.channel_connections,private.whatsapp_account_verifications,text),
  private.whatsapp_account_permission_current(public.channel_connections),public.read_whatsapp_account_permission_review(uuid,uuid,uuid,text),
  public.change_whatsapp_account_text_permission(uuid,uuid,uuid,uuid,text,timestamptz,timestamptz,text) TO service_role;
COMMIT;
