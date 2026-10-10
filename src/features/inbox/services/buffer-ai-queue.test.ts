import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiReplyPreparation } from "@/features/channels/services/ai-reply-producer";
import { createAiQueueControl, prepareAiQueueBatch, recoverAiQueueFailure } from "./buffer-ai-queue.ts";

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
afterEach(()=>{for (const stage of ["AI","INGRESS","WORKER"]) delete process.env[`CHANNEL_${stage}_WORKSPACES`];});
function fixture(overrides: Partial<AiReplyPreparation> = {}) {
  const batch={id:id(91),workspace_id:id(1),conversation_id:id(31),meta:{} as Record<string,unknown>};
  const prep: AiReplyPreparation={mode:"queue",operationId:id(91),eligible:true,enabled:true,reply:null,state:null,...overrides};
  const calls:Array<{name:string;args:Record<string,unknown>}>=[];
  const patches:Array<Record<string,unknown>>=[];
  const result={settled:true,changed:true};
  let writeFails=false;
  const db={rpc:async(name:string,args:Record<string,unknown>)=>{
    calls.push({name,args});
    if (name === "prepare_ai_channel_reply") { const {enabled:_enabled,...raw}=prep; return {data:raw,error:null}; }
    if (name === "handoff_ai_channel_reply") return {data:result,error:null};
    if (name === "checkpoint_ai_channel_reply") {prep.reply=String(args.p_body);return {data:true,error:null};}
    return {data:{operationId:id(91),queued:true,state:"pending",duplicate:false,reason:null},error:null};
  },from:()=>({update:(patch:Record<string,unknown>)=>{
    patches.push(patch);
    const builder={eq:(_key:string,_value:unknown)=>builder,
      select:async()=>({data:writeFails?null:[{id:id(91)}],error:writeFails?{code:"private"}:null})};
    return builder;
  }})};
  const client=db as unknown as SupabaseClient;
  return {batch,prep,calls,patches,result,client,control:createAiQueueControl(client,batch,prep),failWrite:()=>{writeFails=true;}};
}
function enable() {for (const stage of ["AI","INGRESS","WORKER"]) process.env[`CHANNEL_${stage}_WORKSPACES`]=id(1);}

test("legacy preparation returns no queue control; persisted queue remains disabled rather than legacy",async()=>{
  const f=fixture({mode:"legacy"}); assert.equal(await prepareAiQueueBatch(f.client,f.batch),null);
  f.prep.mode="queue";
  const control=await prepareAiQueueBatch(f.client,f.batch); assert.ok(control);
  await assert.rejects(control.resume(),{message:"AI_ROLLOUT_DISABLED"});
});
test("existing pending and unknown jobs are recovered even with flags off, without another enqueue",async()=>{
  for (const state of ["pending","unknown"] as const) {
    const f=fixture({state,enabled:false,eligible:false,reply:"private"});
    assert.equal(await f.control.resume(),"close"); assert.equal(f.calls.length,0);
  }
});
test("only the private reply becomes an outbound body; mutable metadata is ignored",async()=>{
  enable(); const f=fixture({reply:"original private text"}); f.batch.meta.pending_reply="injected metadata";
  assert.equal(await f.control.resume(),"close");
  assert.equal(f.calls[0].args.p_body,"original private text");
});
test("metadata text without a private checkpoint is held for a human and never regenerated/enqueued",async()=>{
  const f=fixture(); f.batch.meta.pending_reply="injected metadata";
  assert.equal(await f.control.resume(),"close");
  assert.equal(f.calls[0].name,"handoff_ai_channel_reply"); assert.equal(f.calls[0].args.p_reason,"write_unconfirmed");
});
test("private text checkpoint still persists after flags are turned off mid-generation",async()=>{
  const f=fixture(); await f.control.checkpoint("original"); assert.equal(f.prep.reply,"original");
  assert.equal(f.calls[0].name,"checkpoint_ai_channel_reply");
});
test("handoff waits for pending/sending work instead of cancelling or repeating it",async()=>{
  const f=fixture({state:"pending",reply:"already queued"}); f.batch.meta.pending_handoff="customer_request"; f.result.settled=false; f.result.changed=false;
  assert.equal(await f.control.resume(),"requeued");
  assert.deepEqual(f.calls.map(row=>row.name),["handoff_ai_channel_reply"]);
  assert.equal(f.patches.at(-1)?.status,"buffering"); assert.equal(f.batch.meta.isolated,true);
});
test("handoff after terminal receipt is quiet and does not enqueue another message",async()=>{
  const f=fixture({state:"unknown"}); f.batch.meta.queue_handoff_reason="tool";
  assert.equal(await f.control.resume(),"close");
  assert.deepEqual(f.calls.map(row=>row.name),["handoff_ai_channel_reply"]);
});
test("queue failures back off with no provider path; exhausted retry performs internal handoff and cancels batch",async()=>{
  const f=fixture(); await recoverAiQueueFailure(f.client,f.batch,f.control);
  assert.equal(f.batch.meta.retry_count,1); assert.equal(f.patches[0].status,"buffering");
  f.batch.meta.retry_count=3; await recoverAiQueueFailure(f.client,f.batch,f.control);
  assert.equal(f.calls[0].args.p_reason,"retry_exhausted"); assert.equal(f.patches.at(-1)?.status,"cancelled");
});
test("unknown mode failures never invoke a handoff notifier and failed checkpoints propagate",async()=>{
  const f=fixture(); f.batch.meta.retry_count=3;
  await recoverAiQueueFailure(f.client,f.batch,null); assert.equal(f.calls.length,0);
  f.failWrite(); await assert.rejects(f.control.handoff("keyword"),{message:"AI_BATCH_CHECKPOINT_FAILED"});
  assert.equal(f.calls.length,0);
});
