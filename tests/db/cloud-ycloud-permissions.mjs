import { permissionEvidenceSql } from "./ycloud-permission-fixture.mjs";
const actor = "f2913ed0-08e2-4700-91c5-fe2760e724b2";
const id = (n) => n === 101 ? actor : `00000000-0000-4000-9000-${String(2700 + n).padStart(12, "0")}`;
export const workspace = id(1);
export const setup = `BEGIN;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.workspaces WHERE id='${workspace}' OR slug='f3-permission-synthetic-27')
  THEN RAISE EXCEPTION 'FIXTURE_EXISTS_RECONCILE_FIRST'; END IF; END $$;
INSERT INTO public.workspaces(id,name,slug) VALUES('${workspace}','QA F3 · permisos ficticios','f3-permission-synthetic-27');
INSERT INTO public.memberships(workspace_id,user_id,role) VALUES('${workspace}','${actor}','admin');
INSERT INTO public.integrations(id,workspace_id,provider,enabled,credentials,config)
  VALUES('${id(11)}','${workspace}','ycloud',true,'{}','{}');
INSERT INTO public.contacts(id,workspace_id,phone,name,opt_in)
  VALUES('${id(21)}','${workspace}','+15555550101','Contacto ficticio · no enviar',false);
INSERT INTO public.conversations(id,workspace_id,contact_id,channel,state,ai_enabled,window_expires_at)
  VALUES('${id(31)}','${workspace}','${id(21)}','whatsapp','human_active',false,now()+interval '1 hour');
${permissionEvidenceSql(id)}
COMMIT;`;
const callback = `https://permissions.example.org/api/webhooks/ycloud?wsid=${workspace}`;
export const probe = setup.replace("COMMIT;", () => `
SET LOCAL ROLE service_role;
DO $$ DECLARE review jsonb; first_check timestamptz; BEGIN
  review:=public.read_ycloud_permission_review('${workspace}','${actor}','${callback}');
  IF review->>'canGrant'<>'true' OR review->>'current'<>'false' THEN RAISE EXCEPTION 'REVIEW_FAILED'; END IF;
  UPDATE private.ycloud_verifications SET report=report-'destination' WHERE workspace_id='${workspace}';
  review:=public.read_ycloud_permission_review('${workspace}','${actor}','${callback}');
  IF review->>'canGrant'<>'false' OR NOT (review->'blockers' ? 'stable_callback_required') THEN
    RAISE EXCEPTION 'NULL_DESTINATION_ALLOWED'; END IF;
  UPDATE private.ycloud_verifications SET report=jsonb_set(report,'{destination}','"https_unconfirmed"') WHERE workspace_id='${workspace}';
  first_check:=(review->>'verificationCheckedAt')::timestamptz;
  PERFORM public.change_ycloud_text_permission('${workspace}','${actor}','${id(51)}','${id(701)}','grant',
    (review->>'connectionUpdatedAt')::timestamptz,first_check,'${callback}');
  review:=public.read_ycloud_permission_review('${workspace}','${actor}','${callback}');
  IF review->>'current'<>'true' OR NOT (review->>'managed')::boolean THEN RAISE EXCEPTION 'GRANT_FAILED'; END IF;
  PERFORM public.change_ycloud_text_permission('${workspace}','${actor}','${id(51)}','${id(702)}','revoke',
    (review->>'connectionUpdatedAt')::timestamptz,NULL,NULL);
  IF public.change_ycloud_text_permission('${workspace}','${actor}','${id(51)}','${id(701)}','grant',
    (review->>'connectionUpdatedAt')::timestamptz,first_check,'${callback}') THEN RAISE EXCEPTION 'REPLAY_REACTIVATED'; END IF;
  review:=public.read_ycloud_permission_review('${workspace}','${actor}','${callback}');
  IF review->>'current'<>'false' THEN RAISE EXCEPTION 'REVOKE_FAILED'; END IF;
  PERFORM public.change_ycloud_text_permission('${workspace}','${actor}','${id(51)}','${id(703)}','grant',
    (review->>'connectionUpdatedAt')::timestamptz,first_check,'${callback}');
  UPDATE public.integrations SET config=config||'{"probe":true}' WHERE workspace_id='${workspace}';
  review:=public.read_ycloud_permission_review('${workspace}','${actor}','${callback}');
  IF review->>'current'<>'false' OR review->>'managed'<>'false' THEN RAISE EXCEPTION 'INVALIDATION_FAILED'; END IF;
END $$;
SELECT true grant_revoke_replay_and_invalidation_pass,
  (SELECT opt_in=false FROM public.contacts WHERE id='${id(21)}') no_contact_consent_granted,
  (SELECT count(*)=1 FROM public.message_jobs WHERE workspace_id='${workspace}') no_new_jobs,
  NOT has_table_privilege('authenticated','private.ycloud_permission_changes','SELECT') private_audit_denied,
  NOT has_function_privilege('authenticated','public.change_ycloud_text_permission(uuid,uuid,uuid,uuid,text,timestamptz,timestamptz,text)','EXECUTE') direct_rpc_denied;
ROLLBACK;`);
export const cleanup = `BEGIN;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.workspaces WHERE id='${workspace}' AND slug='f3-permission-synthetic-27')
  THEN RAISE EXCEPTION 'FIXTURE_SCOPE_INVALID'; END IF; END $$;
DELETE FROM public.message_outbox WHERE workspace_id='${workspace}';
DELETE FROM public.message_jobs WHERE workspace_id='${workspace}';
DELETE FROM public.inbound_events WHERE workspace_id='${workspace}';
DELETE FROM public.conversations WHERE workspace_id='${workspace}';
DELETE FROM public.contact_identities WHERE workspace_id='${workspace}';
DELETE FROM public.channel_connections WHERE workspace_id='${workspace}';
DELETE FROM public.integrations WHERE workspace_id='${workspace}';
DELETE FROM public.contacts WHERE workspace_id='${workspace}';
DELETE FROM public.workspaces WHERE id='${workspace}' AND slug='f3-permission-synthetic-27';
COMMIT;`;
