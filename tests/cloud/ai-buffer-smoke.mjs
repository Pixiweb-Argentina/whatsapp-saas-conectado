// Runs the actual local Next handler against the synthetic new Cloud fixture.
// It recovers a prepared job with rollout off; no model or transport is invoked.
import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {writeFile} from "node:fs/promises";
import {createClient} from "@supabase/supabase-js";
import {workspace,batch} from "../db/cloud-ai-buffer.mjs";
assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL,"https://bzanbpyzujlogipxvkfn.supabase.co");
for (const stage of ["AI","INGRESS","WORKER","HUMAN"]) assert.ok(!process.env[`CHANNEL_${stage}_WORKSPACES`]);
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,
  {auth:{persistSession:false,autoRefreshToken:false}});
function checked(result) {if(result.error) throw new Error(`QA_${result.error.code}`);return result.data;}
const body=JSON.stringify({batchId:batch});
const endpoint="http://127.0.0.1:3100/api/internal/buffer/process";
assert.equal((await fetch(endpoint,{method:"POST",body})).status,401);
const signature=createHmac("sha256",process.env.BUFFER_PROCESS_SECRET).update(body).digest("hex");
const headers={"content-type":"application/json",Authorization:`Bearer ${signature}`};
const response=await fetch(endpoint,{method:"POST",headers,body});
assert.equal(response.status,200);const payload=await response.json();
assert.equal(payload.processed,true);assert.equal(payload.processedBatchId,batch);assert.equal(payload.error,undefined);
const row=checked(await db.from("message_batches").select("status").eq("workspace_id",workspace).eq("id",batch).single());
assert.equal(row.status,"processed");
const jobs=checked(await db.from("message_jobs").select("operation_id,state").eq("workspace_id",workspace));
assert.equal(jobs.length,1);assert.equal(jobs[0].state,"pending");assert.equal(jobs[0].operation_id,batch);
assert.equal(checked(await db.from("message_outbox").select("operation_id").eq("workspace_id",workspace)).length,0);
assert.equal((await fetch(endpoint,{method:"POST",headers,body})).status,404);
const handoff=checked(await db.rpc("handoff_ai_channel_reply",{p_workspace_id:workspace,p_batch_id:batch,p_reason:"tool"}));
assert.deepEqual(handoff,{settled:false,changed:false});
const report={unauthorizedDenied:true,actualNextHandler:true,privateJobRecoveredWithFlagsOff:true,
  batchProcessed:true,onePendingJob:true,replayDenied:true,handoffDeferred:true,noOutbox:true};
await writeFile("test-results/f3-ai-buffer-cloud.json",JSON.stringify(report,null,2));console.log(JSON.stringify(report));
