const id = (n) => `00000000-0000-4000-9000-${String(3000 + n).padStart(12, "0")}`;
export const workspace = id(1);
export const connectionA = id(51), connectionB = id(52);
export function setupSql(actor = "f2913ed0-08e2-4700-91c5-fe2760e724b2") {
  if (!/^[a-f0-9-]{36}$/.test(actor)) throw new Error("INVALID_SYNTHETIC_ACTOR");
  return `BEGIN;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.workspaces WHERE id='${workspace}' OR slug='f3-accounts-synthetic-30')
  THEN RAISE EXCEPTION 'FIXTURE_EXISTS_RECONCILE_FIRST'; END IF; END $$;
INSERT INTO public.workspaces(id,name,slug) VALUES('${workspace}','QA F3 · altas ficticias','f3-accounts-synthetic-30');
INSERT INTO public.memberships(workspace_id,user_id,role) VALUES('${workspace}','${actor}','admin');
COMMIT;`;
}
export function probeSql(actor) {
  const syntheticActor = actor ?? "f2913ed0-08e2-4700-91c5-fe2760e724b2";
  return setupSql(syntheticActor).replace("COMMIT;", () => `
SET LOCAL ROLE service_role;
DO $$ DECLARE result jsonb; stamp timestamptz; BEGIN
  PERFORM public.register_whatsapp_account('${workspace}','${syntheticActor}','${connectionA}',
    'ycloud','+15555550300','Ventas','enc:v1:YWJj:ZGVm',1);
  PERFORM public.register_whatsapp_account('${workspace}','${syntheticActor}','${connectionB}',
    'ycloud','+15555550301','Soporte','enc:v1:YWJj:YWJj',1);
  result:=public.read_whatsapp_accounts('${workspace}','${syntheticActor}');
  IF jsonb_array_length(result)<>2 OR result::text LIKE '%enc:v1:%' THEN RAISE EXCEPTION 'SUMMARY_INVALID'; END IF;
  SELECT updated_at INTO stamp FROM public.channel_connections WHERE id='${connectionA}';
  PERFORM public.revoke_whatsapp_account('${workspace}','${syntheticActor}','${connectionA}',stamp);
  IF (SELECT status FROM public.channel_connections WHERE id='${connectionA}')<>'revoked'
    OR (SELECT status FROM public.channel_connections WHERE id='${connectionB}')<>'needs_permissions'
    OR EXISTS(SELECT 1 FROM public.integrations WHERE workspace_id='${workspace}')
    OR EXISTS(SELECT 1 FROM public.message_jobs WHERE workspace_id='${workspace}') THEN RAISE EXCEPTION 'ISOLATION_FAILED'; END IF;
  BEGIN
    PERFORM public.register_whatsapp_account('${workspace}','${syntheticActor}','${connectionA}',
      'ycloud','+15555550300','Ventas','enc:v1:YWJj:ZGVm',1);
    RAISE EXCEPTION 'REPLAY_REACTIVATED';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN PERFORM public.read_whatsapp_accounts('${workspace}','${syntheticActor}');
    RAISE EXCEPTION 'BROWSER_RPC_ALLOWED'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
SELECT NOT EXISTS(SELECT 1 FROM public.workspaces WHERE id='${workspace}') AS fixture_removed;`);
}
export const cleanupSql = `BEGIN;
DELETE FROM public.workspaces WHERE id='${workspace}' AND slug='f3-accounts-synthetic-30';
COMMIT;
SELECT NOT EXISTS(SELECT 1 FROM public.workspaces WHERE id='${workspace}') AS fixture_removed,
  NOT EXISTS(SELECT 1 FROM private.channel_credentials WHERE workspace_id='${workspace}') AS private_credentials_removed;`;
