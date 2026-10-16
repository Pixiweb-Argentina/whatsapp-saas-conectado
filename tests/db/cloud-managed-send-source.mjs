import { managedSendFixtureSql } from "./managed-send-fixture.mjs";
export const actor = "f2913ed0-08e2-4700-91c5-fe2760e724b2";
export function scope(provider = "ycloud", user = actor) {
  if (!["ycloud", "kapso"].includes(provider) || !/^[a-f0-9-]{36}$/.test(user)) throw new Error("INVALID_FIXTURE_SCOPE");
  const base = provider === "ycloud" ? 3500 : 3600;
  const id = (n) => n === 101 ? user : `00000000-0000-4000-9000-${String(base + n).padStart(12, "0")}`;
  return { id, provider, workspace: id(1), connection: id(51), conversation: id(31), operation: id(62), worker: id(71) };
}
export function setupSql(provider = "ycloud", user = actor, ciphertext = "enc:v1:YWJj:ZGVm") {
  if (!/^enc:v1:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$/.test(ciphertext)) throw new Error("INVALID_FIXTURE_CIPHERTEXT");
  const { id, workspace } = scope(provider, user);
  return `BEGIN;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.workspaces WHERE id='${workspace}' OR slug='f3-managed-send-${provider}-35')
  THEN RAISE EXCEPTION 'FIXTURE_EXISTS_RECONCILE_FIRST'; END IF; END $$;
INSERT INTO public.workspaces(id,name,slug) VALUES('${workspace}','QA F3 · transporte managed ${provider}','f3-managed-send-${provider}-35');
INSERT INTO public.memberships(workspace_id,user_id,role) VALUES('${workspace}','${user}','admin');
INSERT INTO public.contacts(id,workspace_id,phone,name,opt_in) VALUES('${id(21)}','${workspace}','+15555550101','QA ficticio, no enviar',true);
INSERT INTO public.conversations(id,workspace_id,contact_id,channel,state,ai_enabled,window_expires_at)
  VALUES('${id(31)}','${workspace}','${id(21)}','whatsapp','human_active',false,now()+interval '1 hour');
${managedSendFixtureSql(id, provider).replaceAll("enc:v1:YWJj:ZGVm", ciphertext)}
COMMIT;`;
}
export function probeSql(provider = "ycloud", user = actor) {
  const { id, workspace, connection, conversation, operation, worker } = scope(provider, user);
  return setupSql(provider, user).replace("COMMIT;", () => `
SET LOCAL ROLE service_role;
DO $$ DECLARE enqueued jsonb; claimed public.message_jobs; BEGIN
  enqueued:=public.enqueue_human_channel_text('${workspace}','${conversation}','${user}','${operation}','Ficticio managed send');
  IF (enqueued->>'duplicate')::boolean OR NOT EXISTS(SELECT 1 FROM private.channel_job_sources WHERE operation_id='${operation}' AND permission_id='${id(701)}')
    THEN RAISE EXCEPTION 'MISSING_SOURCE_PIN'; END IF;
  SELECT * INTO claimed FROM public.claim_channel_job('${workspace}','${worker}');
  IF claimed.operation_id<>'${operation}' OR NOT public.begin_channel_send('${workspace}','${operation}','${worker}',claimed.fence,'${id(92)}',clock_timestamp()+interval '30 seconds')
    THEN RAISE EXCEPTION 'MANAGED_SEND_NOT_PERMITTED'; END IF;
  IF public.begin_channel_send('${workspace}','${operation}','${worker}',claimed.fence,'${id(92)}',clock_timestamp()+interval '30 seconds')
    THEN RAISE EXCEPTION 'DOUBLE_PERMIT'; END IF;
  PERFORM public.finish_channel_send('${workspace}','${operation}','${worker}',claimed.fence,jsonb_build_object('status','unknown','operationId','${operation}'));
  IF EXISTS(SELECT 1 FROM public.claim_channel_job('${workspace}','${worker}')) THEN RAISE EXCEPTION 'UNKNOWN_RECLAIMED'; END IF;
  enqueued:=public.enqueue_human_channel_text('${workspace}','${conversation}','${user}','${operation}','Ficticio managed send');
  IF (enqueued->>'duplicate')::boolean IS NOT TRUE OR enqueued->>'state'<>'unknown'
    OR (SELECT count(*) FROM public.message_outbox WHERE operation_id='${operation}')<>1
    OR (SELECT count(*) FROM public.messages WHERE channel_operation_id='${operation}')<>1 THEN RAISE EXCEPTION 'REPLAY_DUPLICATED'; END IF;
  PERFORM public.enqueue_human_channel_text('${workspace}','${conversation}','${user}','${id(63)}','Ficticio stale send');
  PERFORM public.change_whatsapp_account_text_permission('${workspace}','${user}','${connection}','${id(702)}','grant',c.updated_at,v.checked_at,
    v.input->>'callbackUrl') FROM public.channel_connections c JOIN private.whatsapp_account_verifications v ON v.connection_id=c.id WHERE c.id='${connection}';
  SELECT * INTO claimed FROM public.claim_channel_job('${workspace}','${worker}');
  IF claimed.operation_id<>'${id(63)}' OR public.begin_channel_send('${workspace}','${id(63)}','${worker}',claimed.fence,'${id(92)}',clock_timestamp()+interval '30 seconds')
    THEN RAISE EXCEPTION 'STALE_GRANT_REVIVED'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
SELECT true AS passed,'${provider} managed source pin/permit/unknown/replay/renewal fence rolled back' AS evidence;`);
}
export function cleanupSql(provider = "ycloud") {
  const { workspace, connection, operation, id } = scope(provider);
  return `BEGIN;
DO $$ BEGIN
  PERFORM 1 FROM public.workspaces WHERE id='${workspace}' AND slug='f3-managed-send-${provider}-35' AND name='QA F3 · transporte managed ${provider}' FOR UPDATE;
  IF NOT FOUND OR EXISTS(SELECT 1 FROM public.integrations WHERE workspace_id='${workspace}')
    OR (SELECT count(*) FROM public.channel_connections WHERE workspace_id='${workspace}')<>1
    OR EXISTS(SELECT 1 FROM public.channel_connections WHERE workspace_id='${workspace}' AND (id<>'${connection}' OR legacy_integration_id IS NOT NULL OR provider<>'${provider}'))
    OR EXISTS(SELECT 1 FROM public.message_jobs WHERE workspace_id='${workspace}' AND operation_id NOT IN ('${operation}','${id(61)}','${id(63)}'))
    OR EXISTS(SELECT 1 FROM public.messages WHERE workspace_id='${workspace}' AND body NOT IN ('Prueba ficticia, sin llamada al proveedor.','Ficticio managed send'))
    THEN RAISE EXCEPTION 'CLEANUP_FIXTURE_DRIFT'; END IF;
END $$;
DELETE FROM private.whatsapp_account_permission_changes WHERE workspace_id='${workspace}';
DELETE FROM private.whatsapp_account_verifications WHERE workspace_id='${workspace}';
DELETE FROM private.channel_delivery_receipts WHERE workspace_id='${workspace}';
DELETE FROM public.message_outbox WHERE workspace_id='${workspace}';
DELETE FROM public.messages WHERE workspace_id='${workspace}';
DELETE FROM public.message_jobs WHERE workspace_id='${workspace}';
DELETE FROM public.inbound_events WHERE workspace_id='${workspace}';
DELETE FROM public.conversations WHERE workspace_id='${workspace}';
DELETE FROM public.contact_identities WHERE workspace_id='${workspace}';
DELETE FROM public.contacts WHERE workspace_id='${workspace}';
DELETE FROM public.channel_connections WHERE workspace_id='${workspace}';
DELETE FROM public.workspaces WHERE id='${workspace}' AND slug='f3-managed-send-${provider}-35';
COMMIT;
SELECT NOT EXISTS(SELECT 1 FROM public.workspaces WHERE id='${workspace}') AS cleaned;`;
}
