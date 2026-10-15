import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test, afterEach } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { YCLOUD_TEXT, KAPSO_TEXT, KAPSO_ECHO } from "../testing/whatsapp-fixtures.ts";

process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.ENCRYPTION_KEY_VERSION = "v1";
const { sealAccountCredentials } = await import("./account-credentials.ts");
const { captureWhatsAppAccountDelivery, accountIngressEnabled } = await import("./whatsapp-account-ingress.ts");
const { resolveConnectionAdapter } = await import("./connection-adapter.ts");
const { readWhatsAppAccountSource } = await import("./whatsapp-account-source.ts");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = Date.parse("2026-10-10T12:01:00Z");
const secret = "synthetic-account-secret";
afterEach(() => { delete process.env.CHANNEL_ACCOUNT_INGRESS_CONNECTIONS; });

async function fixture(provider: "ycloud" | "kapso" = "ycloud", payload: unknown = provider === "ycloud" ? YCLOUD_TEXT : KAPSO_TEXT) {
  const owner = { workspaceId: id(1), connectionId: id(51), provider };
  const sealed = await sealAccountCredentials(owner, { apiKey: "placeholder", signingSecret: secret });
  const source = { ...owner, ...sealed, status: "needs_permissions",
    externalAccountId: provider === "ycloud" ? "+15555550100" : "synthetic-phone-id", sourceRevision: "a".repeat(32) };
  let result: unknown = source, error: unknown = null;
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const tables: string[] = [];
  const connection = { id: owner.connectionId, workspace_id: owner.workspaceId, channel: "whatsapp", provider,
    external_account_id: source.externalAccountId, status: "ready", revoked_at: null, capabilities: {}, legacy_integration_id: null };
  const db = { rpc: async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args }); return { data: name === "read_whatsapp_account_source" ? result : id(41), error };
  }, from: (name: string) => {
    tables.push(name);
    const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: name === "channel_connections"
      ? connection : { structured: { default_country_code: "1" } }, error: null }) }; return q;
  } } as unknown as SupabaseClient;
  const rawBody = JSON.stringify(payload), headers = new Headers();
  if (provider === "ycloud") {
    const ts = Math.floor(Date.now() / 1000);
    headers.set("YCloud-Signature", `t=${ts},s=${createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex")}`);
  } else {
    headers.set("X-Webhook-Signature", createHmac("sha256", secret).update(rawBody).digest("hex"));
    headers.set("X-Webhook-Event", "whatsapp.message.received");
  }
  process.env.CHANNEL_ACCOUNT_INGRESS_CONNECTIONS = owner.connectionId;
  const input = { workspaceId: owner.workspaceId, connectionId: owner.connectionId, rawBody, headers };
  return { source, connection, db, calls, tables, input, setResult: (v: unknown) => { result = v; },
    fail: () => { error = { message: "private-provider-sentinel" }; } };
}

test("per-account opt-in defaults off; workspace pilot/ingress flags never opt accounts in", async () => {
  const f = await fixture(); delete process.env.CHANNEL_ACCOUNT_INGRESS_CONNECTIONS;
  assert.equal(accountIngressEnabled(id(51)), false);
  assert.deepEqual(await captureWhatsAppAccountDelivery(f.db, f.input, now), { status: "disabled" });
  assert.equal(f.calls.length, 0); assert.equal(accountIngressEnabled(id(52), id(51)), false);
  assert.throws(() => accountIngressEnabled(id(51), "*"), /CONFIG_INVALID/);
});

test("YCloud and Kapso signed messages bind to the private source and cannot reach legacy tables", async () => {
  for (const provider of ["ycloud", "kapso"] as const) {
    const f = await fixture(provider);
    assert.deepEqual(await captureWhatsAppAccountDelivery(f.db, f.input, now), { status: "persisted", kind: "message" });
    const write = f.calls[1];
    assert.equal(write.name, "persist_whatsapp_account_delivery"); assert.equal(write.args.p_source_revision, f.source.sourceRevision);
    const event = write.args.p_delivery as Record<string, unknown>;
    assert.equal(event.connectionId, id(51)); assert.equal(event.workspaceId, id(1)); assert.equal(event.provider, provider);
    assert.deepEqual(f.tables, ["business_info"]); assert.equal(JSON.stringify(write).includes(secret), false);
  }
});

