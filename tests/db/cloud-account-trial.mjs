import { accountTrialFixtureSql } from "./account-trial-fixture.mjs";
export const actor = "f2913ed0-08e2-4700-91c5-fe2760e724b2";
export function scope(provider = "ycloud", user = actor) {
  if (!["ycloud", "kapso"].includes(provider) || !/^[a-f0-9-]{36}$/.test(user)) throw new Error("INVALID_FIXTURE_SCOPE");
  const base = provider === "ycloud" ? 3700 : 3800;
  const id = (n) => n === 101 ? user : `00000000-0000-4000-9000-${String(base + n).padStart(12, "0")}`;
  return { id, provider, workspace: id(1), connection: id(51), conversation: id(31), operation: id(62), worker: id(71),
    callback: `https://permissions.example.org/api/webhooks/whatsapp-accounts/${id(1)}/${id(51)}` };
}
export function setupSql(provider = "ycloud", user = actor, ciphertext = "enc:v1:YWJj:ZGVm") {
  if (!/^enc:v1:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$/.test(ciphertext)) throw new Error("INVALID_FIXTURE_CIPHERTEXT");
  const { id, workspace } = scope(provider, user);
  return `BEGIN;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.workspaces WHERE id='${workspace}' OR slug='f3-account-trial-${provider}-36')
  THEN RAISE EXCEPTION 'FIXTURE_EXISTS_RECONCILE_FIRST'; END IF; END $$;
INSERT INTO public.workspaces(id,name,slug) VALUES('${workspace}','QA F3 · prueba única ${provider}','f3-account-trial-${provider}-36');
INSERT INTO public.memberships(workspace_id,user_id,role) VALUES('${workspace}','${user}','admin');
INSERT INTO public.contacts(id,workspace_id,phone,name,opt_in) VALUES('${id(21)}','${workspace}','+15555550101','QA ficticio, no enviar',false);
INSERT INTO public.conversations(id,workspace_id,contact_id,channel,state,ai_enabled,window_expires_at)
  VALUES('${id(31)}','${workspace}','${id(21)}','whatsapp','human_active',false,now()+interval '1 hour');
${accountTrialFixtureSql(id, provider).replaceAll("enc:v1:YWJj:ZGVm", ciphertext)}
COMMIT;`;
}
export function probeSql(provider = "ycloud", user = actor) {
  const { id, workspace, connection, conversation, operation, worker, callback } = scope(provider, user);
  return setupSql(provider, user).replace("COMMIT;", () => `
SET LOCAL ROLE service_role;
DO $$ DECLARE claim jsonb; review jsonb; replay jsonb; BEGIN
  review:=public.read_whatsapp_account_trial('${workspace}','${user}','${connection}','${callback}');
  IF review->'blockers'<>'[]' OR jsonb_array_length(review->'candidates')<>1 THEN RAISE EXCEPTION 'TRIAL_REVIEW_INVALID'; END IF;
  PERFORM public.authorize_whatsapp_account_trial('${workspace}','${user}','${connection}','${conversation}','${operation}','+15555550101',
    c.updated_at,v.checked_at,'${callback}',true) FROM public.channel_connections c JOIN private.whatsapp_account_verifications v ON v.connection_id=c.id WHERE c.id='${connection}';
  IF EXISTS(SELECT 1 FROM public.claim_channel_job('${workspace}','${worker}')) THEN RAISE EXCEPTION 'ORDINARY_WORKER_CLAIMED_TRIAL'; END IF;
  claim:=public.claim_whatsapp_account_trial('${workspace}','${user}','${connection}','${operation}','${worker}','${callback}',
    public.read_whatsapp_account_source('${workspace}','${connection}')->>'sourceRevision');
  IF claim IS NULL OR NOT public.begin_channel_send('${workspace}','${operation}','${worker}',1,'${id(92)}',(claim->>'validUntil')::timestamptz)
    THEN RAISE EXCEPTION 'TRIAL_NOT_PERMITTED'; END IF;
  IF public.begin_channel_send('${workspace}','${operation}','${worker}',1,'${id(92)}',(claim->>'validUntil')::timestamptz)
    THEN RAISE EXCEPTION 'TRIAL_DOUBLE_PERMIT'; END IF;
  PERFORM public.finish_channel_send('${workspace}','${operation}','${worker}',1,jsonb_build_object('status','unknown','operationId','${operation}'));
  PERFORM public.recover_channel_jobs('${workspace}');
  IF public.claim_whatsapp_account_trial('${workspace}','${user}','${connection}','${operation}','${worker}','${callback}',
    public.read_whatsapp_account_source('${workspace}','${connection}')->>'sourceRevision') IS NOT NULL THEN RAISE EXCEPTION 'TRIAL_RECLAIMED'; END IF;
  SELECT public.authorize_whatsapp_account_trial('${workspace}','${user}','${connection}','${conversation}','${operation}','+15555550101',
    c.updated_at,v.checked_at,'${callback}',true) INTO replay FROM public.channel_connections c JOIN private.whatsapp_account_verifications v ON v.connection_id=c.id WHERE c.id='${connection}';
  IF replay->'duplicate'<>'true' OR (SELECT count(*) FROM public.message_outbox WHERE operation_id='${operation}')<>1
    OR (SELECT opt_in FROM public.contacts WHERE id='${id(21)}')
    OR EXISTS(SELECT 1 FROM private.whatsapp_account_permission_changes WHERE workspace_id='${workspace}')
    OR NOT EXISTS(SELECT 1 FROM public.channel_connections WHERE id='${connection}' AND status='needs_permissions' AND capabilities='{}')
    THEN RAISE EXCEPTION 'TRIAL_SCOPE_OR_REPLAY_DRIFT'; END IF;
END $$;
RESET ROLE; ROLLBACK;
SELECT true AS passed,'${provider}' AS provider,'one-shot unknown/replay/ordinary-queue isolation/consent preserved, rolled back' AS evidence;`);
}
export function cleanupSql(provider = "ycloud") {
  const { workspace, connection, id } = scope(provider);
  return `BEGIN;
DO $$ BEGIN
  PERFORM 1 FROM public.workspaces WHERE id='${workspace}' AND slug='f3-account-trial-${provider}-36' AND name='QA F3 · prueba única ${provider}' FOR UPDATE;
  IF NOT FOUND OR EXISTS(SELECT 1 FROM public.integrations WHERE workspace_id='${workspace}')
    OR (SELECT count(*) FROM public.channel_connections WHERE workspace_id='${workspace}')<>1
    OR EXISTS(SELECT 1 FROM public.channel_connections WHERE workspace_id='${workspace}' AND (id<>'${connection}' OR legacy_integration_id IS NOT NULL OR provider<>'${provider}'))
    OR EXISTS(SELECT 1 FROM public.message_jobs WHERE workspace_id='${workspace}' AND operation_id NOT IN ('${id(62)}','${id(63)}'))
    OR EXISTS(SELECT 1 FROM public.messages WHERE workspace_id='${workspace}' AND body NOT IN ('Entrada ficticia de prueba','Hola, este es un mensaje de prueba de Pixiweb. Recibimos tu mensaje correctamente.'))
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
DELETE FROM public.workspaces WHERE id='${workspace}' AND slug='f3-account-trial-${provider}-36';
COMMIT;
SELECT NOT EXISTS(SELECT 1 FROM public.workspaces WHERE id='${workspace}') AS cleaned;`;
}
