import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { afterEach, mock, test } from "node:test";
import { NextRequest, NextResponse } from "next/server";
import { YCLOUD_TEXT, KAPSO_TEXT } from "./whatsapp-fixtures.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
// Next's request scope is absent here; mismatch telemetry is unrelated to capture.
mock.module("next/server", { exports: { NextRequest, NextResponse, after: () => undefined } });
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fixture-only";
process.env.CHANNEL_INGRESS_WORKSPACES = id(1);
const trace: string[] = [];
const envelopes: Record<string, unknown>[] = [];
let provider: "ycloud" | "kapso" = "ycloud";
let storageFails = false;
let rowId = id(2);
const fakeSvc = {
  from(table: string) {
    const q = { select: () => q, eq: () => q,
      single: async () => q.maybeSingle(),
      maybeSingle: async (): Promise<{ data: unknown; error: null }> => {
        if (table === "integrations") return { data: { id: rowId, workspace_id: id(1),
          credentials: { webhook_signing_secret: "fixture-signature-secret" },
          config: { phone_number: "+15555550100", phone_number_id: "synthetic-phone-id" } }, error: null };
        if (table === "business_info") return { data: { structured: { default_country_code: "1" } }, error: null };
        assert.equal(table, "channel_connections");
        trace.push("resolve-connection");
        return { data: { id: id(3), workspace_id: id(1), legacy_integration_id: id(2),
          provider, channel: "whatsapp", status: "ready", revoked_at: null,
          external_account_id: provider === "ycloud" ? "+15555550100" : "synthetic-phone-id" }, error: null };
      } };
    return q;
  },
  async rpc(name: string, args: Record<string, unknown>) {
    assert.ok(["persist_channel_event","persist_channel_receipt","persist_business_app_echo","materialize_ycloud_inbound"].includes(name));
    trace.push(name === "materialize_ycloud_inbound" ? "materialize-inbox" : name === "persist_channel_event" ? "persist-event" : name === "persist_business_app_echo" ? "persist-echo" : "persist-receipt");
    envelopes.push((args.p_event ?? args.p_receipt ?? args.p_echo) as Record<string, unknown>);
    return { data: name === "materialize_ycloud_inbound" ? {eventId:id(4),conversationId:id(31),messageId:id(41),inserted:true} : name === "persist_business_app_echo" ? {conversationId:id(31),inserted:true,aiDisabled:true} : id(4), error: storageFails ? { message: "private details" } : null };
  },
};
mock.module("@supabase/supabase-js", { exports: { createClient: () => fakeSvc } });
mock.module("@/shared/lib/integration-secrets.ts", { exports: { decryptCredentials: async (c: unknown) => c } });
const unused = async () => { throw new Error("unexpected side effect"); };
mock.module("@/features/inbox/services/normalizer.ts", { exports: {
  processInbound: async () => { trace.push("legacy-dedup"); return { contact: {}, conversation: {}, message: null }; },
  processOutboundEcho: unused,
} });
mock.module("@/features/inbox/services/buffer.ts", { exports: {
  upsertBatch: unused, processNextBatch: unused, hasTimeToClaim: () => true,
} });
mock.module("@/features/inbox/services/cost-tracker.ts", { exports: { checkRateLimits: unused } });
mock.module("@/features/inbox/services/media-handler.ts", { exports: { downloadAndStoreMedia: unused, patchMessageMedia: unused } });
mock.module("@/features/inbox/services/media-understanding.ts", { exports: { transcribeAudio: unused, describeImage: unused } });
mock.module("@/features/inbox/services/message-status.ts", { exports: { applyMessageStatus: async () => { trace.push("legacy-status"); } } });
mock.module("@/features/inbox/services/daily-events.ts", { exports: { emitEventOncePerDay: unused } });
const ycloud = await import("@/app/api/webhooks/ycloud/route.ts");
const kapso = await import("@/app/api/webhooks/kapso/route.ts");
afterEach(() => { trace.length = 0; envelopes.length = 0; storageFails = false; rowId = id(2);
  delete process.env.YCLOUD_VERIFICATION_ONLY_WORKSPACES; delete process.env.YCLOUD_INBOX_ONLY_WORKSPACES; });

