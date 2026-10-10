// Explicit QA project only. Readiness rejection must occur before any dispatch.
// node --env-file=.env.local --env-file=.env.qa.local --import ./scripts/register-alias-hook.mjs tests/cloud/channel-context-smoke.mjs
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { readPolicyConnection, loadMessagePolicyContext } from "../../src/features/channels/services/message-policy-context.ts";
import { readComposerAvailability } from "../../src/features/channels/services/composer-availability.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
assert.equal(url, "https://bzanbpyzujlogipxvkfn.supabase.co", "QA project mismatch");
assert.equal(process.env.QA_EMAIL, "qa-f3-admin@omnichannel.invalid", "QA account mismatch");
const ledger = JSON.parse(await readFile(new URL("../../test-results/f3-inbox-fixture.json", import.meta.url), "utf8"));
assert.equal(ledger.workspaceId, "52aa2172-9791-48cc-82ca-6fb21cfca773");
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, options);
function checked(result) {
  if (result.error) throw new Error(`Cloud QA failed: ${result.error.code ?? result.error.status}`);
  return result.data;
}
const conversation = checked(await service.from("conversations").select("id,workspace_id,channel,connection_id")
  .eq("workspace_id", ledger.workspaceId).eq("id", ledger.conversationIds[0]).single());
const connection = await readPolicyConnection(service, ledger.workspaceId, ledger.connectionIds[0]);
assert.equal(connection.status, "connecting");
assert.equal(connection.legacy_integration_id, null);
assert.equal(checked(await service.from("integrations").select("id").eq("workspace_id", ledger.workspaceId)).length, 0);

const jar = new Map();
const session = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    setAll: (values) => values.forEach(({ name, value }) => jar.set(name, value)) },
});
const messageIds = async () => checked(await service.from("messages").select("id")
  .eq("workspace_id", ledger.workspaceId).order("id")).map((row) => row.id);
checked(await session.auth.signInWithPassword({ email: process.env.QA_EMAIL, password: process.env.QA_PASSWORD }));
try {
  const availability = await readComposerAvailability(session, conversation);
  assert.equal(availability.reason, "connection_not_ready");
  assert.equal(availability.allowed, false);
  await assert.rejects(loadMessagePolicyContext(service, { workspaceId: ledger.workspaceId,
    connectionId: ledger.connectionIds[0], conversationId: ledger.conversationIds[0], eventId: null,
    channel: "whatsapp", recipient: "+15555550800" }), { message: "CHANNEL_POLICY_CONTEXT_UNAVAILABLE" });
  const before = await messageIds();
  const response = await fetch(`http://127.0.0.1:3100/api/conversations/${conversation.id}/messages`, {
    method: "POST", headers: { "content-type": "application/json",
      cookie: [...jar].map(([name, value]) => `${name}=${value}`).join("; ") },
    body: JSON.stringify({ body: "QA bloqueado: no enviar", capabilities: { text: true }, status: "ready" }),
  });
  assert.equal(response.status, 422);
  assert.equal((await response.json()).code, "connection_not_ready");
  assert.deepEqual(await messageIds(), before, "Blocked request must not insert a message");
  const report = { project: "bzanbpyzujlogipxvkfn", workspaceId: ledger.workspaceId,
    readiness: availability.reason, unverifiedIdentityBlocked: true, directApi: 422,
    forgedCapabilitiesIgnored: true, messageIdsUnchanged: true, providerCalls: 0,
    verifiedAt: new Date().toISOString() };
  await writeFile(new URL("../../test-results/f3-context-cloud.json", import.meta.url), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await session.auth.signOut({ scope: "local" });
}
