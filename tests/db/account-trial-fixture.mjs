import { managedSendFixtureSql } from "./managed-send-fixture.mjs";
/** Fictitious proof only. Remove ALL delivery seeds and grants before exercising first-delivery bootstrap. */
export function accountTrialFixtureSql(id, provider = "ycloud") {
  return `${managedSendFixtureSql(id, provider)}
DELETE FROM private.channel_delivery_receipts WHERE workspace_id='${id(1)}';
DELETE FROM public.message_outbox WHERE workspace_id='${id(1)}';
DELETE FROM public.messages WHERE workspace_id='${id(1)}' AND direction='out';
DELETE FROM public.message_jobs WHERE workspace_id='${id(1)}';
DELETE FROM private.whatsapp_account_permission_changes WHERE workspace_id='${id(1)}';
UPDATE public.channel_connections SET status='needs_permissions',capabilities='{}' WHERE id='${id(51)}';
UPDATE public.contacts SET opt_in=false WHERE id='${id(21)}';
INSERT INTO public.messages(id,workspace_id,conversation_id,connection_id,provider,direction,type,body,wamid,external_message_id,meta)
VALUES('${id(93)}','${id(1)}','${id(31)}','${id(51)}','${provider}','in','text','Entrada ficticia de prueba','trial.inbound','trial.inbound',
  jsonb_build_object('inbound_event_id','${id(92)}','managed_account',true,'receive_only',true));`;
}
