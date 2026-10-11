import {setup as baseSetup} from "./cloud-atomic-send.mjs";
import {cleanup as baseCleanup} from "./cloud-human-enqueue.mjs";
const id=(n)=>`00000000-0000-4000-8000-${String(997000+n).padStart(12,"0")}`;
export const workspace=id(1),conversation=id(31),connection=id(51),operation=id(61),worker=id(71),event=id(91);
export const setup=baseSetup.replaceAll("000000990","000000997")
  .replaceAll("f3-atomic-synthetic-probe","f3-limits-synthetic-probe")
  .replaceAll("Prueba transaccional F3","Prueba límites F3")
  .replace("COMMIT;",`INSERT INTO public.memberships(workspace_id,user_id,role)
    VALUES('${workspace}','f2913ed0-08e2-4700-91c5-fe2760e724b2','admin'); COMMIT;`);
export const cleanup=baseCleanup.replaceAll("000000992","000000997")
  .replaceAll("f3-human-synthetic-probe","f3-limits-synthetic-probe");
export const permit=`SELECT public.begin_channel_send_status('${workspace}','${operation}','${worker}',1,'${event}',now()+interval '1 minute') status;`;
export const rejection=`SELECT public.finish_channel_send('${workspace}','${operation}','${worker}',1,
  '{"status":"rejected","errorCode":"130429","retryable":true,"retryAfterSeconds":120}'::jsonb) finished;`;
export const observations=`SELECT (SELECT state FROM public.message_jobs WHERE operation_id='${operation}') state,
  (SELECT attempts FROM public.message_jobs WHERE operation_id='${operation}') attempts,
  (SELECT run_after>clock_timestamp()+interval '115 seconds' FROM public.message_jobs WHERE operation_id='${operation}') respects_hint,
  (SELECT count(*)::int FROM public.message_outbox WHERE workspace_id='${workspace}') outbox,
  (SELECT count(*)::int FROM public.messages WHERE channel_operation_id='${operation}') messages,
  (SELECT meta->>'send_outcome' FROM public.messages WHERE channel_operation_id='${operation}') outcome;`;
export const quotaProbe=`BEGIN;
UPDATE private.channel_send_budgets SET limit_per_minute=1 WHERE scope_id='${workspace}';
UPDATE public.message_jobs SET run_after=clock_timestamp() WHERE operation_id='${operation}';
SELECT public.claim_channel_job('${workspace}','${worker}');
SELECT public.begin_channel_send_status('${workspace}','${operation}','${worker}',2,'${event}',now()+interval '1 minute') status;
SELECT state,attempts,last_error_code FROM public.message_jobs WHERE operation_id='${operation}';
ROLLBACK;`;
export const retryPermit=`BEGIN;
UPDATE public.message_jobs SET run_after=clock_timestamp() WHERE operation_id='${operation}';
UPDATE private.channel_send_budgets SET blocked_until='epoch',window_started_at=clock_timestamp()-interval '2 minutes'
  WHERE workspace_id='${workspace}';
SELECT public.claim_channel_job('${workspace}','${worker}');
SELECT public.begin_channel_send_status('${workspace}','${operation}','${worker}',2,'${event}',now()+interval '1 minute') status;
COMMIT;`;
export const acceptance=`SELECT public.finish_channel_send('${workspace}','${operation}','${worker}',2,
  '{"status":"accepted","externalId":"wamid.synthetic-limits","wamid":"wamid.synthetic-limits"}'::jsonb) finished;
SELECT (SELECT state FROM public.message_jobs WHERE operation_id='${operation}') state,
  (SELECT count(*)::int FROM public.message_outbox WHERE workspace_id='${workspace}') outbox,
  (SELECT count(*)::int FROM public.messages WHERE channel_operation_id='${operation}') messages;`;

export const concurrentSetup=`BEGIN;
UPDATE private.channel_send_budgets SET used=0,blocked_until='epoch',window_started_at=clock_timestamp(),limit_per_minute=1
  WHERE workspace_id='${workspace}';
SELECT public.enqueue_channel_job('${workspace}','${connection}','${conversation}','${event}','quota-race-1','automation',0,
  jsonb_build_object('operationId','${id(63)}','channel','whatsapp','recipient','+15555559901','action','text','body','Cupo ficticio A: no enviar'));
SELECT public.enqueue_channel_job('${workspace}','${connection}','${conversation}','${event}','quota-race-2','automation',0,
  jsonb_build_object('operationId','${id(64)}','channel','whatsapp','recipient','+15555559901','action','text','body','Cupo ficticio B: no enviar'));
COMMIT;`;
