import { accountProofFixtureSql } from "./whatsapp-account-proof-fixture.mjs";
export const actor = "f2913ed0-08e2-4700-91c5-fe2760e724b2";
export const id = (n) => n === 101 ? actor : `00000000-0000-4000-9000-${String(3200 + n).padStart(12, "0")}`;
export const workspace = id(1), connection = id(51);
export const callback = `https://permissions.example.org/api/webhooks/whatsapp-accounts/${workspace}/${connection}`;
export const setupSql = `BEGIN;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.workspaces WHERE id='${workspace}' OR slug='f3-account-checks-32')
  THEN RAISE EXCEPTION 'FIXTURE_EXISTS_RECONCILE_FIRST'; END IF; END $$;
INSERT INTO public.workspaces(id,name,slug) VALUES('${workspace}','QA F3 · permisos por cuenta','f3-account-checks-32');
INSERT INTO public.memberships(workspace_id,user_id,role) VALUES('${workspace}','${actor}','admin');
INSERT INTO public.contacts(id,workspace_id,phone,name,opt_in) VALUES('${id(21)}','${workspace}','+15555550101','QA ficticio, no enviar',false);
INSERT INTO public.conversations(id,workspace_id,contact_id,channel,state,ai_enabled,window_expires_at)
  VALUES('${id(31)}','${workspace}','${id(21)}','whatsapp','human_active',false,now()+interval '1 hour');
${accountProofFixtureSql(id)}
SET LOCAL ROLE service_role;
SELECT public.save_whatsapp_account_verification('${workspace}','${actor}','${connection}',
  public.read_whatsapp_account_source('${workspace}','${connection}')->>'sourceRevision',
  jsonb_build_object('endpointId','synthetic-endpoint32','callbackUrl','${callback}'),
  jsonb_build_object('version',1,'checkedAt',clock_timestamp()-interval '1 second','checks',
    '{"api_access":true,"connected_number":true,"webhook_active":true,"webhook_url":true,"webhook_events":true,"webhook_secret":true}'::jsonb,
    'destination','https_unconfirmed','providerRead','complete','sendAuthorization',false));
RESET ROLE;
COMMIT;`;

export function probeSql() {
  return setupSql.replace("COMMIT;", () => `
SET LOCAL ROLE service_role;
DO $$ DECLARE r jsonb; first_operation uuid:='${id(701)}'; revoked uuid:='${id(702)}'; BEGIN
  r:=public.read_whatsapp_account_permission_review('${workspace}','${actor}','${connection}','${callback}');
  IF (r->>'canGrant')::boolean IS NOT TRUE OR (r->>'current')::boolean THEN RAISE EXCEPTION 'REVIEW_INVALID'; END IF;
  IF NOT public.change_whatsapp_account_text_permission('${workspace}','${actor}','${connection}',first_operation,'grant',
    (r->>'connectionUpdatedAt')::timestamptz,(r->>'verificationCheckedAt')::timestamptz,'${callback}') THEN RAISE EXCEPTION 'GRANT_FAILED'; END IF;
  r:=public.read_whatsapp_account_permission_review('${workspace}','${actor}','${connection}','${callback}');
  IF (r->>'current')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'GRANT_NOT_CURRENT'; END IF;
  IF public.change_whatsapp_account_text_permission('${workspace}','${actor}','${connection}',first_operation,'grant',
    (r->>'connectionUpdatedAt')::timestamptz,(r->>'verificationCheckedAt')::timestamptz,'${callback}') THEN RAISE EXCEPTION 'REPLAY_REAPPLIED'; END IF;
  PERFORM public.change_whatsapp_account_text_permission('${workspace}','${actor}','${connection}',revoked,'revoke',
    (r->>'connectionUpdatedAt')::timestamptz,NULL,NULL);
  IF public.change_whatsapp_account_text_permission('${workspace}','${actor}','${connection}',first_operation,'grant',
    (r->>'connectionUpdatedAt')::timestamptz,(r->>'verificationCheckedAt')::timestamptz,'${callback}') THEN RAISE EXCEPTION 'REPLAY_REACTIVATED'; END IF;
  IF EXISTS(SELECT 1 FROM public.channel_connections WHERE id='${connection}' AND status='ready')
    OR EXISTS(SELECT 1 FROM public.contacts WHERE workspace_id='${workspace}' AND opt_in)
    OR (SELECT count(*) FROM public.message_jobs WHERE workspace_id='${workspace}')<>1
    OR (SELECT count(*) FROM public.messages WHERE workspace_id='${workspace}')<>1 THEN RAISE EXCEPTION 'UNEXPECTED_SIDE_EFFECT'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
SELECT true AS passed,'Source proof/grant/revoke/replay under service_role rolled back; no provider/model calls' AS evidence;`);
}
