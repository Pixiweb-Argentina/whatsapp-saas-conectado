// Synthetic PostgreSQL probe. Every fixture and write rolls back; no provider, model or send.
const id = (n) => `00000000-0000-4000-9000-${String(3100 + n).padStart(12, "0")}`;
export const workspace = id(1), connectionA = id(51), connectionB = id(52);
export function probeSql(actor = "f2913ed0-08e2-4700-91c5-fe2760e724b2") {
  if (!/^[a-f0-9-]{36}$/.test(actor)) throw new Error("INVALID_SYNTHETIC_ACTOR");
  const event = { schemaVersion: 1, workspaceId: workspace, connectionId: connectionA,
    channel: "whatsapp", provider: "ycloud", providerEventId: "wamid.synthetic-31",
    kind: "message", occurredAt: "2026-10-10T12:00:00Z", receivedAt: "2026-10-10T12:00:01Z",
    externalActorId: "+15555550101", externalMessageId: "wamid.synthetic-31",
    content: { type: "text", text: "Prueba ficticia", rawType: "text" }, mediaRefs: [],
    sourceContext: { channel: "whatsapp", sourceType: "direct_message" } };
  return `BEGIN;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.workspaces WHERE id='${workspace}' OR slug='f3-account-ingress-31')
  THEN RAISE EXCEPTION 'FIXTURE_EXISTS_RECONCILE_FIRST'; END IF; END $$;
INSERT INTO public.workspaces(id,name,slug) VALUES('${workspace}','QA F3 · ingreso por cuenta','f3-account-ingress-31');
INSERT INTO public.memberships(workspace_id,user_id,role) VALUES('${workspace}','${actor}','admin');
SET LOCAL ROLE service_role;
DO $$ DECLARE source jsonb; event jsonb:='${JSON.stringify(event)}'; first uuid; again uuid; old_revision text;
BEGIN
  PERFORM public.register_whatsapp_account('${workspace}','${actor}','${connectionA}','ycloud','+15555550400',
    'QA Ventas','enc:v1:YWJj:ZGVm',1);
  PERFORM public.register_whatsapp_account('${workspace}','${actor}','${connectionB}','ycloud','+15555550401',
    'QA Soporte','enc:v1:YWJj:YWJj',1);
  source:=public.read_whatsapp_account_source('${workspace}','${connectionA}');
  IF source->>'encryptedPayload'<>'enc:v1:YWJj:ZGVm' OR source->>'status'<>'needs_permissions'
    OR source->>'sourceRevision' !~ '^[a-f0-9]{32}$' THEN RAISE EXCEPTION 'SOURCE_INVALID'; END IF;
  first:=public.persist_whatsapp_account_delivery('${workspace}','${connectionA}',source->>'sourceRevision','message',event);
  again:=public.persist_whatsapp_account_delivery('${workspace}','${connectionA}',source->>'sourceRevision','message',
    event||jsonb_build_object('receivedAt','2026-10-10T12:00:05Z'));
  IF first<>again THEN RAISE EXCEPTION 'REPLAY_DUPLICATED'; END IF;
  BEGIN
    PERFORM public.persist_whatsapp_account_delivery('${workspace}','${connectionA}',source->>'sourceRevision','message',
      jsonb_set(event,'{content,text}','"changed"'));
    RAISE EXCEPTION 'COLLISION_ACCEPTED'; EXCEPTION WHEN check_violation THEN NULL; END;
  old_revision:=source->>'sourceRevision';
  UPDATE private.channel_credentials SET encrypted_payload='enc:v1:YWJj:YWJj' WHERE connection_id='${connectionA}';
  BEGIN
    PERFORM public.persist_whatsapp_account_delivery('${workspace}','${connectionA}',old_revision,'message',event);
    RAISE EXCEPTION 'STALE_SOURCE_ACCEPTED'; EXCEPTION WHEN check_violation THEN NULL; END;
  source:=public.read_whatsapp_account_source('${workspace}','${connectionB}');
  PERFORM public.persist_whatsapp_account_delivery('${workspace}','${connectionB}',source->>'sourceRevision','message',
    event||jsonb_build_object('connectionId','${connectionB}'));
  PERFORM public.persist_whatsapp_account_delivery('${workspace}','${connectionB}',source->>'sourceRevision','receipt',
    jsonb_build_object('connectionId','${connectionB}','provider','ycloud','externalAccountId','+15555550401',
      'providerEventId','evt.receipt31','status','delivered','wamid','wamid.synthetic-31',
      'providerMessageId','provider.synthetic31','recipient','+15555550101','occurredAt','2026-10-10T12:00:00Z'));
  IF (SELECT count(*) FROM public.inbound_events WHERE workspace_id='${workspace}')<>2
    OR (SELECT count(*) FROM private.channel_delivery_receipts WHERE workspace_id='${workspace}')<>1
    OR EXISTS(SELECT 1 FROM public.message_jobs WHERE workspace_id='${workspace}')
    OR EXISTS(SELECT 1 FROM public.message_outbox WHERE workspace_id='${workspace}')
    OR EXISTS(SELECT 1 FROM public.messages WHERE workspace_id='${workspace}')
    OR EXISTS(SELECT 1 FROM public.contacts WHERE workspace_id='${workspace}')
    OR EXISTS(SELECT 1 FROM public.conversations WHERE workspace_id='${workspace}')
    OR EXISTS(SELECT 1 FROM public.integrations WHERE workspace_id='${workspace}')
    OR EXISTS(SELECT 1 FROM public.channel_connections WHERE workspace_id='${workspace}' AND capabilities<>'{}')
    THEN RAISE EXCEPTION 'UNEXPECTED_SIDE_EFFECT'; END IF;
  UPDATE public.channel_connections SET status='revoked',revoked_at=clock_timestamp() WHERE id='${connectionB}';
  IF public.read_whatsapp_account_source('${workspace}','${connectionB}') IS NOT NULL THEN RAISE EXCEPTION 'REVOKED_SOURCE_READ'; END IF;
END $$;
RESET ROLE;
DO $$ DECLARE role_name text; fn text; BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOREACH fn IN ARRAY ARRAY['public.read_whatsapp_account_source(uuid,uuid)',
      'public.persist_whatsapp_account_delivery(uuid,uuid,text,text,jsonb)'] LOOP
      IF has_function_privilege(role_name,fn,'EXECUTE') THEN RAISE EXCEPTION 'PUBLIC_EXECUTE'; END IF;
    END LOOP;
  END LOOP;
END $$;
ROLLBACK;
SELECT true AS passed,'PostgreSQL account-source/intake/replay/rotation/receipt/revoke/ACL probe rolled back' AS evidence;`;
}
