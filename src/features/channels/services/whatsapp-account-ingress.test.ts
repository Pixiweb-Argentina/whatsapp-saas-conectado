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
afterEach(() => { delete process.env.CHANNEL_ACCOUNT_INGRESS_CONNECTIONS; delete process.env.CHANNEL_ACCOUNT_INBOX_CONNECTIONS; });

async function fixture(provider: "ycloud" | "kapso" = "ycloud", payload: unknown = provider === "ycloud" ? YCLOUD_TEXT : KAPSO_TEXT) {
  const owner = { workspaceId: id(1), connectionId: id(51), provider };
  const sealed = await sealAccountCredentials(owner, { apiKey: "placeholder", signingSecret: secret });
  const source = { ...owner, ...sealed, status: "needs_permissions",
    externalAccountId: provider === "ycloud" ? "+15555550100" : "synthetic-phone-id", sourceRevision: "a".repeat(32) };
  let result: unknown = source, error: unknown = null, inserted = true;
  let echoResult: unknown = { conversationId: id(42), inserted: true, aiDisabled: true };
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const tables: string[] = [];
  const connection = { id: owner.connectionId, workspace_id: owner.workspaceId, channel: "whatsapp", provider,
    external_account_id: source.externalAccountId, status: "ready", revoked_at: null, capabilities: {}, legacy_integration_id: null };
  const db = { rpc: async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args }); return { data: name === "read_whatsapp_account_source" ? result
      : name === "materialize_whatsapp_account_inbound" ? { eventId: id(41), conversationId: id(42), messageId: id(43), inserted }
      : name === "persist_whatsapp_account_echo" ? echoResult : id(41), error };
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
  return { source, connection, db, calls, tables, input, setResult: (v: unknown) => { result = v; }, replay: () => { inserted = false; },
    setEcho: (v: unknown) => { echoResult = v; },
    fail: () => { error = { message: "private-provider-sentinel" }; } };
}

test("per-account opt-in defaults off; workspace pilot/ingress flags never opt accounts in", async () => {
  const f = await fixture(); delete process.env.CHANNEL_ACCOUNT_INGRESS_CONNECTIONS;
  assert.equal(accountIngressEnabled(id(51)), false);
  assert.deepEqual(await captureWhatsAppAccountDelivery(f.db, f.input, now), { status: "disabled" });
  assert.equal(f.calls.length, 0); assert.equal(accountIngressEnabled(id(52), id(51)), false);
  assert.throws(() => accountIngressEnabled(id(51), "*"), /CONFIG_INVALID/);
});

test("inbox requires both explicit account flags and writes only the atomic materializer", async () => {
  for (const provider of ["ycloud", "kapso"] as const) {
    const f = await fixture(provider); process.env.CHANNEL_ACCOUNT_INBOX_CONNECTIONS = id(51);
    delete process.env.CHANNEL_ACCOUNT_INGRESS_CONNECTIONS;
    assert.deepEqual(await captureWhatsAppAccountDelivery(f.db, f.input, now), { status: "disabled" });
    assert.equal(f.calls.length, 0);
    process.env.CHANNEL_ACCOUNT_INGRESS_CONNECTIONS = id(51);
    assert.deepEqual(await captureWhatsAppAccountDelivery(f.db, f.input, now), { status: "persisted", kind: "message", materialized: true });
    assert.equal(f.calls[1].name, "materialize_whatsapp_account_inbound");
    assert.equal(f.calls[1].args.p_source_revision, f.source.sourceRevision);
    assert.equal(JSON.stringify(f.calls[1]).includes(secret), false);
    assert.deepEqual(f.tables, ["business_info"]);
  }
});

function mediaStore(failDownload = false) {
  const downloads: Array<Record<string, unknown>> = [], patches: unknown[][] = [];
  const store = { download: async (opts: Record<string, unknown>) => {
    downloads.push(opts); if (failDownload) throw new Error("private-download-sentinel");
    return { storage_path: "synthetic/path.jpg", mime_type: "image/jpeg" };
  }, patch: async (...args: unknown[]) => { patches.push(args); } };
  return { store: store as unknown as Parameters<typeof captureWhatsAppAccountDelivery>[3] & object, downloads, patches };
}
const YCLOUD_IMAGE = { ...YCLOUD_TEXT, whatsappInboundMessage: { ...YCLOUD_TEXT.whatsappInboundMessage, type: "image",
  image: { id: "synthetic-image", link: "https://api.ycloud.com/v2/media/synthetic", mime_type: "image/jpeg" } } };

