// Controlled probes for the new Supabase project. Run setup once, each holder
// with its competitor on separate connections, then cleanup. No HTTP sends.
// MCP serialized simultaneous tool calls. The verified Cloud run used the
// self-unscheduling cron holders below and compared backend PIDs/timestamps.
const ws = "00000000-0000-4000-8000-000000009001";
const conn = "00000000-0000-4000-8000-000000009051";
const conv = "00000000-0000-4000-8000-000000009031";
const contact = "00000000-0000-4000-8000-000000009021";
const identity = "00000000-0000-4000-8000-000000009081";
const op = "00000000-0000-4000-8000-000000009061";
const worker = "00000000-0000-4000-8000-000000009071";
const other = "00000000-0000-4000-8000-000000009072";

export const setup = `BEGIN;
INSERT INTO public.workspaces(id,name,slug) VALUES ('${ws}','F3 synthetic concurrency probe','f3-synthetic-concurrency-probe');
INSERT INTO public.contacts(id,workspace_id,phone,name,opt_in) VALUES ('${contact}','${ws}','+15555550901','Synthetic queue probe',true);
INSERT INTO public.channel_connections(id,workspace_id,channel,provider,external_account_id,status)
VALUES ('${conn}','${ws}','whatsapp','ycloud','+15555550900','ready');
INSERT INTO public.contact_identities(id,workspace_id,contact_id,connection_id,external_user_id)
VALUES ('${identity}','${ws}','${contact}','${conn}','+15555550901');
INSERT INTO public.conversations(id,workspace_id,contact_id,channel,connection_id,identity_id,window_expires_at)
VALUES ('${conv}','${ws}','${contact}','whatsapp','${conn}','${identity}',now()+interval '1 hour');
SELECT public.enqueue_channel_job('${ws}','${conn}','${conv}',null,'concurrency-fixture','ai',0,
  jsonb_build_object('operationId','${op}','channel','whatsapp','recipient','+15555550901','action','text','body','Synthetic SQL probe; never sent'));
COMMIT;`;

export const claimHolder = `BEGIN;
SET LOCAL application_name = 'f3_queue_claim_holder';
SELECT * FROM public.claim_channel_job('${ws}','${worker}');
SELECT pg_sleep(10);
COMMIT;
SELECT pg_backend_pid() AS pid, clock_timestamp() AS completed_at,
  (SELECT lease_owner FROM public.message_jobs WHERE operation_id='${op}') AS winner;`;

export const observeClaim = "SELECT pid,wait_event,clock_timestamp() AS observed_at FROM pg_stat_activity WHERE application_name='f3_queue_claim_holder' AND wait_event='PgSleep'";

export const competingClaim = `SELECT pg_backend_pid() AS pid, statement_timestamp() AS started_at,
  (SELECT count(*) FROM public.claim_channel_job('${ws}','${other}')) AS claimed,
  clock_timestamp() AS completed_at;`;

export const takeoverHolder = `BEGIN;
SET LOCAL application_name = 'f3_queue_takeover_holder';
UPDATE public.conversations SET state='human_active',ai_enabled=false WHERE workspace_id='${ws}' AND id='${conv}';
SELECT pg_sleep(6);
COMMIT;
SELECT pg_backend_pid() AS pid, clock_timestamp() AS completed_at,
  (SELECT state FROM public.message_jobs WHERE operation_id='${op}') AS job_state;`;

export const observeTakeover = "SELECT pid,wait_event,clock_timestamp() AS observed_at FROM pg_stat_activity WHERE application_name='f3_queue_takeover_holder' AND wait_event='PgSleep'";

export const competingSend = `SELECT pg_backend_pid() AS pid, statement_timestamp() AS started_at,
  public.begin_channel_send('${ws}','${op}','${worker}',
    (SELECT fence FROM public.message_jobs WHERE operation_id='${op}'),'synthetic-policy',now()+interval '1 hour') AS permitted,
  clock_timestamp() AS completed_at;`;

export const scheduleClaimOnce = `SELECT cron.schedule('f3-queue-claim-once','1 second',$probe$
DO $body$ BEGIN
  PERFORM cron.unschedule('f3-queue-claim-once');
  PERFORM public.claim_channel_job('${ws}','${worker}');
  PERFORM pg_sleep(15);
END $body$;
$probe$);`;

export const scheduleTakeoverOnce = `SELECT cron.schedule('f3-queue-takeover-once','1 second',$probe$
DO $body$ BEGIN
  PERFORM cron.unschedule('f3-queue-takeover-once');
  UPDATE public.conversations SET state='human_active',ai_enabled=false WHERE workspace_id='${ws}' AND id='${conv}';
  PERFORM pg_sleep(15);
END $body$;
$probe$);`;

export const cleanup = `BEGIN;
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('f3-queue-claim-once','f3-queue-takeover-once');
DO $guard$ BEGIN IF NOT EXISTS (SELECT 1 FROM public.workspaces WHERE id='${ws}' AND slug='f3-synthetic-concurrency-probe')
  THEN RAISE EXCEPTION 'FIXTURE_SCOPE_MISMATCH'; END IF; END $guard$;
DELETE FROM public.message_outbox WHERE workspace_id='${ws}';
DELETE FROM public.message_jobs WHERE workspace_id='${ws}';
DELETE FROM public.inbound_events WHERE workspace_id='${ws}';
DELETE FROM public.conversations WHERE workspace_id='${ws}';
DELETE FROM public.contact_identities WHERE workspace_id='${ws}';
DELETE FROM public.channel_connections WHERE workspace_id='${ws}';
DELETE FROM public.contacts WHERE workspace_id='${ws}';
DELETE FROM public.workspaces WHERE id='${ws}' AND slug='f3-synthetic-concurrency-probe';
COMMIT;
SELECT (SELECT count(*) FROM public.workspaces) AS workspaces,
  (SELECT count(*) FROM auth.users) AS auth_users,
  (SELECT count(*) FROM public.message_jobs) AS message_jobs;`;
