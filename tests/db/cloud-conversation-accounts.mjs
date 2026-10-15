// Synthetic-only probe for the new non-operational project. No provider/model calls.
// The SQL probe rolls back. UI setup is explicit and its exact fixture is removable.
export const ids = Object.fromEntries(["workspace", "contact", "integration", "accountA", "accountB", "identityA",
  "identityB", "threadA", "threadB"].map((key, n) => [key, `00000000-0000-4000-9000-${String(2501 + n).padStart(12, "0")}`]));
const qa = "f2913ed0-08e2-4700-91c5-fe2760e724b2";
const routing = JSON.stringify({ integrationId: ids.integration, provider: "ycloud", accountId: "+15555550250" });
const seed = `
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.workspaces WHERE id='${ids.workspace}' OR slug='f3-accounts-25-synthetic') THEN
    RAISE EXCEPTION 'FIXTURE_ALREADY_EXISTS_RECONCILE_FIRST'; END IF;
END $$;
INSERT INTO public.workspaces(id,name,slug) VALUES('${ids.workspace}','F3 · Cuentas separadas · temporal','f3-accounts-25-synthetic');
INSERT INTO public.memberships(workspace_id,user_id,role) VALUES('${ids.workspace}','${qa}','admin');
INSERT INTO public.integrations(id,workspace_id,provider,enabled,config)
  VALUES('${ids.integration}','${ids.workspace}','ycloud',true,'{"phone_number":"+15555550250"}');
INSERT INTO public.contacts(id,workspace_id,name,phone,opt_in)
  VALUES('${ids.contact}','${ids.workspace}','Contacto de prueba · dos cuentas','+15555550925',false);
INSERT INTO public.channel_connections(id,workspace_id,channel,provider,external_account_id,display_name,status,legacy_integration_id)
  VALUES('${ids.accountA}','${ids.workspace}','whatsapp','ycloud','+15555550250','Ventas · prueba ficticia','connecting','${ids.integration}'),
    ('${ids.accountB}','${ids.workspace}','whatsapp','ycloud','+15555550251','Soporte · prueba ficticia','connecting',NULL);
INSERT INTO public.contact_identities(id,workspace_id,connection_id,contact_id,external_user_id)
  VALUES('${ids.identityA}','${ids.workspace}','${ids.accountA}','${ids.contact}','+15555550925'),
    ('${ids.identityB}','${ids.workspace}','${ids.accountB}','${ids.contact}','+15555550925');
INSERT INTO public.conversations(id,workspace_id,contact_id,channel,connection_id,identity_id,state,ai_enabled)
  VALUES('${ids.threadA}','${ids.workspace}','${ids.contact}','whatsapp','${ids.accountA}','${ids.identityA}','human_active',false);
`;
const secondThread = `
INSERT INTO public.conversations(id,workspace_id,contact_id,channel,connection_id,identity_id,state,ai_enabled,source_context)
  VALUES('${ids.threadB}','${ids.workspace}','${ids.contact}','whatsapp','${ids.accountB}','${ids.identityB}','paused',false,
    '{"channel":"whatsapp","sourceType":"direct_message"}');
`;
// Explicit columns to keep both text messages inbound and without send authority.
const uiMessages = `
INSERT INTO public.messages(workspace_id,conversation_id,connection_id,provider,direction,type,body,wamid,status,meta)
  VALUES('${ids.workspace}','${ids.threadA}','${ids.accountA}','ycloud','in','text','Mensaje ficticio de la cuenta Ventas.',
    'f3.accounts25.a','delivered','{"synthetic":true,"fixture":"f3-accounts-25"}'),
    ('${ids.workspace}','${ids.threadB}','${ids.accountB}','ycloud','in','text','Mensaje ficticio de la cuenta Soporte.',
    'f3.accounts25.b','delivered','{"synthetic":true,"fixture":"f3-accounts-25"}');
`;
export const setupUi = `BEGIN;${seed}${secondThread}${uiMessages}COMMIT;
SELECT '${ids.workspace}' AS workspace_id,'${ids.threadA}' AS thread_a,'${ids.threadB}' AS thread_b;`;

