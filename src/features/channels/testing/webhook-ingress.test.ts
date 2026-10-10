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
    assert.equal(name, "persist_channel_event"); trace.push("persist-event");
    envelopes.push(args.p_event as Record<string, unknown>);
    return { data: id(4), error: storageFails ? { message: "private details" } : null };
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
mock.module("@/features/inbox/services/message-status.ts", { exports: { applyMessageStatus: unused } });
mock.module("@/features/inbox/services/daily-events.ts", { exports: { emitEventOncePerDay: unused } });
const ycloud = await import("@/app/api/webhooks/ycloud/route.ts");
const kapso = await import("@/app/api/webhooks/kapso/route.ts");
afterEach(() => { trace.length = 0; envelopes.length = 0; storageFails = false; rowId = id(2); });

function payload() {
  const time = Date.now() - 10_000;
  return provider === "ycloud" ? { ...YCLOUD_TEXT, createTime: new Date(time).toISOString() }
    : { ...KAPSO_TEXT, message: { ...KAPSO_TEXT.message, timestamp: String(Math.floor(time / 1000)) } };
}
function send(body: unknown = payload(), secret = "fixture-signature-secret") {
  const raw = JSON.stringify(body);
  const time = Math.floor(Date.now() / 1000);
  const signed = provider === "ycloud" ? `${time}.${raw}` : raw;
  const digest = createHmac("sha256", secret).update(signed).digest("hex");
  const headers: Record<string, string> = provider === "ycloud"
    ? { "YCloud-Signature": `t=${time},s=${digest}` }
    : { "X-Webhook-Signature": digest, "X-Webhook-Event": "whatsapp.message.received" };
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
