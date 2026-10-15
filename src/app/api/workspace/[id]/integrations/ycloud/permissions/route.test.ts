import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { NextRequest, NextResponse } from "next/server";
const ws = "00000000-0000-4000-8000-000000000001";
let role: string | null = "admin"; let fail = false; let calls: unknown[] = [];
mock.module("@/lib/auth/workspace-access.ts", { exports: {
  requireWorkspaceMember: async (_id: string, options: { minRole: string }) => role === "admin" || role === options.minRole
    ? { ok: true, userId: "server-actor", role } : { ok: false, response: NextResponse.json({}, { status: role ? 403 : 401 }) },
  readJsonBody: async (req: NextRequest) => ({ ok: true, body: await req.json() as unknown }),
} });
mock.module("@supabase/supabase-js", { exports: { createClient: () => ({ marker: "service-only" }) } });
mock.module("@/features/channels/services/ycloud-permissions.ts", { exports: {
  readYCloudPermissionReview: async (...args: unknown[]) => { calls.push(args); if (fail) throw new Error("raw-secret"); return null; },
  changeYCloudTextPermission: async (...args: unknown[]) => { calls.push(args); if (fail) throw new Error("raw-secret"); return { applied: true, review: null }; },
} });
const { GET, POST } = await import("./route.ts");
const ctx = { params: Promise.resolve({ id: ws }) };
const body = { action: "grant", connectionId: ws, operationId: ws, connectionUpdatedAt: "2026-10-15T12:00:00Z",
  verificationCheckedAt: "2026-10-15T12:00:00Z", acknowledgeTextPermission: true };
const request = (value: unknown = body) => new NextRequest("http://localhost/permissions", { method: "POST", body: JSON.stringify(value) });
function reset() { role = "admin"; calls = []; fail = false; }

test("anonymous/viewer/agent/manager cannot authorize, while manager may inspect the review", async () => {
  for (const denied of [null, "viewer", "agent", "manager"]) {
    reset(); role = denied; assert.equal((await POST(request(), ctx)).status, denied ? 403 : 401); assert.equal(calls.length, 0);
  }
  reset(); role = "manager"; assert.equal((await GET(request(), ctx)).status, 200); assert.equal(calls.length, 1);
});
test("invalid scope, absent acknowledgement and client-supplied public origins fail before service access", async () => {
  reset(); assert.equal((await POST(request(), { params: Promise.resolve({ id: "bad" }) })).status, 400);
  for (const value of [{ ...body, acknowledgeTextPermission: false }, { ...body, publicOrigin: "https://evil.invalid" }, { ...body, actorId: ws }, null]) {
    assert.equal((await POST(request(value), ctx)).status, 400);
  }
  assert.equal(calls.length, 0);
});
test("service mutations use the authenticated actor and response errors stay sanitized and uncached", async () => {
  reset(); let res = await POST(request(), ctx); assert.equal(res.status, 200); assert.equal(res.headers.get("Cache-Control"), "no-store");
  assert.deepEqual((calls[0] as unknown[]).slice(1), [ws, "server-actor", body]);
  fail = true; res = await POST(request(), ctx); assert.equal(res.status, 409); assert.equal(JSON.stringify(await res.json()).includes("raw-secret"), false);
  res = await GET(request(), ctx); assert.equal(res.status, 503);
});
