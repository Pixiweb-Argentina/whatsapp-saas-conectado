// Signed synthetic callbacks to the actual local Next handlers. No provider/LLM request.
import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {writeFile} from "node:fs/promises";
import {createClient} from "@supabase/supabase-js";
import {encryptCredentials} from "../../src/shared/lib/integration-secrets.ts";
import {workspace,operation,integration,kapsoOperation,kapsoIntegration} from "../db/cloud-delivery-receipts.mjs";
assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL,"https://bzanbpyzujlogipxvkfn.supabase.co");
for (const stage of ["AI","WORKER","HUMAN"]) assert.ok(!process.env[`CHANNEL_${stage}_WORKSPACES`]);
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,
  {auth:{persistSession:false,autoRefreshToken:false}});
function checked(result) {if(result.error) throw new Error(`QA_${result.error.code}`);return result.data;}
const secret="synthetic-receipt-signature";
for (const [id,provider] of [[integration,"ycloud"],[kapsoIntegration,"kapso"]]) {
  const credentials=await encryptCredentials({webhook_signing_secret:secret},workspace,provider);
  checked(await db.from("integrations").update({credentials}).eq("workspace_id",workspace).eq("id",id));
}
async function send(provider,body,eventName,valid=true) {
  const raw=JSON.stringify(body);const timestamp=Math.floor(Date.now()/1000);
  const signature=createHmac("sha256",valid?secret:"wrong-fixture-key").update(provider === "ycloud" ? `${timestamp}.${raw}` : raw).digest("hex");
  const headers=provider === "ycloud" ? {"YCloud-Signature":`t=${timestamp},s=${signature}`} : {"X-Webhook-Signature":signature,"X-Webhook-Event":eventName};
  return fetch(`http://127.0.0.1:3100/api/webhooks/${provider}?wsid=${workspace}`,{method:"POST",headers,body:raw});
}
const date=new Date(Date.now()-1000).toISOString();
const ycloud={id:"evt.synthetic-receipt",type:"whatsapp.message.updated",createTime:date,
  whatsappMessage:{id:"provider.synthetic-receipt",wamid:"wamid.synthetic-receipt",status:"read",
    from:"+15555559900",to:"+15555559901",externalId:`channel:${operation}`}};
assert.equal((await send("ycloud",ycloud,null,false)).status,401);
for(let n=0;n<2;n++) assert.equal((await send("ycloud",ycloud)).status,200);
const message=checked(await db.from("messages").select("id,status,meta,error_message").eq("workspace_id",workspace).eq("channel_operation_id",operation).single());
assert.equal(message.status,"read");assert.equal(message.meta.send_outcome,"accepted");assert.equal(message.error_message,null);
const job=checked(await db.from("message_jobs").select("state").eq("workspace_id",workspace).eq("operation_id",operation).single());assert.equal(job.state,"accepted");
checked(await db.from("integrations").update({enabled:false}).eq("workspace_id",workspace).eq("id",integration));
checked(await db.from("integrations").update({enabled:true}).eq("workspace_id",workspace).eq("id",kapsoIntegration));
const kapso={phone_number_id:"synthetic-receipt-account",message:{id:"wamid.synthetic-kapso",timestamp:String(Math.floor(Date.now()/1000)-1),
  to:"15555559902",kapso:{origin:"cloud_api",status:"read"}}};
assert.equal((await send("kapso",kapso,"whatsapp.message.read",false)).status,401);
assert.equal((await send("kapso",{...kapso,phone_number_id:"wrong-account"},"whatsapp.message.read")).status,401);
for(let n=0;n<2;n++) assert.equal((await send("kapso",kapso,"whatsapp.message.read")).status,200);
const kapsoMessage=checked(await db.from("messages").select("status").eq("workspace_id",workspace).eq("channel_operation_id",kapsoOperation).single());assert.equal(kapsoMessage.status,"read");
checked(await db.from("integrations").update({enabled:false}).eq("workspace_id",workspace).eq("id",kapsoIntegration));
checked(await db.from("integrations").update({enabled:true}).eq("workspace_id",workspace).eq("id",integration));
const late={...ycloud,id:"evt.synthetic-late",whatsappMessage:{...ycloud.whatsappMessage,status:"sent"}};
assert.equal((await send("ycloud",late)).status,200);
assert.equal(checked(await db.from("messages").select("status").eq("id",message.id).single()).status,"read");
assert.equal(checked(await db.from("message_jobs").select("operation_id").eq("workspace_id",workspace)).length,2);
assert.equal(checked(await db.from("message_batches").select("id").eq("workspace_id",workspace)).length,0);
const anonymous=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false}});
assert.equal((await anonymous.rpc("reconcile_channel_receipts",{p_workspace_id:workspace,p_limit:50})).error?.code,"42501");
const report={actualNextHandlers:true,invalidSignaturesDenied:true,kapsoWrongAccountDenied:true,ycloudUnknownReconciled:true,
  kapsoReadReconciled:true,duplicateCallbacksIdempotent:true,outOfOrderReadPreserved:true,noNewJobsOrBatches:true,publicRpcDenied:true,noTransportCalled:true};
await writeFile("test-results/f3-receipt-cloud.json",JSON.stringify(report,null,2));console.log(JSON.stringify(report));
