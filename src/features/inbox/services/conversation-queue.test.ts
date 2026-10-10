import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readConversationQueue } from "./conversation-queue.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const row = (n: number) => ({ operationId: id(n), state: "pending", actor: "human",
  body: "Prueba", createdAt: new Date().toISOString() });
function fixture(data: unknown, error: unknown = null) {
  const calls: unknown[] = [];
  const db = { rpc: async (name: string, args: unknown) => {
    calls.push({ name, args }); return { data, error };
  } } as unknown as SupabaseClient;
  return { db, calls };
}
test("queue reader scopes the session RPC and returns chronological bounded rows", async () => {
  const f = fixture(Array.from({ length: 51 }, (_, n) => row(100 - n)));
  const result = await readConversationQueue(f.db, id(1), id(31));
  assert.deepEqual(f.calls, [{ name: "read_conversation_queue", args: {
    p_workspace_id: id(1), p_conversation_id: id(31),
  } }]);
  assert.equal(result.messages.length, 50); assert.equal(result.more, true);
  assert.equal(result.messages[0].operationId, id(51)); assert.equal(result.error, false);
});
test("queue reader rejects malformed rows and unexpected private fields without exposing errors", async () => {
  for (const data of [[{ ...row(1), request: { recipient: "private" } }],
    [{ ...row(1), state: "accepted" }], [{ ...row(1), body: null }], null]) {
    const result = await readConversationQueue(fixture(data).db, id(1), id(31));
    assert.deepEqual(result, { messages: [], more: false, error: true });
  }
  assert.deepEqual(await readConversationQueue(fixture([], { detail: "private" }).db, id(1), id(31)),
    { messages: [], more: false, error: true });
});
test("invalid queue scope never reaches the database", async () => {
  const f = fixture([]);
  await assert.rejects(() => readConversationQueue(f.db, "invalid", id(31)));
  assert.equal(f.calls.length, 0);
});
