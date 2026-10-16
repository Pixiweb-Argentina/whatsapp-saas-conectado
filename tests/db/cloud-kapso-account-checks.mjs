import { kapsoProofFixtureSql } from "./kapso-account-proof-fixture.mjs";
export const actor = "f2913ed0-08e2-4700-91c5-fe2760e724b2";
export const id = (n) => n === 101 ? actor : `00000000-0000-4000-9000-${String(3400 + n).padStart(12, "0")}`;
export const workspace = id(1), connection = id(51);
export const callback = `https://permissions.example.org/api/webhooks/whatsapp-accounts/${workspace}/${connection}`;
export const setupSql = `BEGIN;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.workspaces WHERE id='${workspace}' OR slug='f3-kapso-checks-34')
  THEN RAISE EXCEPTION 'FIXTURE_EXISTS_RECONCILE_FIRST'; END IF; END $$;
INSERT INTO public.workspaces(id,name,slug) VALUES('${workspace}','QA F3 · permisos Kapso','f3-kapso-checks-34');
INSERT INTO public.memberships(workspace_id,user_id,role) VALUES('${workspace}','${actor}','admin');
INSERT INTO public.contacts(id,workspace_id,phone,name,opt_in) VALUES('${id(21)}','${workspace}','+15555550101','QA ficticio, no enviar',false);
INSERT INTO public.conversations(id,workspace_id,contact_id,channel,state,ai_enabled,window_expires_at)
  VALUES('${id(31)}','${workspace}','${id(21)}','whatsapp','human_active',false,now()+interval '1 hour');
${kapsoProofFixtureSql(id)}
SET LOCAL ROLE service_role;
SELECT public.save_whatsapp_account_verification('${workspace}','${actor}','${connection}',
  public.read_whatsapp_account_source('${workspace}','${connection}')->>'sourceRevision',
  jsonb_build_object('endpointId','${id(901)}','callbackUrl','${callback}'),
  jsonb_build_object('version',1,'checkedAt',clock_timestamp()-interval '1 second','checks',
    '{"api_access":true,"connected_number":true,"webhook_active":true,"webhook_url":true,"webhook_events":true,"webhook_secret":true}'::jsonb,
    'destination','https_unconfirmed','providerRead','complete','sendAuthorization',false));
RESET ROLE;
COMMIT;`;
export function probeSql() {
  return setupSql.replace("COMMIT;", () => `
SET LOCAL ROLE service_role;
DO $$ DECLARE r jsonb; old_until timestamptz; old_proof private.whatsapp_account_verifications; BEGIN
  r:=public.read_whatsapp_account_permission_review('${workspace}','${actor}','${connection}','${callback}');
  IF (r->>'canGrant')::boolean IS NOT TRUE OR (r->>'current')::boolean THEN RAISE EXCEPTION 'KAPSO_PROOF_INVALID'; END IF;
  UPDATE private.whatsapp_account_verifications SET checked_at=clock_timestamp()-interval '1 hour',
    report=jsonb_set(report,'{checkedAt}',to_jsonb(clock_timestamp()-interval '1 hour')) WHERE connection_id='${connection}';
  r:=public.read_whatsapp_account_permission_review('${workspace}','${actor}','${connection}','${callback}');
  PERFORM public.change_whatsapp_account_text_permission('${workspace}','${actor}','${connection}','${id(701)}','grant',
    (r->>'connectionUpdatedAt')::timestamptz,(r->>'verificationCheckedAt')::timestamptz,'${callback}');
  r:=public.read_whatsapp_account_permission_review('${workspace}','${actor}','${connection}','${callback}');
  old_until:=(r->>'validUntil')::timestamptz;
  IF (r->>'current')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'KAPSO_GRANT_INVALID'; END IF;
  SELECT * INTO old_proof FROM private.whatsapp_account_verifications WHERE connection_id='${connection}';
  PERFORM public.save_whatsapp_account_verification('${workspace}','${actor}','${connection}',
    public.read_whatsapp_account_source('${workspace}','${connection}')->>'sourceRevision',old_proof.input,
    jsonb_set(old_proof.report,'{checkedAt}',to_jsonb(clock_timestamp()-interval '1 second')));
  r:=public.read_whatsapp_account_permission_review('${workspace}','${actor}','${connection}','${callback}');
  IF (r->>'validUntil')::timestamptz<>old_until THEN RAISE EXCEPTION 'RECHECK_RENEWED_WITHOUT_CONSENT'; END IF;
  PERFORM public.change_whatsapp_account_text_permission('${workspace}','${actor}','${connection}','${id(702)}','grant',
    (r->>'connectionUpdatedAt')::timestamptz,(r->>'verificationCheckedAt')::timestamptz,'${callback}');
  r:=public.read_whatsapp_account_permission_review('${workspace}','${actor}','${connection}','${callback}');
  IF (r->>'validUntil')::timestamptz<=old_until THEN RAISE EXCEPTION 'EXPLICIT_RENEWAL_FAILED'; END IF;
  PERFORM public.change_whatsapp_account_text_permission('${workspace}','${actor}','${connection}','${id(703)}','revoke',
    (r->>'connectionUpdatedAt')::timestamptz,NULL,NULL);
  IF public.change_whatsapp_account_text_permission('${workspace}','${actor}','${connection}','${id(702)}','grant',
    (r->>'connectionUpdatedAt')::timestamptz,(r->>'verificationCheckedAt')::timestamptz,'${callback}') THEN RAISE EXCEPTION 'REPLAY_REACTIVATED'; END IF;
  IF EXISTS(SELECT 1 FROM public.contacts WHERE workspace_id='${workspace}' AND opt_in)
    OR (SELECT count(*) FROM public.message_jobs WHERE workspace_id='${workspace}')<>1
    OR (SELECT count(*) FROM public.message_outbox WHERE workspace_id='${workspace}')<>1
    OR (SELECT count(*) FROM public.messages WHERE workspace_id='${workspace}')<>1
    OR EXISTS(SELECT 1 FROM public.channel_connections WHERE workspace_id='${workspace}' AND status='ready')
    THEN RAISE EXCEPTION 'UNEXPECTED_SIDE_EFFECT'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
SELECT true AS passed,'Kapso proof/grant/recheck/explicit renewal/revoke/replay probe rolled back' AS evidence;`);
}
export const cleanupSql = `BEGIN;
DO $$ BEGIN
  PERFORM 1 FROM public.workspaces WHERE id='${workspace}' AND slug='f3-kapso-checks-34' AND name='QA F3 · permisos Kapso' FOR UPDATE;
  IF NOT FOUND OR (SELECT count(*) FROM public.channel_connections WHERE workspace_id='${workspace}')<>1
    OR EXISTS(SELECT 1 FROM public.channel_connections WHERE workspace_id='${workspace}' AND (id<>'${connection}' OR provider<>'kapso' OR legacy_integration_id IS NOT NULL))
    OR (SELECT count(*) FROM public.messages WHERE workspace_id='${workspace}')<>1
    OR EXISTS(SELECT 1 FROM public.messages WHERE workspace_id='${workspace}' AND body<>'Prueba ficticia, sin llamada al proveedor.')
    OR EXISTS(SELECT 1 FROM public.contacts WHERE workspace_id='${workspace}' AND opt_in)
    OR (SELECT count(*) FROM public.message_jobs WHERE workspace_id='${workspace}')<>1
    OR EXISTS(SELECT 1 FROM public.message_jobs WHERE workspace_id='${workspace}' AND operation_id<>'${id(61)}')
    THEN RAISE EXCEPTION 'CLEANUP_FIXTURE_DRIFT'; END IF;
END $$;
DELETE FROM private.whatsapp_account_permission_changes WHERE workspace_id='${workspace}';
DELETE FROM private.whatsapp_account_verifications WHERE workspace_id='${workspace}';
DELETE FROM private.channel_delivery_receipts WHERE workspace_id='${workspace}';
DELETE FROM public.message_outbox WHERE workspace_id='${workspace}';
DELETE FROM public.messages WHERE workspace_id='${workspace}';
DELETE FROM public.message_jobs WHERE workspace_id='${workspace}';
DELETE FROM public.conversations WHERE workspace_id='${workspace}';
DELETE FROM public.contact_identities WHERE workspace_id='${workspace}';
DELETE FROM public.contacts WHERE workspace_id='${workspace}';
DELETE FROM public.channel_connections WHERE workspace_id='${workspace}';
DELETE FROM public.workspaces WHERE id='${workspace}' AND slug='f3-kapso-checks-34';
COMMIT;
SELECT NOT EXISTS(SELECT 1 FROM public.workspaces WHERE id='${workspace}') AS cleaned;`;
