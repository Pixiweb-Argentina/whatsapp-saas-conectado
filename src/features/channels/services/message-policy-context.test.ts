import assert from "node:assert/strict";
import { test } from "node:test";
import { loadMessagePolicyContext } from "./message-policy-context.ts";
import { createMessagePipeline } from "./message-pipeline.ts";
import { resolveConnectionAdapter } from "./connection-adapter.ts";
import { evaluateSendPolicy } from "./send-policy.ts";
import { policyContextFixture, contextId, contextNow, verifiedAt } from "../testing/policy-context-fixture.ts";

const subject = (f: ReturnType<typeof policyContextFixture>) => ({ workspaceId: f.request.workspaceId,
  connectionId: f.request.connectionId, conversationId: f.request.conversationId, eventId: f.request.eventId,
  channel: f.request.request.channel, recipient: f.request.request.recipient });
async function decision(f: ReturnType<typeof policyContextFixture>) {
  const { conversationId: _id, ...context } = await loadMessagePolicyContext(f.db, subject(f), contextNow);
  return evaluateSendPolicy({ ...context, workspaceId: f.request.workspaceId,
    actor: f.request.actor, request: f.request.request, phase: "enqueue", now: contextNow });
}

test("server context binds evidence, identity and conversation and caps expiry to the grant", async () => {
  const f = policyContextFixture();
  const result = await decision(f);
  assert.equal(result.allowed, true);
  assert.equal(result.evidenceId, contextId(41));
  assert.equal(result.validUntil, "2026-10-10T13:00:00.000Z");
  assert(f.queries.every((q) => q.filters.some(([k, v]) => k === "workspace_id" && v === contextId(1))));
  assert(f.queries.every((q) => !q.columns.includes("credentials")));
});

test("unverified/backfilled identities cannot authorize the new pipeline, nor can a contact phone replace them", async () => {
  for (const patch of [{ verified_at: null }, { external_user_id: "+15555550999" },
    { verified_at: "2026-10-11T11:00:00Z" }, { contact_id: contextId(90) }]) {
    const f = policyContextFixture(); Object.assign(f.rows.contact_identities[0], patch);
    await assert.rejects(loadMessagePolicyContext(f.db, subject(f), contextNow),
      { message: "CHANNEL_POLICY_CONTEXT_UNAVAILABLE" });
  }
});

test("tenant, account, identity and conversation substitution fail closed", async () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["channel_connections", { workspace_id: contextId(2) }],
    ["channel_connections", { id: contextId(52) }],
    ["contact_identities", { connection_id: contextId(52) }],
    ["conversations", { identity_id: contextId(90) }],
    ["conversations", { contact_id: contextId(90) }],
    ["conversations", { channel: "instagram" }], ["contacts", { workspace_id: contextId(2) }],
  ];
  for (const [table, patch] of cases) {
    const f = policyContextFixture(); Object.assign(f.rows[table][0], patch);
    await assert.rejects(loadMessagePolicyContext(f.db, subject(f), contextNow));
    assert.equal(f.rpcCalls.length, 0);
  }
});

test("capability booleans, missing provenance, expired/future or foreign grants never authorize", async () => {
  for (const capabilities of [{ text: true }, {}, { version: 1, grants: [{ capability: "text" }] },
    { version: 1, grants: [{ ...policyContextFixture().grants[0], workspaceId: contextId(2) }] },
    { version: 1, grants: [{ ...policyContextFixture().grants[0], validUntil: verifiedAt }] },
    { version: 1, grants: [{ ...policyContextFixture().grants[0], verifiedAt: "2026-10-11T12:00:00Z" }] }]) {
    const f = policyContextFixture(); f.rows.channel_connections[0].capabilities = capabilities;
    assert.equal((await decision(f)).reasonCode, "unsupported_capability");
  }
});

test("a request must reference its persisted inbound, never the conversation timestamp or message text", async () => {
  const f = policyContextFixture(); f.request.eventId = null;
  assert.equal((await decision(f)).reasonCode, "missing_evidence");
  assert(!f.queries.some((query) => query.table === "inbound_events"));
  for (const patch of [{ historical: true }, { kind: "outbound_echo" }, { kind: "delivery_receipt" },
    { kind: "comment" }, { id: contextId(42) }]) {
    const item = policyContextFixture(); Object.assign(item.rows.inbound_events[0], patch);
    assert.equal((await decision(item)).reasonCode, "missing_evidence");
  }
});

