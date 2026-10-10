import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAiReplyProducer } from "./ai-reply-producer.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const scope = { workspaceId: id(1), batchId: id(91) };
function fixture() {
  const calls: Array<{ name: string; args: unknown }> = [];
  const response: { data: unknown; error: { message: string } | null } = { data:
    { mode: "queue", operationId: id(91), eligible: true, reply: null, state: null }, error: null };
  const db = { rpc: async (name: string, args: unknown) => { calls.push({name,args}); return response; } };
  const env: Record<string,string | undefined> = {};
  return { calls, response, env, producer: createAiReplyProducer(db as unknown as SupabaseClient, env) };
}
function enable(f: ReturnType<typeof fixture>) {
  for (const stage of ["AI","INGRESS","WORKER"]) f.env[`CHANNEL_${stage}_WORKSPACES`]=id(1);
}

test("preparation defaults to legacy and delegates immutable choice to storage", async () => {
  const f=fixture(); f.response.data={mode:"legacy",operationId:id(91),eligible:false,reply:null,state:null};
  assert.equal((await f.producer.prepare(scope)).mode,"legacy");
  assert.deepEqual(f.calls,[{name:"prepare_ai_channel_reply",args:{p_workspace_id:id(1),p_batch_id:id(91),p_mode:"legacy"}}]);
});
test("persisted queue never becomes legacy when flags turn off on retry", async () => {
  const f=fixture(); f.response.data={mode:"queue",operationId:id(91),eligible:false,reply:"checkpoint",state:"unknown"};
  const result=await f.producer.prepare(scope);
  assert.equal(result.mode,"queue"); assert.equal(result.enabled,false); assert.equal(result.reply,"checkpoint");
  await assert.rejects(f.producer.enqueue({...scope,body:"checkpoint"}),{message:"AI_ROLLOUT_DISABLED"});
  assert.equal(f.calls.length,1);
});
test("all three workspace flags are required; enabling another workspace is ineffective", async () => {
  for (const stage of ["AI","INGRESS","WORKER"]) {
    const f=fixture(); enable(f); f.env[`CHANNEL_${stage}_WORKSPACES`]=id(2);
    await assert.rejects(f.producer.enqueue({...scope,body:"hola"}),{message:"AI_ROLLOUT_DISABLED"});
    assert.equal(f.calls.length,0);
  }
});
test("enqueue supplies only server batch scope and preserves exact checkpoint text", async () => {
  const f=fixture(); enable(f);
  f.response.data={operationId:id(91),queued:true,duplicate:false,state:"pending",reason:null};
  assert.equal((await f.producer.enqueue({...scope,body:" hola "})).state,"pending");
  assert.deepEqual(f.calls,[{name:"enqueue_ai_channel_reply",args:{p_workspace_id:id(1),p_batch_id:id(91),p_body:" hola "}}]);
});
test("blocked and terminal duplicate responses never infer delivery or ask for a new operation", async () => {
  const f=fixture(); enable(f);
  f.response.data={operationId:id(91),queued:false,duplicate:false,state:null,reason:"context_unavailable"};
  assert.equal((await f.producer.enqueue({...scope,body:"hola"})).queued,false);
  f.response.data={operationId:id(91),queued:true,duplicate:true,state:"unknown",reason:null};
  assert.equal((await f.producer.enqueue({...scope,body:"hola"})).state,"unknown");
  assert.equal(f.calls.length,2);
});
test("malformed scopes, extra recipient facts and empty/oversized text never reach storage", async () => {
  const f=fixture(); enable(f);
  for (const input of [{...scope,batchId:"bad",body:"hola"},{...scope,body:" "},
    {...scope,body:"a".repeat(4097)},{...scope,body:"hola",recipient:"invented"}]) {
    await assert.rejects(f.producer.enqueue(input));
  }
  assert.equal(f.calls.length,0);
});
test("invalid storage results and raw errors are redacted; known conflict stays explicit", async () => {
  const f=fixture(); enable(f);
  f.response.error={message:"secret payload"};
  await assert.rejects(f.producer.prepare(scope),{message:"AI_QUEUE_STORAGE_FAILED"});
  f.response.error={message:"AI_REPLY_CONFLICT"};
  await assert.rejects(f.producer.enqueue({...scope,body:"hola"}),{message:"AI_REPLY_CONFLICT"});
  f.response.error=null;
  for (const data of [{operationId:id(92),queued:true,duplicate:false,state:"pending",reason:null},
    {operationId:id(91),queued:true,duplicate:false,state:null,reason:null}]) {
    f.response.data=data;
    await assert.rejects(f.producer.enqueue({...scope,body:"hola"}),{message:"AI_QUEUE_STORAGE_FAILED"});
  }
});
test("AI rollout is bounded and invalid lists fail before any storage mutation", async () => {
  const f=fixture();
  for (const raw of ["*", `${id(1)},bad`, [1,2,3,4].map(id).join(",")]) {
    f.env.CHANNEL_AI_WORKSPACES=raw;
    await assert.rejects(f.producer.prepare(scope),{message:"CHANNEL_ROLLOUT_INVALID"});
  }
  assert.equal(f.calls.length,0);
});
