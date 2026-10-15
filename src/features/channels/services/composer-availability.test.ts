import assert from "node:assert/strict";
import { test } from "node:test";
import { readComposerAvailability } from "./composer-availability.ts";
import { policyContextFixture, contextId } from "../testing/policy-context-fixture.ts";

test("legacy WA keeps its existing window rules without requiring a migrated identity", async () => {
  const f = policyContextFixture();
  assert.equal((await readComposerAvailability(f.db, { ...f.rows.conversations[0], connection_id: null })).allowed, true);
  assert.equal(f.queries.length, 0);
});

test("only a ready mapped WA connection permits the existing composer path", async () => {
  for (const status of ["connecting", "needs_permissions", "awaiting_webhook", "ready", "degraded", "revoked"]) {
    const f = policyContextFixture(); f.rows.channel_connections[0].status = status;
    const result = await readComposerAvailability(f.db, f.rows.conversations[0]);
    assert.equal(result.allowed, status === "ready");
    assert.equal(result.message === null, status === "ready");
  }
});

test("new channels never offer WA templates or route a contact by phone", async () => {
  for (const channel of ["instagram", "messenger", "web"]) {
    const f = policyContextFixture();
    assert.equal((await readComposerAvailability(f.db, { ...f.rows.conversations[0], channel })).reason,
      "transport_unavailable");
    assert.equal(f.queries.length, 0);
  }
});

test("turning the rollout off cannot offer legacy sending on a durable account thread", async () => {
  const f = policyContextFixture();
  const result = await readComposerAvailability(f.db, { ...f.rows.conversations[0],
    source_context: { channel: "whatsapp", sourceType: "direct_message" } });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "transport_unavailable");
});

test("missing/foreign connections and read errors remain blocked, with no secret details", async () => {
  const f = policyContextFixture();
  f.rows.channel_connections[0].workspace_id = contextId(2);
  assert.equal((await readComposerAvailability(f.db, f.rows.conversations[0])).allowed, false);
  f.errors.channel_connections = { message: "private server details" };
  const result = await readComposerAvailability(f.db, f.rows.conversations[0]);
  assert.equal(result.reason, "context_unavailable");
  assert(!JSON.stringify(result).includes("private server"));
  assert.equal((await readComposerAvailability(f.db, { channel: "whatsapp" })).allowed, false);
});
