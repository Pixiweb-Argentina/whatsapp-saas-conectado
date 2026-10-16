import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { sealAccountCredentials } from "../../src/features/channels/services/account-credentials.ts";
import { setupSql, scope, actor } from "../db/cloud-account-trial.mjs";
assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL, "https://bzanbpyzujlogipxvkfn.supabase.co");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });
const mode = process.argv[2]; let checks = 0;
const check = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
const expect = async (operation) => { const r = await operation; assert.equal(r.error, null); return r.data; };
const base = (s) => `http://localhost:3100/api/workspace/${s.workspace}/whatsapp-accounts/${s.connection}/trial`;
if (mode === "prepare") {
  const scripts = [];
  for (const provider of ["ycloud", "kapso"]) {
    const s = scope(provider); check(await expect(db.from("workspaces").select("id").eq("id", s.workspace)), []);
    const sealed = await sealAccountCredentials({ workspaceId: s.workspace, connectionId: s.connection, provider },
      { apiKey: `synthetic-account-trial-${provider}`, signingSecret: "synthetic-trial-secret" });
    check(sealed.keyVersion, 1); scripts.push(setupSql(provider, actor, sealed.encryptedPayload));
  }
  await writeFile("test-results/f3-account-trial-setup.sql", scripts.join("\n"));
} else if (["probe", "manager", "inactive", "disabled"].includes(mode)) {
  const jar = new Map();
  const auth = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (rows) => rows.forEach((r) => jar.set(r.name, r.value)) } });
  const login = await auth.auth.signInWithPassword({ email: process.env.QA_EMAIL, password: process.env.QA_PASSWORD });
  check(login.error, null); check(login.data.user.id, actor);
  const request = async (s, body, anonymous = false) => fetch(base(s), { method: body ? "POST" : "GET", signal: AbortSignal.timeout(45000),
    headers: { "Content-Type": "application/json", ...(anonymous ? {} : { cookie: [...jar].map(([key, value]) => `${key}=${value}`).join("; ") }) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  try {
    for (const provider of ["ycloud", "kapso"]) {
      const s = scope(provider);
      if (mode === "inactive") {
        check((await request(s)).status, 403);
        check((await request(s, { action: "send", operationId: s.operation, acknowledgeSend: true })).status, 403); continue;
      }
      if (mode === "manager") {
        check((await request(s)).status, 200);
        check((await request(s, { action: "send", operationId: s.operation, acknowledgeSend: true })).status, 403); continue;
      }
      if (mode === "disabled") {
        check((await (await request(s)).json()).review.dispatchEnabled, false);
        check((await request(s, { action: "send", operationId: s.operation, acknowledgeSend: true })).status, 409); continue;
      }
      check((await request(s, undefined, true)).status, 401);
      const reviewResponse = await request(s); check(reviewResponse.status, 200);
      const { review } = await reviewResponse.json(); check(review.blockers, []); check(review.candidates.length, 1); check(review.dispatchEnabled, true);
      check(await expect(db.from("message_jobs").select("operation_id").eq("workspace_id", s.workspace)), []);
      check(await expect(db.from("message_outbox").select("operation_id").eq("workspace_id", s.workspace)), []);
      const input = { action: "authorize", operationId: s.operation, conversationId: s.conversation, recipient: "+15555550101",
        connectionUpdatedAt: review.connectionUpdatedAt, verificationCheckedAt: review.verificationCheckedAt, acknowledgeOneMessage: true };
      check((await request(s, { ...input, acknowledgeOneMessage: false })).status, 400);
      check((await request(s, { ...input, body: "not the trial" })).status, 400);
      const authorized = await request(s, input); check(authorized.status, 200); check((await authorized.json()).duplicate, false);
      check((await (await request(s, input)).json()).duplicate, true);
      check(await expect(db.rpc("claim_channel_job", { p_workspace_id: s.workspace, p_worker_id: s.worker })), []);
      const sent = await request(s, { action: "send", operationId: s.operation, acknowledgeSend: true }); check(sent.status, 200);
      check((await sent.json()).status, provider === "ycloud" ? "unknown" : "accepted");
      check((await (await request(s, { action: "send", operationId: s.operation, acknowledgeSend: true })).json()).status, "not_claimed");
      const latest = (await (await request(s)).json()).review.latest;
      check(latest.state, provider === "ycloud" ? "unknown" : "accepted"); check(latest.canSend, false);
      check((await request(s, { ...input, operationId: s.id(63) })).status, 409);
      const attempts = await expect(db.from("message_outbox").select("state").eq("workspace_id", s.workspace).eq("operation_id", s.operation));
      check(attempts, [{ state: provider === "ycloud" ? "unknown" : "accepted" }]);
      check(await expect(db.from("contacts").select("opt_in").eq("workspace_id", s.workspace)), [{ opt_in: false }]);
      check(await expect(db.from("channel_connections").select("status,capabilities").eq("workspace_id", s.workspace)), [{ status: "needs_permissions", capabilities: {} }]);
      if (provider === "kapso") {
        const raw = JSON.stringify({ phone_number_id: "155555507000001", message: { id: "wamid.trial36", to: "+15555550101",
          timestamp: String(Math.floor(Date.now() / 1000)), kapso: { origin: "cloud_api", direction: "outbound" } } });
        const receipt = await fetch(`http://localhost:3100/api/webhooks/whatsapp-accounts/${s.workspace}/${s.connection}`, {
          method: "POST", body: raw, headers: { "X-Webhook-Event": "whatsapp.message.delivered",
            "X-Webhook-Signature": createHmac("sha256", "synthetic-trial-secret").update(raw).digest("hex") }, signal: AbortSignal.timeout(45000) });
        check(receipt.status, 200); check((await receipt.json()).shadowOnly, true);
        const delivered = (await (await request(s)).json()).review.latest; check(delivered.deliveryStatus, "delivered");
        const permissions = await fetch(base(s).replace(/\/trial$/, "/permissions"), { headers: { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } });
        check((await permissions.json()).review.canGrant, true);
      }
      check((await request(s, { action: "revoke", operationId: s.operation })).status, 200);
      const after = (await (await request(s)).json()).review.latest; check(after.revoked, true); check(after.canSend, false);
    }
    if (mode === "probe") {
      const intercepts = (await readFile("test-results/f3-account-trial-intercepts.jsonl", "utf8")).trim().split("\n").map((row) => JSON.parse(row));
      check(intercepts.length, 2); check(intercepts.map((row) => row.provider), ["ycloud", "kapso"]);
    }
  } finally { await auth.auth.signOut({ scope: "local" }); }
} else throw new Error("Specify prepare, probe, manager, inactive or disabled; cleanup is guarded SQL-only");
console.log(JSON.stringify({ mode, passed: true, checks, realProviderCalls: 0, realModelCalls: 0 }));
