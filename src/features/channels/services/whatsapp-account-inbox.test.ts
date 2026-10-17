import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountInboxEnabled, accountInboxMaterializable, materializeAccountInbox } from "./whatsapp-account-inbox.ts";
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
  const stored = { eventId: id(41), conversationId: id(42), messageId: id(43), inserted: false };
  response = { data: stored, error: null };
  assert.deepEqual(await materializeAccountInbox(db, source, event, YCLOUD_TEXT, null), { ...stored, media: null });
});

test("materializable scope covers contact content but not templates, system rows, empty text or several files", () => {
  const withContent = (content: Record<string, unknown>, mediaRefs: unknown[] = []) =>
    ({ ...event, content: { ...event.content, ...content }, mediaRefs }) as typeof event;
  assert.equal(accountInboxMaterializable(event), true);
  for (const type of ["audio", "image", "document", "video", "sticker", "location"]) {
    assert.equal(accountInboxMaterializable(withContent({ type, text: undefined })), true);
  }
  assert.equal(accountInboxMaterializable(withContent({ type: "template" })), false);
  assert.equal(accountInboxMaterializable(withContent({ type: "system" })), false);
  assert.equal(accountInboxMaterializable(withContent({ type: "text", text: undefined, rawType: "interactive" })), false);
  assert.equal(accountInboxMaterializable(withContent({ type: "image" }, [{ mediaId: "a" }, { mediaId: "b" }])), false);
});

test("media link comes back for the post-response copy, without the placeholder caption", async () => {
  const image = { ...YCLOUD_TEXT, whatsappInboundMessage: { ...YCLOUD_TEXT.whatsappInboundMessage, type: "image",
    image: { id: "synthetic-image", link: "https://api.ycloud.com/v2/media/synthetic", mime_type: "image/jpeg" } } };
  const parsed = normalizeWhatsAppEvent({ connection: { workspaceId: source.workspaceId, connectionId: source.connectionId,
    channel: "whatsapp", provider: source.provider, status: source.status, externalAccountId: source.externalAccountId }, payload: image,
    receivedAt: "2026-10-10T12:00:01Z", defaultCountryCode: "1" });
  if (parsed.status !== "normalized") throw new Error("INVALID_FIXTURE");
  const data = { eventId: id(41), conversationId: id(42), messageId: id(43), inserted: true };
  const db = { rpc: async () => ({ data, error: null }) } as unknown as SupabaseClient;
  assert.deepEqual(await materializeAccountInbox(db, source, parsed.event, image, null), { ...data, media: {
    link: "https://api.ycloud.com/v2/media/synthetic", mimeType: "image/jpeg", filename: undefined,
    mediaId: "synthetic-image", caption: undefined } });
});
