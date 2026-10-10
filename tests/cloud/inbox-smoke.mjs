// Explicit opt-in smoke for the new, non-operational project. No provider/LLM calls.
// node --env-file=.env.local --env-file=.env.qa.local tests/cloud/inbox-smoke.mjs
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
assert.equal(url, "https://bzanbpyzujlogipxvkfn.supabase.co", "QA project mismatch");
assert.equal(process.env.QA_EMAIL, "qa-f3-admin@omnichannel.invalid", "QA account mismatch");
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, options);
const session = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);
const ledgerPath = new URL("../../test-results/f3-inbox-fixture.json", import.meta.url);
function checked(result) {
  if (result.error) throw new Error(`Cloud QA failed: ${result.error.code ?? result.error.status}`);
  return result.data;
}
let ledger;
try { ledger = JSON.parse(await readFile(ledgerPath, "utf8")); }
catch (error) { if (error.code !== "ENOENT") throw error; }
const workspace = checked(await service.from("workspaces").select("id,name")
  .eq("name", "Laboratorio F3 · prueba").single());
const owner = checked(await service.from("memberships").select("role").eq("workspace_id", workspace.id)
  .eq("user_id", process.env.QA_USER_ID).single());
assert.equal(owner.role, "admin");
if (!ledger) {
  const existing = checked(await service.from("conversations").select("id").eq("workspace_id", workspace.id).limit(1));
  assert.equal(existing.length, 0, "QA ledger missing: reconcile existing fixture IDs before retrying; never seed duplicates");
  ledger = { workspaceId: workspace.id, connectionIds: [randomUUID(), randomUUID()],
    contactIds: [randomUUID(), randomUUID()], identityIds: [randomUUID(), randomUUID()],
    conversationIds: [randomUUID(), randomUUID()], operationId: randomUUID() };
  await writeFile(ledgerPath, JSON.stringify(ledger, null, 2), { flag: "wx" });
  for (let n = 0; n < 2; n++) {
    const phone = `+1555555080${n}`;
    checked(await service.from("channel_connections").insert({ id: ledger.connectionIds[n], workspace_id: workspace.id,
      channel: "whatsapp", provider: "ycloud", external_account_id: "qa-inbox-" + n,
      display_name: n === 0 ? "Prueba · Ventas" : "Prueba · Soporte", status: "connecting" }));
    checked(await service.from("contacts").insert({ id: ledger.contactIds[n], workspace_id: workspace.id,
      name: n === 0 ? "Ana · contacto ficticio" : "Bruno · contacto ficticio", phone, opt_in: true }));
    checked(await service.from("contact_identities").insert({ id: ledger.identityIds[n], workspace_id: workspace.id,
      contact_id: ledger.contactIds[n], connection_id: ledger.connectionIds[n], external_user_id: phone }));
    checked(await service.from("conversations").insert({ id: ledger.conversationIds[n], workspace_id: workspace.id,
      contact_id: ledger.contactIds[n], connection_id: ledger.connectionIds[n], identity_id: ledger.identityIds[n],
      channel: "whatsapp", state: "ai_active", window_expires_at: new Date(Date.now() + 86400000).toISOString() }));
    checked(await service.from("messages").insert({ workspace_id: workspace.id, conversation_id: ledger.conversationIds[n],
      direction: "in", type: "text", body: n === 0 ? "Hola, quiero información. Mensaje de prueba." : "Necesito ayuda. Mensaje de prueba.",
      status: "delivered", meta: { synthetic: true, fixture: "f3-inbox" } }));
  }
  checked(await service.rpc("enqueue_channel_job", { p_workspace_id: workspace.id, p_connection_id: ledger.connectionIds[0],
    p_conversation_id: ledger.conversationIds[0], p_event_id: null, p_idempotency_key: "f3-inbox-takeover", p_actor: "ai", p_expected_revision: 0,
    p_request: { operationId: ledger.operationId, channel: "whatsapp", recipient: "+15555550800", action: "text",
      body: "Fixture pendiente. No enviar." } }));
}
assert.equal(ledger.workspaceId, workspace.id);
checked(await session.auth.signInWithPassword({ email: process.env.QA_EMAIL, password: process.env.QA_PASSWORD }));
const rows = checked(await session.rpc("read_inbox_page", { p_workspace_id: workspace.id }));
assert.equal(rows.length, 2);
assert(rows.every((row) => row.last_message?.body && ledger.conversationIds.includes(row.id)));
const filtered = checked(await session.rpc("read_inbox_page", { p_workspace_id: workspace.id,
  p_connection_id: ledger.connectionIds[0], p_search: "Ana" }));
assert.equal(filtered.length, 1);
const stranger = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);
const strangerPassword = randomBytes(30).toString("base64url");
const strangerUser = checked(await service.auth.admin.createUser({
  email: `qa-f3-outsider-${randomUUID()}@omnichannel.invalid`, password: strangerPassword, email_confirm: true,
})).user;
try {
  checked(await stranger.auth.signInWithPassword({ email: strangerUser.email, password: strangerPassword }));
  assert.deepEqual(checked(await stranger.rpc("read_inbox_page", { p_workspace_id: workspace.id })), []);
  const anonymous = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);
  assert((await anonymous.rpc("read_inbox_page", { p_workspace_id: workspace.id })).error);
  const queue = await session.from("message_jobs").select("operation_id");
  assert(queue.error, "Browser must not read durable jobs");
} finally {
  await stranger.auth.signOut();
  // Only the temporary account created by this invocation; never an existing user.
  checked(await service.auth.admin.deleteUser(strangerUser.id));
  // Do not revoke the independent browser QA session for the same test user.
  await session.auth.signOut({ scope: "local" });
}
console.log(JSON.stringify({ project: "bzanbpyzujlogipxvkfn", workspaceId: workspace.id,
  auth: "real GoTrue", previews: 2, filters: "passed", outsiderRls: "passed", anonymousDenied: true,
  browserQueueDenied: true, providerCalls: 0, emailsSent: 0 }, null, 2));
