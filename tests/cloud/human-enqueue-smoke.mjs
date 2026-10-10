// Run after the synthetic browser enqueue, with the fixture and local flags active.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { workspace, conversation } from "../db/cloud-human-enqueue.mjs";
const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
assert.equal(url,"https://bzanbpyzujlogipxvkfn.supabase.co");
assert.equal(process.env.QA_EMAIL,"qa-f3-admin@omnichannel.invalid");
const service=createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
function checked(r) { if(r.error) throw new Error(`QA_${r.error.code}`); return r.data; }
const job=checked(await service.from("message_jobs").select("operation_id,request,sender_user_id")
  .eq("workspace_id",workspace).eq("actor","human").single());
const connection=checked(await service.from("channel_connections").select("id,capabilities")
  .eq("workspace_id",workspace).single());
const jar=new Map();
const session=createServerClient(url,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{
  cookies:{getAll:()=>[...jar].map(([name,value])=>({name,value})),
    setAll:(values)=>values.forEach(({name,value})=>jar.set(name,value))},
});
checked(await session.auth.signInWithPassword({email:process.env.QA_EMAIL,password:process.env.QA_PASSWORD}));
const post=(body,authenticated=true)=>fetch(`http://127.0.0.1:3100/api/conversations/${conversation}/messages`,{
  method:"POST",headers:{"content-type":"application/json",...(authenticated?{cookie:[...jar].map(([k,v])=>`${k}=${v}`).join("; ")}: {})},
  body:JSON.stringify(body),
});
const body={body:job.request.body,operationId:job.operation_id,deliveryMode:"queue"};
try {
  assert.equal((await post(body,false)).status,401);
  const direct=await session.rpc("enqueue_human_channel_text",{p_workspace_id:workspace,p_conversation_id:conversation,
    p_sender_user_id:job.sender_user_id,p_operation_id:randomUUID(),p_body:"Direct browser denial"});
  assert.equal(direct.error?.code,"42501");
  for(let i=0;i<2;i++) {
    const response=await post({...body,workspaceId:randomUUID(),senderUserId:randomUUID(),recipient:"forged"});
    assert.equal(response.status,202);const result=await response.json();
    assert.equal(result.duplicate,true);assert.equal(result.operationId,job.operation_id);
  }
  assert.equal((await post({...body,body:"Changed body"})).status,409);
  checked(await service.from("channel_connections").update({capabilities:{}}).eq("workspace_id",workspace).eq("id",connection.id));
  assert.equal((await post(body)).status,202);
  assert.equal((await post({...body,operationId:randomUUID()})).status,422);
  const jobs=checked(await service.from("message_jobs").select("operation_id,state,actor").eq("workspace_id",workspace));
  assert.equal(jobs.filter(j=>j.actor==="human").length,1);
  assert.equal(jobs.find(j=>j.actor==="automation").state,"cancelled");
  const outbox=await service.from("message_outbox").select("*",{head:true,count:"exact"}).eq("workspace_id",workspace);
  checked(outbox); assert.equal(outbox.count,0);
  const report={checkedAt:new Date().toISOString(),workspace,conversation,operation:job.operation_id,
    authenticatedRetry:202,forgedScopeIgnored:true,duplicateJobs:0,changedBody:409,
    missingGrantNewAttempt:422,missingGrantRetry:202,unauthenticated:401,browserRpcDenied:true,outbox:0};
  await writeFile("test-results/f3-human-cloud.json",JSON.stringify(report,null,2)+"\n","utf8");
  console.log(JSON.stringify(report));
} finally {
  checked(await service.from("channel_connections").update({capabilities:connection.capabilities})
    .eq("workspace_id",workspace).eq("id",connection.id));
  await session.auth.signOut({scope:"local"});
}
