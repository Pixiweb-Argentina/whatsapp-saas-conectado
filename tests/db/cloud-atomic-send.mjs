// SQL-only probes on the explicitly selected new Cloud project. No transport calls.
// Each cron unschedules itself; always run cleanup after observing completion.
const id = (n) => `00000000-0000-4000-8000-${String(990000 + n).padStart(12, "0")}`;
const ws = id(1), conn = id(51), conv = id(31), contact = id(21), identity = id(81);
const integration = id(11), event = id(91), op = id(61), worker = id(71);
const grant = `jsonb_build_object('version',1,'grants',jsonb_build_array(jsonb_build_object(
  'workspaceId','${ws}','connectionId','${conn}','capability','text','evidenceRef','synthetic-verification',
  'verifiedAt',now()-interval '1 minute','validUntil',now()+interval '1 hour')))`;

export const setup = `BEGIN;
INSERT INTO public.workspaces(id,name,slug) VALUES('${ws}','Prueba transaccional F3','f3-atomic-synthetic-probe');
INSERT INTO public.contacts(id,workspace_id,phone,name,opt_in) VALUES('${contact}','${ws}','+15555559901','Contacto ficticio F3',true);
INSERT INTO public.integrations(id,workspace_id,provider,enabled,config)
VALUES('${integration}','${ws}','ycloud',true,'{"phone_number":"+15555559900"}');
INSERT INTO public.channel_connections(id,workspace_id,channel,provider,external_account_id,status,legacy_integration_id,capabilities)
VALUES('${conn}','${ws}','whatsapp','ycloud','+15555559900','ready','${integration}',${grant});
INSERT INTO public.contact_identities(id,workspace_id,contact_id,connection_id,external_user_id,verified_at)
VALUES('${identity}','${ws}','${contact}','${conn}','+15555559901',now()-interval '1 minute');
INSERT INTO public.conversations(id,workspace_id,contact_id,channel,connection_id,identity_id,window_expires_at)
VALUES('${conv}','${ws}','${contact}','whatsapp','${conn}','${identity}',now()+interval '1 hour');
INSERT INTO public.inbound_events(id,workspace_id,connection_id,provider_event_id,kind,envelope)
VALUES('${event}','${ws}','${conn}','synthetic-inbound','message',jsonb_build_object('schemaVersion',1,
 'workspaceId','${ws}','connectionId','${conn}','channel','whatsapp','provider','ycloud',
 'providerEventId','synthetic-inbound','kind','message','externalActorId','+15555559901','externalMessageId','synthetic-inbound',
 'occurredAt',now()-interval '1 minute','receivedAt',now()-interval '1 minute',
 'content',jsonb_build_object('type','text','text','prueba','rawType','text'),'mediaRefs','[]'::jsonb,
 'sourceContext',jsonb_build_object('channel','whatsapp','sourceType','direct_message')));
SELECT public.enqueue_channel_job('${ws}','${conn}','${conv}','${event}','atomic-probe','automation',0,
 jsonb_build_object('operationId','${op}','channel','whatsapp','recipient','+15555559901','action','text',
 'body','Prueba F3: resultado sin confirmar. No se llamó a ningún proveedor.'));
SELECT public.claim_channel_job('${ws}','${worker}');
COMMIT;`;

const permit = `public.begin_channel_send('${ws}','${op}','${worker}',1,'${event}',now()+interval '1 minute')`;
export const competingSend = `SELECT pg_backend_pid() AS pid, statement_timestamp() AS started_at,
 ${permit} AS permitted,clock_timestamp() AS completed_at;`;
export const observe = `SELECT pid,application_name,wait_event,clock_timestamp() AS observed_at
 FROM pg_stat_activity WHERE application_name='f3_atomic_holder' AND wait_event='PgSleep';`;