test("inbox materializes YCloud media and copies the file only after the response, with the account key", async () => {
  process.env.CHANNEL_ACCOUNT_INBOX_CONNECTIONS = id(51);
  const f = await fixture("ycloud", YCLOUD_IMAGE), m = mediaStore();
  const result = await captureWhatsAppAccountDelivery(f.db, f.input, now, m.store);
  assert.equal(result.status, "persisted");
  assert.ok(result.status === "persisted" && result.materialized === true && typeof result.media === "function");
  assert.equal(f.calls[1].name, "materialize_whatsapp_account_inbound");
  const event = f.calls[1].args.p_event as { content: Record<string, unknown>; mediaRefs: unknown[] };
  assert.equal(event.content.type, "image"); assert.equal(event.mediaRefs.length, 1);
  assert.equal(m.downloads.length, 0);
  await result.media();
  assert.deepEqual(m.downloads, [{ provider: "ycloud", link: "https://api.ycloud.com/v2/media/synthetic", workspaceId: id(1),
    conversationId: id(42), mimeType: "image/jpeg", filename: undefined, caption: undefined, mediaId: "synthetic-image",
    apiKey: "placeholder" }]);
  assert.deepEqual(m.patches, [[id(1), id(43), { storage_path: "synthetic/path.jpg", mime_type: "image/jpeg" }]]);
});

test("Kapso media uses its signed link without a key; replays and failed copies stay quiet", async () => {
  process.env.CHANNEL_ACCOUNT_INBOX_CONNECTIONS = id(51);
  const kapsoImage = { ...KAPSO_TEXT, message: { ...KAPSO_TEXT.message, type: "image", text: undefined,
    image: { id: "synthetic-k-image", mime_type: "image/png", caption: "foto" },
    kapso: { direction: "inbound", media_url: "https://api.kapso.ai/media/synthetic?token=t" } } };
  const f = await fixture("kapso", kapsoImage), m = mediaStore();
  const result = await captureWhatsAppAccountDelivery(f.db, f.input, now, m.store);
  assert.ok(result.status === "persisted" && result.media);
  await result.media();
  assert.equal(m.downloads[0].provider, "kapso"); assert.equal("apiKey" in m.downloads[0], false);
  assert.equal(m.downloads[0].caption, "foto"); assert.equal(m.downloads[0].mediaId, "synthetic-k-image");
  const replay = await fixture("ycloud", YCLOUD_IMAGE); replay.replay();
  assert.deepEqual(await captureWhatsAppAccountDelivery(replay.db, replay.input, now, mediaStore().store),
    { status: "persisted", kind: "message", materialized: true });
  const broken = await fixture("ycloud", YCLOUD_IMAGE), b = mediaStore(true);
  const failed = await captureWhatsAppAccountDelivery(broken.db, broken.input, now, b.store);
  assert.ok(failed.status === "persisted" && failed.media);
  await failed.media(); assert.equal(b.downloads.length, 1); assert.equal(b.patches.length, 0);
});

