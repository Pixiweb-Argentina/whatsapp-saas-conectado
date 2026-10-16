import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountInboxEnabled, materializeAccountInbox } from "./whatsapp-account-inbox.ts";
import { YCLOUD_TEXT } from "../testing/whatsapp-fixtures.ts";
import { normalizeWhatsAppEvent } from "./whatsapp-inbound-event.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const source = { workspaceId: id(1), connectionId: id(51), provider: "ycloud" as const, externalAccountId: "+15555550100",
  status: "needs_permissions" as const, sourceRevision: "a".repeat(32), credentials: { apiKey: "not-live", signingSecret: "not-live" } };
const normalized = normalizeWhatsAppEvent({ connection: { workspaceId: source.workspaceId, connectionId: source.connectionId,
  channel: "whatsapp", provider: source.provider, status: source.status, externalAccountId: source.externalAccountId }, payload: YCLOUD_TEXT,
  receivedAt: "2026-10-10T12:00:01Z", defaultCountryCode: "1" });
assert.equal(normalized.status, "normalized");
if (normalized.status !== "normalized") throw new Error("INVALID_FIXTURE");
const event = normalized.event;

test("inbox list defaults off and rejects wildcards, malformed IDs or excessive entries", () => {
  assert.equal(accountInboxEnabled(id(51), ""), false); assert.equal(accountInboxEnabled(id(51), id(52)), false);
  assert.equal(accountInboxEnabled(id(51), ` ${id(52)}, ${id(51)} `), true);
  for (const raw of ["*", "bad", `${id(51)},`, Array(101).fill(id(51)).join(",")]) {
    assert.throws(() => accountInboxEnabled(id(51), raw), /ACCOUNT_INBOX_CONFIG_INVALID/);
  }
});
test("account scope is validated before SQL and storage errors never leak provider details", async () => {
  let calls = 0; let response: { data: unknown; error: unknown } = { data: null, error: { message: "private-sentinel" } };
  const db = { rpc: async () => { calls++; return response; } } as unknown as SupabaseClient;
  await assert.rejects(materializeAccountInbox(db, { ...source, workspaceId: id(2) }, event, YCLOUD_TEXT, null), /ACCOUNT_INBOX_SCOPE_INVALID/);
  assert.equal(calls, 0);
  await assert.rejects(materializeAccountInbox(db, source, event, YCLOUD_TEXT, null), { message: "ACCOUNT_INBOX_STORAGE_FAILED" });
  response = { data: { arbitrary: "private-sentinel" }, error: null };
  await assert.rejects(materializeAccountInbox(db, source, event, YCLOUD_TEXT, null), { message: "ACCOUNT_INBOX_STORAGE_FAILED" });
  response = { data: { eventId: id(41), conversationId: id(42), messageId: id(43), inserted: false }, error: null };
  assert.deepEqual(await materializeAccountInbox(db, source, event, YCLOUD_TEXT, null), response.data);
});
