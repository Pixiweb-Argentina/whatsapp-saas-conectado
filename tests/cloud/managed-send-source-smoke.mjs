import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { sealAccountCredentials } from "../../src/features/channels/services/account-credentials.ts";
import { createMessageJobStore } from "../../src/features/channels/services/message-job-store.ts";
import { processClaimedJob } from "../../src/features/channels/services/message-job-worker.ts";
import { resolveConnectionAdapter } from "../../src/features/channels/services/connection-adapter.ts";
import { loadMessagePolicyContext } from "../../src/features/channels/services/message-policy-context.ts";
import { setupSql, scope, actor } from "../db/cloud-managed-send-source.mjs";

assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL, "https://bzanbpyzujlogipxvkfn.supabase.co");
const mode = process.argv[2], realFetch = globalThis.fetch;
let checks = 0, intercepted = 0, simulateUnknown = false;
const key = (provider) => `synthetic-managed-send-${provider}`, secret = "synthetic-managed-receipt-secret";
const check = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (["api.ycloud.com", "api.kapso.ai"].includes(url.hostname)) {
    const provider = url.hostname === "api.ycloud.com" ? "ycloud" : "kapso";
    check(init.method, "POST"); check(new Headers(init.headers).get("X-API-Key"), key(provider));
    const body = JSON.parse(init.body); check(body.text.body, "Ficticio managed send");
    check(body.to.replace(/^\+/, ""), "15555550101");
    check(url.href, provider === "ycloud" ? "https://api.ycloud.com/v2/whatsapp/messages"
      : "https://api.kapso.ai/meta/whatsapp/v24.0/155555507000001/messages");
    if (provider === "ycloud") check(body.from, "+15555550700");
    intercepted++;
    if (simulateUnknown) throw new Error("Synthetic transport uncertainty after permit");
    return Response.json(provider === "ycloud" ? { id: "provider.synthetic35", wamid: "wamid.synthetic35" }
      : { messages: [{ id: "wamid.synthetic35" }] });
  }
  assert.ok(url.origin === process.env.NEXT_PUBLIC_SUPABASE_URL || url.origin === "http://localhost:3100", "Unexpected network target");
  return realFetch(input, init);
};
const expect = async (op) => { const r = await op; assert.equal(r.error, null); return r.data; };
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });
if (mode === "prepare") {
  const scripts = [];
  for (const provider of ["ycloud", "kapso"]) {
    const { workspace, connection } = scope(provider);
    check(await expect(db.from("workspaces").select("id").eq("id", workspace)), []);
    const sealed = await sealAccountCredentials({ workspaceId: workspace, connectionId: connection, provider }, { apiKey: key(provider), signingSecret: secret });
    check(sealed.keyVersion, 1); scripts.push(setupSql(provider, actor, sealed.encryptedPayload));
  }
  await writeFile("test-results/f3-managed-send-setup.sql", scripts.join("\n"));
} else if (mode === "probe") {
  const jar = new Map();
  const auth = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (rows) => rows.forEach((r) => jar.set(r.name, r.value)) } });
  const login = await auth.auth.signInWithPassword({ email: process.env.QA_EMAIL, password: process.env.QA_PASSWORD });
  check(login.error, null); check(login.data.user.id, actor);
  const send = async (s, operation, body = "Ficticio managed send", anonymous = false) => fetch(`http://localhost:3100/api/conversations/${s.conversation}/messages`, {
    method: "POST", signal: AbortSignal.timeout(45000), headers: { "Content-Type": "application/json",
      ...(anonymous ? {} : { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") }) },
    body: JSON.stringify({ operationId: operation, deliveryMode: "queue", body }) });
  const store = createMessageJobStore(db);
  const work = async (s) => {
    const job = await store.claim(s.workspace, s.worker); assert.ok(job); check(job.connection_id, s.connection);
    return processClaimedJob(job, { store,
      resolveAdapter: (j) => resolveConnectionAdapter(db, j.workspace_id, j.connection_id),
      loadContext: (j) => loadMessagePolicyContext(db, { workspaceId: j.workspace_id, connectionId: j.connection_id,
        conversationId: j.conversation_id, eventId: j.event_id, channel: j.request.channel, recipient: j.request.recipient }) });
  };
  try {
    for (const provider of ["ycloud", "kapso"]) {
      const s = scope(provider), before = intercepted;
      check((await send(s, s.operation, undefined, true)).status, 401);
      const queued = await send(s, s.operation); check(queued.status, 202); check((await queued.json()).duplicate, false);
      const retry = await send(s, s.operation); check(retry.status, 202); check((await retry.json()).duplicate, true);
      check((await send(s, s.operation, "Collision")).status, 409);
      check((await work(s)).status, "accepted"); check(intercepted, before + 1);
      const time = new Date(Date.now() - 2000).toISOString();
      const payload = provider === "ycloud" ? { id: "receipt.synthetic35", type: "whatsapp.message.updated", createTime: time,
        whatsappMessage: { id: "provider.synthetic35", wamid: "wamid.synthetic35", from: "+15555550700", to: "+15555550101",
          externalId: `channel:${s.operation}`, status: "delivered" } }
        : { phone_number_id: "155555507000001", message: { id: "wamid.synthetic35", to: "+15555550101",
          timestamp: String(Math.floor(Date.parse(time) / 1000)), kapso: { origin: "cloud_api", direction: "outbound" } } };
      const raw = JSON.stringify(payload), timestamp = Math.floor(Date.now() / 1000);
      const signed = createHmac("sha256", secret).update(provider === "ycloud" ? `${timestamp}.${raw}` : raw).digest("hex");
      const receipt = await fetch(`http://localhost:3100/api/webhooks/whatsapp-accounts/${s.workspace}/${s.connection}`, { method: "POST", body: raw,
        headers: provider === "ycloud" ? { "YCloud-Signature": `t=${timestamp},s=${signed}` }
          : { "X-Webhook-Signature": signed, "X-Webhook-Event": "whatsapp.message.delivered" }, signal: AbortSignal.timeout(45000) });
      check(receipt.status, 200); check((await receipt.json()).shadowOnly, true);
      const messages = await expect(db.from("messages").select("provider,status,connection_id").eq("workspace_id", s.workspace).eq("channel_operation_id", s.operation));
      check(messages, [{ provider, status: "delivered", connection_id: s.connection }]);
      check(await store.claim(s.workspace, s.worker), null);
      const after = await send(s, s.operation); check(after.status, 200); check((await after.json()).duplicate, true);
      check(intercepted, before + 1);
    }
    const s = scope("ycloud"), uncertain = s.id(63), before = intercepted;
    check((await send(s, uncertain)).status, 202); simulateUnknown = true;
    check((await work(s)).status, "unknown"); check(intercepted, before + 1);
    await store.recover(s.workspace); check(await store.claim(s.workspace, s.worker), null);
    const replay = await send(s, uncertain); check(replay.status, 200); check((await replay.json()).state, "unknown");
    check(intercepted, before + 1);
    const attempts = await expect(db.from("message_outbox").select("state").eq("workspace_id", s.workspace).eq("operation_id", uncertain));
    check(attempts, [{ state: "unknown" }]);
  } finally { await auth.auth.signOut({ scope: "local" }); }
} else throw new Error("Specify prepare or probe; scoped fixture cleanup is SQL-only");
console.log(JSON.stringify({ mode, passed: true, checks, interceptedProviderPosts: intercepted, realProviderCalls: 0, realModelCalls: 0 }));
