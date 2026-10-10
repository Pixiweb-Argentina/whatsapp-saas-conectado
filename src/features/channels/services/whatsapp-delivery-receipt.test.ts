import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeWhatsAppReceipt } from "./whatsapp-delivery-receipt.ts";
import type { AuthenticatedWhatsAppDelivery } from "./whatsapp-event-ingress";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const now=Date.parse("2026-10-10T12:01:00Z");
const ycloud={id:"evt.fixture",type:"whatsapp.message.updated",createTime:"2026-10-10T12:00:00Z",
  whatsappMessage:{from:"+15555550100",to:"+15555550101",id:"provider.fixture",wamid:"wamid.fixture",status:"read",externalId:`channel:${id(61)}`}};
const kapso={phone_number_id:"fixture-account",message:{id:"wamid.fixture",to:"15555550101",timestamp:String(now/1000-60),
  kapso:{origin:"cloud_api",status:"read"}}};
const input:AuthenticatedWhatsAppDelivery={workspaceId:id(1),integrationId:id(11),provider:"ycloud",configuredAccountId:"+15555550100",payload:ycloud};

test("YCloud normalizes only signed account evidence and outbound correlation; body/secrets are dropped",()=>{
  const receipt=normalizeWhatsAppReceipt({...input,payload:{...ycloud,token:"not-retained"}},id(51),now);
  assert.ok(receipt);assert.equal(receipt.operationId,id(61));assert.equal(receipt.recipient,"+15555550101");
  assert.equal(receipt.providerEventId,"evt.fixture");assert.equal(JSON.stringify(receipt).includes("not-retained"),false);
});
test("wrong account, missing/future timestamp, no IDs and unsupported statuses cannot reconcile",()=>{
  for (const patch of [{whatsappMessage:{...ycloud.whatsappMessage,from:"+15555550999"}},
    {createTime:undefined},{createTime:"2026-10-11T12:00:00Z"},
    {whatsappMessage:{...ycloud.whatsappMessage,id:null,wamid:null}},
    {whatsappMessage:{...ycloud.whatsappMessage,status:"accepted"}}]) {
    assert.equal(normalizeWhatsAppReceipt({...input,payload:{...ycloud,...patch}},id(51),now),null);
  }
});
test("Kapso receipt identity includes status and timestamp, is stable on replay, and never schedules an incoming event",()=>{
  const value={...input,provider:"kapso" as const,configuredAccountId:"fixture-account",payload:kapso,kapsoEventName:"whatsapp.message.read"};
  const receipt=normalizeWhatsAppReceipt(value,id(51),now);assert.ok(receipt);
  assert.deepEqual(normalizeWhatsAppReceipt(value,id(51),now+1000),receipt);
  assert.notEqual(normalizeWhatsAppReceipt({...value,kapsoEventName:"whatsapp.message.delivered"},id(51),now)?.providerEventId,receipt.providerEventId);
  assert.equal(receipt.operationId,null);assert.equal(receipt.recipient,"+15555550101");
});
test("Business App, history and other-app echoes are excluded; missing phones are not invented",()=>{
  for(const origin of ["business_app","history_sync","other_app"]) {
    assert.equal(normalizeWhatsAppReceipt({...input,provider:"kapso",configuredAccountId:"fixture-account",
      kapsoEventName:"whatsapp.message.sent",payload:{...kapso,message:{...kapso.message,kapso:{origin}}}},id(51),now),null);
  }
  const noPhone={...ycloud,whatsappMessage:{...ycloud.whatsappMessage,to:undefined}};
  assert.equal(normalizeWhatsAppReceipt({...input,payload:noPhone},id(51),now)?.recipient,null);
});
