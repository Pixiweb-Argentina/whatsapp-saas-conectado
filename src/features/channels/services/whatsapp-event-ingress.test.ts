import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { captureWhatsAppDelivery, type AuthenticatedWhatsAppDelivery } from "./whatsapp-event-ingress.ts";
import { YCLOUD_TEXT, KAPSO_TEXT, KAPSO_ECHO, YCLOUD_STATUS } from "../testing/whatsapp-fixtures.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = () => Date.parse("2026-10-10T12:00:01.000Z");
const original = process.env.CHANNEL_INGRESS_WORKSPACES;
afterEach(() => {
  if (original === undefined) delete process.env.CHANNEL_INGRESS_WORKSPACES;
  else process.env.CHANNEL_INGRESS_WORKSPACES = original;
});
function fixture(overrides: Record<string, unknown> = {}, rpcError: unknown = null) {
  process.env.CHANNEL_INGRESS_WORKSPACES = id(1);
  const input: AuthenticatedWhatsAppDelivery = { workspaceId: id(1), integrationId: id(2),
    provider: "ycloud", configuredAccountId: "+15555550100", payload: YCLOUD_TEXT };
  const row = { id: id(3), workspace_id: id(1), legacy_integration_id: id(2), channel: "whatsapp",
    provider: "ycloud", external_account_id: "+15555550100", status: "ready", revoked_at: null, ...overrides };
  const reads: string[] = [];
  const filters: Array<[string, unknown]> = [];
  const writes: Array<{ name: string; args: Record<string, unknown> }> = [];
  const db = {
    from(table: string) {
      reads.push(table);
      const q = { select: () => q, eq: (key: string, value: unknown) => { filters.push([key, value]); return q; },
        maybeSingle: async () => ({ data: table === "business_info" ? { structured: { default_country_code: "1" } } : row,
          error: null }) };
      return q;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      writes.push({ name, args }); return { data: id(4), error: rpcError };
    },
  } as unknown as SupabaseClient;
  return { input, row, db, reads, filters, writes };
}

test("disabled capture and unlisted tenants perform no reads or writes", async () => {
  const f = fixture();
  assert.deepEqual(await captureWhatsAppDelivery(f.db, { ...f.input, workspaceId: id(9) }, now), { status: "disabled" });
  delete process.env.CHANNEL_INGRESS_WORKSPACES;
  assert.deepEqual(await captureWhatsAppDelivery(f.db, f.input, now), { status: "disabled" });
  assert.deepEqual(f.reads, []); assert.deepEqual(f.writes, []);
});
test("capture owns scope from authenticated integration, strips body routing and secrets", async () => {
  const f = fixture();
  f.input.payload = { ...YCLOUD_TEXT, workspaceId: id(9), connectionId: id(9), access_token: "do-not-save" };
  assert.deepEqual(await captureWhatsAppDelivery(f.db, f.input, now), { status: "persisted", eventId: id(4) });
  assert.ok(f.filters.some(([k, v]) => k === "legacy_integration_id" && v === id(2)));
  const event = f.writes[0].args.p_event as Record<string, unknown>;
  assert.equal(event.workspaceId, id(1)); assert.equal(event.connectionId, id(3));
  assert.equal(event.receivedAt, new Date(now()).toISOString());
  assert.equal(JSON.stringify(f.writes).includes("do-not-save"), false);
  assert.deepEqual(f.writes.map((w) => w.name), ["persist_channel_event"]);
  assert.equal(f.writes[0].args.p_historical, false);
});
test("delivery retries preserve the provider event ID for database deduplication", async () => {
  const f = fixture();
  await captureWhatsAppDelivery(f.db, f.input, now);
  await captureWhatsAppDelivery(f.db, f.input, () => now() + 5000);
  const events = f.writes.map((w) => w.args.p_event as Record<string, unknown>);
  assert.equal(events[0].providerEventId, events[1].providerEventId);
  assert.notEqual(events[0].receivedAt, events[1].receivedAt);
});
test("wrong tenant, integration, provider and account mappings cannot persist", async () => {
  for (const override of [{ workspace_id: id(9) }, { legacy_integration_id: id(9) },
    { provider: "kapso" }, { external_account_id: "+15555550999" }]) {
    const f = fixture(override);
    await assert.rejects(captureWhatsAppDelivery(f.db, f.input, now), { message: "CHANNEL_INGRESS_CONNECTION_UNAVAILABLE" });
    assert.deepEqual(f.writes, []);
  }
});
test("revoked connections and mismatched payload destination are ignored", async () => {
  const f = fixture({ revoked_at: new Date(now()).toISOString() });
  assert.deepEqual(await captureWhatsAppDelivery(f.db, f.input, now), { status: "ignored", reason: "revoked" });
  f.row.revoked_at = null;
  f.input.payload = { ...YCLOUD_TEXT, whatsappInboundMessage: { ...YCLOUD_TEXT.whatsappInboundMessage, to: "+15555550999" } };
  assert.deepEqual(await captureWhatsAppDelivery(f.db, f.input, now), { status: "ignored", reason: "account_mismatch" });
  assert.deepEqual(f.writes, []);
});
test("missing or future timestamps, receipts and reactions cannot create actionable evidence", async () => {
  const f = fixture();
  for (const payload of [YCLOUD_STATUS, { ...YCLOUD_TEXT, createTime: undefined },
    { ...YCLOUD_TEXT, createTime: "2026-10-11T12:00:00Z" },
    { ...YCLOUD_TEXT, whatsappInboundMessage: { ...YCLOUD_TEXT.whatsappInboundMessage, type: "reaction" } }]) {
    assert.equal((await captureWhatsAppDelivery(f.db, { ...f.input, payload }, now)).status, "ignored");
  }
  assert.deepEqual(f.writes, []);
});
test("Kapso inbound is captured, outbound echo cannot become inbound evidence", async () => {
  const f = fixture({ provider: "kapso", external_account_id: "synthetic-phone-id" });
  f.input = { ...f.input, provider: "kapso", configuredAccountId: "synthetic-phone-id",
    kapsoEventName: "whatsapp.message.received", payload: KAPSO_TEXT };
  assert.equal((await captureWhatsAppDelivery(f.db, f.input, now)).status, "persisted");
  assert.equal((await captureWhatsAppDelivery(f.db, { ...f.input, payload: KAPSO_ECHO }, now)).status, "ignored");
  assert.equal(f.writes.length, 1);
});
test("persistence error is retriable and redacted, never reported as a captured event", async () => {
  const f = fixture({}, { message: "secret provider details" });
  await assert.rejects(captureWhatsAppDelivery(f.db, f.input, now), { message: "CHANNEL_QUEUE_STORAGE_FAILED" });
});
