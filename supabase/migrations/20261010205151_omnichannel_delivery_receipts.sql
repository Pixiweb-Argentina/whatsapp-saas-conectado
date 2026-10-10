-- Signed delivery evidence is separate from incoming messages: no AI/window grant.
CREATE TABLE private.channel_delivery_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL, connection_id uuid NOT NULL,
  provider_event_id text NOT NULL CHECK (length(provider_event_id) BETWEEN 1 AND 512),
  provider text NOT NULL CHECK (provider IN ('ycloud','kapso')),
  external_account_id text NOT NULL, status text NOT NULL CHECK (status IN ('sent','delivered','read','failed')),
  wamid text, provider_message_id text, external_operation_id uuid, recipient text,
  occurred_at timestamptz NOT NULL, received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','planned','ignored')),
  operation_id uuid,
  FOREIGN KEY(workspace_id,connection_id) REFERENCES public.channel_connections(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id,operation_id) REFERENCES public.message_jobs(workspace_id,operation_id) ON DELETE CASCADE,
  UNIQUE(workspace_id,connection_id,provider_event_id),
  CHECK (wamid IS NOT NULL OR provider_message_id IS NOT NULL),
  CHECK (wamid IS NULL OR length(wamid) BETWEEN 1 AND 512),
  CHECK (provider_message_id IS NULL OR length(provider_message_id) BETWEEN 1 AND 512)
);
CREATE INDEX channel_receipts_pending ON private.channel_delivery_receipts(workspace_id,received_at,id) WHERE state='pending';
CREATE INDEX channel_jobs_result_wamid ON public.message_jobs(workspace_id,connection_id,result_wamid) WHERE result_wamid IS NOT NULL;
CREATE INDEX channel_jobs_result_provider_id ON public.message_jobs(workspace_id,connection_id,result_provider_message_id) WHERE result_provider_message_id IS NOT NULL;
ALTER TABLE private.channel_delivery_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.channel_delivery_receipts FROM PUBLIC,anon,authenticated;
GRANT ALL ON private.channel_delivery_receipts TO service_role;

CREATE FUNCTION private.apply_channel_receipt_message(receipt private.channel_delivery_receipts, job public.message_jobs)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE msg public.messages; new_status text; conflicting boolean;
BEGIN
  SELECT * INTO msg FROM public.messages WHERE workspace_id=receipt.workspace_id AND channel_operation_id=job.operation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CHANNEL_MESSAGE_MISSING' USING ERRCODE='23514'; END IF;
  -- Device delivery/read evidence wins over a contradictory failure. Keep the conflict visible in metadata.
  conflicting:=(msg.status IN ('delivered','read') AND receipt.status='failed')
    OR (msg.status='failed' AND receipt.status IN ('delivered','read') AND msg.meta->>'send_outcome'='accepted');
  new_status:=CASE WHEN msg.status='read' OR receipt.status='read' THEN 'read'
    WHEN msg.status='delivered' OR receipt.status='delivered' THEN 'delivered'
    WHEN msg.status='failed' AND msg.meta->>'send_outcome'='accepted' OR receipt.status='failed' THEN 'failed' ELSE 'sent' END;
  UPDATE public.messages SET status=new_status::public.message_status,wamid=coalesce(wamid,receipt.wamid),
    error_message=CASE WHEN new_status='failed' THEN 'El proveedor confirmó que el mensaje no se entregó.' END,
    meta=meta || jsonb_strip_nulls(jsonb_build_object('send_outcome','accepted','delivery_status',new_status,
      'provider_message_id',coalesce(job.result_provider_message_id,receipt.provider_message_id),
      'ycloud_id',CASE WHEN receipt.provider='ycloud' THEN coalesce(job.result_provider_message_id,receipt.provider_message_id) END,
      'delivery_conflict',CASE WHEN conflicting THEN true END))
    WHERE workspace_id=receipt.workspace_id AND id=msg.id;
END;
$$;

