import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { sealAccountCredentials } from "../../src/features/channels/services/account-credentials.ts";
import { workspace, connectionA, connectionB } from "../db/cloud-whatsapp-account-ingress.mjs";

assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL, "https://bzanbpyzujlogipxvkfn.supabase.co");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });
const accountA = "+15555550400", accountB = "+15555550401", secret = "synthetic-account-intake-secret-not-live";
const actor = "f2913ed0-08e2-4700-91c5-fe2760e724b2";
const expect = async (operation) => { const r = await operation; assert.equal(r.error, null); return r.data; };
const url = (connection = connectionA) => `http://localhost:3100/api/webhooks/whatsapp-accounts/${workspace}/${connection}`;

if (process.argv[2] === "setup") {
  assert.deepEqual(await expect(db.from("workspaces").select("id").eq("id", workspace)), [], "Fixture exists; reconcile first");
  await expect(db.from("workspaces").insert({ id: workspace, name: "QA F3 · ingreso por cuenta", slug: "f3-account-ingress-31" }));
  await expect(db.from("memberships").insert({ workspace_id: workspace, user_id: actor, role: "admin" }));
  for (const [connectionId, account] of [[connectionA, accountA], [connectionB, accountB]]) {
    const sealed = await sealAccountCredentials({ workspaceId: workspace, connectionId, provider: "ycloud" },
      { apiKey: "synthetic-account-intake-key-not-live", signingSecret: secret });
    const result = await expect(db.rpc("register_whatsapp_account", { p_workspace: workspace, p_actor: actor,
      p_connection: connectionId, p_provider: "ycloud", p_account: account, p_label: "QA ficticia",
      p_payload: sealed.encryptedPayload, p_key_version: sealed.keyVersion }));
    assert.equal(result, connectionId);
  }
  console.log(JSON.stringify({ setup: true, accounts: 2, sendAuthority: false }));
} else if (process.argv[2] === "disabled") {
  const response = await fetch(url(), { method: "POST", body: "{}", signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, 503); console.log(JSON.stringify({ disabledVerified: true }));
} else if (process.argv[2] === "probe") {
  let checks = 0;
  const existing = await expect(db.from("inbound_events").select("envelope").eq("workspace_id", workspace)
    .eq("connection_id", connectionA).eq("provider_event_id", "wamid.synthetic-http31"));
  assert.ok(existing.length <= 1);
  const time = existing[0]?.envelope.occurredAt ?? new Date(Date.now() - 2000).toISOString();
  const event = { id: "evt.synthetic-http31", type: "whatsapp.inbound_message.received", createTime: time,
    whatsappInboundMessage: { wamid: "wamid.synthetic-http31", from: "+15555550101", to: accountA,
      type: "text", text: { body: "Ficticio desde HTTP por cuenta" } } };
  const post = async (payload, connection = connectionA, headerPatch = {}, raw) => {
    const body = raw ?? JSON.stringify(payload), t = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
    return fetch(url(connection), { method: "POST", body, headers: { "Content-Type": "application/json",
      "YCloud-Signature": `t=${t},s=${signature}`, ...headerPatch }, signal: AbortSignal.timeout(45000) });
  };
  const status = async (promise, code) => { const r = await promise; assert.equal(r.status, code); checks++; return r; };
  await status(post(event, connectionA, { "YCloud-Signature": "invalid" }), 401);
  await status(post(event, connectionA, {}, "{"), 400);
  const response = await status(post(event), 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store"); checks++;
  assert.deepEqual(await response.json(), { received: true, shadowOnly: true, recorded: true }); checks++;
  await status(post(event), 200);
  await status(post({ ...event, whatsappInboundMessage: { ...event.whatsappInboundMessage, to: accountB } }, connectionB), 200);
  await status(post(event, connectionB), 400);
  await status(post({ ...event, whatsappInboundMessage: { ...event.whatsappInboundMessage, text: { body: "Collision" } } }), 503);
  await status(post({ ...event, createTime: "2099-01-01T00:00:00Z" }), 503);
  const receipt = { id: "evt.receipt-http31", type: "whatsapp.message.updated", createTime: time,
    whatsappMessage: { id: "provider.http31", wamid: "wamid.synthetic-http31", from: accountA,
      to: "+15555550101", status: "delivered" } };
  await status(post(receipt), 200); await status(post(receipt), 200);
  const rows = await expect(db.from("inbound_events").select("connection_id,provider_event_id").eq("workspace_id", workspace));
  assert.equal(rows.length, 2); assert.equal(new Set(rows.map((r) => r.connection_id)).size, 2); checks++;
  for (const table of ["messages", "contacts", "conversations", "message_jobs", "message_outbox"]) {
    assert.deepEqual(await expect(db.from(table).select("workspace_id").eq("workspace_id", workspace)), []); checks++;
  }
  const accounts = await expect(db.from("channel_connections").select("id,status,updated_at,capabilities").eq("workspace_id", workspace));
  assert.equal(accounts.every((a) => a.status === "needs_permissions" && JSON.stringify(a.capabilities) === "{}"), true); checks++;
  const account = accounts.find((a) => a.id === connectionA);
  assert.equal(await expect(db.rpc("revoke_whatsapp_account", { p_workspace: workspace, p_actor: actor,
    p_connection: connectionA, p_expected_updated_at: account.updated_at })), true); checks++;
  await status(post(event), 401);
  const credentials = await expect(db.rpc("read_whatsapp_account_source", { p_workspace: workspace, p_connection: connectionA }));
  assert.equal(credentials, null); checks++;
  console.log(JSON.stringify({ passed: true, checks, events: 2, realProviderCalls: 0, realModelCalls: 0 }));
} else { throw new Error("Specify setup, probe or disabled; cleanup uses the scoped SQL fixture ledger"); }
