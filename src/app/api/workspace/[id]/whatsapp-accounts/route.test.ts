import assert from "node:assert/strict";
import { test, mock, beforeEach } from "node:test";
import { NextRequest, NextResponse } from "next/server";

process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
process.env.ENCRYPTION_KEY_VERSION = "v1";
const workspace = "00000000-0000-4000-8000-000000000001", actor = "00000000-0000-4000-8000-000000000101";
const connection = "00000000-0000-4000-8000-000000000051";
let role: "admin" | "manager" | null = "admin";
let rpcError = false, corruptSummary = false;
const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
const row = { id: connection, provider: "ycloud", externalAccountId: "+15555550800", displayName: "Ventas",
  status: "needs_permissions", managed: true, credentialsStored: true, updatedAt: new Date().toISOString() };
mock.module("@/lib/auth/workspace-access", { exports: {
  requireWorkspaceMember: async (_id: string, options: { minRole: string }) =>
    role && (options.minRole === "manager" || role === "admin") ? { ok: true, userId: actor, role }
      : { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) },
  readJsonBody: async (request: NextRequest) => ({ ok: true, body: await request.json() }),
} });
mock.module("@supabase/supabase-js", { exports: { createClient: () => ({
  rpc: async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    if (rpcError) return { data: null, error: { message: "never serialize credential details", code: "40001" } };
    return { data: name === "read_whatsapp_accounts" ? [{ ...row, ...(corruptSummary ? { encryptedPayload: "private" } : {}) }]
      : name === "register_whatsapp_account" ? connection : true, error: null };
  },
}) } });
const { GET, POST, DELETE } = await import("./route.ts");
const { openAccountCredentials } = await import("@/features/channels/services/account-credentials");
const context = { params: Promise.resolve({ id: workspace }) };
const request = (method = "GET", body?: unknown) => new NextRequest(`http://localhost/api/workspace/${workspace}/whatsapp-accounts`,
  { method, ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}) });
const input = { connectionId: connection, provider: "ycloud", externalAccountId: row.externalAccountId,
  displayName: "Ventas", apiKey: "synthetic-api", signingSecret: "synthetic-secret" };
beforeEach(() => { role = "admin"; rpcError = false; corruptSummary = false; calls.length = 0; });

test("non-member and manager mutations never reach the service database", async () => {
  role = null; assert.equal((await GET(request(), context)).status, 403);
  role = "manager"; assert.equal((await POST(request("POST", input), context)).status, 403);
  assert.equal((await DELETE(request("DELETE", { connectionId: connection, updatedAt: row.updatedAt }), context)).status, 403);
  assert.equal(calls.length, 0);
});
test("manager reads metadata with no-store and no credentials", async () => {
  role = "manager"; const response = await GET(request(), context);
  assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { accounts: [row] });
  assert.equal(calls[0].args.p_actor, actor);
});
test("strict body cannot provide actor, grants or malformed account before encryption/RPC", async () => {
  for (const patch of [{ actorId: actor }, { capabilities: { grants: ["text"] } }, { externalAccountId: "national" }]) {
    assert.equal((await POST(request("POST", { ...input, ...patch }), context)).status, 400);
  }
  assert.equal(calls.length, 0);
});
test("valid create seals credentials for exact workspace/account/provider and returns only ID", async () => {
  const response = await POST(request("POST", input), context);
  assert.equal(response.status, 201); assert.deepEqual(await response.json(), { connectionId: connection });
  const rpc = calls[0]; assert.equal(rpc.name, "register_whatsapp_account"); assert.equal(rpc.args.p_actor, actor);
  assert.match(String(rpc.args.p_payload), /^enc:v1:/);
  assert.equal(JSON.stringify(rpc.args).includes(input.apiKey), false);
  assert.deepEqual(await openAccountCredentials({ workspaceId: workspace, connectionId: connection, provider: "ycloud" },
    String(rpc.args.p_payload)), { apiKey: input.apiKey, signingSecret: input.signingSecret });
});
test("revocation uses session actor and revision; stale/errors remain generic and do not retry", async () => {
  const body = { connectionId: connection, updatedAt: row.updatedAt };
  rpcError = true; const response = await DELETE(request("DELETE", body), context);
  assert.equal(response.status, 409); assert.equal((await response.text()).includes("credential details"), false);
  assert.equal(calls.length, 1); assert.equal(calls[0].args.p_expected_updated_at, row.updatedAt);
  assert.equal(calls[0].args.p_actor, actor);
});
test("a summary accidentally containing ciphertext is rejected rather than sent to the browser", async () => {
  corruptSummary = true; const response = await GET(request(), context);
  assert.equal(response.status, 503); assert.equal((await response.text()).includes("private"), false);
});
