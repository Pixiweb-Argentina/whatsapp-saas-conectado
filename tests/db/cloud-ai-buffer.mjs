import {setup as base,cleanup as baseCleanup} from "./cloud-ai-reply.mjs";
const id=(n)=>`00000000-0000-4000-8000-${String(994000+n).padStart(12,"0")}`;
export const workspace=id(1),conversation=id(31),batch=id(92),worker=id(71),event=id(91);
export const setup=base.replaceAll("000000993","000000994").replaceAll("f3-ai-synthetic-probe","f3-ai-buffer-synthetic-probe")
  .replace("COMMIT;",`SELECT public.prepare_ai_channel_reply('${workspace}','${batch}','queue');
SELECT public.checkpoint_ai_channel_reply('${workspace}','${batch}','Respuesta IA ficticia: no enviar');
SELECT public.enqueue_ai_channel_reply('${workspace}','${batch}','Respuesta IA ficticia: no enviar');
UPDATE public.message_batches SET status='buffering',flush_at=now()-interval '1 minute' WHERE id='${batch}';
COMMIT;`);
export const settle=`BEGIN;
SET LOCAL ROLE service_role;
SELECT public.claim_channel_job('${workspace}','${worker}');
DO $probe$ BEGIN
IF NOT public.begin_channel_send('${workspace}','${batch}','${worker}',1,'${event}',now()+interval '1 minute') THEN
  RAISE EXCEPTION 'PERMIT_EXPECTED'; END IF;
IF NOT public.finish_channel_send('${workspace}','${batch}','${worker}',1,
  jsonb_build_object('status','unknown','operationId','${batch}')) THEN RAISE EXCEPTION 'FINISH_EXPECTED'; END IF;
END $probe$;
COMMIT;
SELECT public.handoff_ai_channel_reply('${workspace}','${batch}','tool') AS handoff;`;
export const cleanup=baseCleanup.replaceAll("000000993","000000994").replaceAll("f3-ai-synthetic-probe","f3-ai-buffer-synthetic-probe");
