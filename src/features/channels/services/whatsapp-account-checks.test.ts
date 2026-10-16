import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { configuredAccountCallback, validAccountCallback } from "../types/whatsapp-account-checks";

process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64"); process.env.ENCRYPTION_KEY_VERSION = "v1";
const { sealAccountCredentials } = await import("./account-credentials.ts");
const { verifyManagedAccount, readAccountVerification, readAccountPermissionReview, changeAccountTextPermission } = await import("./whatsapp-account-checks.ts");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const origin = "https://permissions.example.org", callbackUrl = configuredAccountCallback(id(1), id(51), origin)!;
const checkedAt = "2026-10-15T12:00:00Z";
const grant = { connectionId: id(51), operationId: id(701), action: "grant", acknowledgeTextPermission: true,
  connectionUpdatedAt: checkedAt, verificationCheckedAt: checkedAt };
async function fixture() {
  const source = { workspaceId: id(1), connectionId: id(51), provider: "ycloud", externalAccountId: "+15555550100",
    status: "needs_permissions", sourceRevision: "a".repeat(32), ...await sealAccountCredentials({ workspaceId: id(1), connectionId: id(51), provider: "ycloud" },
      { apiKey: "synthetic-check-api-key", signingSecret: "synthetic-check-secret" }) };
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [], reads: string[] = [];
  const review = { connectionId: id(51), connectionUpdatedAt: checkedAt, storedStatus: "needs_permissions", managed: false,
    current: false, validUntil: null, canGrant: false, canRevoke: false, verificationCheckedAt: null,
    blockers: ["delivery_proof_required"], callbackUrl };
  let verification: unknown = null, failName = "";
  const db = { rpc: async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args }); if (name === failName) return { data: null, error: { message: "private-check-details" } };
    if (name === "save_whatsapp_account_verification") verification = { input: args.p_input, report: args.p_report, current: true };
    return { data: name === "read_whatsapp_account_check_source" ? source : name === "read_whatsapp_account_verification" ? verification
      : name === "read_whatsapp_account_permission_review" ? review : true, error: null };
  } } as unknown as SupabaseClient;
  const fetcher: typeof fetch = async (url, init) => {
    const target = String(url); reads.push(target); assert.equal(new URL(target).origin, "https://api.ycloud.com");
    assert.equal(init?.method, "GET"); assert.equal(init?.redirect, "error");
    assert.equal(new Headers(init?.headers).get("X-API-Key"), "synthetic-check-api-key");
    return Response.json(target.includes("webhookEndpoints") ? { id: "endpoint-1", url: callbackUrl, status: "active",
      secret: "synthetic-check-secret", enabledEvents: ["whatsapp.inbound_message.received", "whatsapp.message.updated"] }
      : { items: [{ phoneNumber: source.externalAccountId, status: "CONNECTED" }], total: 1 });
  };
  return { source, db, calls, reads, fetcher, fail: (name: string) => { failName = name; } };
}
test("configured account callback is exact, stable and scoped; invalid origin never becomes a network target", () => {
  assert.ok(validAccountCallback(callbackUrl, id(1), id(51)));
  for (const url of [origin + "/path", "http://example.org", "https://x.trycloudflare.com", "https://127.0.0.1", origin + "#x", "https://user:pass@example.org"]) {
    assert.equal(configuredAccountCallback(id(1), id(51), url), null);
  }
  for (const url of [callbackUrl + "?wsid=" + id(1), callbackUrl + "#x", callbackUrl.replace(id(51), id(52))]) {
    assert.equal(validAccountCallback(url, id(1), id(51)), false);
  }
});
test("managed provider checks use only the account's key, current source revision and server destination", async () => {
  const f = await fixture(); const r = await verifyManagedAccount(f.db, id(1), id(101), id(51), { endpointId: "endpoint-1" }, origin, f.fetcher);
  assert.ok(r?.current); assert.ok(Object.values(r.report.checks).every(Boolean)); assert.equal(r.report.sendAuthorization, false);
  assert.equal(f.reads.length, 2); assert.equal(f.calls[0].name, "read_whatsapp_account_check_source");
  assert.equal(f.calls[0].args.p_actor, id(101)); assert.equal(f.calls[1].args.p_source_revision, f.source.sourceRevision);
  assert.deepEqual(f.calls[1].args.p_input, { endpointId: "endpoint-1", callbackUrl });
  assert.equal(JSON.stringify(r).includes("synthetic-check-secret"), false);
  assert.equal(JSON.stringify(f.calls[1]).includes("synthetic-check-api-key"), false);
});
test("missing stable origin and client-controlled callback reject before private source or provider access", async () => {
  const f = await fixture();
  await assert.rejects(verifyManagedAccount(f.db, id(1), id(101), id(51), { endpointId: "endpoint-1" }, "", f.fetcher), /ORIGIN_REQUIRED/);
  await assert.rejects(verifyManagedAccount(f.db, id(1), id(101), id(51), { endpointId: "endpoint-1", callbackUrl }, origin, f.fetcher));
  assert.equal(f.calls.length, 0); assert.equal(f.reads.length, 0);
});
test("stale or revoked actor/source cannot read credentials or save proof; errors are redacted", async () => {
  const f = await fixture(); f.fail("read_whatsapp_account_check_source");
  await assert.rejects(verifyManagedAccount(f.db, id(1), id(101), id(51), { endpointId: "endpoint-1" }, origin, f.fetcher), /ACCOUNT_SOURCE_UNAVAILABLE/);
  assert.equal(f.reads.length, 0);
  const g = await fixture(); g.fail("save_whatsapp_account_verification");
  await assert.rejects(verifyManagedAccount(g.db, id(1), id(101), id(51), { endpointId: "endpoint-1" }, origin, g.fetcher), /ACCOUNT_VERIFICATION_STALE/);
});
test("permission mutations pin route account and actor, derive callback and re-read after a replay", async () => {
  const f = await fixture(); const result = await changeAccountTextPermission(f.db, id(1), id(101), id(51), grant, origin);
  assert.equal(result.applied, true); assert.equal(result.review?.current, false); assert.equal(f.calls[0].args.p_callback, callbackUrl);
  assert.equal(f.calls[0].args.p_actor, id(101)); assert.equal(f.calls[0].args.p_connection, id(51));
  await assert.rejects(changeAccountTextPermission(f.db, id(1), id(101), id(52), grant, origin), /SCOPE_INVALID/);
});
test("read-only review may show missing callback; unavailable database is not a confirmed mutation", async () => {
  const f = await fixture(); await readAccountPermissionReview(f.db, id(1), id(101), id(51), ""); assert.equal(f.calls[0].args.p_callback, null);
  f.fail("change_whatsapp_account_text_permission");
  await assert.rejects(changeAccountTextPermission(f.db, id(1), id(101), id(51), grant, origin), /UNCONFIRMED/);
  const g = await fixture(); assert.equal(await readAccountVerification(g.db, id(1), id(101), id(51)), null);
});
