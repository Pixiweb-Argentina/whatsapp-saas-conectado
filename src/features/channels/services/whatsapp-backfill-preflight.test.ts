import assert from "node:assert/strict";
import { test } from "node:test";
import { assessWhatsAppBackfill } from "./whatsapp-backfill-preflight.ts";

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function fixture() {
  return {
    connections: [{ workspaceId: id(1), connectionId: id(2), channel: "whatsapp",
      provider: "ycloud", externalAccountId: "+15555550100", status: "ready" }],
    contacts: [{ id: id(3), workspaceId: id(1), phone: "+15555550101" as string | null }],
    conversations: [{ id: id(4), workspaceId: id(1), contactId: id(3), channel: "whatsapp" }],
    messages: [{ id: id(5), workspaceId: id(1), conversationId: id(4), wamid: "wamid.synthetic-1" as string | null }],
  };
}
test("preflight preserves IDs and counts without mutating the supplied snapshot", () => {
  const snapshot = fixture();
  const before = JSON.stringify(snapshot);
  const result = assessWhatsAppBackfill(snapshot);
  assert.equal(JSON.stringify(snapshot), before);
  assert.equal(result.readyForDryRun, true);
  assert.deepEqual(result.counts, { contacts: 1, conversations: 1, messages: 1, whatsappConversations: 1 });
  assert.deepEqual(result.assignments, [{ workspaceId: id(1), connectionId: id(2),
    contactId: id(3), conversationId: id(4), externalActorId: "+15555550101" }]);
  assert.deepEqual(assessWhatsAppBackfill(snapshot), result);
});
test("no provider and multiple historical providers both require explicit resolution", () => {
  const snapshot = fixture();
  snapshot.connections = [];
  assert.equal(assessWhatsAppBackfill(snapshot).blockers[0]?.code, "connection_ambiguous");
  const multiple = fixture();
  multiple.connections.push({ ...multiple.connections[0], connectionId: id(6),
    provider: "kapso", externalAccountId: "synthetic-phone-id" });
  const result = assessWhatsAppBackfill(multiple);
  assert.equal(result.readyForDryRun, false);
  assert.deepEqual(result.assignments, []);
  assert.equal(result.blockers[0]?.code, "connection_ambiguous");
});
test("contact and message relations cannot cross workspaces", () => {
  const snapshot = fixture();
  snapshot.contacts[0].workspaceId = id(10);
  snapshot.messages[0].workspaceId = id(10);
  const result = assessWhatsAppBackfill(snapshot);
  assert.equal(result.blockers.filter((b) => b.code === "tenant_mismatch").length, 2);
  assert.deepEqual(result.assignments, []);
});
test("orphan rows are reported without deleting or inventing records", () => {
  const snapshot = fixture();
  snapshot.conversations[0].contactId = id(99);
  snapshot.messages[0].conversationId = id(98);
  const result = assessWhatsAppBackfill(snapshot);
  assert.deepEqual(result.blockers.map((b) => b.code), ["contact_missing", "conversation_missing"]);
});
test("legacy WhatsApp contact requires a real stored E164 phone; no invented phone", () => {
  for (const phone of [null, "", "15555550101", "not-a-phone"]) {
    const snapshot = fixture();
    snapshot.contacts[0].phone = phone;
    assert.equal(assessWhatsAppBackfill(snapshot).blockers[0]?.code, "phone_invalid");
  }
});
test("duplicate IDs and duplicate conversation identities block the whole plan", () => {
  const snapshot = fixture();
  snapshot.contacts.push({ ...snapshot.contacts[0] });
  snapshot.conversations.push({ ...snapshot.conversations[0], id: id(6) });
  const result = assessWhatsAppBackfill(snapshot);
  assert.equal(result.blockers.some((b) => b.code === "duplicate_id"), true);
  assert.equal(result.blockers.some((b) => b.code === "identity_collision"), true);
  assert.deepEqual(result.assignments, []);
});
test("message wamid collision blocks, while multiple unsent messages can have null wamid", () => {
  const snapshot = fixture();
  snapshot.messages.push({ ...snapshot.messages[0], id: id(6) });
  assert.equal(assessWhatsAppBackfill(snapshot).blockers[0]?.code, "message_collision");
  snapshot.messages.forEach((message) => { message.wamid = null; });
  assert.equal(assessWhatsAppBackfill(snapshot).readyForDryRun, true);
});
test("same phone in separate tenants stays separate but a shared account is blocked", () => {
  const snapshot = fixture();
  snapshot.connections.push({ ...snapshot.connections[0], connectionId: id(12),
    workspaceId: id(11), externalAccountId: "+15555550200" });
  snapshot.contacts.push({ ...snapshot.contacts[0], id: id(13), workspaceId: id(11) });
  snapshot.conversations.push({ ...snapshot.conversations[0], id: id(14),
    workspaceId: id(11), contactId: id(13) });
  assert.equal(assessWhatsAppBackfill(snapshot).assignments.length, 2);
  snapshot.connections[1].externalAccountId = snapshot.connections[0].externalAccountId;
  assert.equal(assessWhatsAppBackfill(snapshot).blockers[0]?.code, "account_shared");
});
test("non-WhatsApp histories count toward preservation but are not assigned a WA connection", () => {
  const snapshot = fixture();
  snapshot.conversations[0].channel = "instagram";
  snapshot.contacts[0].phone = null;
  const result = assessWhatsAppBackfill(snapshot);
  assert.equal(result.readyForDryRun, true);
  assert.equal(result.counts.messages, 1);
  assert.deepEqual(result.assignments, []);
});
test("malformed snapshots and secret fields are rejected before planning", () => {
  assert.throws(() => assessWhatsAppBackfill({}));
  const snapshot = fixture();
  assert.throws(() => assessWhatsAppBackfill({ ...snapshot, credentials: "not-allowed" }));
  assert.throws(() => assessWhatsAppBackfill({ ...snapshot,
    connections: [{ ...snapshot.connections[0], apiKey: "not-allowed" }] }));
});
