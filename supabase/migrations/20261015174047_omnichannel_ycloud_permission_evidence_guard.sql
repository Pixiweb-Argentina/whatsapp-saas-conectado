-- NULL metadata must fail closed as well as a mismatching destination.
CREATE OR REPLACE FUNCTION private.ycloud_permission_blockers(i public.integrations,c public.channel_connections,
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
  ELSIF v.input->>'callbackUrl' IS DISTINCT FROM p_callback OR v.report->>'destination' IS DISTINCT FROM 'https_unconfirmed' THEN
    blockers:=array_append(blockers,'stable_callback_required'); END IF;
  IF c.id IS NOT NULL AND private.ycloud_text_receipt(c) IS NULL THEN blockers:=array_append(blockers,'delivery_proof_required'); END IF;
  IF c.id IS NOT NULL AND c.capabilities NOT IN ('{}'::jsonb,'{"version":1,"grants":[]}'::jsonb)
    AND private.ycloud_owned_permission(c) IS NULL THEN blockers:=array_append(blockers,'unmanaged_capabilities'); END IF;
  RETURN blockers;
END;
$$;