function payload() {
  const time = Date.now() - 10_000;
  return provider === "ycloud" ? { ...YCLOUD_TEXT, createTime: new Date(time).toISOString() }
    : { ...KAPSO_TEXT, message: { ...KAPSO_TEXT.message, timestamp: String(Math.floor(time / 1000)) } };
}
function send(body: unknown = payload(), secret = "fixture-signature-secret", eventName = "whatsapp.message.received", verificationRequired = false, receptionMode?: string) {
  const raw = JSON.stringify(body);
  const time = Math.floor(Date.now() / 1000);
  const signed = provider === "ycloud" ? `${time}.${raw}` : raw;
  const digest = createHmac("sha256", secret).update(signed).digest("hex");
  const headers: Record<string, string> = provider === "ycloud"
    ? { "YCloud-Signature": `t=${time},s=${digest}` }
    : { "X-Webhook-Signature": digest, "X-Webhook-Event": eventName };
  if (verificationRequired) headers["X-YCloud-Verification-Only"] = "true";
  if (receptionMode) headers["X-YCloud-Reception-Mode"] = receptionMode;
  const request = new NextRequest(`http://localhost/api/webhooks/${provider}?wsid=${id(1)}`, { method: "POST", body: raw, headers });
  return (provider === "ycloud" ? ycloud : kapso).POST(request);
}

for (const channel of ["ycloud", "kapso"] as const) {
  test(`${channel}: invalid signature cannot resolve a connection or persist`, async () => {
    provider = channel;
    assert.equal((await send(payload(), "wrong-secret")).status, 401);
    assert.deepEqual(trace, []);
  });
  test(`${channel}: signed duplicates reach durable capture before legacy dedup`, async () => {
    provider = channel;
    const body = { ...payload(), workspaceId: id(9), connectionId: id(9) };
    for (let i = 0; i < 2; i++) {
      const response = await send(body);
      assert.equal(response.status, 200); assert.equal((await response.json()).dedup, true);
    }
    assert.deepEqual(trace, ["resolve-connection", "persist-event", "legacy-dedup",
      "resolve-connection", "persist-event", "legacy-dedup"]);
    assert.equal(envelopes[0].providerEventId, envelopes[1].providerEventId);
    assert.equal(envelopes[0].workspaceId, id(1)); assert.equal(envelopes[0].connectionId, id(3));
  });
  test(`${channel}: storage failure returns retryable 500 before legacy handling`, async () => {
    provider = channel; storageFails = true;
    assert.equal((await send()).status, 500);
    assert.deepEqual(trace, ["resolve-connection", "persist-event"]);
  });
  test(`${channel}: the authenticated integration ID must match the connection`, async () => {
    provider = channel; rowId = id(9);
    assert.equal((await send()).status, 500);
    assert.deepEqual(trace, ["resolve-connection"]);
  });
  test(`${channel}: a signed event for another destination cannot be captured`, async () => {
    provider = channel;
    const body = channel === "ycloud" ? { ...YCLOUD_TEXT,
      whatsappInboundMessage: { ...YCLOUD_TEXT.whatsappInboundMessage, to: "+15555550999" } }
      : { ...KAPSO_TEXT, phone_number_id: "wrong-account" };
    assert.equal((await send(body)).status, channel === "ycloud" ? 200 : 401);
    assert.deepEqual(trace, []);
  });
}

