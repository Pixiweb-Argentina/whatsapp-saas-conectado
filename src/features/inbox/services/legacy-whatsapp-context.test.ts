import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readLegacyWhatsAppConversation } from "./legacy-whatsapp-context";

function fixture(data: unknown, error: unknown = null) {
  const calls: unknown[] = [];
  const db = { rpc: async (fn: string, args: unknown) => {
    calls.push({ fn, args }); return { data, error };
  } } as unknown as SupabaseClient;
  return { db, calls };
}
const row = { id: "conversation-a", workspace_id: "workspace-a", contact_id: "contact-a", channel: "whatsapp" };

test("an empty safe resolution is held without choosing another thread", async () => {
  const f = fixture([]);
  assert.equal(await readLegacyWhatsAppConversation(f.db, "workspace-a", "contact-a"), null);
  assert.deepEqual(f.calls, [{ fn: "read_legacy_whatsapp_conversation",
    args: { p_workspace: "workspace-a", p_contact: "contact-a", p_routing: null } }]);
});
test("foreign, multiple, wrong-channel and malformed RPC rows are never usable for legacy sends", async () => {
  for (const data of [[{ ...row, workspace_id: "workspace-b" }], [{ ...row, contact_id: "contact-b" }],
    [{ ...row, channel: "instagram" }], [row, row], {}, null]) {
    await assert.rejects(() => readLegacyWhatsAppConversation(fixture(data).db, "workspace-a", "contact-a"),
      /LEGACY_WHATSAPP_CONTEXT_UNAVAILABLE/);
  }
});
test("a database error never leaks its raw details or enables a fallback", async () => {
  await assert.rejects(() => readLegacyWhatsAppConversation(fixture([row], { message: "private-detail" }).db,
    "workspace-a", "contact-a"), (error: Error) => error.message === "LEGACY_WHATSAPP_CONTEXT_UNAVAILABLE");
  assert.equal((await readLegacyWhatsAppConversation(fixture([row]).db, "workspace-a", "contact-a"))?.id, row.id);
});
