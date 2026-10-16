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
function called(...args: unknown[]) { calls.push(args); if (failed) throw new Error("private-trial-details"); return null; }
mock.module("@/features/channels/services/account-trial", { exports: { readAccountTrial: called, mutateAccountTrial: called } });
const route = await import("@/app/api/workspace/[id]/whatsapp-accounts/[connectionId]/trial/route");
const context = { params: Promise.resolve({ id: id(1), connectionId: id(51) }) };
const request = (body?: unknown) => new NextRequest("http://localhost/api/test", { method: body ? "POST" : "GET",
  ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
beforeEach(() => { role = "admin"; failed = false; created = 0; calls.length = 0; });
test("manager reads only; unauthorized and non-admin sends never construct service client", async () => {
  role = null; assert.equal((await route.GET(request(), context)).status, 403);
  role = "manager"; assert.equal((await route.POST(request({ action: "send", operationId: id(62), acknowledgeSend: true }), context)).status, 403);
  assert.equal(created, 0); assert.equal((await route.GET(request(), context)).status, 200);
});
test("server owns workspace and actor; no sender/body/callback injection reaches service", async () => {
  const body = { action: "send", operationId: id(62), acknowledgeSend: true };
  assert.equal((await route.POST(request({ ...body, callbackUrl: "https://evil.example" }), context)).status, 400);
  assert.equal(created, 0); assert.equal((await route.POST(request(body), context)).status, 200);
  assert.deepEqual(calls[0][1], { workspaceId: id(1), actorId: id(101), connectionId: id(51) });
});
test("errors remain uncertain/redacted and invalid UUID rejects before private access", async () => {
  failed = true; const response = await route.POST(request({ action: "send", operationId: id(62), acknowledgeSend: true }), context);
  assert.equal(response.status, 409); assert.equal((await response.text()).includes("private-trial-details"), false);
  const before = created;
  assert.equal((await route.GET(request(), { params: Promise.resolve({ id: "bad", connectionId: id(51) }) })).status, 400);
  assert.equal(created, before);
});
