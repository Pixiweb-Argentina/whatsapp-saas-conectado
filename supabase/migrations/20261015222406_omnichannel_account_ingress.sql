-- Managed-account sources are server-only. Legacy integration contracts stay unchanged.
BEGIN;
CREATE FUNCTION public.read_whatsapp_account_source(p_workspace uuid,p_connection uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE cc public.channel_connections; secret private.channel_credentials;
BEGIN
  SELECT * INTO cc FROM public.channel_connections WHERE workspace_id=p_workspace AND id=p_connection
    AND channel='whatsapp' AND legacy_integration_id IS NULL AND revoked_at IS NULL AND status<>'revoked' FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO secret FROM private.channel_credentials WHERE workspace_id=p_workspace AND connection_id=p_connection
    AND (expires_at IS NULL OR expires_at>clock_timestamp()) FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('workspaceId',cc.workspace_id,'connectionId',cc.id,'provider',cc.provider,
    'externalAccountId',cc.external_account_id,'status',cc.status,'encryptedPayload',secret.encrypted_payload,
    'keyVersion',secret.key_version,'sourceRevision',md5(jsonb_build_array(cc.workspace_id,cc.id,cc.provider,
      cc.external_account_id,cc.status,cc.updated_at,secret.encrypted_payload,secret.key_version,secret.expires_at)::text));
END;
$$;

CREATE FUNCTION public.persist_whatsapp_account_delivery(p_workspace uuid,p_connection uuid,p_source_revision text,
  p_kind text,p_delivery jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE source jsonb; result uuid; stored public.inbound_events; receipt private.channel_delivery_receipts;
BEGIN
  -- Locks both connection and credentials until the write commits; revoke/rotation cannot race this check.
  source:=public.read_whatsapp_account_source(p_workspace,p_connection);
  IF source IS NULL OR p_source_revision IS DISTINCT FROM source->>'sourceRevision' THEN
    RAISE EXCEPTION 'ACCOUNT_SOURCE_STALE' USING ERRCODE='23514'; END IF;
  IF p_delivery->>'connectionId' IS DISTINCT FROM p_connection::text
    OR p_delivery->>'provider' IS DISTINCT FROM source->>'provider' THEN
    RAISE EXCEPTION 'ACCOUNT_DELIVERY_SCOPE_INVALID' USING ERRCODE='23514'; END IF;
  IF p_kind='message' THEN
    IF p_delivery->>'workspaceId' IS DISTINCT FROM p_workspace::text OR p_delivery->>'channel' IS DISTINCT FROM 'whatsapp'
      OR p_delivery->>'kind' IS DISTINCT FROM 'message'
      OR (p_delivery->>'occurredAt')::timestamptz>clock_timestamp() THEN
      RAISE EXCEPTION 'ACCOUNT_EVENT_INVALID' USING ERRCODE='23514'; END IF;
    result:=public.persist_channel_event(p_delivery,false);
    SELECT * INTO STRICT stored FROM public.inbound_events WHERE workspace_id=p_workspace AND connection_id=p_connection AND id=result;
    IF stored.historical OR (stored.envelope-'receivedAt') IS DISTINCT FROM (p_delivery-'receivedAt') THEN
      RAISE EXCEPTION 'ACCOUNT_EVENT_COLLISION' USING ERRCODE='23514'; END IF;
  ELSIF p_kind='receipt' THEN
    IF p_delivery->>'externalAccountId' IS DISTINCT FROM source->>'externalAccountId'
      OR (p_delivery->>'occurredAt')::timestamptz>clock_timestamp() THEN
      RAISE EXCEPTION 'ACCOUNT_RECEIPT_INVALID' USING ERRCODE='23514'; END IF;
    INSERT INTO private.channel_delivery_receipts(workspace_id,connection_id,provider_event_id,provider,external_account_id,
      status,wamid,provider_message_id,external_operation_id,recipient,occurred_at)
      VALUES(p_workspace,p_connection,p_delivery->>'providerEventId',source->>'provider',source->>'externalAccountId',
        p_delivery->>'status',nullif(p_delivery->>'wamid',''),nullif(p_delivery->>'providerMessageId',''),
        (p_delivery->>'operationId')::uuid,p_delivery->>'recipient',(p_delivery->>'occurredAt')::timestamptz)
      ON CONFLICT(workspace_id,connection_id,provider_event_id) DO NOTHING RETURNING id INTO result;
    IF result IS NULL THEN
      SELECT * INTO STRICT receipt FROM private.channel_delivery_receipts WHERE workspace_id=p_workspace
        AND connection_id=p_connection AND provider_event_id=p_delivery->>'providerEventId';
      IF (receipt.status,receipt.wamid,receipt.provider_message_id,receipt.external_operation_id,receipt.recipient,receipt.occurred_at)
        IS DISTINCT FROM (p_delivery->>'status',nullif(p_delivery->>'wamid',''),nullif(p_delivery->>'providerMessageId',''),
          (p_delivery->>'operationId')::uuid,p_delivery->>'recipient',(p_delivery->>'occurredAt')::timestamptz) THEN
        RAISE EXCEPTION 'ACCOUNT_RECEIPT_COLLISION' USING ERRCODE='23514'; END IF;
      result:=receipt.id;
    END IF;
    PERFORM private.reconcile_channel_receipt(p_workspace,result);
  ELSE RAISE EXCEPTION 'ACCOUNT_DELIVERY_KIND_INVALID' USING ERRCODE='22023'; END IF;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.read_whatsapp_account_source(uuid,uuid),
  public.persist_whatsapp_account_delivery(uuid,uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_whatsapp_account_source(uuid,uuid),
  public.persist_whatsapp_account_delivery(uuid,uuid,text,text,jsonb) TO service_role;
COMMIT;