CREATE FUNCTION private.reconcile_channel_receipt(p_workspace_id uuid,p_receipt_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE receipt private.channel_delivery_receipts; job public.message_jobs;
BEGIN
  SELECT * INTO receipt FROM private.channel_delivery_receipts WHERE workspace_id=p_workspace_id AND id=p_receipt_id FOR UPDATE;
  IF NOT FOUND OR receipt.state <> 'pending' THEN RETURN false; END IF;
  -- IDs are scoped to a physical account; no text/time/phone-only fuzzy matching.
  SELECT * INTO job FROM public.message_jobs j WHERE j.workspace_id=p_workspace_id AND j.connection_id=receipt.connection_id
    AND (receipt.external_operation_id IS NULL OR j.operation_id=receipt.external_operation_id)
    AND ((receipt.external_operation_id IS NOT NULL AND receipt.provider='ycloud')
      OR j.result_wamid=receipt.wamid OR j.result_provider_message_id=receipt.provider_message_id)
    AND j.state IN ('sending','unknown','accepted')
    AND EXISTS (SELECT 1 FROM public.message_outbox o WHERE o.workspace_id=j.workspace_id AND o.operation_id=j.operation_id
      AND o.fence=j.fence AND o.state IN ('sending','unknown','accepted'))
    ORDER BY j.operation_id LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF (receipt.recipient IS NOT NULL AND receipt.recipient IS DISTINCT FROM job.request->>'recipient')
    OR (job.result_wamid IS NOT NULL AND receipt.wamid IS NOT NULL AND job.result_wamid <> receipt.wamid)
    OR (job.result_provider_message_id IS NOT NULL AND receipt.provider_message_id IS NOT NULL
      AND job.result_provider_message_id <> receipt.provider_message_id)
    OR EXISTS (SELECT 1 FROM public.message_jobs j WHERE j.workspace_id=p_workspace_id AND j.connection_id=receipt.connection_id
      AND j.operation_id<>job.operation_id AND (j.result_wamid=receipt.wamid OR j.result_provider_message_id=receipt.provider_message_id)) THEN
    UPDATE private.channel_delivery_receipts SET state='ignored' WHERE id=receipt.id;
    RETURN false;
  END IF;
  UPDATE public.message_jobs SET state='accepted', result_external_id=coalesce(result_external_id,receipt.wamid,receipt.provider_message_id),
    result_wamid=coalesce(result_wamid,receipt.wamid),result_provider_message_id=coalesce(result_provider_message_id,receipt.provider_message_id),
    last_error_code=NULL,lease_owner=NULL,lease_until=NULL,updated_at=clock_timestamp()
    WHERE workspace_id=p_workspace_id AND operation_id=job.operation_id;
  UPDATE public.message_outbox SET state='accepted',result_external_id=coalesce(result_external_id,receipt.wamid,receipt.provider_message_id),
    error_code=NULL,finished_at=coalesce(finished_at,clock_timestamp())
    WHERE workspace_id=p_workspace_id AND operation_id=job.operation_id AND fence=job.fence;
  PERFORM private.apply_channel_receipt_message(receipt,job);
  UPDATE private.channel_delivery_receipts SET state='planned',operation_id=job.operation_id WHERE id=receipt.id;
  RETURN true;
END;
$$;

CREATE FUNCTION public.persist_channel_receipt(p_workspace_id uuid,p_integration_id uuid,p_receipt jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE connection public.channel_connections; stored private.channel_delivery_receipts; receipt_id uuid;
BEGIN
  SELECT * INTO connection FROM public.channel_connections WHERE workspace_id=p_workspace_id
    AND id=(p_receipt->>'connectionId')::uuid AND legacy_integration_id=p_integration_id AND channel='whatsapp'
    AND provider=p_receipt->>'provider' AND external_account_id=p_receipt->>'externalAccountId';
  IF NOT FOUND THEN RAISE EXCEPTION 'CHANNEL_RECEIPT_SCOPE_INVALID' USING ERRCODE='42501'; END IF;
  INSERT INTO private.channel_delivery_receipts(workspace_id,connection_id,provider_event_id,provider,external_account_id,
    status,wamid,provider_message_id,external_operation_id,recipient,occurred_at)
    VALUES(p_workspace_id,connection.id,p_receipt->>'providerEventId',connection.provider,connection.external_account_id,
      p_receipt->>'status',nullif(p_receipt->>'wamid',''),nullif(p_receipt->>'providerMessageId',''),
      (p_receipt->>'operationId')::uuid,p_receipt->>'recipient',(p_receipt->>'occurredAt')::timestamptz)
    ON CONFLICT(workspace_id,connection_id,provider_event_id) DO NOTHING RETURNING id INTO receipt_id;
  IF receipt_id IS NULL THEN
    SELECT * INTO stored FROM private.channel_delivery_receipts WHERE workspace_id=p_workspace_id AND connection_id=connection.id
      AND provider_event_id=p_receipt->>'providerEventId';
    IF (stored.status,stored.wamid,stored.provider_message_id,stored.external_operation_id,stored.recipient,stored.occurred_at)
      IS DISTINCT FROM (p_receipt->>'status',nullif(p_receipt->>'wamid',''),nullif(p_receipt->>'providerMessageId',''),
        (p_receipt->>'operationId')::uuid,p_receipt->>'recipient',(p_receipt->>'occurredAt')::timestamptz) THEN
      RAISE EXCEPTION 'CHANNEL_RECEIPT_CONFLICT' USING ERRCODE='23514'; END IF;
    receipt_id:=stored.id;
  END IF;
  PERFORM private.reconcile_channel_receipt(p_workspace_id,receipt_id);
  RETURN receipt_id;
END;
$$;

-- Bounded recovery for a receipt arriving before the provider result was stored.
CREATE FUNCTION public.reconcile_channel_receipts(p_workspace_id uuid,p_limit integer DEFAULT 50)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE receipt_id uuid; count integer:=0;
BEGIN
  IF p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'INVALID_RECEIPT_LIMIT' USING ERRCODE='22023'; END IF;
  FOR receipt_id IN SELECT r.id FROM private.channel_delivery_receipts r WHERE r.workspace_id=p_workspace_id AND r.state='pending'
    AND EXISTS (SELECT 1 FROM public.message_jobs j WHERE j.workspace_id=r.workspace_id AND j.connection_id=r.connection_id
      AND j.state IN ('accepted','unknown','sending') AND (j.result_wamid=r.wamid OR j.result_provider_message_id=r.provider_message_id
        OR (r.provider='ycloud' AND r.external_operation_id=j.operation_id)))
    ORDER BY r.received_at,r.id LIMIT p_limit FOR UPDATE SKIP LOCKED LOOP
    IF private.reconcile_channel_receipt(p_workspace_id,receipt_id) THEN count:=count+1; END IF;
  END LOOP;
  RETURN count;
END;
$$;
REVOKE ALL ON FUNCTION private.apply_channel_receipt_message(private.channel_delivery_receipts,public.message_jobs),private.reconcile_channel_receipt(uuid,uuid),public.persist_channel_receipt(uuid,uuid,jsonb),
  public.reconcile_channel_receipts(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.apply_channel_receipt_message(private.channel_delivery_receipts,public.message_jobs),private.reconcile_channel_receipt(uuid,uuid),public.persist_channel_receipt(uuid,uuid,jsonb),
  public.reconcile_channel_receipts(uuid,integer) TO service_role;