test("inbox materializes button replies as text but keeps templates and receipts capture-only; bad config fails closed", async () => {
  process.env.CHANNEL_ACCOUNT_INBOX_CONNECTIONS = id(51);
  const button = await fixture("ycloud", { ...YCLOUD_TEXT, whatsappInboundMessage: { ...YCLOUD_TEXT.whatsappInboundMessage,
    type: "button", button: { text: "Sí", payload: "synthetic-payload" } } });
  assert.deepEqual(await captureWhatsAppAccountDelivery(button.db, button.input, now, mediaStore().store),
    { status: "persisted", kind: "message", materialized: true });
  const buttonEvent = button.calls[1].args.p_event as { content: Record<string, unknown> };
  assert.equal(buttonEvent.content.type, "text"); assert.equal(buttonEvent.content.rawType, "button");
  const template = await fixture("ycloud", { ...YCLOUD_TEXT, whatsappInboundMessage: { ...YCLOUD_TEXT.whatsappInboundMessage,
    type: "template", template: { name: "synthetic" } } });
  assert.deepEqual(await captureWhatsAppAccountDelivery(template.db, template.input, now), { status: "persisted", kind: "message" });
  assert.equal(template.calls[1].name, "persist_whatsapp_account_delivery");
  const receipt = await fixture("ycloud", { id: "receipt.inbox", type: "whatsapp.message.updated", createTime: "2026-10-10T12:00:00Z",
    whatsappMessage: { from: "+15555550100", to: "+15555550101", id: "provider.id", wamid: "wamid.receipt", status: "read" } });
  assert.deepEqual(await captureWhatsAppAccountDelivery(receipt.db, receipt.input, now), { status: "persisted", kind: "receipt" });
  assert.equal(receipt.calls[1].name, "persist_whatsapp_account_delivery");
  process.env.CHANNEL_ACCOUNT_INBOX_CONNECTIONS = "*";
  await assert.rejects(captureWhatsAppAccountDelivery(receipt.db, receipt.input, now), /ACCOUNT_INBOX_CONFIG_INVALID/);
  assert.equal(receipt.calls.length, 2);
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

const MANAGED_ECHO = { phone_number_id: "synthetic-phone-id", message: { id: "wamid.synthetic-phone-reply", to: "15555550101",
  timestamp: String(now / 1000 - 60), type: "text", text: { body: "Te respondo yo" }, kapso: { origin: "business_app" } } };

test("with the inbox on, a Kapso phone-app reply is stored as a human echo that pauses the AI, nothing else", async () => {
  const f = await fixture("kapso", MANAGED_ECHO); process.env.CHANNEL_ACCOUNT_INBOX_CONNECTIONS = id(51);
  f.input.headers.set("X-Webhook-Event", "whatsapp.message.sent");
  assert.deepEqual(await captureWhatsAppAccountDelivery(f.db, f.input, now), { status: "persisted", kind: "echo" });
  assert.deepEqual(f.calls.map((c) => c.name), ["read_whatsapp_account_source", "persist_whatsapp_account_echo"]);
  const args = f.calls[1].args, echo = args.p_echo as Record<string, unknown>;
  assert.equal(args.p_workspace, id(1)); assert.equal(args.p_connection, id(51)); assert.equal(args.p_source_revision, f.source.sourceRevision);
  assert.equal(echo.connectionId, id(51)); assert.equal(echo.externalAccountId, "synthetic-phone-id");
  assert.equal(echo.recipient, "+15555550101"); assert.equal(echo.body, "Te respondo yo");
  assert.equal(JSON.stringify(f.calls).includes(secret), false); assert.deepEqual(f.tables, []);
});

test("phone-app replies stay capture-free with the inbox off and fail closed on bad storage answers", async () => {
  const off = await fixture("kapso", MANAGED_ECHO); off.input.headers.set("X-Webhook-Event", "whatsapp.message.sent");
  assert.deepEqual(await captureWhatsAppAccountDelivery(off.db, off.input, now), { status: "ignored" });
  assert.equal(off.calls.some((c) => c.name === "persist_whatsapp_account_echo"), false);
  const bad = await fixture("kapso", MANAGED_ECHO); process.env.CHANNEL_ACCOUNT_INBOX_CONNECTIONS = id(51);
  bad.input.headers.set("X-Webhook-Event", "whatsapp.message.sent"); bad.setEcho({ conversationId: "not-an-id" });
  await assert.rejects(captureWhatsAppAccountDelivery(bad.db, bad.input, now), /ACCOUNT_ECHO_STORAGE_FAILED/);
  const future = await fixture("kapso", { ...MANAGED_ECHO, message: { ...MANAGED_ECHO.message, timestamp: String(now / 1000 + 60) } });
  future.input.headers.set("X-Webhook-Event", "whatsapp.message.sent");
  assert.equal(future.calls.some((c) => c.name === "persist_whatsapp_account_echo"), false);
  await captureWhatsAppAccountDelivery(future.db, future.input, now).catch(() => null);
  assert.equal(future.calls.some((c) => c.name === "persist_whatsapp_account_echo"), false);
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