test("event payload cannot swap account/provider/actor, lie about kind or extend a future window", async () => {
  for (const patch of [{ workspaceId: contextId(2) }, { connectionId: contextId(52) }, { provider: "kapso" },
    { kind: "outbound_echo" }, { occurredAt: "2026-10-11T12:00:00Z" }, { receivedAt: "2026-10-11T12:00:00Z" }]) {
    const f = policyContextFixture(); Object.assign(f.envelope, patch);
    await assert.rejects(decision(f));
  }
  const f = policyContextFixture(); f.envelope.externalActorId = "another-contact";
  assert.equal((await decision(f)).reasonCode, "missing_evidence");
});

test("late inbound deliveries do not restart the window at receive time", async () => {
  const f = policyContextFixture(); f.envelope.occurredAt = "2026-10-08T11:00:00Z";
  assert.equal((await decision(f)).reasonCode, "expired");
});

test("opt-outs come from both contact and workspace phone suppression; read errors stop enqueue", async () => {
  const f = policyContextFixture();
  f.rows.contact_opt_outs.push({ workspace_id: contextId(1), phone_key: "15555550101" });
  f.rows.contacts[0].phone = "+15555550999";
  assert.equal((await loadMessagePolicyContext(f.db, subject(f), contextNow)).optedOut, true);
  f.rows.contact_opt_outs = [];
  f.rows.contacts[0].opt_in = false;
  assert.equal((await loadMessagePolicyContext(f.db, subject(f), contextNow)).optedOut, true);
  f.rows.contacts[0].opt_in = true; f.errors.contact_opt_outs = { message: "private details", code: "42P01" };
  await assert.rejects(createMessagePipeline(f.db, () => contextNow).enqueue(f.request),
    { message: "CHANNEL_POLICY_CONTEXT_UNAVAILABLE" });
  assert.equal(f.rpcCalls.length, 0);
});

test("producer reloads policy before enqueue and preserves request/revision/operation binding", async () => {
  const f = policyContextFixture();
  assert.deepEqual(await createMessagePipeline(f.db, () => contextNow).enqueue(f.request),
    { queued: true, operationId: f.request.request.operationId });
  assert.equal(f.rpcCalls.length, 1);
  assert.equal(f.rpcCalls[0].args.p_expected_revision, 4);
  assert.equal(f.rpcCalls[0].args.p_event_id, contextId(41));
  assert.deepEqual(f.rpcCalls[0].args.p_request, f.request.request);
  f.rows.conversations[0].state_revision = 5;
  const rejected = await createMessagePipeline(f.db, () => contextNow).enqueue(f.request);
  assert.equal(rejected.queued, false);
  if (!rejected.queued) assert.equal(rejected.decision.reasonCode, "stale_revision");
  assert.equal(f.rpcCalls.length, 1);
});

test("producer cannot be enabled by body policy claims or an operator takeover", async () => {
  const f = policyContextFixture();
  await assert.rejects(createMessagePipeline(f.db).enqueue({ ...f.request, capabilities: { text: true } }));
  f.rows.conversations[0].state = "human_active";
  const result = await createMessagePipeline(f.db, () => contextNow).enqueue(f.request);
  assert.equal(result.queued, false);
  if (!result.queued) assert.equal(result.decision.reasonCode, "human_hold");
  assert.equal(f.rpcCalls.length, 0);
});

test("resolver binds exact provider/account/integration without substituting the active row", async () => {
  const f = policyContextFixture();
  const adapter = await resolveConnectionAdapter(f.db, contextId(1), contextId(51));
  assert.equal(adapter?.provider, "ycloud");
  assert.equal(adapter?.live, false, "placeholder must never be a live transport");
  for (const patch of [{ enabled: false }, { id: contextId(12) }, { provider: "kapso" },
    { config: { phone_number: "+15555550999" } }, { workspace_id: contextId(2) }]) {
    const item = policyContextFixture(); Object.assign(item.rows.integrations[0], patch);
    assert.equal(await resolveConnectionAdapter(item.db, contextId(1), contextId(51)), null);
  }
});

test("revocation prevents even decrypting credentials; transport errors are redacted", async () => {
  const f = policyContextFixture();
  f.rows.channel_connections[0].status = "revoked";
  f.rows.channel_connections[0].revoked_at = verifiedAt;
  assert.equal(await resolveConnectionAdapter(f.db, contextId(1), contextId(51)), null);
  assert(!f.queries.some((q) => q.table === "integrations"));
  f.rows.channel_connections[0].status = "ready"; f.rows.channel_connections[0].revoked_at = null;
  f.errors.integrations = { message: "private provider credentials" };
  await assert.rejects(resolveConnectionAdapter(f.db, contextId(1), contextId(51)),
    { message: "CHANNEL_ADAPTER_UNAVAILABLE" });
});
