import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { NextRequest, NextResponse } from "next/server";

const ws = "00000000-0000-4000-8000-000000000001";
const user = "00000000-0000-4000-8000-000000000101";
const input = { endpointId: "endpoint-1", callbackUrl: `https://app.example.org/api/webhooks/ycloud?wsid=${ws}` };
const report = { version: 1, checkedAt: new Date().toISOString(), checks: { api_access: true, connected_number: true,
  webhook_active: true, webhook_url: true, webhook_events: true, webhook_secret: true },
  destination: "https_unconfirmed", providerRead: "complete", sendAuthorization: false };
const record = { input, report, current: true };
let role: string | null = "admin"; let reads = 0; let providerCalls = 0;
let row: unknown; let readData: unknown; let rpcError: unknown; let sourceError: unknown;
const calls: { fn: string; args: Record<string, unknown> }[] = [];
const filters: unknown[] = [];
const chain = {
  eq: (key: string, value: unknown) => { filters.push([key, value]); return chain; },
  single: async () => { reads++; return { data: row, error: sourceError }; },
};
mock.module("@/lib/auth/workspace-access.ts", { exports: {
  requireWorkspaceMember: async (id: string, options: { minRole: string }) => {
    assert.equal(id, ws);
    if (role === "admin" || (role === "manager" && options.minRole === "manager")) return { ok: true, userId: user, role };
    return { ok: false, response: NextResponse.json({ error: "denied" }, { status: role ? 403 : 401 }) };
  },
  readJsonBody: async (req: NextRequest) => {
    try { return { ok: true, body: await req.json() as unknown }; }
    catch { return { ok: false, response: NextResponse.json({ error: "invalid" }, { status: 400 }) }; }
  },
} });
mock.module("@supabase/supabase-js", { exports: { createClient: () => ({
  from: (table: string) => { assert.equal(table, "integrations"); return { select: () => chain }; },
  rpc: async (fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); return { data: readData, error: rpcError }; },
}) } });
mock.module("@/shared/lib/integration-secrets.ts", { exports: {
  decryptCredentials: async () => ({ ycloud_api_key: "secret-key", webhook_signing_secret: "secret-signing" }),
} });
mock.module("@/features/channels/services/ycloud-verification.ts", { exports: {
  verifyYCloudAccount: async (options: Record<string, unknown>) => {
    providerCalls++; assert.equal(options.workspaceId, ws); assert.equal(options.apiKey, "secret-key"); return report;
  },
} });
const { GET, POST } = await import("./route.ts");
const context = { params: Promise.resolve({ id: ws }) };
const request = (body: unknown = input) => new NextRequest(`http://localhost/api/workspace/${ws}/integrations/ycloud/verification`,
  { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
function reset() {
  role = "admin"; reads = 0; providerCalls = 0; calls.length = 0; filters.length = 0; rpcError = null; sourceError = null;
  row = { id: "00000000-0000-4000-8000-000000000011", workspace_id: ws, provider: "ycloud", enabled: true,
    config: { phone_number: "+15555550101" }, credentials: { encrypted: "private-ciphertext" } };
  readData = record;
}

test("only an active admin may perform provider reads and persist a check; managers may read evidence", async () => {
  for (const denied of [null, "viewer", "agent", "manager"]) {
    reset(); role = denied; assert.equal((await POST(request(), context)).status, denied ? 403 : 401);
    assert.equal(reads, 0); assert.equal(providerCalls, 0); assert.equal(calls.length, 0);
  }
  reset(); role = "manager"; const res = await GET(request(), context);
  assert.equal(res.status, 200); assert.equal(res.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(calls, [{ fn: "read_ycloud_verification", args: { p_workspace: ws, p_actor: user } }]);
});

test("invalid IDs, foreign callback or extra client assertions cannot trigger provider verification", async () => {
  reset(); assert.equal((await POST(request(), { params: Promise.resolve({ id: "bad" }) })).status, 400);
  for (const value of [{ ...input, callbackUrl: input.callbackUrl.replace(ws, user) }, { ...input, grant: "text" },
    { ...input, endpointId: "../balance" }, null]) {
    assert.equal((await POST(request(value), context)).status, 400);
  }
  assert.equal(providerCalls, 0); assert.equal(reads, 0);
});

test("the saved integration alone supplies credentials and exact workspace source; browser sees only the report", async () => {
  reset(); const res = await POST(request(), context); const json = await res.json() as unknown;
  assert.equal(res.status, 200); assert.deepEqual(json, { verification: record });
  assert.deepEqual(filters, [["workspace_id", ws], ["provider", "ycloud"]]);
  assert.equal(providerCalls, 1); assert.equal(calls.length, 1);
  assert.equal(calls[0].fn, "save_ycloud_verification"); assert.deepEqual(calls[0].args.p_source, row);
  assert.equal(JSON.stringify(json).includes("secret"), true); // Only the safe check name webhook_secret.
  for (const value of ["secret-key", "secret-signing", "private-ciphertext", "+15555550101"]) assert.equal(JSON.stringify(json).includes(value), false);
});

test("disabled/missing/foreign configuration, DB failure and races never return successful evidence", async () => {
  for (const value of [null, { enabled: false }, { workspace_id: user }]) {
    reset(); row = value; assert.equal((await POST(request(), context)).status, 409); assert.equal(providerCalls, 0);
  }
  reset(); rpcError = { message: "raw-secret" }; let res = await POST(request(), context);
  assert.equal(res.status, 409); assert.equal(JSON.stringify(await res.json()).includes("raw-secret"), false);
  reset(); readData = { ...record, privateKey: "secret-key" }; res = await GET(request(), context);
  assert.equal(res.status, 503); assert.equal(JSON.stringify(await res.json()).includes("secret-key"), false);
  reset(); readData = null; assert.deepEqual(await (await GET(request(), context)).json(), { verification: null });
});
