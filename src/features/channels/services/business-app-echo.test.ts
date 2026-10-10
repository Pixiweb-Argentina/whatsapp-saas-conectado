import assert from "node:assert/strict";
import {afterEach,test} from "node:test";
import type {SupabaseClient} from "@supabase/supabase-js";
import {captureBusinessAppEcho,normalizeBusinessAppEcho} from "./business-app-echo.ts";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const now=Date.parse("2026-10-10T12:01:00Z");
const payload={phone_number_id:"fixture-account",message:{id:"wamid.fixture",to:"15555550101",
  timestamp:String(now/1000-60),type:"text",text:{body:"Mensaje humano"},kapso:{origin:"business_app"}}};
const input={workspaceId:id(1),integrationId:id(11),provider:"kapso" as const,
  configuredAccountId:"fixture-account",payload,kapsoEventName:"whatsapp.message.sent"};
const originalFlag=process.env.CHANNEL_INGRESS_WORKSPACES;
afterEach(()=>{if(originalFlag===undefined)delete process.env.CHANNEL_INGRESS_WORKSPACES;else process.env.CHANNEL_INGRESS_WORKSPACES=originalFlag;});
function database(fail=false) {
  let calls=0;
  const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{id:id(51),workspace_id:id(1),
    legacy_integration_id:id(11),channel:"whatsapp",provider:"kapso",external_account_id:"fixture-account",status:"ready",revoked_at:null},error:null})};
  return {db:{from:()=>q,rpc:async(name:string,args:Record<string,unknown>)=>{calls++;assert.equal(name,"persist_business_app_echo");
    assert.equal(args.p_workspace_id,id(1));return {data:{conversationId:id(31),inserted:true,aiDisabled:true},error:fail?{message:"secret"}:null};}} as unknown as SupabaseClient,
    calls:()=>calls};
}
test("Business App normalization uses exact account, recipient, IDs and original timestamp, dropping unrelated fields",()=>{
  const value=normalizeBusinessAppEcho({...input,payload:{...payload,secret:"private"}},id(51),now);
  assert.ok(value);assert.equal(value.recipient,"+15555550101");assert.equal(value.body,"Mensaje humano");
  assert.equal(JSON.stringify(value).includes("private"),false);
});
test("unknown/future dates, other accounts, absent phones and cloud/history/other-app origins are excluded",()=>{
  for(const patch of [{timestamp:undefined},{timestamp:"bad"},{timestamp:String(now/1000+10)},
    {to:undefined},{to:"invalid"},{kapso:{origin:"cloud_api"}},{kapso:{origin:"history_sync"}},{kapso:{origin:"other_app"}}]) {
    assert.equal(normalizeBusinessAppEcho({...input,payload:{...payload,message:{...payload.message,...patch}}},id(51),now),null);
  }
  assert.equal(normalizeBusinessAppEcho({...input,configuredAccountId:"wrong"},id(51),now),null);
});
test("media echo keeps only caption or placeholder and does not download provider URLs",()=>{
  const value=normalizeBusinessAppEcho({...input,payload:{...payload,message:{...payload.message,type:"image",
    image:{url:"https://example.invalid/private"},kapso:{origin:"business_app",content:"private url"}}}},id(51),now);
  assert.equal(value?.body,"[Multimedia]");assert.equal(value?.type,"image");
});
test("oversized echo body is ignored without enabling the legacy writer",()=>{
  assert.equal(normalizeBusinessAppEcho({...input,payload:{...payload,message:{...payload.message,text:{body:"x".repeat(4097)}}}},id(51),now),null);
});
test("disabled echo pilot does not touch storage and keeps the legacy route available",async()=>{
  delete process.env.CHANNEL_INGRESS_WORKSPACES;const probe=database();
  assert.equal((await captureBusinessAppEcho(probe.db,input,now)).status,"disabled");assert.equal(probe.calls(),0);
});
test("enabled capture calls only the atomic RPC and validates its minimal projection",async()=>{
  process.env.CHANNEL_INGRESS_WORKSPACES=id(1);const probe=database();
  assert.deepEqual(await captureBusinessAppEcho(probe.db,input,now),{status:"persisted",conversationId:id(31),inserted:true,aiDisabled:true});
  assert.equal(probe.calls(),1);
});
test("enabled invalid echo is acknowledged as ignored without writing or fallback",async()=>{
  process.env.CHANNEL_INGRESS_WORKSPACES=id(1);const probe=database();
  assert.equal((await captureBusinessAppEcho(probe.db,{...input,payload:{...payload,message:{...payload.message,timestamp:undefined}}},now)).status,"ignored");assert.equal(probe.calls(),0);
});
test("atomic echo RPC failure is redacted and propagates for provider retry, with no second writer",async()=>{
  process.env.CHANNEL_INGRESS_WORKSPACES=id(1);const probe=database(true);
  await assert.rejects(()=>captureBusinessAppEcho(probe.db,input,now),{message:"CHANNEL_ECHO_STORAGE_FAILED"});assert.equal(probe.calls(),1);
});
