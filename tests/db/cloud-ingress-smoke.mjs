// Explicit opt-in smoke against the approved NEW project. Synthetic data only.
// Run with --env-file=.env.local --import ./scripts/register-alias-hook.mjs.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { captureWhatsAppDelivery } from "../../src/features/channels/services/whatsapp-event-ingress.ts";
import { GET } from "../../src/app/api/cron/channel-jobs/route.ts";

const project = "bzanbpyzujlogipxvkfn";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
assert.equal(new URL(url).hostname, `${project}.supabase.co`, "Wrong project; no mutations allowed");
const originalFetch = globalThis.fetch;
let blockedExternalRequests = 0;
globalThis.fetch = async (input, init) => {
  const destination = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (destination.hostname !== `${project}.supabase.co`) {
    blockedExternalRequests++;
    throw new Error("SMOKE_EXTERNAL_NETWORK_BLOCKED");
  }
  return originalFetch(input, init);
};
const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const id = (n) => `00000000-0000-4000-8000-${String(991000 + n).padStart(12, "0")}`;
const workspace = id(1), integration = id(11), connection = id(51);
const slug = "f3-ingress-synthetic-probe";
const assertions = [];
let created = false;
function checked(result, label) {
  if (result.error) throw new Error(`SMOKE_DB_${label}`);
  return result.data;
}
async function count(table) {
  const result = await db.from(table).select("id", { count: "exact", head: true }).eq("workspace_id", workspace);
  checked(result, `COUNT_${table}`);
  return result.count;
}
try {
  const existing = checked(await db.from("workspaces").select("id").eq("id", workspace).maybeSingle(), "LOOKUP");
  assert.equal(existing, null, "Fixture already exists; reconcile before retrying");
  checked(await db.from("workspaces").insert({ id: workspace, name: "Prueba ingress F3", slug }), "WORKSPACE");
  created = true;
  checked(await db.from("integrations").insert({ id: integration, workspace_id: workspace, provider: "ycloud",
    enabled: true, config: { phone_number: "+15555559800" } }), "INTEGRATION");
  checked(await db.from("channel_connections").insert({ id: connection, workspace_id: workspace,
    channel: "whatsapp", provider: "ycloud", external_account_id: "+15555559800",
    status: "connecting", legacy_integration_id: integration }), "CONNECTION");
  process.env.CHANNEL_INGRESS_WORKSPACES = workspace;
  const occurredAt = new Date(Date.now() - 30_000).toISOString();
  const input = { workspaceId: workspace, integrationId: integration, provider: "ycloud",
    configuredAccountId: "+15555559800", payload: { type: "whatsapp.inbound_message.received", createTime: occurredAt,
      whatsappInboundMessage: { wamid: "wamid.f3-synthetic-ingress", from: "+15555559801", to: "+15555559800",
        type: "text", text: { body: "Prueba sintética, sin envío" } } } };
  const first = await captureWhatsAppDelivery(db, input);
  assert.equal(first.status, "persisted");
  const second = await captureWhatsAppDelivery(db, input);
  assert.deepEqual(second, first);
  assert.equal(await count("inbound_events"), 1);
  const saved = checked(await db.from("inbound_events").select("envelope,state,historical")
    .eq("workspace_id", workspace).eq("id", first.eventId).single(), "EVENT");
  assert.equal(saved.envelope.occurredAt, occurredAt);
  assert.equal(saved.envelope.connectionId, connection);
  assert.equal(saved.historical, false); assert.equal(saved.state, "pending");
  assertions.push("service-role capture persisted one event and deduplicated redelivery");
  await assert.rejects(captureWhatsAppDelivery(db, { ...input, integrationId: id(12) }),
    { message: "CHANNEL_INGRESS_CONNECTION_UNAVAILABLE" });
  assert.equal(await count("inbound_events"), 1);
  assertions.push("different integration cannot write through the connection");
  for (const table of ["contact_identities", "messages", "message_jobs", "message_outbox"]) {
    const result = await db.from(table).select("*", { count: "exact", head: true }).eq("workspace_id", workspace);
    checked(result, `COUNT_${table}`); assert.equal(result.count, 0);
  }
  assertions.push("capture creates no identities, messages, jobs or outbox entries");
  assert.ok(process.env.CRON_SECRET, "Missing local cron secret");
  process.env.CHANNEL_WORKER_WORKSPACES = workspace;
  assert.equal((await GET(new Request("http://localhost/api/cron/channel-jobs"))).status, 401);
  const response = await GET(new Request("http://localhost/api/cron/channel-jobs", {
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { enabled: true, outcomes: {} });
  assertions.push("authenticated worker recovered/claimed empty synthetic workspace without a transport");
  assert.equal(blockedExternalRequests, 0);
} finally {
  if (created) {
    const owner = checked(await db.from("workspaces").select("slug").eq("id", workspace).single(), "CLEANUP_SCOPE");
    assert.equal(owner.slug, slug);
    for (const table of ["inbound_events", "channel_connections", "integrations"]) {
      checked(await db.from(table).delete().eq("workspace_id", workspace), `CLEANUP_${table}`);
    }
    checked(await db.from("workspaces").delete().eq("id", workspace).eq("slug", slug), "CLEANUP_WORKSPACE");
    assert.equal(checked(await db.from("workspaces").select("id").eq("id", workspace).maybeSingle(), "CLEANUP_VERIFY"), null);
  }
}
const report = { checkedAt: new Date().toISOString(), project, fixtureWorkspace: workspace,
  synthetic: true, externalRequests: blockedExternalRequests, assertions, cleanup: "verified" };
await writeFile("test-results/f3-ingress-cloud.json", JSON.stringify(report, null, 2) + "\n", "utf8");
console.log(JSON.stringify(report));
