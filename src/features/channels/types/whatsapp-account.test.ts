import assert from "node:assert/strict";
import { test } from "node:test";
import { registerWhatsAppAccountSchema, whatsAppAccountSchema } from "./whatsapp-account.ts";
const input = { connectionId: "00000000-0000-4000-8000-000000000051", provider: "ycloud",
  externalAccountId: "+15555550101", displayName: "Ventas", apiKey: "synthetic", signingSecret: "synthetic-secret" };

test("strict account input rejects capabilities, actor spoofing, invalid accounts and ciphertext", () => {
  assert.equal(registerWhatsAppAccountSchema.safeParse(input).success, true);
  for (const patch of [{ capabilities: { grants: ["text"] } }, { actorId: input.connectionId }, { provider: "meta" },
    { externalAccountId: "15555550101" }, { externalAccountId: "+0" }, { apiKey: "enc:v1:a:b" }, { signingSecret: "" }]) {
    assert.equal(registerWhatsAppAccountSchema.safeParse({ ...input, ...patch }).success, false);
  }
  assert.equal(registerWhatsAppAccountSchema.safeParse({ ...input, provider: "kapso", externalAccountId: "phone-id" }).success, true);
});
test("account summary cannot serialize credential payloads into browser data", () => {
  const row = { id: input.connectionId, provider: "ycloud", externalAccountId: input.externalAccountId, displayName: "Ventas",
    status: "needs_permissions", managed: true, credentialsStored: true, updatedAt: new Date().toISOString() };
  assert.equal(whatsAppAccountSchema.safeParse(row).success, true);
  assert.equal(whatsAppAccountSchema.safeParse({ ...row, encryptedPayload: "enc:v1:a:b" }).success, false);
});
