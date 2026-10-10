// SQL probes for the temporary human fixture. Never invokes a provider.
import { setup as humanSetup, cleanup, workspace, conversation, operation } from "./cloud-human-enqueue.mjs";
export { cleanup };
const user="f2913ed0-08e2-4700-91c5-fe2760e724b2";
const worker="00000000-0000-4000-8000-000000992071";
const event="00000000-0000-4000-8000-000000992091";
export const setup=humanSetup.replace("COMMIT;",`SELECT public.enqueue_human_channel_text(
  '${workspace}','${conversation}','${user}','${operation}','Prueba persistente de cola: no enviar'); COMMIT;`);
export const transitionUnknown=`BEGIN; SET LOCAL ROLE service_role;
SELECT * FROM public.claim_channel_job('${workspace}','${worker}');
DO $$ BEGIN
IF NOT public.begin_channel_send('${workspace}','${operation}','${worker}',1,'${event}',now()+interval '1 minute')
  THEN RAISE EXCEPTION 'PERMIT_FAILED'; END IF;
IF NOT public.finish_channel_send('${workspace}','${operation}','${worker}',1,
  jsonb_build_object('status','unknown','operationId','${operation}')) THEN RAISE EXCEPTION 'FINISH_FAILED'; END IF;
END $$; COMMIT;`;
export const addPending=`SELECT public.enqueue_human_channel_text('${workspace}','${conversation}','${user}',
  '00000000-0000-4000-8000-000000992093','Otro pendiente sintético: persiste al recargar');`;
