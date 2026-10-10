import assert from "node:assert/strict";
import { test } from "node:test";
import { contactInitials, contactLabel, contactMatchesSearch } from "./contact-display.ts";

test("social contacts render and can be searched without a phone", () => {
  const contact = { name: "Ana Pérez", phone: null, email: null };
  assert.equal(contactLabel(contact), "Ana Pérez");
  assert.equal(contactInitials(contact), "AP");
  assert.equal(contactMatchesSearch(contact, " PÉREZ "), true);
  assert.equal(contactMatchesSearch(contact, "555"), false);
});
test("anonymous contact has a readable label and never invents a phone", () => {
  const contact = { name: null, phone: null, email: null };
  assert.equal(contactLabel(contact), "Contacto sin nombre");
  assert.equal(contactInitials(contact), "?");
  assert.equal(contactMatchesSearch(contact, ""), true);
});
test("phone and email are display attributes with explicit fallbacks", () => {
  const contact = { name: "  ", phone: "+15555550101", email: "fixture@example.invalid" };
  assert.equal(contactLabel(contact), contact.phone);
  assert.equal(contactInitials(contact), "0101");
  assert.equal(contactMatchesSearch(contact, "EXAMPLE"), true);
  assert.equal(contactLabel({ ...contact, phone: null }), contact.email);
  assert.equal(contactInitials({ ...contact, phone: null }), "FI");
});