const changes = {
  revoke: `UPDATE public.channel_connections SET status='revoked',revoked_at=now() WHERE id='${conn}';`,
  grant: `UPDATE public.channel_connections SET capabilities='{}' WHERE id='${conn}';`,
  identity: `UPDATE public.contact_identities SET verified_at=null WHERE id='${identity}';`,
  suppression: `INSERT INTO public.contact_opt_outs(workspace_id,phone_key,opted_out_at,source)
    VALUES('${ws}','15555559901',now(),'keyword');`,
};
export function schedule(change) {
  if (!Object.hasOwn(changes, change)) throw new Error("Unknown probe");
  return `SELECT cron.schedule('f3-atomic-${change}-once','1 second',$probe$
DO $body$ BEGIN
 PERFORM cron.unschedule('f3-atomic-${change}-once');
 PERFORM set_config('application_name','f3_atomic_holder',true);
 ${changes[change]}
 PERFORM pg_sleep(12);
END $body$;
$probe$);`;
}
export const reset = `BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('channel-suppression:${ws}:15555559901',0));
UPDATE public.channel_connections SET status='ready',revoked_at=null,capabilities=${grant} WHERE id='${conn}';
UPDATE public.contact_identities SET verified_at=now()-interval '1 minute' WHERE id='${identity}';
DELETE FROM public.contact_opt_outs WHERE workspace_id='${ws}';
UPDATE public.message_jobs SET lease_until=clock_timestamp()+interval '90 seconds' WHERE operation_id='${op}' AND state='leased';
COMMIT;`;

export const finishUnknown = `BEGIN;
DO $check$ BEGIN IF NOT ${permit} THEN RAISE EXCEPTION 'EXPECTED_PERMIT'; END IF;
IF NOT public.finish_channel_send('${ws}','${op}','${worker}',1,
  jsonb_build_object('status','unknown','operationId','${op}')) THEN RAISE EXCEPTION 'EXPECTED_FINISH'; END IF;
END $check$;
UPDATE public.channel_connections SET status='connecting' WHERE id='${conn}';
INSERT INTO public.memberships(workspace_id,user_id,role)
SELECT '${ws}',id,'admin' FROM public.users
WHERE id='f2913ed0-08e2-4700-91c5-fe2760e724b2' AND email='qa-f3-admin@omnichannel.invalid';
COMMIT;
SELECT j.state,m.status,m.meta,m.body,m.id AS message_id,m.conversation_id
FROM public.message_jobs j JOIN public.messages m ON m.channel_operation_id=j.operation_id
WHERE j.operation_id='${op}';`;

export const cleanup = `BEGIN;
DO $guard$ BEGIN IF NOT EXISTS (SELECT 1 FROM public.workspaces WHERE id='${ws}' AND slug='f3-atomic-synthetic-probe')
THEN RAISE EXCEPTION 'FIXTURE_SCOPE_MISMATCH'; END IF; END $guard$;
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname IN
 ('f3-atomic-revoke-once','f3-atomic-grant-once','f3-atomic-identity-once','f3-atomic-suppression-once');
DELETE FROM public.messages WHERE workspace_id='${ws}';
DELETE FROM public.message_outbox WHERE workspace_id='${ws}';
DELETE FROM public.message_jobs WHERE workspace_id='${ws}';
DELETE FROM public.inbound_events WHERE workspace_id='${ws}';
DELETE FROM public.conversations WHERE workspace_id='${ws}';
DELETE FROM public.contact_identities WHERE workspace_id='${ws}';
DELETE FROM public.channel_connections WHERE workspace_id='${ws}';
DELETE FROM public.integrations WHERE workspace_id='${ws}';
DELETE FROM public.contacts WHERE workspace_id='${ws}';
DELETE FROM public.workspaces WHERE id='${ws}' AND slug='f3-atomic-synthetic-probe';
COMMIT;
SELECT (SELECT count(*) FROM public.workspaces) AS workspaces,
 (SELECT count(*) FROM public.message_outbox) AS outbox,
 (SELECT count(*) FROM public.messages) AS messages,
 (SELECT count(*) FROM cron.job WHERE active) AS active_cron;`;
