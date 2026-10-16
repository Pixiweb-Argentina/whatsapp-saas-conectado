import { accountProofFixtureSql } from "./whatsapp-account-proof-fixture.mjs";
import { kapsoProofFixtureSql } from "./kapso-account-proof-fixture.mjs";
export function managedSendFixtureSql(id, provider = "ycloud") {
  const callback = `https://permissions.example.org/api/webhooks/whatsapp-accounts/${id(1)}/${id(51)}`;
  return `${provider === "kapso" ? kapsoProofFixtureSql(id) : accountProofFixtureSql(id)}
UPDATE public.conversations SET source_context='{"channel":"whatsapp","sourceType":"direct_message"}' WHERE id='${id(31)}';
INSERT INTO public.inbound_events(id,workspace_id,connection_id,provider_event_id,kind,envelope)
VALUES('${id(92)}','${id(1)}','${id(51)}','managed-inbound','message',jsonb_build_object('schemaVersion',1,
 'workspaceId','${id(1)}','connectionId','${id(51)}','channel','whatsapp','provider','${provider}',
 'providerEventId','managed-inbound','kind','message','externalActorId','+15555550101','externalMessageId','managed-inbound',
 'occurredAt',clock_timestamp()-interval '1 minute','receivedAt',clock_timestamp()-interval '1 minute',
 'content',jsonb_build_object('type','text','text','Ficticio entrada','rawType','text'),'mediaRefs','[]'::jsonb,
 'sourceContext',jsonb_build_object('channel','whatsapp','sourceType','direct_message')));
SELECT public.save_whatsapp_account_verification('${id(1)}','${id(101)}','${id(51)}',
 public.read_whatsapp_account_source('${id(1)}','${id(51)}')->>'sourceRevision',
 jsonb_build_object('endpointId','${id(901)}','callbackUrl','${callback}'),
 jsonb_build_object('version',1,'checkedAt',clock_timestamp()-interval '1 second','checks',
 '{"api_access":true,"connected_number":true,"webhook_active":true,"webhook_url":true,"webhook_events":true,"webhook_secret":true}'::jsonb,
 'destination','https_unconfirmed','providerRead','complete','sendAuthorization',false));
SELECT public.change_whatsapp_account_text_permission('${id(1)}','${id(101)}','${id(51)}','${id(701)}','grant',
 c.updated_at,v.checked_at,'${callback}') FROM public.channel_connections c JOIN private.whatsapp_account_verifications v ON v.connection_id=c.id WHERE c.id='${id(51)}';`;
}
