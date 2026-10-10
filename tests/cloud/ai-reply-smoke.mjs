// RPC/GoTrue on the new project, synthetic fixture only. No model or transport.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { workspace,conversation,batch,secondBatch } from "../db/cloud-ai-reply.mjs";
const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
assert.equal(url,"https://bzanbpyzujlogipxvkfn.supabase.co");
assert.equal(process.env.QA_EMAIL,"qa-f3-admin@omnichannel.invalid");
const opts={auth:{persistSession:false,autoRefreshToken:false}};
const service=createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY,opts);
const anon=createClient(url,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,opts);
const session=createClient(url,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,opts);
function checked(result) { if(result.error) throw new Error(`QA_${result.error.code}`); return result.data; }
const prepare=(id=batch,mode="queue")=>service.rpc("prepare_ai_channel_reply",{
  p_workspace_id:workspace,p_batch_id:id,p_mode:mode,
});
const enqueue=(id=batch,body="Prueba IA: no enviar")=>service.rpc("enqueue_ai_channel_reply",{
  p_workspace_id:workspace,p_batch_id:id,p_body:body,
});
const report={serviceRpc:false,scopeDenied:false,publicDenied:false,queuePinned:false,
  staleResumeBlocked:false,textRecovered:false,duplicate:false,conflict:false,noOutbox:false};
checked(await session.auth.signInWithPassword({email:process.env.QA_EMAIL,password:process.env.QA_PASSWORD}));
try {
  const initial=checked(await prepare()); assert.equal(initial.eligible,true); report.serviceRpc=true;
  assert.equal(checked(await prepare(batch,"legacy")).mode,"queue"); report.queuePinned=true;
  assert.equal((await service.rpc("prepare_ai_channel_reply",{p_workspace_id:"52aa2172-9791-48cc-82ca-6fb21cfca773",
    p_batch_id:batch,p_mode:"queue"})).error?.code,"42501"); report.scopeDenied=true;
  for (const client of [anon,session]) {
    assert.equal((await client.rpc("prepare_ai_channel_reply",{p_workspace_id:workspace,p_batch_id:batch,p_mode:"queue"})).error?.code,"42501");
    assert.equal((await client.rpc("enqueue_ai_channel_reply",{p_workspace_id:workspace,p_batch_id:batch,p_body:"injected"})).error?.code,"42501");
  }
  report.publicDenied=true;
  for (const [state,ai_enabled] of [["human_active",false],["ai_active",true]]) {
    checked(await service.from("conversations").update({state,ai_enabled}).eq("workspace_id",workspace).eq("id",conversation));
  }
  assert.equal(checked(await enqueue()).queued,false); report.staleResumeBlocked=true;
  assert.equal(checked(await prepare()).reply,"Prueba IA: no enviar"); report.textRecovered=true;
  checked(await service.from("message_batches").insert({id:secondBatch,workspace_id:workspace,conversation_id:conversation,status:"processing"}));
  checked(await service.from("messages").update({batch_id:secondBatch}).eq("workspace_id",workspace).eq("batch_id",batch));
  assert.equal(checked(await prepare(secondBatch)).eligible,true);
  assert.equal(checked(await enqueue(secondBatch)).state,"pending");
  const retry=checked(await enqueue(secondBatch)); assert.equal(retry.duplicate,true); report.duplicate=true;
  assert.equal((await enqueue(secondBatch,"changed reply")).error?.message,"AI_REPLY_CONFLICT"); report.conflict=true;
  assert.equal(checked(await service.from("message_jobs").select("operation_id").eq("workspace_id",workspace)).length,1);
  assert.equal(checked(await service.from("message_outbox").select("operation_id").eq("workspace_id",workspace)).length,0);
  report.noOutbox=true;
  await writeFile("test-results/f3-ai-reply-cloud.json",JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
} finally { await session.auth.signOut({scope:"local"}); }