test("wrong signatures, stale YCloud timestamps and tampered bodies never persist or resolve country", async () => {
  for (const provider of ["ycloud", "kapso"] as const) {
    const f = await fixture(provider);
    f.input.rawBody += " ";
    assert.deepEqual(await captureWhatsAppAccountDelivery(f.db, f.input, now), { status: "unauthorized" });
    assert.equal(f.calls.length, 1); assert.deepEqual(f.tables, []);
  }
  const f = await fixture(); f.input.headers.set("YCloud-Signature", "t=1,s=" + "a".repeat(64));
  assert.deepEqual(await captureWhatsAppAccountDelivery(f.db, f.input, now), { status: "unauthorized" });
});

test("unknown, expired/revoked, foreign, wrong-version or corrupt private sources fail closed", async () => {
  const f = await fixture(); f.setResult(null);
  assert.deepEqual(await captureWhatsAppAccountDelivery(f.db, f.input, now), { status: "unauthorized" });
  for (const patch of [{ workspaceId: id(2) }, { connectionId: id(52) }, { provider: "kapso" }, { status: "revoked" },
    { keyVersion: 2 }, { encryptedPayload: "plaintext" }, { unexpected: true }]) {
    f.setResult({ ...f.source, ...patch });
    await assert.rejects(captureWhatsAppAccountDelivery(f.db, f.input, now), /ACCOUNT_SOURCE_UNAVAILABLE/);
  }
  assert.equal(f.calls.every((c) => c.name === "read_whatsapp_account_source"), true);
});

test("same-provider account substitution fails AES authentication even with plausible row metadata", async () => {
  const f = await fixture(); f.input.connectionId = id(52); process.env.CHANNEL_ACCOUNT_INGRESS_CONNECTIONS = id(52);
  f.setResult({ ...f.source, connectionId: id(52) });
  await assert.rejects(captureWhatsAppAccountDelivery(f.db, f.input, now), /ACCOUNT_SOURCE_UNAVAILABLE/);
});

test("signed wrong destination cannot create an event and body workspace IDs cannot choose the scope", async () => {
  const f = await fixture("ycloud", { ...YCLOUD_TEXT, workspaceId: id(2), connectionId: id(52),
    whatsappInboundMessage: { ...YCLOUD_TEXT.whatsappInboundMessage, to: "+15555550999" } });
  assert.deepEqual(await captureWhatsAppAccountDelivery(f.db, f.input, now), { status: "invalid" });
  assert.equal(f.calls.length, 1);
  const safe = await fixture("ycloud", { ...YCLOUD_TEXT, workspaceId: id(2), connectionId: id(52), token: "do-not-store" });
  await captureWhatsAppAccountDelivery(safe.db, safe.input, now);
  assert.equal(JSON.stringify(safe.calls[1]).includes("do-not-store"), false);
});

test("receipts persist separately without message context or implicit send authority", async () => {
  const f = await fixture("ycloud", { id: "evt.receipt", type: "whatsapp.message.updated", createTime: "2026-10-10T12:00:00Z",
    whatsappMessage: { from: "+15555550100", to: "+15555550101", id: "provider.id", wamid: "wamid.receipt", status: "delivered" } });
  assert.deepEqual(await captureWhatsAppAccountDelivery(f.db, f.input, now), { status: "persisted", kind: "receipt" });
  assert.deepEqual(f.tables, []); assert.equal(f.calls[1].args.p_kind, "receipt");
});

