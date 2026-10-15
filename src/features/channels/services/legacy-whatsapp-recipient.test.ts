import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadLegacyWhatsAppRecipient } from "./legacy-whatsapp-recipient";

function fixture(connectionId: string | null, resolved: unknown = []) {
  const reads: string[] = [];
  const calls: unknown[] = [];
  const db = { rpc: async (fn: string, args: unknown) => {
    calls.push({ fn, args }); return { data: resolved, error: null };
  }, from(table: string) {
    reads.push(table);
    return { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({
      data: table === "contacts" ? { phone: "+15555550101", opt_in: true } : {
        channel: "whatsapp", contact_id: "contact-a", connection_id: connectionId, window_expires_at: null,
      }, error: null,
    }) };
  } } as unknown as SupabaseClient;
  return { db, reads, calls };
}
const row = { id: "conversation-a", workspace_id: "workspace-a", contact_id: "contact-a", channel: "whatsapp" };
test("mapped legacy sends require the exact eligible thread before reading a recipient phone", async () => {
  for (const resolved of [[], [{ ...row, id: "conversation-b" }]]) {
    const f = fixture("account-a", resolved);
    assert.equal(await loadLegacyWhatsAppRecipient("conversation-a", "workspace-a", f.db), null);
    assert.deepEqual(f.reads, ["conversations"]);
  }
});
test("the original single-account mapped thread still resolves the recipient", async () => {
  const f = fixture("account-a", [row]);
  assert.equal((await loadLegacyWhatsAppRecipient("conversation-a", "workspace-a", f.db))?.toPhone, "+15555550101");
  assert.equal(f.calls.length, 1);
});
test("unmapped legacy WhatsApp remains compatible without adopting a bound account", async () => {
  const f = fixture(null);
  assert.equal((await loadLegacyWhatsAppRecipient("conversation-a", "workspace-a", f.db))?.optIn, true);
  assert.equal(f.calls.length, 0);
});
