/** Synthetic evidence only. No provider/model calls or real credentials. Caller owns fixture workspace. */
export function permissionEvidenceSql(id) {
  const callback = `https://permissions.example.org/api/webhooks/ycloud?wsid=${id(1)}`;
  return `
UPDATE public.integrations SET config='{"phone_number":"+15555550700"}' WHERE workspace_id='${id(1)}' AND id='${id(11)}';
INSERT INTO public.channel_connections(id,workspace_id,channel,provider,external_account_id,status,legacy_integration_id,capabilities,display_name)
VALUES('${id(51)}','${id(1)}','whatsapp','ycloud','+15555550700','needs_permissions','${id(11)}','{"version":1,"grants":[]}','Cuenta ficticia · sin conexión real');
SELECT private.backfill_whatsapp_workspace('${id(1)}','${id(51)}',100);
INSERT INTO public.message_jobs(operation_id,workspace_id,connection_id,conversation_id,idempotency_key,actor,request,
 expected_state_revision,state,fence,result_external_id,result_wamid,result_provider_message_id)
VALUES('${id(61)}','${id(1)}','${id(51)}','${id(31)}','permission-proof','human',jsonb_build_object(
 'operationId','${id(61)}','channel','whatsapp','action','text','recipient','+15555550101','body','Ficticio. No enviar.'),0,'accepted',1,
 'wamid.permission-fixture','wamid.permission-fixture','provider.permission-fixture');
INSERT INTO public.message_outbox(workspace_id,operation_id,fence,state,policy_evidence_id,policy_valid_until,result_external_id)
VALUES('${id(1)}','${id(61)}',1,'accepted','synthetic',now()+interval '1 hour','wamid.permission-fixture');
INSERT INTO public.messages(id,workspace_id,conversation_id,connection_id,provider,direction,type,body,status,wamid,channel_operation_id)
VALUES('${id(44)}','${id(1)}','${id(31)}','${id(51)}','ycloud','out','text','Prueba ficticia, sin llamada al proveedor.','delivered',
 'wamid.permission-fixture','${id(61)}');
INSERT INTO private.channel_delivery_receipts(id,workspace_id,connection_id,provider_event_id,provider,external_account_id,status,
 wamid,provider_message_id,occurred_at,state,operation_id)
VALUES('${id(91)}','${id(1)}','${id(51)}','permission-fixture','ycloud','+15555550700','delivered',
 'wamid.permission-fixture','provider.permission-fixture',now()-interval '1 minute','planned','${id(61)}');
SELECT public.save_ycloud_verification('${id(1)}','${id(101)}',private.ycloud_verification_source(i),
 jsonb_build_object('endpointId','synthetic-endpoint','callbackUrl','${callback}'),
 jsonb_build_object('version',1,'checkedAt',clock_timestamp()-interval '1 second','checks',
 '{"api_access":true,"connected_number":true,"webhook_active":true,"webhook_url":true,"webhook_events":true,"webhook_secret":true}'::jsonb,
 'destination','https_unconfirmed','providerRead','complete','sendAuthorization',false))
FROM public.integrations i WHERE workspace_id='${id(1)}' AND id='${id(11)}';
`;
}
