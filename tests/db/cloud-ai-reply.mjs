import { setup as atomicSetup } from "./cloud-atomic-send.mjs";
import { cleanup as humanCleanup } from "./cloud-human-enqueue.mjs";
const id=(n)=>`00000000-0000-4000-8000-${String(993000+n).padStart(12,"0")}`;
export const workspace=id(1), conversation=id(31), batch=id(92), secondBatch=id(93);
const base=atomicSetup.slice(0,atomicSetup.indexOf("SELECT public.enqueue_channel_job"))
  .replaceAll("000000990","000000993").replaceAll("f3-atomic-synthetic-probe","f3-ai-synthetic-probe")
  .replaceAll("Prueba transaccional F3","Prueba contexto IA F3");
export const setup=base+`INSERT INTO public.message_batches(id,workspace_id,conversation_id,status)
 VALUES('${batch}','${workspace}','${conversation}','processing');
INSERT INTO public.messages(workspace_id,conversation_id,batch_id,direction,type,body,wamid)
 VALUES('${workspace}','${conversation}','${batch}','in','text','Entrada IA ficticia','synthetic-inbound');
COMMIT;`;
export const cleanup=humanCleanup.replaceAll("000000992","000000993")
  .replaceAll("f3-human-synthetic-probe","f3-ai-synthetic-probe")
  .replace("DELETE FROM public.inbound_events",`DELETE FROM public.message_batches WHERE workspace_id='${workspace}';
DELETE FROM public.inbound_events`);