function receiptPayload() {
  const time=Date.now()-10_000;
  return provider === "ycloud" ? {id:"evt.receipt",type:"whatsapp.message.updated",createTime:new Date(time).toISOString(),
    whatsappMessage:{id:"provider.receipt",wamid:"wamid.receipt",from:"+15555550100",to:"+15555550101",status:"read"}}
    : {phone_number_id:"synthetic-phone-id",message:{id:"wamid.receipt",timestamp:String(Math.floor(time/1000)),
      to:"15555550101",kapso:{origin:"cloud_api",status:"read"}}};
}

test("YCloud verification mode authenticates and binds the account without any durable or legacy work", async () => {
  provider = "ycloud"; process.env.YCLOUD_VERIFICATION_ONLY_WORKSPACES = id(1);
  for (const body of [payload(), receiptPayload()]) {
    const response = await send(body);
    assert.deepEqual(await response.json(), { received: true, verificationOnly: true, accountMatched: true });
    assert.deepEqual(trace, []); assert.deepEqual(envelopes, []);
  }
});

test("YCloud inbox stores only verified account-matched text atomically, with no legacy side effects", async () => {
  provider = "ycloud"; process.env.YCLOUD_INBOX_ONLY_WORKSPACES = id(1);
  assert.equal((await send(payload(), "wrong-secret")).status, 401); assert.deepEqual(trace, []);
  const response = await send(payload(), "fixture-signature-secret", "unused", false, "inbox");
  assert.deepEqual(await response.json(), { received: true, inboxOnly: true, accountMatched: true, recorded: true });
  assert.deepEqual(trace, ["resolve-connection", "materialize-inbox"]);
  assert.equal(envelopes[0].workspaceId, id(1)); assert.equal(envelopes[0].connectionId, id(3));
});
test("YCloud inbox ignores other accounts and status updates; persistence failure asks for retry", async () => {
  provider = "ycloud"; process.env.YCLOUD_INBOX_ONLY_WORKSPACES = id(1);
  for (const body of [receiptPayload(), { ...YCLOUD_TEXT, whatsappInboundMessage: { ...YCLOUD_TEXT.whatsappInboundMessage, to: "+15555550999" } }]) {
    assert.equal((await send(body)).status, 200); assert.deepEqual(trace, []);
  }
  storageFails = true; assert.equal((await send()).status, 500);
  assert.deepEqual(trace, ["resolve-connection", "materialize-inbox"]);
});
test("YCloud inbox rejects ambiguous modes, mismatched relay requirements and guessed sender identities", async () => {
  provider = "ycloud"; process.env.YCLOUD_INBOX_ONLY_WORKSPACES = id(1);
  assert.equal((await send(payload(), "fixture-signature-secret", "unused", false, "verify")).status, 503);
  assert.deepEqual(trace, []);
  process.env.YCLOUD_VERIFICATION_ONLY_WORKSPACES = id(1);
  assert.equal((await send()).status, 500); assert.deepEqual(trace, []);
  delete process.env.YCLOUD_VERIFICATION_ONLY_WORKSPACES;
  assert.equal((await send({ ...YCLOUD_TEXT, whatsappInboundMessage: { ...YCLOUD_TEXT.whatsappInboundMessage, from: "5555550101" } })).status, 500);
  assert.deepEqual(trace, ["resolve-connection"]);
});
test("YCloud verification rejects invalid signatures and does not attest foreign or missing business numbers", async () => {
  provider = "ycloud"; process.env.YCLOUD_VERIFICATION_ONLY_WORKSPACES = id(1);
  assert.equal((await send(payload(), "wrong-secret")).status, 401);
  for (const to of ["+15555550999", undefined, "5555550100"]) {
    const response = await send({ ...YCLOUD_TEXT, whatsappInboundMessage: { ...YCLOUD_TEXT.whatsappInboundMessage, to } });
    assert.equal((await response.json()).accountMatched, false); assert.deepEqual(trace, []);
  }
});
test("YCloud verification config fails closed; an unrelated workspace keeps its existing behavior", async () => {
  provider = "ycloud"; process.env.YCLOUD_VERIFICATION_ONLY_WORKSPACES = "*";
  assert.equal((await send()).status, 500); assert.deepEqual(trace, []);
  process.env.YCLOUD_VERIFICATION_ONLY_WORKSPACES = id(9);
  assert.equal((await send()).status, 200); assert.deepEqual(trace, ["resolve-connection", "persist-event", "legacy-dedup"]);
});
test("YCloud local verification health exposes no account data and cannot approve sending", async () => {
  process.env.YCLOUD_VERIFICATION_ONLY_WORKSPACES = id(1);
  const response = await ycloud.GET(new NextRequest(`http://localhost/api/webhooks/ycloud?wsid=${id(1)}`));
  assert.deepEqual(await response.json(), { verificationOnly: true, workspaceId: id(1) });
  assert.equal((await ycloud.GET(new NextRequest(`http://localhost/api/webhooks/ycloud?wsid=${id(9)}`))).status, 404);
  assert.deepEqual(trace, []);
});
test("YCloud relay requirement prevents legacy effects even when the flag is removed between health and POST", async () => {
  provider = "ycloud";
  assert.equal((await send(payload(), "fixture-signature-secret", "whatsapp.message.received", true)).status, 503);
  assert.deepEqual(trace, []);
  process.env.YCLOUD_VERIFICATION_ONLY_WORKSPACES = id(1);
  const result = await send(payload(), "fixture-signature-secret", "whatsapp.message.received", true);
  assert.equal((await result.json()).verificationOnly, true); assert.deepEqual(trace, []);
});
for (const channel of ["ycloud","kapso"] as const) {
  test(`${channel}: receipt signature precedes durable persistence; no batch/model/incoming message is reached`,async()=>{
    provider=channel;const payload=receiptPayload();
    assert.equal((await send(payload,"wrong","whatsapp.message.read")).status,401);assert.deepEqual(trace,[]);
    assert.equal((await send(payload,"fixture-signature-secret","whatsapp.message.read")).status,200);
    assert.deepEqual(trace,["resolve-connection","persist-receipt","legacy-status"]);
    assert.equal(envelopes[0].connectionId,id(3));assert.equal("content" in envelopes[0],false);
  });
  test(`${channel}: receipt storage failure asks for webhook retry before any legacy update`,async()=>{
    provider=channel;storageFails=true;
    assert.equal((await send(receiptPayload(),"fixture-signature-secret","whatsapp.message.read")).status,500);
    assert.deepEqual(trace,["resolve-connection","persist-receipt"]);
  });
}

