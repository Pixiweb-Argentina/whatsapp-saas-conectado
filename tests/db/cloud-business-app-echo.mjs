import {setup as atomicSetup} from "./cloud-atomic-send.mjs";
import {cleanup as baseCleanup} from "./cloud-human-enqueue.mjs";
const id=(n)=>`00000000-0000-4000-8000-${String(996000+n).padStart(12,"0")}`;
export const workspace=id(1),conversation=id(31),integration=id(11),operation=id(61);
export const setup=atomicSetup.replaceAll("000000990","000000996")
  .replaceAll("f3-atomic-synthetic-probe","f3-business-echo-synthetic-probe")
  .replaceAll("Prueba transaccional F3","Prueba WhatsApp Business F3")
  .replaceAll("'ycloud'","'kapso'").replaceAll('"phone_number"','"phone_number_id"')
  .replaceAll("+15555559900","synthetic-echo-account")
  .replace("COMMIT;",`UPDATE public.contacts SET opt_in=false WHERE workspace_id='${workspace}';
    INSERT INTO public.memberships(workspace_id,user_id,role)
      SELECT '${workspace}',id,'admin' FROM public.users
      WHERE id='f2913ed0-08e2-4700-91c5-fe2760e724b2' AND email='qa-f3-admin@omnichannel.invalid'; COMMIT;`);
export const cleanup=baseCleanup.replaceAll("000000992","000000996")
  .replaceAll("f3-human-synthetic-probe","f3-business-echo-synthetic-probe");
export const resume=`UPDATE public.conversations SET state='ai_active',ai_enabled=true WHERE workspace_id='${workspace}' AND id='${conversation}';`;