export const probe = `BEGIN;${seed}
DO $$ DECLARE result jsonb; before_profile jsonb; BEGIN
  result:=public.upsert_legacy_whatsapp_inbound('${ids.workspace}','+15555550925','Single-account legacy','${routing}');
  IF result->'conversation'->>'id'<>'${ids.threadA}' THEN RAISE EXCEPTION 'LEGACY_ID_NOT_PRESERVED'; END IF;
END $$;
${secondThread}${uiMessages}
DO $$ DECLARE conv public.conversations; before_profile jsonb; BEGIN
  conv:=private.ycloud_account_conversation('${ids.workspace}','${ids.accountB}','${ids.contact}','${ids.identityB}');
  IF conv.id<>'${ids.threadB}' OR conv.state<>'paused' OR conv.ai_enabled THEN
    RAISE EXCEPTION 'ACCOUNT_SCOPED_REPLAY_CHANGED_CONTROL'; END IF;
  SELECT to_jsonb(c) INTO before_profile FROM public.contacts c WHERE id='${ids.contact}';
  BEGIN
    PERFORM public.upsert_legacy_whatsapp_inbound('${ids.workspace}','+15555550925','Must roll back','${routing}');
    RAISE EXCEPTION 'AMBIGUOUS_LEGACY_ACCEPTED';
  EXCEPTION WHEN check_violation THEN NULL; END;
  IF (SELECT to_jsonb(c) FROM public.contacts c WHERE id='${ids.contact}') IS DISTINCT FROM before_profile THEN
    RAISE EXCEPTION 'REJECTED_LEGACY_MUTATED_PROFILE'; END IF;
  IF EXISTS (SELECT 1 FROM public.read_legacy_whatsapp_conversation('${ids.workspace}','${ids.contact}')) THEN
    RAISE EXCEPTION 'AMBIGUOUS_LEGACY_READ'; END IF;
  IF has_function_privilege('anon','public.upsert_legacy_whatsapp_inbound(uuid,text,text,jsonb)','execute')
    OR has_function_privilege('authenticated','public.read_legacy_whatsapp_conversation(uuid,uuid,jsonb)','execute') THEN
    RAISE EXCEPTION 'BROWSER_ROLE_CAN_CALL_SERVICE_RPC'; END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','${qa}',true);
DO $$ DECLARE count_rows integer; preview jsonb; BEGIN
  SELECT count(*) INTO count_rows FROM public.read_inbox_page_assigned('${ids.workspace}');
  IF count_rows<>2 THEN RAISE EXCEPTION 'ACCOUNT_THREADS_NOT_VISIBLE'; END IF;
  SELECT value INTO preview FROM public.read_inbox_page_assigned('${ids.workspace}',p_connection_id=>'${ids.accountB}') value;
  IF preview->>'id'<>'${ids.threadB}' OR preview->'last_message'->>'body'<>'Mensaje ficticio de la cuenta Soporte.' THEN
    RAISE EXCEPTION 'ACCOUNT_PREVIEW_MIXED'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-9000-000000009999',true);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.read_inbox_page_assigned('${ids.workspace}')) THEN RAISE EXCEPTION 'TENANT_LEAK'; END IF;
END $$;
RESET ROLE; ROLLBACK;
SELECT 'passed' AS multiaccount_probe,NOT EXISTS(SELECT 1 FROM public.workspaces WHERE id='${ids.workspace}') AS fixture_removed;`;

export const cleanupUi = `BEGIN;
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname='f3-accounts25-holder';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.workspaces WHERE id='${ids.workspace}' AND
    (slug<>'f3-accounts-25-synthetic' OR name<>'F3 · Cuentas separadas · temporal')) THEN
    RAISE EXCEPTION 'FIXTURE_SCOPE_CHANGED'; END IF;
END $$;
DELETE FROM public.workspaces WHERE id='${ids.workspace}' AND slug='f3-accounts-25-synthetic';
COMMIT; SELECT NOT EXISTS(SELECT 1 FROM public.workspaces WHERE id='${ids.workspace}') AS fixture_removed;`;

export const setupConcurrency = `BEGIN;${seed}COMMIT;
SELECT cron.schedule('f3-accounts25-holder','1 second',$probe$
DO $body$ DECLARE conv public.conversations; acquired timestamptz; BEGIN
  PERFORM set_config('application_name','f3-accounts25-holder',true);
  PERFORM cron.unschedule('f3-accounts25-holder');
  conv:=private.ycloud_account_conversation('${ids.workspace}','${ids.accountB}','${ids.contact}','${ids.identityB}');
  acquired:=clock_timestamp();
  PERFORM pg_sleep(12);
  INSERT INTO public.events(workspace_id,conversation_id,type,payload)
    VALUES('${ids.workspace}',conv.id,'f3_accounts25_holder',jsonb_build_object(
      'pid',pg_backend_pid(),'acquiredAt',acquired,'completedAt',clock_timestamp(),'threadId',conv.id));
END $body$;
$probe$) AS job_id;`;
export const observeConcurrency = `SELECT pid,wait_event FROM pg_stat_activity
  WHERE application_name='f3-accounts25-holder' AND wait_event='PgSleep';`;
export const competeConcurrency = `SELECT pg_backend_pid() AS competitor_pid,statement_timestamp() AS started_at,
  to_jsonb(private.ycloud_account_conversation('${ids.workspace}','${ids.accountB}','${ids.contact}','${ids.identityB}'))->>'id' AS thread_id,
  clock_timestamp() AS completed_at;`;
export const verifyConcurrency = `SELECT payload AS holder,
  (SELECT count(*) FROM public.conversations WHERE workspace_id='${ids.workspace}' AND contact_id='${ids.contact}') AS threads,
  (SELECT count(*) FROM cron.job WHERE jobname='f3-accounts25-holder') AS remaining_jobs
  FROM public.events WHERE workspace_id='${ids.workspace}' AND type='f3_accounts25_holder';`;