function businessAppPayload() {
  return {phone_number_id:"synthetic-phone-id",message:{id:"wamid.app",to:"15555550101",type:"text",
    text:{body:"Respuesta humana"},timestamp:String(Math.floor(Date.now()/1000)-10),kapso:{origin:"business_app"}}};
}
test("Kapso: verified Business App echo uses atomic capture without the legacy writer or AI",async()=>{
  provider="kapso";const response=await send(businessAppPayload(),"fixture-signature-secret","whatsapp.message.sent");
  assert.equal(response.status,200);assert.equal((await response.json()).aiDisabled,true);
  assert.deepEqual(trace,["resolve-connection","persist-echo"]);
});
test("Kapso: failed Business App transaction returns 500 without legacy fallback",async()=>{
  provider="kapso";storageFails=true;assert.equal((await send(businessAppPayload(),"fixture-signature-secret","whatsapp.message.sent")).status,500);
  assert.deepEqual(trace,["resolve-connection","persist-echo"]);
});
test("Kapso: invalid echo timestamp cannot trigger a legacy takeover",async()=>{
  provider="kapso";const value=businessAppPayload();value.message.timestamp="invalid";
  const response=await send(value,"fixture-signature-secret","whatsapp.message.sent");assert.equal(response.status,200);
  assert.equal((await response.json()).recorded,false);assert.deepEqual(trace,["resolve-connection"]);
});
