import { test } from "node:test";
import assert from "node:assert/strict";
import { conversationAccountLabel } from "./conversation-account";

test("the channel account remains identifiable without a display name or joined row", () => {
  const accountId = "00000051-0000-4000-8000-000000000001";
  assert.equal(conversationAccountLabel({ channel: "instagram", connection_id: accountId }), "Instagram · Cuenta 00000051");
  assert.equal(conversationAccountLabel({ channel: "whatsapp", connection:
    { id: accountId, channel: "whatsapp", display_name: "  " } }), "WhatsApp · Cuenta 00000051");
  assert.equal(conversationAccountLabel({ channel: "web", connection: null }), "Chat web · Cuenta sin vincular");
});

test("account names stay distinct across conversations of the same channel", () => {
  for (const display_name of ["Soporte", "Ventas"]) {
    assert.equal(conversationAccountLabel({ channel: "messenger", connection:
      { id: "account", channel: "messenger", display_name } }), `Messenger · ${display_name}`);
  }
});
