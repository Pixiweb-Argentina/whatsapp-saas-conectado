// Reuse the synthetic atomic fixture, in a separate temporary workspace.
import { setup as atomicSetup } from "./cloud-atomic-send.mjs";
const id = (n) => `00000000-0000-4000-8000-${String(992000+n).padStart(12,"0")}`;
export const workspace = id(1), conversation = id(31), operation = id(92);
export const setup = atomicSetup.replaceAll("000000990", "000000992")
  .replaceAll("f3-atomic-synthetic-probe", "f3-human-synthetic-probe")
  .replaceAll("Prueba transaccional F3", "Prueba envío humano F3")
  .replace("COMMIT;", `INSERT INTO public.memberships(workspace_id,user_id,role)
    VALUES('${workspace}','f2913ed0-08e2-4700-91c5-fe2760e724b2','admin'); COMMIT;`);
export const assertions = `BEGIN;
SET LOCAL ROLE service_role;
DO $probe$ DECLARE first_result jsonb; retry jsonb; BEGIN
first_result:=public.enqueue_human_channel_text('${workspace}','${conversation}',
  'f2913ed0-08e2-4700-91c5-fe2760e724b2','${operation}','Prueba Cloud: no enviar');
retry:=public.enqueue_human_channel_text('${workspace}','${conversation}',
  'f2913ed0-08e2-4700-91c5-fe2760e724b2','${operation}','Prueba Cloud: no enviar');
IF first_result->>'state'<>'pending' OR retry->>'duplicate'<>'true' THEN RAISE EXCEPTION 'BAD_ENQUEUE'; END IF;
IF NOT EXISTS (SELECT 1 FROM public.conversations WHERE id='${conversation}' AND state='human_active' AND NOT ai_enabled)
  THEN RAISE EXCEPTION 'NO_TAKEOVER'; END IF;
IF NOT EXISTS (SELECT 1 FROM public.message_jobs WHERE operation_id='${id(61)}' AND state='cancelled')
  THEN RAISE EXCEPTION 'AI_NOT_CANCELLED'; END IF;
IF (SELECT count(*) FROM public.events WHERE workspace_id='${workspace}' AND type='state_change')<>1
  THEN RAISE EXCEPTION 'AUDIT_NOT_ATOMIC'; END IF;
END $probe$;
ROLLBACK;
SELECT 'human enqueue/dedup/takeover/audit passed, rolled back' AS result;`;
export const cleanup = `BEGIN;
DO $guard$ BEGIN IF NOT EXISTS (SELECT 1 FROM public.workspaces WHERE id='${workspace}' AND slug='f3-human-synthetic-probe')
THEN RAISE EXCEPTION 'FIXTURE_SCOPE_MISMATCH'; END IF; END $guard$;
DELETE FROM public.events WHERE workspace_id='${workspace}';
DELETE FROM public.messages WHERE workspace_id='${workspace}';
DELETE FROM public.message_outbox WHERE workspace_id='${workspace}';
DELETE FROM public.message_jobs WHERE workspace_id='${workspace}';
DELETE FROM public.inbound_events WHERE workspace_id='${workspace}';
DELETE FROM public.conversations WHERE workspace_id='${workspace}';
DELETE FROM public.contact_identities WHERE workspace_id='${workspace}';
DELETE FROM public.channel_connections WHERE workspace_id='${workspace}';
DELETE FROM public.integrations WHERE workspace_id='${workspace}';
DELETE FROM public.contacts WHERE workspace_id='${workspace}';
DELETE FROM public.workspaces WHERE id='${workspace}' AND slug='f3-human-synthetic-probe';
COMMIT;
SELECT (SELECT count(*) FROM public.workspaces) AS workspaces,
 (SELECT count(*) FROM public.messages) AS messages,
 (SELECT count(*) FROM public.message_outbox) AS outbox,
 (SELECT count(*) FROM cron.job WHERE active) AS active_cron;`;
