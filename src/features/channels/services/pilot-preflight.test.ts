import assert from "node:assert/strict";
import { test } from "node:test";
import { readPilotPreflight } from "./pilot-preflight.ts";
import { policyContextFixture, contextId, contextNow } from "../testing/policy-context-fixture.ts";

const run = (f: ReturnType<typeof policyContextFixture>, env: Record<string, string | undefined> = {}) =>
  readPilotPreflight(f.db, contextId(1), env, contextNow);

test("preflight samples the existing policy and reports placeholders without granting external readiness", async () => {
  const f = policyContextFixture();
  const report = await run(f);
  assert.equal(report.coverage, "complete"); assert.equal(report.externalValidation, "pending");
  assert.equal(report.sideEffects, false);
  assert.deepEqual(report.rollout, { ingress: false, worker: false, human: false, ai: false });
  assert.equal(report.connections[0].storedTextGrantCurrent, true);
  assert.deepEqual(report.connections[0].sampledPolicies, ["allowed"]);
  assert.deepEqual(report.connections[0].blockers, ["transport_unavailable"]);
  assert.equal(f.rpcCalls.length, 0, "No enqueue, begin, recover or drain RPC");
  assert(f.queries.every((q) => q.filters.some(([key, value]) => key === "workspace_id" && value === contextId(1))));
});

test("report never contains account IDs, recipients, messages, capabilities or credentials", async (t) => {
  const f = policyContextFixture();
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => { requests++; throw new Error("PREFLIGHT_MUST_NOT_CALL_PROVIDER"); });
  f.rows.integrations[0].credentials = { ycloud_api_key: "private-test-key-sentinel" };
  const report = await run(f), text = JSON.stringify(report);
  assert.equal(report.connections[0].configuredTransport, true);
  for (const secret of ["private-test-key-sentinel", "+15555550101", "+15555550100", "Mensaje sintético", "fixture-verification"]) {
    assert(!text.includes(secret));
  }
  assert.equal(report.externalValidation, "pending", "Credentials never prove remote grants/delivery");
  assert.equal(requests, 0);
});

test("unfinished laboratory accounts expose the actual configuration gaps", async () => {
  const f = policyContextFixture(); f.rows.channel_connections[0].status = "connecting";
  f.rows.channel_connections[0].capabilities = {}; f.rows.contact_identities[0].verified_at = null;
  f.rows.inbound_events = [];
  const row = (await run(f)).connections[0];
  assert.deepEqual(row.blockers, ["connection_not_ready", "grant_missing", "identity_unverified", "transport_unavailable", "inbound_policy_unavailable"]);
  assert.equal(row.verifiedIdentities, 0); assert.equal(row.configuredTransport, false);
  assert(!f.queries.some((q) => q.table === "integrations"), "No credential access for an unfinished connection");
});

test("expired inbound and opt-out remain blockers despite current account grants", async () => {
  const f = policyContextFixture(); f.envelope.occurredAt = "2026-10-08T11:00:00Z";
  assert.deepEqual((await run(f)).connections[0].sampledPolicies, ["expired"]);
  f.envelope.occurredAt = "2026-10-10T11:00:00Z"; f.rows.contacts[0].opt_in = false;
  assert.deepEqual((await run(f)).connections[0].sampledPolicies, ["opted_out"]);
  f.rows.contacts[0].opt_in = null;
  assert.deepEqual((await run(f)).connections[0].sampledPolicies, ["opt_in_required"]);
  assert.equal(f.rpcCalls.length, 0);
});

test("foreign or expired grants and future identity verification cannot satisfy checks", async () => {
  for (const patch of [{ workspaceId: contextId(2) }, { validUntil: "2026-10-10T11:00:00Z" },
    { verifiedAt: "2026-10-11T11:00:00Z" }]) {
    const f = policyContextFixture(); Object.assign(f.grants[0], patch);
    assert.equal((await run(f)).connections[0].storedTextGrantCurrent, false);
  }
  const f = policyContextFixture(); f.rows.contact_identities[0].verified_at = "2026-10-11T11:00:00Z";
  assert.equal((await run(f)).connections[0].verifiedIdentities, 0);
});

test("database failures are redacted, and unavailable per-account context fails closed", async () => {
  const f = policyContextFixture(); f.errors.channel_connections = { message: "private-database-sentinel" };
  await assert.rejects(run(f), { message: "CHANNEL_PREFLIGHT_UNAVAILABLE" });
  const g = policyContextFixture(); g.errors.integrations = { message: "private-database-sentinel" };
  assert((await run(g)).connections[0].blockers.includes("context_unavailable"));
  assert.equal(g.rpcCalls.length, 0);
});

test("explicit rollout is displayed but never changed; invalid lists stop inspection", async () => {
  const f = policyContextFixture();
  const report = await run(f, { CHANNEL_INGRESS_WORKSPACES: contextId(1), CHANNEL_WORKER_WORKSPACES: contextId(2) });
  assert.equal(report.rollout.ingress, true); assert.equal(report.rollout.worker, false);
  await assert.rejects(run(f, { CHANNEL_WORKER_WORKSPACES: "*" }), { message: "CHANNEL_ROLLOUT_INVALID" });
  assert.equal(f.rpcCalls.length, 0);
});

test("bounded sampling is visibly partial instead of certifying all conversations", async () => {
  const f = policyContextFixture();
  f.rows.conversations = Array.from({ length: 11 }, (_, n) => ({ ...f.rows.conversations[0], id: contextId(200 + n) }));
  assert.equal((await run(f)).coverage, "partial");
  f.rows.conversations = [];
  f.rows.inbound_events = Array.from({ length: 1001 }, () => ({ ...f.rows.inbound_events[0] }));
  assert.equal((await run(f)).coverage, "partial");
});
