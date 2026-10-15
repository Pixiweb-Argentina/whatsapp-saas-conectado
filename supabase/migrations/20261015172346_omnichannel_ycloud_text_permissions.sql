-- Local, explicit authorization of the durable text transport. Never contact consent or AI rollout.
CREATE TABLE private.ycloud_permission_changes (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  integration_id uuid NOT NULL,
  actor_id uuid,
  action text NOT NULL CHECK(action IN ('grant','revoke','invalidate')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  valid_until timestamptz,
  verification_checked_at timestamptz,
  source_fingerprint bytea,
  expected_callback text,
  receipt_id uuid REFERENCES private.channel_delivery_receipts(id) ON DELETE SET NULL,
  FOREIGN KEY(workspace_id,connection_id) REFERENCES public.channel_connections(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id,integration_id) REFERENCES public.integrations(workspace_id,id) ON DELETE CASCADE,
  CHECK(action<>'grant' OR (actor_id IS NOT NULL AND valid_until IS NOT NULL AND verification_checked_at IS NOT NULL
    AND source_fingerprint IS NOT NULL AND expected_callback IS NOT NULL))
);
CREATE INDEX ycloud_permission_history ON private.ycloud_permission_changes(workspace_id,connection_id,created_at DESC);
CREATE INDEX ycloud_permission_integration ON private.ycloud_permission_changes(workspace_id,integration_id);
CREATE INDEX ycloud_permission_receipt ON private.ycloud_permission_changes(receipt_id) WHERE receipt_id IS NOT NULL;
ALTER TABLE private.ycloud_permission_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.ycloud_permission_changes FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON private.ycloud_permission_changes TO service_role;

CREATE FUNCTION private.ycloud_text_capabilities(change private.ycloud_permission_changes) RETURNS jsonb
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT jsonb_build_object('version',1,'grants',jsonb_build_array(jsonb_build_object(
    'workspaceId',change.workspace_id,'connectionId',change.connection_id,'capability','text',
    'verifiedAt',to_char(change.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'validUntil',to_char(change.valid_until AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'evidenceRef','ycloud-text:'||change.id::text)));
$$;

CREATE FUNCTION private.ycloud_owned_permission(c public.channel_connections) RETURNS uuid
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT p.id FROM private.ycloud_permission_changes p WHERE p.workspace_id=c.workspace_id AND p.connection_id=c.id
    AND p.integration_id=c.legacy_integration_id AND p.action='grant'
    AND c.capabilities=private.ycloud_text_capabilities(p) ORDER BY p.created_at DESC LIMIT 1;
$$;

CREATE FUNCTION private.ycloud_verification_current(i public.integrations,v private.ycloud_verifications)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT coalesce(i.enabled AND i.provider='ycloud' AND v.workspace_id=i.workspace_id AND v.integration_id=i.id
    AND v.checked_at<=clock_timestamp() AND v.checked_at>clock_timestamp()-interval '24 hours'
    AND v.source_fingerprint=sha256(convert_to(private.ycloud_verification_source(i)::text,'UTF8'))
    AND v.report->>'providerRead'='complete'
    AND v.report->'checks'='{"api_access":true,"connected_number":true,"webhook_active":true,"webhook_url":true,"webhook_events":true,"webhook_secret":true}'::jsonb,false);
$$;

CREATE FUNCTION private.ycloud_text_receipt(c public.channel_connections) RETURNS uuid
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT r.id FROM private.channel_delivery_receipts r JOIN public.message_jobs j
    ON j.workspace_id=r.workspace_id AND j.connection_id=r.connection_id AND j.operation_id=r.operation_id
    JOIN public.messages m ON m.workspace_id=j.workspace_id AND m.connection_id=j.connection_id AND m.channel_operation_id=j.operation_id
  WHERE r.workspace_id=c.workspace_id AND r.connection_id=c.id AND r.external_account_id=c.external_account_id
    AND r.provider='ycloud' AND r.state='planned' AND r.status IN ('delivered','read')
    AND r.occurred_at BETWEEN clock_timestamp()-interval '30 days' AND clock_timestamp()
    AND j.state='accepted' AND j.request->>'action'='text' AND m.status IN ('delivered','read')
    AND coalesce(m.meta->>'delivery_conflict','false')='false'
    AND (r.wamid=j.result_wamid OR r.provider_message_id=j.result_provider_message_id)
    AND EXISTS(SELECT 1 FROM public.message_outbox o WHERE o.workspace_id=j.workspace_id AND o.operation_id=j.operation_id
      AND o.fence=j.fence AND o.state='accepted' AND o.result_external_id=j.result_external_id)
  ORDER BY r.occurred_at DESC,r.id LIMIT 1;
$$;

CREATE FUNCTION private.ycloud_permission_blockers(i public.integrations,c public.channel_connections,
  v private.ycloud_verifications,p_callback text) RETURNS text[]
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE blockers text[]:='{}';
BEGIN
  IF c.id IS NULL OR c.channel<>'whatsapp' OR c.provider<>'ycloud' OR c.workspace_id<>i.workspace_id
    OR c.legacy_integration_id<>i.id OR c.external_account_id IS DISTINCT FROM i.config->>'phone_number' THEN
    blockers:=array_append(blockers,'account_mismatch'); END IF;
  IF c.revoked_at IS NOT NULL OR c.status='revoked' THEN blockers:=array_append(blockers,'account_revoked'); END IF;
  IF NOT private.ycloud_verification_current(i,v) THEN blockers:=array_append(blockers,'verification_required'); END IF;
  IF p_callback IS NULL THEN blockers:=array_append(blockers,'public_origin_missing');
  ELSIF v.input->>'callbackUrl' IS DISTINCT FROM p_callback OR v.report->>'destination'<>'https_unconfirmed' THEN
    blockers:=array_append(blockers,'stable_callback_required'); END IF;
  IF c.id IS NOT NULL AND private.ycloud_text_receipt(c) IS NULL THEN blockers:=array_append(blockers,'delivery_proof_required'); END IF;
  IF c.id IS NOT NULL AND c.capabilities NOT IN ('{}'::jsonb,'{"version":1,"grants":[]}'::jsonb)
    AND private.ycloud_owned_permission(c) IS NULL THEN blockers:=array_append(blockers,'unmanaged_capabilities'); END IF;
  RETURN blockers;
END;
$$;

CREATE FUNCTION public.read_ycloud_permission_review(p_workspace uuid,p_actor uuid,p_callback text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE i public.integrations; c public.channel_connections; v private.ycloud_verifications; owned uuid; blockers text[];
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.memberships WHERE workspace_id=p_workspace AND user_id=p_actor
    AND is_active AND role IN ('admin','manager')) THEN
    RAISE EXCEPTION 'YCLOUD_PERMISSION_FORBIDDEN' USING ERRCODE='42501'; END IF;
  SELECT * INTO i FROM public.integrations WHERE workspace_id=p_workspace AND provider='ycloud';
  SELECT * INTO c FROM public.channel_connections WHERE workspace_id=p_workspace AND legacy_integration_id=i.id;
  IF c.id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v FROM private.ycloud_verifications WHERE workspace_id=p_workspace AND integration_id=i.id;
  blockers:=private.ycloud_permission_blockers(i,c,v,p_callback); owned:=private.ycloud_owned_permission(c);
  RETURN jsonb_build_object('connectionId',c.id,'connectionUpdatedAt',c.updated_at,'storedStatus',c.status,
    'managed',owned IS NOT NULL,'validUntil',CASE WHEN owned IS NOT NULL THEN c.capabilities->'grants'->0->>'validUntil' END,
    'current',coalesce(c.status='ready' AND private.channel_text_grant_until(c)>clock_timestamp(),false),
    'canGrant',cardinality(blockers)=0 AND (owned IS NULL OR NOT coalesce(private.channel_text_grant_until(c)>clock_timestamp(),false)
      OR EXISTS(SELECT 1 FROM private.ycloud_permission_changes p WHERE p.id=owned AND p.verification_checked_at<v.checked_at)),
    'canRevoke',owned IS NOT NULL,
    'verificationCheckedAt',v.checked_at,'blockers',to_jsonb(blockers));
END;
$$;

CREATE FUNCTION private.apply_ycloud_permission(i public.integrations,c public.channel_connections,v private.ycloud_verifications,
  p_actor uuid,p_operation uuid,p_action text,p_callback text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE change private.ycloud_permission_changes;
BEGIN
  IF p_action='grant' THEN
    IF cardinality(private.ycloud_permission_blockers(i,c,v,p_callback))<>0 THEN
      RAISE EXCEPTION 'YCLOUD_PERMISSION_NOT_ELIGIBLE' USING ERRCODE='23514'; END IF;
    INSERT INTO private.ycloud_permission_changes(id,workspace_id,connection_id,integration_id,actor_id,action,
      valid_until,verification_checked_at,source_fingerprint,expected_callback,receipt_id)
      VALUES(p_operation,i.workspace_id,c.id,i.id,p_actor,'grant',v.checked_at+interval '24 hours',v.checked_at,
        v.source_fingerprint,p_callback,private.ycloud_text_receipt(c)) RETURNING * INTO change;
    UPDATE public.channel_connections SET status='ready',capabilities=private.ycloud_text_capabilities(change),
      last_verified_at=change.created_at WHERE workspace_id=i.workspace_id AND id=c.id;
  ELSE
    IF private.ycloud_owned_permission(c) IS NULL THEN
      RAISE EXCEPTION 'YCLOUD_PERMISSION_UNMANAGED' USING ERRCODE='23514'; END IF;
    INSERT INTO private.ycloud_permission_changes(id,workspace_id,connection_id,integration_id,actor_id,action)
      VALUES(p_operation,i.workspace_id,c.id,i.id,p_actor,'revoke');
    UPDATE public.channel_connections SET capabilities='{"version":1,"grants":[]}',
      status=CASE WHEN revoked_at IS NULL THEN 'needs_permissions' ELSE 'revoked' END
      WHERE workspace_id=i.workspace_id AND id=c.id;
  END IF;
END;
$$;

CREATE FUNCTION public.change_ycloud_text_permission(p_workspace uuid,p_actor uuid,p_connection uuid,p_operation uuid,
  p_action text,p_expected_updated_at timestamptz,p_expected_verification timestamptz,p_callback text) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE i public.integrations; c public.channel_connections; v private.ycloud_verifications; prior private.ycloud_permission_changes;
BEGIN
  PERFORM 1 FROM public.memberships WHERE workspace_id=p_workspace AND user_id=p_actor AND is_active AND role='admin' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'YCLOUD_PERMISSION_FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF p_operation IS NULL OR p_action IS NULL OR p_action NOT IN ('grant','revoke') THEN
    RAISE EXCEPTION 'YCLOUD_PERMISSION_INVALID' USING ERRCODE='23514'; END IF;
  SELECT * INTO STRICT i FROM public.integrations WHERE workspace_id=p_workspace AND provider='ycloud' FOR UPDATE;
  SELECT * INTO STRICT c FROM public.channel_connections WHERE workspace_id=p_workspace AND id=p_connection
    AND legacy_integration_id=i.id AND provider='ycloud' AND channel='whatsapp' FOR UPDATE;
  SELECT * INTO prior FROM private.ycloud_permission_changes WHERE id=p_operation;
  IF FOUND THEN
    IF (prior.workspace_id,prior.connection_id,prior.actor_id,prior.action) IS DISTINCT FROM (p_workspace,p_connection,p_actor,p_action) THEN
      RAISE EXCEPTION 'YCLOUD_PERMISSION_OPERATION_COLLISION' USING ERRCODE='23514'; END IF;
    RETURN false;
  END IF;
  IF c.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'YCLOUD_PERMISSION_STALE' USING ERRCODE='40001'; END IF;
  SELECT * INTO v FROM private.ycloud_verifications WHERE workspace_id=p_workspace AND integration_id=i.id;
  IF p_action='grant' AND (v.checked_at IS NULL OR v.checked_at IS DISTINCT FROM p_expected_verification) THEN
    RAISE EXCEPTION 'YCLOUD_PERMISSION_STALE' USING ERRCODE='40001'; END IF;
  PERFORM private.apply_ycloud_permission(i,c,v,p_actor,p_operation,p_action,p_callback);
  RETURN true;
END;
$$;

-- Trigger-only authority lets existing RLS integration updates invalidate an owned permission too.
CREATE FUNCTION private.invalidate_ycloud_text_permission() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE integration uuid; workspace uuid; i public.integrations; v private.ycloud_verifications;
  c public.channel_connections; permission private.ycloud_permission_changes; owned uuid;
BEGIN
  IF TG_TABLE_NAME='integrations' THEN
    IF NEW.provider<>'ycloud' AND OLD.provider<>'ycloud' THEN RETURN NULL; END IF;
    integration:=NEW.id; workspace:=NEW.workspace_id;
  ELSE
    IF TG_OP='DELETE' THEN integration:=OLD.integration_id; workspace:=OLD.workspace_id;
    ELSE integration:=NEW.integration_id; workspace:=NEW.workspace_id; END IF;
  END IF;
  SELECT * INTO i FROM public.integrations WHERE workspace_id=workspace AND id=integration;
  IF i.id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v FROM private.ycloud_verifications WHERE workspace_id=workspace AND integration_id=integration;
  FOR c IN SELECT * FROM public.channel_connections WHERE workspace_id=workspace AND legacy_integration_id=integration FOR UPDATE LOOP
    owned:=private.ycloud_owned_permission(c);
    IF owned IS NULL THEN CONTINUE; END IF;
    SELECT * INTO permission FROM private.ycloud_permission_changes WHERE id=owned;
    IF private.ycloud_verification_current(i,v) AND permission.source_fingerprint=v.source_fingerprint
      AND v.input->>'callbackUrl'=permission.expected_callback AND c.external_account_id=i.config->>'phone_number'
      AND v.report->>'destination'='https_unconfirmed' THEN CONTINUE; END IF;
    INSERT INTO private.ycloud_permission_changes(id,workspace_id,connection_id,integration_id,action)
      VALUES(gen_random_uuid(),workspace,c.id,integration,'invalidate');
    UPDATE public.channel_connections SET capabilities='{"version":1,"grants":[]}',
      status=CASE WHEN revoked_at IS NULL THEN 'needs_permissions' ELSE 'revoked' END WHERE workspace_id=workspace AND id=c.id;
  END LOOP;
  RETURN NULL;
END;
$$;
CREATE TRIGGER invalidate_ycloud_permission_integration AFTER UPDATE ON public.integrations
  FOR EACH ROW EXECUTE FUNCTION private.invalidate_ycloud_text_permission();
CREATE TRIGGER invalidate_ycloud_permission_verification AFTER INSERT OR UPDATE OR DELETE ON private.ycloud_verifications
  FOR EACH ROW EXECUTE FUNCTION private.invalidate_ycloud_text_permission();

REVOKE ALL ON FUNCTION private.ycloud_text_capabilities(private.ycloud_permission_changes),
  private.ycloud_owned_permission(public.channel_connections),private.ycloud_verification_current(public.integrations,private.ycloud_verifications),
  private.ycloud_text_receipt(public.channel_connections),
  private.ycloud_permission_blockers(public.integrations,public.channel_connections,private.ycloud_verifications,text),
  private.apply_ycloud_permission(public.integrations,public.channel_connections,private.ycloud_verifications,uuid,uuid,text,text),
  private.invalidate_ycloud_text_permission(),public.read_ycloud_permission_review(uuid,uuid,text),
  public.change_ycloud_text_permission(uuid,uuid,uuid,uuid,text,timestamptz,timestamptz,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.ycloud_text_capabilities(private.ycloud_permission_changes),
  private.ycloud_owned_permission(public.channel_connections),private.ycloud_verification_current(public.integrations,private.ycloud_verifications),
  private.ycloud_text_receipt(public.channel_connections),
  private.ycloud_permission_blockers(public.integrations,public.channel_connections,private.ycloud_verifications,text),
  private.apply_ycloud_permission(public.integrations,public.channel_connections,private.ycloud_verifications,uuid,uuid,text,text),
  public.read_ycloud_permission_review(uuid,uuid,text),
  public.change_ycloud_text_permission(uuid,uuid,uuid,uuid,text,timestamptz,timestamptz,text) TO service_role;
