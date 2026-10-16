import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { sealAccountCredentials } from "../../src/features/channels/services/account-credentials.ts";
import { readInboxPage } from "../../src/features/inbox/services/inbox-query.ts";
import { readComposerAvailability } from "../../src/features/channels/services/composer-availability.ts";
import { actor, workspace, connectionA, connectionB, connectionK } from "../db/cloud-whatsapp-account-inbox.mjs";
assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL, "https://bzanbpyzujlogipxvkfn.supabase.co");
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, options);
const accounts = [[connectionA, "ycloud", "+15555550600"], [connectionB, "ycloud", "+15555550601"], [connectionK, "kapso", "synthetic-phone33"]];
const secret = "synthetic-inbox-secret-no-provider", sender = "+15555550701";
const expect = async (operation) => { const r = await operation; assert.equal(r.error, null); return r.data; };
const url = (connection = connectionA) => `http://localhost:3100/api/webhooks/whatsapp-accounts/${workspace}/${connection}`;
const mode = process.argv[2]; let checks = 0;
const check = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
const rows = (table, select = "*") => expect(db.from(table).select(select).eq("workspace_id", workspace));

if (mode === "setup") {
  check(await expect(db.from("workspaces").select("id").eq("id", workspace)), []);
  await expect(db.from("workspaces").insert({ id: workspace, name: "QA F3 · bandeja por cuenta", slug: "f3-account-inbox-33" }));
  await expect(db.from("memberships").insert({ workspace_id: workspace, user_id: actor, role: "admin" }));
  for (const [connectionId, provider, account] of accounts) {
    const sealed = await sealAccountCredentials({ workspaceId: workspace, connectionId, provider },
      { apiKey: "synthetic-inbox-api-no-provider", signingSecret: secret });
    check(await expect(db.rpc("register_whatsapp_account", { p_workspace: workspace, p_actor: actor, p_connection: connectionId,
      p_provider: provider, p_account: account, p_label: "QA ficticia sin envíos", p_payload: sealed.encryptedPayload, p_key_version: sealed.keyVersion })), connectionId);
  }
} else if (mode === "disabled") {
  check((await fetch(url(), { method: "POST", body: "{}", signal: AbortSignal.timeout(30000) })).status, 503);
} else if (mode === "read") {
  const auth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);
  try {
    const login = await auth.auth.signInWithPassword({ email: process.env.QA_EMAIL, password: process.env.QA_PASSWORD });
    check(login.error, null); check(login.data.user.id, actor);
    const page = await readInboxPage(auth, workspace, { q: "" });
    check(page.error, false); check(page.conversations.length, 3); check(page.accounts.length, 3);
    check(new Set(page.conversations.map((row) => row.connection?.id)).size, 3);
    for (const [connection] of accounts) {
      const filtered = await readInboxPage(auth, workspace, { q: "", account: connection, state: "human_active" });
      check(filtered.error, false); check(filtered.conversations.length, 1);
      check(filtered.conversations[0].connection?.id, connection);
      const availability = await readComposerAvailability(auth, filtered.conversations[0]);
      check(availability.allowed, false); check(availability.reason, connection === connectionA ? "revoked" : "permission_missing");
    }
  } finally { await auth.auth.signOut({ scope: "local" }); }
} else if (mode === "probe") {
  const existing = await expect(db.from("inbound_events").select("envelope").eq("workspace_id", workspace)
    .eq("connection_id", connectionA).eq("provider_event_id", "wamid.http33"));
  assert.ok(existing.length <= 1);
  const time = existing[0]?.envelope.occurredAt ?? new Date(Math.floor(Date.now() / 1000) * 1000 - 2000).toISOString();
  const text = (connection = connectionA) => {
    const [, provider, account] = accounts.find((row) => row[0] === connection);
    return provider === "ycloud" ? { id: "event.http33", type: "whatsapp.inbound_message.received", createTime: time,
      whatsappInboundMessage: { wamid: "wamid.http33", from: sender, to: account,
        type: "text", text: { body: "Ficticio bandeja por cuenta" }, customerProfile: { name: "QA original" } } }
      : { phone_number_id: account, message: { id: "wamid.http33", from: sender.slice(1), timestamp: String(Date.parse(time) / 1000),
        type: "text", text: { body: "Ficticio bandeja por cuenta" }, kapso: { direction: "inbound" } } };
  };
  const post = async (payload, connection = connectionA, invalidSignature = false, raw) => {
    const [, provider] = accounts.find((row) => row[0] === connection), body = raw ?? JSON.stringify(payload);
    const t = String(Math.floor(Date.now() / 1000));
    const digest = createHmac("sha256", secret).update(provider === "ycloud" ? `${t}.${body}` : body).digest("hex");
    return fetch(url(connection), { method: "POST", body, signal: AbortSignal.timeout(45000), headers: { "Content-Type": "application/json",
      ...(provider === "ycloud" ? { "YCloud-Signature": invalidSignature ? "invalid" : `t=${t},s=${digest}` }
        : { "X-Webhook-Signature": invalidSignature ? "invalid" : digest, "X-Webhook-Event": "whatsapp.message.received" }) } });
  };
  const status = async (request, expected) => { const r = await request; check(r.status, expected); return r; };
  await status(post(text(), connectionA, true), 401); await status(post(text(), connectionA, false, "{"), 400);
  for (const [connection] of accounts) {
    const response = await status(post(text(connection), connection), 200);
    check(response.headers.get("Cache-Control"), "no-store");
    check(await response.json(), { received: true, shadowOnly: false, recorded: true, inboxOnly: true, materialized: true });
    await status(post(text(connection), connection), 200);
  }
  await status(post(text(), connectionB), 400);
  await status(post({ ...text(), createTime: "2099-01-01T00:00:00Z" }), 503);
  await status(post({ ...text(), whatsappInboundMessage: { ...text().whatsappInboundMessage, text: { body: "Collision" } } }), 503);
  const threads = await rows("conversations"), messages = await rows("messages");
  check(threads.length, 3); check(messages.length, 3); check(new Set(threads.map((r) => r.contact_id)).size, 1);
  check(new Set(threads.map((r) => r.identity_id)).size, 3); check(new Set(threads.map((r) => r.connection_id)).size, 3);
  check(threads.every((r) => !r.ai_enabled && r.state === "human_active" && r.unread_count === 1), true);
  check(messages.every((r) => r.direction === "in" && r.meta.receive_only && r.meta.managed_account), true);
  check(messages.find((r) => r.connection_id === connectionK)?.provider, "kapso");
  check((await rows("contacts")).every((r) => !r.opt_in && r.name === "QA original"), true);
  check((await rows("contact_identities")).every((r) => r.verified_at !== null), true);
  const beforeReceipt = await rows("conversations");
  const receipt = { id: "receipt.http33", type: "whatsapp.message.updated", createTime: time,
    whatsappMessage: { id: "provider.http33", wamid: "external-outgoing33", from: accounts[0][2], to: sender, status: "read" } };
  const receiptResponse = await status(post(receipt), 200);
  check(await receiptResponse.json(), { received: true, shadowOnly: true, recorded: true });
  await status(post(receipt), 200); check(await rows("conversations"), beforeReceipt);
  const media = { ...text(), whatsappInboundMessage: { ...text().whatsappInboundMessage, wamid: "media.http33", type: "image",
    image: { id: "synthetic-media33", link: "https://example.invalid/private-no-download" } } };
  const mediaResponse = await status(post(media), 200);
  check(await mediaResponse.json(), { received: true, shadowOnly: true, recorded: true });
  check((await rows("messages")).length, 3); check((await rows("inbound_events")).length, 4);
  for (const table of ["message_jobs", "message_outbox", "integrations"]) check(await rows(table, "workspace_id"), []);
  check((await rows("channel_connections")).every((r) => r.status === "needs_permissions" && JSON.stringify(r.capabilities) === "{}"), true);
  const auth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);
  try {
    const login = await auth.auth.signInWithPassword({ email: process.env.QA_EMAIL, password: process.env.QA_PASSWORD });
    check(login.error, null); check(login.data.user.id, actor);
    const own = await expect(auth.from("conversations").select("id,connection_id").eq("workspace_id", workspace));
    check(own.length, 3);
    for (const thread of own) {
      const visible = await expect(auth.from("messages").select("id,connection_id,body").eq("workspace_id", workspace).eq("conversation_id", thread.id));
      check(visible.length, 1); check(visible[0].connection_id, thread.connection_id);
    }
    check((await auth.rpc("materialize_whatsapp_account_inbound", { p_workspace: workspace, p_connection: connectionA,
      p_source_revision: "a".repeat(32), p_event: {}, p_customer_name: null })).error?.code, "42501");
  } finally { await auth.auth.signOut({ scope: "local" }); }
  const anonymous = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);
  const anonymousRead = await anonymous.from("messages").select("id").eq("workspace_id", workspace);
  check(anonymousRead.error?.code, "42501"); check(anonymousRead.data, null);
  const account = (await rows("channel_connections")).find((r) => r.id === connectionA);
  check(await expect(db.rpc("revoke_whatsapp_account", { p_workspace: workspace, p_actor: actor, p_connection: connectionA,
    p_expected_updated_at: account.updated_at })), true);
  await status(post(text()), 401); check((await rows("messages")).length, 3);
} else throw new Error("Specify setup, probe, read or disabled. Cleanup requires the guarded SQL fixture ledger");
console.log(JSON.stringify({ mode, passed: true, checks, realProviderCalls: 0, realModelCalls: 0 }));
