import assert from "node:assert/strict";
import { test } from "node:test";
import { identityKey } from "../lib/identity-key.ts";
import { connectionSchema, inboundEventSchema, type ChannelConnection } from "../types/channel-contracts.ts";
import { normalizeWhatsAppEvent, type WhatsAppInboundInput } from "./whatsapp-inbound-event.ts";
import { YCLOUD_TEXT, KAPSO_TEXT, KAPSO_ECHO, YCLOUD_STATUS } from "../testing/whatsapp-fixtures.ts";

const WORKSPACE = "00000000-0000-4000-8000-000000000001";
const CONNECTION = "00000000-0000-4000-8000-000000000002";
const OTHER = "00000000-0000-4000-8000-000000000003";
const connection: ChannelConnection = {
  workspaceId: WORKSPACE, connectionId: CONNECTION, externalAccountId: "+15555550100",
  channel: "whatsapp", provider: "ycloud", status: "ready",
};
function input(overrides: Partial<WhatsAppInboundInput> = {}): WhatsAppInboundInput {
  return { connection, payload: YCLOUD_TEXT, receivedAt: "2026-10-10T12:00:01.000Z",
    defaultCountryCode: "1", ...overrides };
}
function event(overrides: Partial<WhatsAppInboundInput> = {}) {
  const result = normalizeWhatsAppEvent(input(overrides));
  assert.equal(result.status, "normalized");
  if (result.status !== "normalized") throw new Error("Expected normalized fixture");
  return result.event;
}

test("YCloud preserves sender, message ID, text and server-resolved workspace", () => {
  const result = event();
  assert.equal(result.workspaceId, WORKSPACE);
  assert.equal(result.connectionId, CONNECTION);
  assert.equal(result.externalMessageId, "wamid.synthetic-y1");
  assert.equal(result.externalActorId, "+15555550101");
  assert.equal(result.content.text, "hola");
  assert.equal(result.occurredAt, YCLOUD_TEXT.createTime);
});
test("Kapso resolves by business account ID, never the contact phone", () => {
  const result = event({ connection: { ...connection, provider: "kapso",
    externalAccountId: "synthetic-phone-id" }, payload: KAPSO_TEXT,
    kapsoEventName: "whatsapp.message.received" });
  assert.equal(result.externalMessageId, "wamid.synthetic-k1");
  assert.equal(result.externalActorId, "+15555550101");
});
test("untrusted body workspace and source do not select a tenant or invent ad attribution", () => {
  const result = event({ payload: { ...YCLOUD_TEXT, workspaceId: OTHER,
    connectionId: OTHER, sourceContext: { sourceType: "ad", adId: "invented" } } });
  assert.equal(result.workspaceId, WORKSPACE);
  assert.deepEqual(result.sourceContext, { channel: "whatsapp", sourceType: "direct_message" });
});
test("mismatched business account fails closed", () => {
  assert.deepEqual(normalizeWhatsAppEvent(input({ connection: {
    ...connection, externalAccountId: "+15555550999",
  } })), { status: "rejected", reason: "account_mismatch" });
});
test("Kapso without routing identity cannot use the contact number as the account", () => {
  assert.deepEqual(normalizeWhatsAppEvent(input({
    connection: { ...connection, provider: "kapso", externalAccountId: "synthetic-phone-id" },
    payload: { message: KAPSO_TEXT.message, conversation: { phone_number: "synthetic-phone-id" } },
    kapsoEventName: "whatsapp.message.received",
  })), { status: "rejected", reason: "account_mismatch" });
});
test("outbound echoes and receipts never become inbound messages", () => {
  assert.equal(normalizeWhatsAppEvent(input({ payload: YCLOUD_STATUS })).status, "ignored");
  assert.equal(normalizeWhatsAppEvent(input({ connection: { ...connection, provider: "kapso",
    externalAccountId: "synthetic-phone-id" }, payload: KAPSO_ECHO,
    kapsoEventName: "whatsapp.message.received" })).status, "ignored");
});
test("revoked connections cannot normalize into actionable events", () => {
  assert.deepEqual(normalizeWhatsAppEvent(input({ connection: { ...connection, status: "revoked" } })),
    { status: "rejected", reason: "invalid_context" });
});
test("malformed timestamps and phone identities are rejected", () => {
  assert.equal(normalizeWhatsAppEvent(input({ payload: { ...YCLOUD_TEXT,
    createTime: "yesterday" } })).status, "rejected");
  assert.equal(normalizeWhatsAppEvent(input({ payload: { ...YCLOUD_TEXT,
    whatsappInboundMessage: { ...YCLOUD_TEXT.whatsappInboundMessage, from: "?" } } })).status, "rejected");
  assert.equal(normalizeWhatsAppEvent(input({ receivedAt: "tomorrow" })).status, "rejected");
});
test("reactions retain raw type so the consumer can keep legacy no-reply behavior", () => {
  const result = event({ payload: { ...YCLOUD_TEXT, whatsappInboundMessage: {
    ...YCLOUD_TEXT.whatsappInboundMessage, type: "reaction",
    reaction: { emoji: "👍", message_id: "wamid.original" },
  } } });
  assert.equal(result.content.rawType, "reaction");
});
test("durable media envelope excludes expiring URLs and transcripts", () => {
  const result = event({ payload: { ...YCLOUD_TEXT, whatsappInboundMessage: {
    ...YCLOUD_TEXT.whatsappInboundMessage, type: "document",
    document: { id: "synthetic-media", link: "https://example.invalid/file?token=fixture",
      mime_type: "application/pdf", filename: "guia.pdf" },
  } } });
  assert.equal(result.mediaRefs[0]?.externalId, "synthetic-media");
  assert.equal(JSON.stringify(result).includes("token="), false);
});
test("redelivery has the same provider ID for durable deduplication", () => {
  assert.equal(event().providerEventId, event({ receivedAt: "2026-10-10T12:01:00.000Z" }).providerEventId);
});
test("same actor in separate accounts or tenants has separate identity keys", () => {
  const identity = { workspaceId: WORKSPACE, connectionId: CONNECTION, externalActorId: "123" };
  assert.notEqual(identityKey(identity), identityKey({ ...identity, connectionId: OTHER }));
  assert.notEqual(identityKey(identity), identityKey({ ...identity, workspaceId: OTHER }));
  assert.notEqual(identityKey({ ...identity, externalActorId: "AbC" }),
    identityKey({ ...identity, externalActorId: "abc" }));
});
test("identity validation rejects blank and control characters without requiring a phone", () => {
  const identity = { workspaceId: WORKSPACE, connectionId: CONNECTION, externalActorId: "scoped-ig-id" };
  assert.doesNotThrow(() => identityKey(identity));
  for (const externalActorId of ["", " ", " leading", "\n"]) {
    assert.throws(() => identityKey({ ...identity, externalActorId }));
  }
});
test("connection and inbound contracts reject mismatched channels and unexpected secret fields", () => {
  assert.equal(connectionSchema.safeParse({ ...connection, channel: "instagram" }).success, false);
  assert.equal(connectionSchema.safeParse({ ...connection, token: "fixture" }).success, false);
  assert.equal(inboundEventSchema.safeParse({ ...event(), provider: "meta" }).success, false);
  assert.equal(inboundEventSchema.safeParse({ ...event(),
    sourceContext: { channel: "instagram", sourceType: "direct_message" } }).success, false);
  assert.equal(inboundEventSchema.safeParse({ ...event(), externalMessageId: undefined }).success, false);
});
