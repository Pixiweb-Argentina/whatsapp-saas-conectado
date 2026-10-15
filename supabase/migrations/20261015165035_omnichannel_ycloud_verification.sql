-- Advisory evidence only. Does not issue capabilities or change transport state.
CREATE TABLE private.ycloud_verifications (
  integration_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  source_fingerprint bytea NOT NULL,
  input jsonb NOT NULL CHECK (jsonb_typeof(input)='object'),
  report jsonb NOT NULL CHECK (jsonb_typeof(report)='object' AND report->>'version'='1'
    AND report->'sendAuthorization'='false'::jsonb),
  checked_at timestamptz NOT NULL,
  FOREIGN KEY(workspace_id,integration_id) REFERENCES public.integrations(workspace_id,id) ON DELETE CASCADE
);
CREATE INDEX idx_ycloud_verifications_workspace ON private.ycloud_verifications(workspace_id);
ALTER TABLE private.ycloud_verifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.ycloud_verifications FROM PUBLIC,anon,authenticated;
GRANT ALL ON private.ycloud_verifications TO service_role;

CREATE FUNCTION private.ycloud_verification_source(i public.integrations) RETURNS jsonb
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT jsonb_build_object('id',i.id,'workspace_id',i.workspace_id,'provider',i.provider,
    'enabled',i.enabled,'credentials',i.credentials,'config',i.config);
$$;

CREATE FUNCTION public.read_ycloud_verification(p_workspace uuid,p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.memberships WHERE workspace_id=p_workspace AND user_id=p_actor
    AND is_active AND role IN ('admin','manager')) THEN
    RAISE EXCEPTION 'YCLOUD_VERIFICATION_FORBIDDEN' USING ERRCODE='42501'; END IF;
  SELECT jsonb_build_object('input',v.input,'report',v.report,'current',
    i.enabled AND v.checked_at<=clock_timestamp() AND v.checked_at>clock_timestamp()-interval '24 hours'
    AND v.source_fingerprint=sha256(convert_to(private.ycloud_verification_source(i)::text,'UTF8')))
  INTO result FROM private.ycloud_verifications v JOIN public.integrations i ON i.id=v.integration_id
    AND i.workspace_id=v.workspace_id AND i.provider='ycloud' WHERE v.workspace_id=p_workspace;
  RETURN result;
END;
$$;

CREATE FUNCTION public.save_ycloud_verification(p_workspace uuid,p_actor uuid,p_source jsonb,p_input jsonb,p_report jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE i public.integrations; checked timestamptz;
BEGIN
  PERFORM 1 FROM public.memberships WHERE workspace_id=p_workspace AND user_id=p_actor
    AND is_active AND role='admin' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'YCLOUD_VERIFICATION_FORBIDDEN' USING ERRCODE='42501'; END IF;
  SELECT * INTO STRICT i FROM public.integrations WHERE workspace_id=p_workspace AND provider='ycloud' FOR UPDATE;
  IF NOT i.enabled OR private.ycloud_verification_source(i) IS DISTINCT FROM p_source THEN
    RAISE EXCEPTION 'YCLOUD_VERIFICATION_STALE' USING ERRCODE='40001'; END IF;
  checked:=(p_report->>'checkedAt')::timestamptz;
  IF checked IS NULL OR checked>clock_timestamp() OR checked<clock_timestamp()-interval '2 minutes'
    OR p_input IS NULL OR p_report IS NULL THEN
    RAISE EXCEPTION 'YCLOUD_VERIFICATION_INVALID' USING ERRCODE='23514'; END IF;
  INSERT INTO private.ycloud_verifications(integration_id,workspace_id,actor_id,source_fingerprint,input,report,checked_at)
    VALUES(i.id,p_workspace,p_actor,sha256(convert_to(p_source::text,'UTF8')),p_input,p_report,checked)
    ON CONFLICT(integration_id) DO UPDATE SET actor_id=EXCLUDED.actor_id,source_fingerprint=EXCLUDED.source_fingerprint,
      input=EXCLUDED.input,report=EXCLUDED.report,checked_at=EXCLUDED.checked_at
    WHERE private.ycloud_verifications.checked_at<=EXCLUDED.checked_at;
  IF NOT FOUND THEN RAISE EXCEPTION 'YCLOUD_VERIFICATION_STALE' USING ERRCODE='40001'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.ycloud_verification_source(public.integrations),
  public.read_ycloud_verification(uuid,uuid),public.save_ycloud_verification(uuid,uuid,jsonb,jsonb,jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.ycloud_verification_source(public.integrations),
  public.read_ycloud_verification(uuid,uuid),public.save_ycloud_verification(uuid,uuid,jsonb,jsonb,jsonb) TO service_role;