test("future timestamps retry instead of acknowledging; echoes and reactions never create message evidence", async () => {
  const future = await fixture("ycloud", { ...YCLOUD_TEXT, createTime: "2026-10-10T12:01:01Z" });
  await assert.rejects(captureWhatsAppAccountDelivery(future.db, future.input, now), /CLOCK_SKEW/);
  const echo = await fixture("kapso", KAPSO_ECHO);
  assert.deepEqual(await captureWhatsAppAccountDelivery(echo.db, echo.input, now), { status: "ignored" });
  const reaction = await fixture("ycloud", { ...YCLOUD_TEXT, whatsappInboundMessage: { ...YCLOUD_TEXT.whatsappInboundMessage, type: "reaction" } });
  assert.deepEqual(await captureWhatsAppAccountDelivery(reaction.db, reaction.input, now), { status: "ignored" });
});

test("source errors are redacted and never become acknowledged deliveries", async () => {
  const f = await fixture(); f.fail();
  await assert.rejects(captureWhatsAppAccountDelivery(f.db, f.input, now), { message: "ACCOUNT_SOURCE_UNAVAILABLE" });
});

test("adapter selects only the ready managed account and never substitutes the active integration", async () => {
  const f = await fixture(); f.source.status = "ready";
  assert.equal((await resolveConnectionAdapter(f.db, id(1), id(51)))?.provider, "ycloud");
  assert.equal((await resolveConnectionAdapter(f.db, id(1), id(51)))?.live, false);
  assert.equal(f.tables.every((table) => table === "channel_connections"), true);
  for (const patch of [{ status: "needs_permissions" }, { provider: "kapso" }, { externalAccountId: "+15555550999" }]) {
    f.setResult({ ...f.source, ...patch });
    if (patch.provider) await assert.rejects(resolveConnectionAdapter(f.db, id(1), id(51)), /ACCOUNT_SOURCE_UNAVAILABLE/);
    else assert.equal(await resolveConnectionAdapter(f.db, id(1), id(51)), null);
  }
  f.connection.status = "needs_permissions"; f.calls.length = 0;
  assert.equal(await resolveConnectionAdapter(f.db, id(1), id(51)), null); assert.equal(f.calls.length, 0);
});

test("credential readers validate IDs before RPC and reject unexpected source contents", async () => {
  const f = await fixture(); await assert.rejects(readWhatsAppAccountSource(f.db, "invalid", id(51)));
  assert.equal(f.calls.length, 0);
});

test("transport sends from the selected account with its own key, using only an intercepted fetch", async () => {
  const realFetch = globalThis.fetch;
  const sent: Array<{ url: string; key: string | null; body: Record<string, unknown> }> = [];
  globalThis.fetch = async (url, init) => {
    sent.push({ url: String(url), key: new Headers(init?.headers).get("X-API-Key"), body: JSON.parse(String(init?.body)) });
    return Response.json({ id: "provider.mock", wamid: "wamid.mock", messages: [{ id: "wamid.mock" }] });
  };
  try {
    for (const [index, provider] of ["ycloud", "ycloud", "kapso"].entries()) {
      const f = await fixture(provider as "ycloud" | "kapso");
      const connectionId = id(51 + index), apiKey = `synthetic-key-${index}`;
      const account = provider === "ycloud" ? `+1555555010${index}` : "synthetic-other-phone-id";
      const sealed = await sealAccountCredentials({ workspaceId: id(1), connectionId, provider: f.source.provider },
        { apiKey, signingSecret: secret });
      Object.assign(f.connection, { id: connectionId, status: "ready", external_account_id: account });
      f.setResult({ ...f.source, ...sealed, connectionId, status: "ready", externalAccountId: account });
      const adapter = await resolveConnectionAdapter(f.db, id(1), connectionId);
      assert.ok(adapter?.live);
      const result = await adapter.send({ operationId: id(71 + index), action: "text", channel: "whatsapp",
        recipient: "+15555550199", body: "Texto ficticio interceptado" });
      assert.equal(result.status, "accepted"); assert.equal(sent[index].key, apiKey);
      assert.equal(sent[index].body.to, "+15555550199");
      if (provider === "ycloud") assert.equal(sent[index].body.from, account);
      else assert.equal(sent[index].url.endsWith(`/${account}/messages`), true);
    }
    assert.equal(sent.length, 3);
  } finally { globalThis.fetch = realFetch; }
});
