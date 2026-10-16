import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";
import { NextRequest, NextResponse } from "next/server";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let role: "admin" | "manager" | null = "admin", created = 0, failed = false;
const calls: unknown[][] = [];
mock.module("@supabase/supabase-js", { exports: { createClient: () => { created++; return {}; } } });
mock.module("@/lib/auth/workspace-access", { exports: {
  requireWorkspaceMember: async (_id: string, opts: { minRole: string }) => role && (opts.minRole === "manager" || role === "admin")
    ? { ok: true, userId: id(101), role } : { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) },
  readJsonBody: async (r: NextRequest) => ({ ok: true, body: await r.json() }),
} });
function called(...args: unknown[]) { calls.push(args); if (failed) throw new Error("private-route-details"); return null; }
mock.module("@/features/channels/services/whatsapp-account-checks", { exports: {
  readAccountVerification: called, verifyManagedAccount: called, readAccountPermissionReview: called,
  changeAccountTextPermission: (...args: unknown[]) => { called(...args); return { applied: false, review: null }; },
} });
const verification = await import("@/app/api/workspace/[id]/whatsapp-accounts/[connectionId]/verification/route");
const permission = await import("@/app/api/workspace/[id]/whatsapp-accounts/[connectionId]/permissions/route");
const context = { params: Promise.resolve({ id: id(1), connectionId: id(51) }) };
const request = (body?: unknown) => new NextRequest("http://localhost/api/test", { method: body ? "POST" : "GET",
  ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
const grant = { connectionId: id(51), operationId: id(701), action: "grant", acknowledgeTextPermission: true,
  connectionUpdatedAt: "2026-10-15T12:00:00Z", verificationCheckedAt: "2026-10-15T12:00:00Z" };
beforeEach(() => { role = "admin"; failed = false; created = 0; calls.length = 0; });
test("non-members and manager mutations cannot construct the service client", async () => {
  role = null; assert.equal((await verification.GET(request(), context)).status, 403);
  role = "manager"; assert.equal((await verification.POST(request({ endpointId: "endpoint-1" }), context)).status, 403);
  assert.equal((await permission.POST(request(grant), context)).status, 403); assert.equal(created, 0);
});
test("manager can read only safe verification and review, with no-store", async () => {
  role = "manager";
  for (const route of [verification, permission]) {
    const r = await route.GET(request(), context); assert.equal(r.status, 200); assert.equal(r.headers.get("Cache-Control"), "no-store");
    assert.equal(calls.at(-1)?.[1], id(1)); assert.equal(calls.at(-1)?.[2], id(101)); assert.equal(calls.at(-1)?.[3], id(51));
  }
});
test("request cannot substitute a callback, extra permission fields or a foreign route account", async () => {
  assert.equal((await verification.POST(request({ endpointId: "endpoint-1", callbackUrl: "https://evil.invalid" }), context)).status, 400);
  assert.equal((await permission.POST(request({ ...grant, connectionId: id(52) }), context)).status, 400);
  assert.equal((await permission.POST(request({ ...grant, capabilities: { text: true } }), context)).status, 400);
  assert.equal(created, 0); assert.equal(calls.length, 0);
});
test("admin operations use the session actor and report uncertainty without leaking provider details", async () => {
  assert.equal((await verification.POST(request({ endpointId: "endpoint-1" }), context)).status, 200);
  assert.equal((await permission.POST(request(grant), context)).status, 200);
  failed = true;
  for (const response of [await verification.POST(request({ endpointId: "endpoint-1" }), context), await permission.POST(request(grant), context)]) {
    assert.equal(response.status, 409); assert.equal((await response.text()).includes("private-route-details"), false);
  }
});
test("invalid UUID rejects before membership, private source or provider access", async () => {
  const ctx = { params: Promise.resolve({ id: "bad", connectionId: id(51) }) };
  assert.equal((await verification.GET(request(), ctx)).status, 400); assert.equal((await permission.POST(request(grant), ctx)).status, 400);
  assert.equal(created, 0);
});
