import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test, mock, beforeEach } from "node:test";
import { NextRequest } from "next/server";
import { YCLOUD_TEXT } from "@/features/channels/testing/whatsapp-fixtures";

process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.ENCRYPTION_KEY_VERSION = "v1";
const workspaceId = "00000000-0000-4000-8000-000000000001", connectionId = "00000000-0000-4000-8000-000000000051";
const secret = "synthetic-route-secret", context = { params: Promise.resolve({ workspaceId, connectionId }) };
let created = 0, writes = 0, failed = false;
let source: unknown;
mock.module("@supabase/supabase-js", { exports: { createClient: () => {
  created++;
  return { rpc: async (name: string) => {
    if (name !== "read_whatsapp_account_source") writes++;
    return { data: name === "read_whatsapp_account_source" ? source : name === "materialize_whatsapp_account_inbound"
      ? { eventId: connectionId, conversationId: workspaceId, messageId: connectionId, inserted: true } : connectionId,
      error: failed ? { message: "private-route-sentinel" } : null };
  }, from: () => {
    const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { structured: { default_country_code: "1" } }, error: null }) };
    return q;
  } };
} } });
const { sealAccountCredentials } = await import("@/features/channels/services/account-credentials");
const { POST } = await import("./route.ts");
function request(raw = JSON.stringify(YCLOUD_TEXT), sign = true) {
  const t = Math.floor(Date.now() / 1000), headers = new Headers();
  if (sign) headers.set("YCloud-Signature", `t=${t},s=${createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex")}`);
  return new NextRequest(`http://localhost/api/webhooks/whatsapp-accounts/${workspaceId}/${connectionId}`, { method: "POST", headers, body: raw });
}
beforeEach(async () => {
  created = 0; writes = 0; failed = false;
  delete process.env.CHANNEL_ACCOUNT_INBOX_CONNECTIONS;
  process.env.CHANNEL_ACCOUNT_INGRESS_CONNECTIONS = connectionId;
  source = { workspaceId, connectionId, provider: "ycloud", externalAccountId: "+15555550100", status: "needs_permissions",
    sourceRevision: "b".repeat(32), ...await sealAccountCredentials({ workspaceId, connectionId, provider: "ycloud" },
      { apiKey: "synthetic-api", signingSecret: secret }) };
});

test("disabled or malformed account scopes stop before service access", async () => {
  delete process.env.CHANNEL_ACCOUNT_INGRESS_CONNECTIONS;
  assert.equal((await POST(request(), context)).status, 503);
  process.env.CHANNEL_ACCOUNT_INGRESS_CONNECTIONS = connectionId;
  assert.equal((await POST(request(), { params: Promise.resolve({ workspaceId: "bad", connectionId }) })).status, 400);
  assert.equal(created, 0); assert.equal(writes, 0);
});
test("valid signed delivery returns only the shadow acknowledgement, no source or credentials", async () => {
  const response = await POST(request(), context);
  assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { received: true, shadowOnly: true, recorded: true }); assert.equal(writes, 1);
});
test("explicit receive-only inbox acknowledges materialization without exposing IDs or enabling sends", async () => {
  process.env.CHANNEL_ACCOUNT_INBOX_CONNECTIONS = connectionId;
  const response = await POST(request(), context);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { received: true, shadowOnly: false, recorded: true, inboxOnly: true, materialized: true });
  assert.equal(writes, 1);
});
test("invalid signature, signed bad JSON and unknown source are rejected without writes", async () => {
  assert.equal((await POST(request(undefined, false), context)).status, 401);
  assert.equal((await POST(request("{"), context)).status, 400);
  source = null; assert.equal((await POST(request(), context)).status, 401); assert.equal(writes, 0);
});
test("database failures are retryable, redacted and never acknowledged", async () => {
  failed = true; const response = await POST(request(), context);
  assert.equal(response.status, 503); assert.equal((await response.text()).includes("private-route-sentinel"), false);
});
test("body limit measures streamed bytes and rejects before credentials are read", async () => {
  const response = await POST(request("é".repeat(524289)), context);
  assert.equal(response.status, 413); assert.equal(created, 0); assert.equal(writes, 0);
});
