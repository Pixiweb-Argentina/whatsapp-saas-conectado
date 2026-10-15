import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { claimBufferBatch } from "./buffer-claim.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { workspaceId: id(1), batchId: id(2) };
function fixture(data: unknown = []) {
  const calls: Array<{ name: string; args: unknown }> = [];
  const response: { data: unknown; error: unknown } = { data, error: null };
  const db = { rpc: async (name: string, args?: unknown) => { calls.push({ name, args }); return response; } };
  return { db: db as unknown as SupabaseClient, calls, response };
}
test("unscoped buffer preserves the existing scanner", async () => {
  const f = fixture(); await claimBufferBatch(f.db);
  assert.deepEqual(f.calls, [{ name: "claim_next_batch", args: undefined }]);
});
test("exact claim supplies both UUIDs and preserves the full batch payload", async () => {
  const row = { id: id(2), workspace_id: id(1), status: "processing", meta: { isolated: true } };
  const f = fixture([row]); assert.deepEqual((await claimBufferBatch(f.db, scope)).data, [row]);
  assert.deepEqual(f.calls, [{ name: "claim_ai_channel_batch", args: { p_workspace_id: id(1), p_batch_id: id(2) } }]);
});
test("missing or not-due exact batch never falls back to global claim", async () => {
  const f = fixture(); assert.deepEqual((await claimBufferBatch(f.db, scope)).data, []);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].name, "claim_ai_channel_batch");
});
test("malformed or widened scopes do not invoke any RPC", async () => {
  const f = fixture();
  for (const value of [null, {}, { ...scope, batchId: "bad" }, { ...scope, all: true }]) {
    assert.equal((await claimBufferBatch(f.db, value)).error?.message, "AI_CLAIM_INPUT_INVALID");
  }
  assert.equal(f.calls.length, 0);
});
test("foreign, multiple or malformed rows fail closed without exposing raw DB errors", async () => {
  const row = { id: id(2), workspace_id: id(1), status: "processing" };
  for (const data of [[{ ...row, workspace_id: id(3) }], [{ ...row, id: id(3) }], [row, row], null, [{ ...row, status: "buffering" }]]) {
    const f = fixture(data); assert.equal((await claimBufferBatch(f.db, scope)).error?.message, "AI_CLAIM_UNAVAILABLE");
    assert.equal(f.calls.length, 1);
  }
  const f = fixture(); f.response.error = { message: "private credential" };
  assert.equal((await claimBufferBatch(f.db, scope)).error?.message, "AI_CLAIM_UNAVAILABLE");
});
