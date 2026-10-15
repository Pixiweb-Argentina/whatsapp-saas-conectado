import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { materializeYCloudPipeline } from "./ycloud-pipeline.ts";
import { YCLOUD_TEXT } from "../testing/whatsapp-fixtures.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const keys = ["YCLOUD_PIPELINE_WORKSPACES", "YCLOUD_INBOX_ONLY_WORKSPACES", "YCLOUD_VERIFICATION_ONLY_WORKSPACES",
  "CHANNEL_INGRESS_WORKSPACES", "CHANNEL_WORKER_WORKSPACES", "CHANNEL_AI_WORKSPACES"];
afterEach(() => { for (const key of keys) delete process.env[key]; });
function fixture() {
  for (const key of keys) delete process.env[key];
  process.env.YCLOUD_PIPELINE_WORKSPACES = id(1);
  const now = Date.now();
  const input = { workspaceId: id(1), integrationId: id(2), provider: "ycloud" as const,
    configuredAccountId: "+15555550100", payload: { ...YCLOUD_TEXT, createTime: new Date(now - 1000).toISOString() } };
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const response: { data: unknown; error: unknown } = { data: {
    eventId: id(4), conversationId: id(5), messageId: id(6), inserted: true, batchId: null,
  }, error: null };
  const row = { id: id(3), workspace_id: id(1), legacy_integration_id: id(2), provider: "ycloud",
    channel: "whatsapp", status: "needs_permissions", revoked_at: null, external_account_id: "+15555550100" };
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: row, error: null }) };
  const db = { from: () => query, rpc: async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args }); return response;
  } } as unknown as SupabaseClient;
  return { db, input, now, calls, response };
}
function enable() { for (const key of keys.slice(3)) process.env[key] = id(1); }

test("pipeline mode accepts text without granting AI when any required rollout is absent or foreign", async () => {
  for (const missing of keys.slice(3)) {
    const f = fixture(); enable(); process.env[missing] = id(9);
    assert.equal((await materializeYCloudPipeline(f.db, f.input, undefined, f.now))?.batchId, null);
    assert.equal(f.calls[0].name, "materialize_ycloud_pipeline");
    assert.equal(f.calls[0].args.p_queue_ai, false);
  }
});
test("all three flags only request DB eligibility and preserve the normalized scope", async () => {
  const f = fixture(); enable();
  await materializeYCloudPipeline(f.db, f.input, "10", f.now);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].args.p_queue_ai, true); assert.equal(f.calls[0].args.p_silence_ms, 10000);
  const event = f.calls[0].args.p_event as Record<string, unknown>;
  assert.equal(event.workspaceId, id(1)); assert.equal(event.connectionId, id(3));
  assert.equal(f.calls[0].args.p_workspace, id(1)); assert.equal(f.calls[0].args.p_integration, id(2));
});
test("buffer duration is bounded and malformed values use the conservative default", async () => {
  const f = fixture();
  for (const [value, expected] of [[3, 3000], [3.5, 3500], [1000, 120000], ["bad", 30000],
    [null, 30000], [2, 30000], [Infinity, 30000], [true, 30000]] as const) {
    await materializeYCloudPipeline(f.db, f.input, value, f.now);
    assert.equal(f.calls.at(-1)?.args.p_silence_ms, expected);
  }
});
test("disabled/conflicting modes and malformed flags fail before storage mutation", async () => {
  const f = fixture(); delete process.env.YCLOUD_PIPELINE_WORKSPACES;
  await assert.rejects(materializeYCloudPipeline(f.db, f.input), { message: "YCLOUD_PIPELINE_DISABLED" });
  process.env.YCLOUD_PIPELINE_WORKSPACES = id(1); enable();
  for (const raw of ["*", `${id(1)},bad`, [1, 2, 3, 4].map(id).join(",")]) {
    process.env.CHANNEL_AI_WORKSPACES = raw;
    await assert.rejects(materializeYCloudPipeline(f.db, f.input), { message: "CHANNEL_ROLLOUT_INVALID" });
  }
  assert.equal(f.calls.length, 0);
});
test("unsupported messages never reach the pipeline RPC", async () => {
  const f = fixture();
  const payload = { ...f.input.payload, whatsappInboundMessage: {
    ...YCLOUD_TEXT.whatsappInboundMessage, type: "image", image: { link: "https://example.invalid/image" },
  } };
  assert.equal(await materializeYCloudPipeline(f.db, { ...f.input, payload }), null);
  assert.equal(f.calls.length, 0);
});
test("raw database errors and malformed results are redacted", async () => {
  const f = fixture(); f.response.error = { message: "private credential" };
  await assert.rejects(materializeYCloudPipeline(f.db, f.input), { message: "YCLOUD_PIPELINE_STORAGE_FAILED" });
  f.response.error = null; f.response.data = { inserted: true, batchId: "invented" };
  await assert.rejects(materializeYCloudPipeline(f.db, f.input), { message: "YCLOUD_PIPELINE_STORAGE_FAILED" });
});
