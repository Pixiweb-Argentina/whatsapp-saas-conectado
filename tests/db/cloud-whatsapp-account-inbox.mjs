// Same receive-only transaction probe in PGlite/PostgreSQL17. All fixtures roll back.
export const actor = "f2913ed0-08e2-4700-91c5-fe2760e724b2";
export const id = (n) => `00000000-0000-4000-9000-${String(3300 + n).padStart(12, "0")}`;
export const workspace = id(1), connectionA = id(51), connectionB = id(52), connectionK = id(53);
export const cleanupSql = `BEGIN;
DO $$ BEGIN
  PERFORM 1 FROM public.workspaces WHERE id='${workspace}' AND slug='f3-account-inbox-33'
    AND name='QA F3 · bandeja por cuenta' FOR UPDATE;
  IF NOT FOUND OR (SELECT count(*) FROM public.channel_connections WHERE workspace_id='${workspace}')<>3
    OR EXISTS(SELECT 1 FROM public.channel_connections WHERE workspace_id='${workspace}'
      AND (id NOT IN ('${connectionA}','${connectionB}','${connectionK}') OR legacy_integration_id IS NOT NULL OR capabilities<>'{}'))
    OR (SELECT count(*) FROM public.messages WHERE workspace_id='${workspace}')<>3
    OR EXISTS(SELECT 1 FROM public.messages WHERE workspace_id='${workspace}' AND (direction<>'in' OR body<>'Ficticio bandeja por cuenta'))
    OR EXISTS(SELECT 1 FROM public.contacts WHERE workspace_id='${workspace}' AND opt_in)
    OR EXISTS(SELECT 1 FROM public.message_jobs WHERE workspace_id='${workspace}')
    OR EXISTS(SELECT 1 FROM public.message_outbox WHERE workspace_id='${workspace}')
    OR EXISTS(SELECT 1 FROM public.integrations WHERE workspace_id='${workspace}')
    THEN RAISE EXCEPTION 'CLEANUP_FIXTURE_DRIFT_RECONCILE_FIRST'; END IF;
END $$;
DELETE FROM public.messages WHERE workspace_id='${workspace}';
DELETE FROM public.inbound_events WHERE workspace_id='${workspace}';
DELETE FROM public.conversations WHERE workspace_id='${workspace}';
DELETE FROM public.contact_identities WHERE workspace_id='${workspace}';
DELETE FROM public.contacts WHERE workspace_id='${workspace}';
DELETE FROM public.channel_connections WHERE workspace_id='${workspace}';
DELETE FROM public.workspaces WHERE id='${workspace}' AND slug='f3-account-inbox-33';
COMMIT;
SELECT NOT EXISTS(SELECT 1 FROM public.workspaces WHERE id='${workspace}') AS cleaned;`;
export function probeSql(user = actor) {
  if (!/^[a-f0-9-]{36}$/.test(user)) throw new Error("INVALID_SYNTHETIC_ACTOR");
  const event = { schemaVersion: 1, workspaceId: workspace, connectionId: connectionA, channel: "whatsapp", provider: "ycloud",
    providerEventId: "wamid.sql33", externalMessageId: "wamid.sql33", kind: "message", externalActorId: "+15555550701",
    occurredAt: "2026-10-10T12:00:00Z", receivedAt: "2026-10-10T12:00:01Z", content: { type: "text", rawType: "text", text: "Ficticio SQL" },
    mediaRefs: [], sourceContext: { channel: "whatsapp", sourceType: "direct_message" } };
  return `BEGIN;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.workspaces WHERE id='${workspace}' OR slug='f3-account-inbox-33')
  THEN RAISE EXCEPTION 'FIXTURE_EXISTS_RECONCILE_FIRST'; END IF; END $$;
INSERT INTO public.workspaces(id,name,slug) VALUES('${workspace}','QA F3 · bandeja por cuenta','f3-account-inbox-33');
INSERT INTO public.memberships(workspace_id,user_id,role) VALUES('${workspace}','${user}','admin');
SET LOCAL ROLE service_role;
DO $$ DECLARE event jsonb:='${JSON.stringify(event)}'; source jsonb; first jsonb; again jsonb; second jsonb; third jsonb; old_revision text; contact uuid;
BEGIN
  PERFORM public.register_whatsapp_account('${workspace}','${user}','${connectionA}','ycloud','+15555550600','QA A','enc:v1:YWJj:ZGVm',1);
  PERFORM public.register_whatsapp_account('${workspace}','${user}','${connectionB}','ycloud','+15555550601','QA B','enc:v1:YWJj:ZGVm',1);
  PERFORM public.register_whatsapp_account('${workspace}','${user}','${connectionK}','kapso','synthetic-phone33','QA K','enc:v1:YWJj:ZGVm',1);
  source:=public.read_whatsapp_account_source('${workspace}','${connectionA}');
  first:=public.materialize_whatsapp_account_inbound('${workspace}','${connectionA}',source->>'sourceRevision',event,'QA original');
  again:=public.materialize_whatsapp_account_inbound('${workspace}','${connectionA}',source->>'sourceRevision',
    event||jsonb_build_object('receivedAt',clock_timestamp()),'QA diferente');
  IF first->>'messageId'<>again->>'messageId' OR (again->>'inserted')::boolean THEN RAISE EXCEPTION 'REPLAY_DUPLICATED'; END IF;
  SELECT contact_id INTO contact FROM public.conversations WHERE id=(first->>'conversationId')::uuid;
  UPDATE public.contacts SET phone='+15555550799' WHERE id=contact;
  PERFORM public.materialize_whatsapp_account_inbound('${workspace}','${connectionA}',source->>'sourceRevision',
    event||jsonb_build_object('providerEventId','wamid.next33','externalMessageId','wamid.next33'),'Otro nombre');
  IF EXISTS(SELECT 1 FROM public.contacts WHERE workspace_id='${workspace}' AND phone='+15555550701') THEN RAISE EXCEPTION 'EDITED_PHONE_REROUTED'; END IF;
  UPDATE public.contacts SET phone='+15555550701' WHERE id=contact;
  source:=public.read_whatsapp_account_source('${workspace}','${connectionB}');
  second:=public.materialize_whatsapp_account_inbound('${workspace}','${connectionB}',source->>'sourceRevision',
    event||jsonb_build_object('connectionId','${connectionB}'),NULL);
  source:=public.read_whatsapp_account_source('${workspace}','${connectionK}');
  third:=public.materialize_whatsapp_account_inbound('${workspace}','${connectionK}',source->>'sourceRevision',
    event||jsonb_build_object('connectionId','${connectionK}','provider','kapso'),NULL);
  IF first->>'conversationId'=second->>'conversationId' OR first->>'messageId'=second->>'messageId'
    OR (SELECT count(*) FROM public.contacts WHERE workspace_id='${workspace}')<>1
    OR (SELECT count(*) FROM public.contact_identities WHERE workspace_id='${workspace}')<>3
    OR (SELECT count(*) FROM public.messages WHERE workspace_id='${workspace}')<>4
    OR (SELECT provider FROM public.messages WHERE id=(third->>'messageId')::uuid)<>'kapso'
    OR (SELECT unread_count FROM public.conversations WHERE id=(first->>'conversationId')::uuid)<>2
    OR EXISTS(SELECT 1 FROM public.conversations WHERE workspace_id='${workspace}' AND (ai_enabled OR state<>'human_active'))
    OR EXISTS(SELECT 1 FROM public.contacts WHERE workspace_id='${workspace}' AND opt_in)
    OR EXISTS(SELECT 1 FROM public.inbound_events WHERE workspace_id='${workspace}' AND state<>'planned')
    OR EXISTS(SELECT 1 FROM public.message_jobs WHERE workspace_id='${workspace}')
    OR EXISTS(SELECT 1 FROM public.message_outbox WHERE workspace_id='${workspace}')
    OR EXISTS(SELECT 1 FROM public.channel_connections WHERE workspace_id='${workspace}' AND (status<>'needs_permissions' OR capabilities<>'{}'))
    THEN RAISE EXCEPTION 'UNEXPECTED_ACCOUNT_SIDE_EFFECT'; END IF;
  old_revision:=source->>'sourceRevision';
  UPDATE private.channel_credentials SET encrypted_payload='enc:v1:ZGVm:YWJj' WHERE connection_id='${connectionK}';
  BEGIN PERFORM public.materialize_whatsapp_account_inbound('${workspace}','${connectionK}',old_revision,
    event||jsonb_build_object('connectionId','${connectionK}','provider','kapso'),NULL);
    RAISE EXCEPTION 'STALE_SOURCE_ACCEPTED'; EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
RESET ROLE;
DO $$ DECLARE role_name text; BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF has_function_privilege(role_name,'public.materialize_whatsapp_account_inbound(uuid,uuid,text,jsonb,text)','EXECUTE')
      THEN RAISE EXCEPTION 'PUBLIC_EXECUTE'; END IF;
  END LOOP;
END $$;
ROLLBACK;
SELECT true AS passed,'Atomic managed inbox/replay/account isolation/Kapso/edited contact/rotation/ACL probe rolled back' AS evidence;`;
}
