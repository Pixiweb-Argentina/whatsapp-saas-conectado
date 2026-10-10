// Actual local Next/HMAC/Supabase with synthetic Business App evidence. No transport.
import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {writeFile} from "node:fs/promises";
import {createClient} from "@supabase/supabase-js";
import {encryptCredentials} from "../../src/shared/lib/integration-secrets.ts";
import {workspace,conversation,integration,operation} from "../db/cloud-business-app-echo.mjs";
assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL,"https://bzanbpyzujlogipxvkfn.supabase.co");
for(const stage of ["AI","WORKER","HUMAN"])assert.ok(!process.env[`CHANNEL_${stage}_WORKSPACES`]);
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
function checked(r){if(r.error)throw new Error(`QA_${r.error.code}`);return r.data;}
const secret="synthetic-business-echo-signature";
const creds=await encryptCredentials({webhook_signing_secret:secret},workspace,"kapso");
checked(await db.from("integrations").update({credentials:creds}).eq("workspace_id",workspace).eq("id",integration));
const timestamp=String(Math.floor(Date.now()/1000)-1);
const body={phone_number_id:"synthetic-echo-account",message:{id:"wamid.synthetic-human-app",to:"15555559901",
  timestamp,type:"text",text:{body:"Respuesta humana ficticia desde WhatsApp Business"},kapso:{origin:"business_app"}}};
async function send(value=body,valid=true){const raw=JSON.stringify(value);
  const signature=createHmac("sha256",valid?secret:"wrong-synthetic-key").update(raw).digest("hex");
  return fetch(`http://127.0.0.1:3100/api/webhooks/kapso?wsid=${workspace}`,{method:"POST",body:raw,
    headers:{"X-Webhook-Signature":signature,"X-Webhook-Event":"whatsapp.message.sent"}});}
const before=checked(await db.from("conversations").select("window_expires_at,assigned_to").eq("id",conversation).single());
assert.equal((await send(body,false)).status,401);
assert.equal((await send({...body,phone_number_id:"another-account"})).status,401);
const first=await send();assert.equal(first.status,200);assert.equal((await first.json()).aiDisabled,true);
const state=checked(await db.from("conversations").select("state,ai_enabled,window_expires_at,assigned_to").eq("id",conversation).single());
assert.equal(state.state,"human_active");assert.equal(state.ai_enabled,false);
assert.equal(state.window_expires_at,before.window_expires_at);assert.equal(state.assigned_to,before.assigned_to);
assert.equal(checked(await db.from("message_jobs").select("state").eq("operation_id",operation).single()).state,"cancelled");
assert.equal(checked(await db.from("contacts").select("opt_in").eq("workspace_id",workspace).single()).opt_in,false);
const repeat=await send();assert.equal(repeat.status,200);assert.equal((await repeat.json()).recorded,false);
const changed=await send({...body,message:{...body.message,text:{body:"conflicting text"}}});assert.equal(changed.status,500);
const invalid=await send({...body,message:{...body.message,id:"wamid.invalid-date",timestamp:"invalid"}});assert.equal(invalid.status,200);
assert.equal((await invalid.json()).recorded,false);
checked(await db.from("conversations").update({state:"ai_active",ai_enabled:true}).eq("workspace_id",workspace).eq("id",conversation));
assert.equal((await send()).status,200);
const old=await send({...body,message:{...body.message,id:"wamid.old-unseen",timestamp:String(Number(timestamp)-60)}});assert.equal(old.status,200);
assert.equal((await old.json()).aiDisabled,false);
assert.equal(checked(await db.from("conversations").select("state").eq("id",conversation).single()).state,"ai_active");
const messages=checked(await db.from("messages").select("meta,body").eq("workspace_id",workspace));assert.equal(messages.length,2);
for(const m of messages){assert.equal(m.meta.origin,"business_app");assert.equal(m.meta.channel_actor,"human");}
assert.equal(checked(await db.from("events").select("id").eq("workspace_id",workspace).eq("type","state_change")).length,1);
assert.equal(checked(await db.from("message_batches").select("id").eq("workspace_id",workspace)).length,0);
assert.equal(checked(await db.from("message_outbox").select("operation_id").eq("workspace_id",workspace)).length,0);
const anon=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false}});
assert.equal((await anon.rpc("persist_business_app_echo",{p_workspace_id:workspace,p_integration_id:integration,p_echo:{}})).error?.code,"42501");
const report={actualNextHandler:true,invalidSignatureDenied:true,wrongAccountDenied:true,humanTakeoverAtomic:true,
  leasedAiCancelled:true,duplicateNoOp:true,conflictDenied:true,invalidTimestampIgnoredWithoutFallback:true,
  resumeSurvivesReplayAndOldUnseenEcho:true,windowAndAssignmentUnchanged:true,optInNotGranted:true,
  oneAuditNoBatchesOrOutbox:true,publicRpcDenied:true,noTransportCalled:true};
await writeFile("test-results/f3-business-app-echo-cloud.json",JSON.stringify(report,null,2));console.log(JSON.stringify(report));
