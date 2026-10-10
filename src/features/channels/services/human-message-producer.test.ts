import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const input = { workspaceId: id(1), conversationId: id(31), senderUserId: id(101), operationId: id(91), body: "hola" };
let calls: Array<{ name: string; args: unknown }> = [];
let error: { message: string } | null = null;
let data: unknown = { operationId: id(91), state: "pending", duplicate: false };
mock.module("@supabase/supabase-js", { exports: { createClient: () => ({
  rpc: async (name: string,args: unknown) => { calls.push({name,args});return {data,error}; },
}) } });
const { enqueueHumanMessage } = await import("./human-message-producer.ts");
afterEach(() => {
  delete process.env.CHANNEL_HUMAN_WORKSPACES; delete process.env.CHANNEL_WORKER_WORKSPACES;
  calls=[];error=null;data={ operationId: id(91), state: "pending", duplicate: false };
});
test("producer requires both human and worker allowlists before database access", async () => {
  await assert.rejects(enqueueHumanMessage(input),{message:"HUMAN_ROLLOUT_DISABLED"});
  process.env.CHANNEL_HUMAN_WORKSPACES=id(1);
  await assert.rejects(enqueueHumanMessage(input),{message:"HUMAN_ROLLOUT_DISABLED"});
  assert.equal(calls.length,0);
});
test("producer calls only the atomic RPC with server-owned scope and no recipient facts", async () => {
  process.env.CHANNEL_HUMAN_WORKSPACES=id(1); process.env.CHANNEL_WORKER_WORKSPACES=id(1);
  assert.deepEqual(await enqueueHumanMessage(input),data);
  assert.deepEqual(calls,[{name:"enqueue_human_channel_text",args:{p_workspace_id:id(1),p_conversation_id:id(31),
    p_sender_user_id:id(101),p_operation_id:id(91),p_body:"hola"}}]);
});
test("database error details are redacted; wrong operation response is never acknowledged", async () => {
  process.env.CHANNEL_HUMAN_WORKSPACES=id(1); process.env.CHANNEL_WORKER_WORKSPACES=id(1);
  error={message:"private details"};
  await assert.rejects(enqueueHumanMessage(input),{message:"HUMAN_ENQUEUE_UNAVAILABLE"});
  error=null;data={operationId:id(92),state:"pending",duplicate:false};
  await assert.rejects(enqueueHumanMessage(input),{message:"HUMAN_ENQUEUE_UNAVAILABLE"});
});
