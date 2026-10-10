import {setup as atomicSetup} from "./cloud-atomic-send.mjs";
import {cleanup as baseCleanup} from "./cloud-human-enqueue.mjs";
const id=(n)=>`00000000-0000-4000-8000-${String(995000+n).padStart(12,"0")}`;
export const workspace=id(1),connection=id(51),operation=id(61),integration=id(11);
export const kapsoConnection=id(52),kapsoOperation=id(62),kapsoIntegration=id(12);
export const setup=atomicSetup.replaceAll("000000990","000000995")
  .replaceAll("f3-atomic-synthetic-probe","f3-receipt-synthetic-probe")
  .replace("COMMIT;",`DO $check$ BEGIN
    IF NOT public.begin_channel_send('${workspace}','${operation}','${id(71)}',1,'${id(91)}',now()+interval '1 minute')
      THEN RAISE EXCEPTION 'PERMIT_EXPECTED'; END IF;
    IF NOT public.finish_channel_send('${workspace}','${operation}','${id(71)}',1,
      jsonb_build_object('status','unknown','operationId','${operation}')) THEN RAISE EXCEPTION 'FINISH_EXPECTED'; END IF;
  END $check$;
  INSERT INTO public.integrations(id,workspace_id,provider,enabled,config)
    VALUES('${kapsoIntegration}','${workspace}','kapso',false,'{"phone_number_id":"synthetic-receipt-account"}');
  INSERT INTO public.channel_connections(id,workspace_id,channel,provider,external_account_id,status,legacy_integration_id,capabilities)
    SELECT '${kapsoConnection}',workspace_id,channel,'kapso','synthetic-receipt-account','ready','${kapsoIntegration}',
      jsonb_build_object('version',1,'grants',jsonb_build_array(jsonb_build_object('workspaceId',workspace_id,
        'connectionId','${kapsoConnection}','capability','text','evidenceRef','synthetic-receipt',
        'verifiedAt',now()-interval '1 minute','validUntil',now()+interval '1 hour')))
    FROM public.channel_connections WHERE id='${connection}';
  INSERT INTO public.contacts(id,workspace_id,phone,name,opt_in) VALUES('${id(22)}','${workspace}','+15555559902','Contacto ficticio receipt',true);
  INSERT INTO public.contact_identities(id,workspace_id,contact_id,connection_id,external_user_id,verified_at)
    VALUES('${id(82)}','${workspace}','${id(22)}','${kapsoConnection}','+15555559902',now()-interval '1 minute');
  INSERT INTO public.conversations(id,workspace_id,contact_id,channel,connection_id,identity_id,window_expires_at)
    VALUES('${id(32)}','${workspace}','${id(22)}','whatsapp','${kapsoConnection}','${id(82)}',now()+interval '1 hour');
  INSERT INTO public.inbound_events(id,workspace_id,connection_id,provider_event_id,kind,envelope)
    SELECT '${id(92)}',workspace_id,'${kapsoConnection}','synthetic-kapso-inbound',kind,
      envelope || jsonb_build_object('connectionId','${kapsoConnection}','provider','kapso',
        'providerEventId','synthetic-kapso-inbound','externalActorId','+15555559902','externalMessageId','synthetic-kapso-inbound')
    FROM public.inbound_events WHERE id='${id(91)}';
  SELECT public.enqueue_channel_job('${workspace}','${kapsoConnection}','${id(32)}','${id(92)}','receipt-kapso','automation',0,
    jsonb_build_object('operationId','${kapsoOperation}','channel','whatsapp','recipient','+15555559902','action','text','body','Ficticio: no enviar'));
  UPDATE public.integrations SET enabled=false WHERE id='${integration}';
  UPDATE public.integrations SET enabled=true WHERE id='${kapsoIntegration}';
  SELECT public.claim_channel_job('${workspace}','${id(72)}');
  DO $check$ BEGIN
    IF NOT public.begin_channel_send('${workspace}','${kapsoOperation}','${id(72)}',1,'${id(92)}',now()+interval '1 minute')
      THEN RAISE EXCEPTION 'PERMIT_EXPECTED'; END IF;
    IF NOT public.finish_channel_send('${workspace}','${kapsoOperation}','${id(72)}',1,
      jsonb_build_object('status','accepted','externalId','wamid.synthetic-kapso','wamid','wamid.synthetic-kapso'))
      THEN RAISE EXCEPTION 'FINISH_EXPECTED'; END IF;
  END $check$;
  UPDATE public.integrations SET enabled=false WHERE id='${kapsoIntegration}';
  UPDATE public.integrations SET enabled=true WHERE id='${integration}';
  COMMIT;`);
export const cleanup=baseCleanup.replaceAll("000000992","000000995").replaceAll("f3-human-synthetic-probe","f3-receipt-synthetic-probe");
