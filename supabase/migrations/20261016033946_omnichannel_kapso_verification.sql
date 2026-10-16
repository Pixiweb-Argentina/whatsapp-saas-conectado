-- Read-only Kapso proof and managed text permission parity. No enablement, new tables or backfill.
BEGIN;
-- YCloud keeps its existing evidence contract. Kapso requires exact provider/recipient and accepted text evidence.
CREATE FUNCTION private.whatsapp_account_text_receipt(c public.channel_connections) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE receipt uuid;
BEGIN
  IF c.provider='ycloud' THEN RETURN private.ycloud_text_receipt(c); END IF;
  IF c.provider IS DISTINCT FROM 'kapso' OR c.channel IS DISTINCT FROM 'whatsapp' OR c.legacy_integration_id IS NOT NULL THEN RETURN NULL; END IF;
  SELECT r.id INTO receipt FROM private.channel_delivery_receipts r JOIN public.message_jobs j
    ON j.workspace_id=r.workspace_id AND j.connection_id=r.connection_id AND j.operation_id=r.operation_id
    JOIN public.messages m ON m.workspace_id=j.workspace_id AND m.connection_id=j.connection_id AND m.channel_operation_id=j.operation_id
  WHERE r.workspace_id=c.workspace_id AND r.connection_id=c.id AND r.external_account_id=c.external_account_id
    AND r.provider='kapso' AND m.provider='kapso' AND m.direction='out' AND m.type='text'
    AND r.state='planned' AND r.status IN ('delivered','read') AND r.recipient=j.request->>'recipient'
    AND r.occurred_at BETWEEN clock_timestamp()-interval '30 days' AND clock_timestamp()
    AND j.state='accepted' AND j.request->>'action'='text' AND j.request->>'channel'='whatsapp'
    AND m.status IN ('delivered','read') AND coalesce(m.meta->>'delivery_conflict','false')='false'
    AND r.wamid=j.result_wamid AND m.wamid=j.result_wamid
    AND EXISTS(SELECT 1 FROM public.message_outbox o WHERE o.workspace_id=j.workspace_id AND o.operation_id=j.operation_id
      AND o.fence=j.fence AND o.state='accepted' AND o.result_external_id=j.result_external_id)
  ORDER BY r.occurred_at DESC,r.id LIMIT 1;
  RETURN receipt;
END;
$$;
REVOKE ALL ON FUNCTION private.whatsapp_account_text_receipt(public.channel_connections) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.whatsapp_account_text_receipt(public.channel_connections) TO service_role;

CREATE OR REPLACE FUNCTION public.save_whatsapp_account_verification(p_workspace uuid,p_actor uuid,p_connection uuid,
  p_source_revision text,p_input jsonb,p_report jsonb) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE source jsonb; checked timestamptz;
BEGIN
  PERFORM private.require_account_operator(p_workspace,p_actor,true);
  PERFORM 1 FROM public.channel_connections WHERE workspace_id=p_workspace AND id=p_connection FOR UPDATE;
  source:=public.read_whatsapp_account_source(p_workspace,p_connection);
  IF source IS NULL OR (source->>'provider' IN ('ycloud','kapso')) IS NOT TRUE OR source->>'sourceRevision' IS DISTINCT FROM p_source_revision THEN
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

CREATE OR REPLACE FUNCTION private.whatsapp_account_permission_blockers(c public.channel_connections,
  v private.whatsapp_account_verifications,p_callback text) RETURNS text[]
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE blockers text[]:='{}';
BEGIN
  IF (c.provider IN ('ycloud','kapso')) IS NOT TRUE THEN blockers:=array_append(blockers,'unsupported_provider'); END IF;
  IF c.legacy_integration_id IS NOT NULL OR c.channel IS DISTINCT FROM 'whatsapp' THEN blockers:=array_append(blockers,'account_mismatch'); END IF;
  IF c.revoked_at IS NOT NULL THEN blockers:=array_append(blockers,'account_revoked'); END IF;
  IF NOT private.whatsapp_account_verification_current(v) OR v.report->>'providerRead' IS DISTINCT FROM 'complete'
    OR v.report->'checks' IS DISTINCT FROM '{"api_access":true,"connected_number":true,"webhook_active":true,"webhook_url":true,"webhook_events":true,"webhook_secret":true}'::jsonb THEN
    blockers:=array_append(blockers,'verification_required'); END IF;
  IF p_callback IS NULL THEN blockers:=array_append(blockers,'public_origin_missing');
  ELSIF v.input->>'callbackUrl' IS DISTINCT FROM p_callback OR v.report->>'destination' IS DISTINCT FROM 'https_unconfirmed' THEN
    blockers:=array_append(blockers,'stable_callback_required'); END IF;
  IF private.whatsapp_account_text_receipt(c) IS NULL THEN blockers:=array_append(blockers,'delivery_proof_required'); END IF;
  IF c.capabilities NOT IN ('{}'::jsonb,'{"version":1,"grants":[]}'::jsonb) AND private.whatsapp_account_owned_permission(c) IS NULL THEN
    blockers:=array_append(blockers,'unmanaged_capabilities'); END IF;
  RETURN blockers;
END;
$$;

CREATE OR REPLACE FUNCTION public.change_whatsapp_account_text_permission(p_workspace uuid,p_actor uuid,p_connection uuid,p_operation uuid,
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
        private.whatsapp_account_text_receipt(c)) RETURNING * INTO change;
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
COMMIT;
