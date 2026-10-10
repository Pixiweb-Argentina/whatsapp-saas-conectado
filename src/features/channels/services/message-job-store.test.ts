import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createMessageJobStore } from "./message-job-store.ts";
import { enqueueJobSchema } from "../types/message-job.ts";

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const enqueue = { workspaceId: id(1), connectionId: id(51), conversationId: id(31), eventId: null,
  idempotencyKey: "fixture", actor: "ai", expectedRevision: 0,
  request: { action: "text", channel: "whatsapp", recipient: "+15555550101", operationId: id(61), body: "fixture" } };
function fixture(data: unknown = id(61), error: unknown = null) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const db = { async rpc(name: string, args: Record<string, unknown>) {
    calls.push({ name, args }); return { data, error };
  } } as unknown as SupabaseClient;
  return { store: createMessageJobStore(db), calls };
}

test("durable requests require valid revision/UUID and an anchored comment without a conversation", () => {
  assert.equal(enqueueJobSchema.safeParse(enqueue).success, true);
  for (const value of [{ ...enqueue, expectedRevision: null },
    { ...enqueue, conversationId: null, expectedRevision: null },
    { ...enqueue, request: { ...enqueue.request, operationId: "not-uuid" } },
    { ...enqueue, request: { ...enqueue.request, token: "must-not-persist" } }]) {
    assert.equal(enqueueJobSchema.safeParse(value).success, false);
  }
});

test("enqueue binds the full scoped request to the RPC after validation", async () => {
  const f = fixture();
  assert.equal(await f.store.enqueue(enqueue), id(61));
  assert.deepEqual(f.calls, [{ name: "enqueue_channel_job", args: {
    p_workspace_id: id(1), p_connection_id: id(51), p_conversation_id: id(31), p_event_id: null,
    p_idempotency_key: "fixture", p_actor: "ai", p_expected_revision: 0, p_request: enqueue.request,
    p_sender_user_id: null,
  } }]);
  await assert.rejects(f.store.enqueue({ ...enqueue, actor: "admin" }));
  assert.equal(f.calls.length, 1);
});

test("storage failures are redacted and never converted into successful persistence", async () => {
  const f = fixture(null, { message: "secret remote details" });
  await assert.rejects(f.store.enqueue(enqueue), { message: "CHANNEL_QUEUE_STORAGE_FAILED" });
});

test("human jobs bind an operator ID; AI and automation cannot impersonate one", async () => {
  const f = fixture();
  await assert.rejects(f.store.enqueue({ ...enqueue, actor: "human" }));
  await assert.rejects(f.store.enqueue({ ...enqueue, senderUserId: id(101) }));
  await assert.rejects(f.store.enqueue({ ...enqueue, actor: "automation", senderUserId: id(101) }));
  assert.equal(f.calls.length, 0);
  assert.equal(await f.store.enqueue({ ...enqueue, actor: "human", senderUserId: id(101) }), id(61));
  assert.equal(f.calls[0].args.p_sender_user_id, id(101));
});

test("claim rejects an unscoped or malformed database row before a worker can consume it", async () => {
  const f = fixture([{ workspace_id: id(2), request: enqueue.request }]);
  await assert.rejects(f.store.claim(id(1), id(71)));
  await assert.rejects(f.store.claim("invalid", id(71)));
  assert.equal(f.calls.length, 1);
});

test("inbound payload rejects credentials and invalid envelopes before database persistence", async () => {
  const f = fixture();
  await assert.rejects(f.store.persistEvent({ access_token: "forbidden", kind: "message" }));
  assert.equal(f.calls.length, 0);
});
