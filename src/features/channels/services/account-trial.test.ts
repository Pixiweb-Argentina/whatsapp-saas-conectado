import assert from "node:assert/strict";
import { test, afterEach } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ACCOUNT_TRIAL_BODY, accountTrialMutationSchema, accountTrialEnabled } from "../types/account-trial";
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64"); process.env.ENCRYPTION_KEY_VERSION = "v1";
const { sealAccountCredentials } = await import("./account-credentials.ts");
const { sendAccountTrial, mutateAccountTrial } = await import("./account-trial.ts");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { workspaceId: id(1), actorId: id(101), connectionId: id(51) }, origin = "https://permissions.example.org";
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; delete process.env.CHANNEL_ACCOUNT_TRIAL_CONNECTIONS; });
async function fixture(provider: "ycloud" | "kapso" = "ycloud", permit = "permitted") {
  const source = { ...scopeWithProvider(provider), externalAccountId: provider === "ycloud" ? "+15555550700" : "155555507000001",
    status: "needs_permissions", sourceRevision: "a".repeat(32),
    ...await sealAccountCredentials(scopeWithProvider(provider), { apiKey: "synthetic-trial-key", signingSecret: "synthetic-trial-secret" }) };
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [], posts: unknown[] = [];
  let claimed = false, result: unknown = null;
  const job = { operation_id: id(62), workspace_id: id(1), connection_id: id(51), conversation_id: id(31), event_id: id(92),
    actor: "human", expected_state_revision: 0, state: "leased", attempts: 1, fence: 1, lease_owner: id(71),
    lease_until: new Date(Date.now() + 90000).toISOString(), request: { operationId: id(62), channel: "whatsapp", action: "text",
      recipient: "+15555550101", body: ACCOUNT_TRIAL_BODY } };
  const db = { rpc: async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    if (name === "read_whatsapp_account_check_source") return { data: source, error: null };
    if (name === "claim_whatsapp_account_trial") {
      const data = claimed ? null : { job, validUntil: new Date(Date.now() + 60000).toISOString() }; claimed = true;
      return { data, error: null };
    }
    if (name === "begin_channel_send_status") return { data: permit, error: null };
    if (name === "finish_channel_send") result = args.p_result;
    return { data: name === "reconcile_channel_receipts" ? 0 : true, error: null };
  } } as unknown as SupabaseClient;
  globalThis.fetch = async (url, init) => {
    assert.equal(init?.method, "POST"); assert.equal(new Headers(init?.headers).get("X-API-Key"), "synthetic-trial-key");
    assert.equal(new URL(String(url)).hostname, provider === "ycloud" ? "api.ycloud.com" : "api.kapso.ai");
    const body = JSON.parse(String(init?.body)); assert.equal(body.text.body, ACCOUNT_TRIAL_BODY); posts.push(body);
    if (provider === "ycloud") { assert.equal(body.from, source.externalAccountId); return Response.json({ id: "synthetic-id", wamid: "wamid.trial" }); }
    assert.ok(String(url).includes(source.externalAccountId)); return Response.json({ messages: [{ id: "wamid.trial" }] });
  };
  process.env.CHANNEL_ACCOUNT_TRIAL_CONNECTIONS = id(51);
  return { db, calls, posts, job, source, result: () => result };
}
function scopeWithProvider(provider: "ycloud" | "kapso") { return { workspaceId: id(1), connectionId: id(51), provider }; }

test("trial requests require explicit one-message consent and reject body, callback, sender or expiry injection", () => {
  const valid = { action: "authorize", operationId: id(62), conversationId: id(31), recipient: "+15555550101",
    connectionUpdatedAt: "2026-10-16T10:00:00Z", verificationCheckedAt: "2026-10-16T10:00:00Z", acknowledgeOneMessage: true };
  assert.equal(accountTrialMutationSchema.safeParse(valid).success, true);
  for (const input of [{ ...valid, acknowledgeOneMessage: false }, { ...valid, body: "campaign" }, { ...valid, callbackUrl: origin },
    { ...valid, actorId: id(102) }, { ...valid, validUntil: "2099-01-01T00:00:00Z" }, { action: "send", operationId: id(62) }]) {
    assert.equal(accountTrialMutationSchema.safeParse(input).success, false);
  }
  assert.equal(accountTrialEnabled(id(51), ""), false); assert.equal(accountTrialEnabled(id(51), "*"), false);
  assert.equal(accountTrialEnabled(id(51), id(52)), false); assert.equal(accountTrialEnabled(id(51), id(51)), true);
});
for (const provider of ["ycloud", "kapso"] as const) test(`${provider} trial claims exact operation then permits one intercepted POST with its own credentials`, async () => {
  const f = await fixture(provider);
  assert.deepEqual(await sendAccountTrial(f.db, scope, id(62), origin), { status: "accepted" });
  assert.deepEqual(await sendAccountTrial(f.db, scope, id(62), origin), { status: "not_claimed" });
  assert.equal(f.posts.length, 1);
  const claim = f.calls.find((call) => call.name === "claim_whatsapp_account_trial")!;
  assert.equal(claim.args.p_operation, id(62)); assert.equal(claim.args.p_actor, id(101));
  assert.equal(claim.args.p_source_revision, f.source.sourceRevision);
  assert.equal(f.calls.some((call) => ["claim_channel_job", "recover_channel_jobs", "change_whatsapp_account_text_permission"].includes(call.name)), false);
});
test("disabled account or missing stable origin rejects before private source, claim or provider access", async () => {
  const f = await fixture(); delete process.env.CHANNEL_ACCOUNT_TRIAL_CONNECTIONS;
  await assert.rejects(sendAccountTrial(f.db, scope, id(62), origin), /DISABLED/);
  process.env.CHANNEL_ACCOUNT_TRIAL_CONNECTIONS = id(51);
  await assert.rejects(sendAccountTrial(f.db, scope, id(62), ""), /DISABLED/);
  assert.equal(f.calls.length, 0); assert.equal(f.posts.length, 0);
});
for (const permit of ["lost_lease", "deferred"]) test(`final SQL ${permit} never reaches transport`, async () => {
  const f = await fixture("ycloud", permit);
  assert.deepEqual(await sendAccountTrial(f.db, scope, id(62), origin), { status: permit === "deferred" ? "deferred" : "not_permitted" });
  assert.equal(f.posts.length, 0); assert.equal(f.calls.some((call) => call.name === "finish_channel_send"), false);
});
test("transport uncertainty is persisted as unknown and repeated request never posts again", async () => {
  const f = await fixture(); let posts = 0; globalThis.fetch = async () => { posts++; throw new Error("private-provider-failure"); };
  assert.deepEqual(await sendAccountTrial(f.db, scope, id(62), origin), { status: "unknown" });
  assert.deepEqual(f.result(), { status: "unknown", operationId: id(62) });
  await sendAccountTrial(f.db, scope, id(62), origin); assert.equal(posts, 1);
});
test("revoke remains available with trial rollout disabled and cannot trigger a provider call", async () => {
  const f = await fixture(); delete process.env.CHANNEL_ACCOUNT_TRIAL_CONNECTIONS;
  assert.deepEqual(await mutateAccountTrial(f.db, scope, { action: "revoke", operationId: id(62) }, ""), { revoked: true });
  assert.deepEqual(f.calls.map((call) => call.name), ["revoke_whatsapp_account_trial"]); assert.equal(f.posts.length, 0);
});
