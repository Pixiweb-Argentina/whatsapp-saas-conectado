// Temporary human fixture only. No transport, enqueue or scheduler calls.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { workspace, conversation, operation } from "../db/cloud-human-enqueue.mjs";
const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
assert.equal(url,"https://bzanbpyzujlogipxvkfn.supabase.co");
assert.equal(process.env.QA_EMAIL,"qa-f3-admin@omnichannel.invalid");
const options={auth:{persistSession:false,autoRefreshToken:false}};
const session=createClient(url,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,options);
const service=createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY,options);
const anon=createClient(url,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,options);
function checked(result) { if(result.error) throw new Error(`QA_${result.error.code}`); return result.data; }
const read=(workspaceId=workspace,conversationId=conversation)=>session.rpc("read_conversation_queue",{
  p_workspace_id:workspaceId,p_conversation_id:conversationId,
});
const user=checked(await session.auth.signInWithPassword({email:process.env.QA_EMAIL,password:process.env.QA_PASSWORD})).user;
const report={projection:false,anonDenied:false,directTableDenied:false,foreignScopeEmpty:false,
  revokedMembershipEmpty:false,noOutbox:false};
try {
  const rows=checked(await read());
  const pending=rows.find(row=>row.operationId===operation);
  assert.equal(pending.state,"pending"); assert.equal(pending.body,"Prueba persistente de cola: no enviar");
  assert.deepEqual(Object.keys(pending).sort(),["actor","body","createdAt","operationId","state"]);
  report.projection=true;
  assert.equal((await anon.rpc("read_conversation_queue",{p_workspace_id:workspace,p_conversation_id:conversation})).error?.code,"42501");
  report.anonDenied=true;
  assert.equal((await session.from("message_jobs").select("*").eq("workspace_id",workspace)).error?.code,"42501");
  report.directTableDenied=true;
  assert.deepEqual(checked(await read("52aa2172-9791-48cc-82ca-6fb21cfca773",conversation)),[]);
  report.foreignScopeEmpty=true;
  checked(await service.from("memberships").update({is_active:false}).eq("workspace_id",workspace).eq("user_id",user.id));
  assert.deepEqual(checked(await read()),[]); report.revokedMembershipEmpty=true;
  assert.equal(checked(await service.from("message_outbox").select("operation_id").eq("workspace_id",workspace)).length,0);
  report.noOutbox=true;
  await writeFile("test-results/f3-queue-read-cloud.json",JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
} finally {
  checked(await service.from("memberships").update({is_active:true}).eq("workspace_id",workspace).eq("user_id",user.id));
  await session.auth.signOut({scope:"local"});
}
