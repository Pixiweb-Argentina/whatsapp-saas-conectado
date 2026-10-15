import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthenticatedWhatsAppDelivery } from "./whatsapp-event-ingress";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const workspaceId = id(1);
let resolutions = 0;
mock.module("./whatsapp-event-ingress.ts", { exports: {
  resolveWhatsAppConnection: async () => { resolutions++; return { id: id(3) }; },
} });
const { captureWhatsAppReceipt } = await import("./delivery-receipt-store.ts");
afterEach(() => {
  resolutions = 0;
  for (const key of ["CHANNEL_INGRESS_WORKSPACES", "YCLOUD_INBOX_ONLY_WORKSPACES", "YCLOUD_VERIFICATION_ONLY_WORKSPACES"]) {
    delete process.env[key];
  }
});
const input: AuthenticatedWhatsAppDelivery = {
  workspaceId, integrationId: id(2), provider: "ycloud", configuredAccountId: "+15555550100",
  payload: { id: "evt.synthetic-receipt-store", type: "whatsapp.message.updated", createTime: "2026-10-10T12:00:00Z",
    whatsappMessage: { id: "synthetic-provider-id", from: "+15555550100", to: "+15555550101", status: "read" } },
};
const now = () => Date.parse("2026-10-10T12:01:00Z");

function fixture(fail = false) {
  const calls: Array<{ name: string; args: unknown }> = [];
  const db = { rpc: async (name: string, args: unknown) => {
    calls.push({ name, args }); return { data: id(4), error: fail ? { message: "private-sentinel" } : null };
  } } as unknown as SupabaseClient;
  return { db, calls };
}

test("receipt inbox exception is limited to the explicitly listed YCloud workspace", async () => {
  const f = fixture(); process.env.YCLOUD_INBOX_ONLY_WORKSPACES = workspaceId;
  assert.equal(await captureWhatsAppReceipt(f.db, { ...input, workspaceId: id(9) }, now), "disabled");
  assert.equal(await captureWhatsAppReceipt(f.db, { ...input, provider: "kapso" }, now), "disabled");
  assert.equal(resolutions, 0); assert.equal(f.calls.length, 0);
  assert.equal(await captureWhatsAppReceipt(f.db, input, now), "persisted");
  assert.equal(resolutions, 1); assert.deepEqual(f.calls.map((call) => call.name), ["persist_channel_receipt"]);
});

test("verify mode remains without writes even if normal ingress is enabled", async () => {
  const f = fixture(); process.env.YCLOUD_VERIFICATION_ONLY_WORKSPACES = workspaceId;
  process.env.CHANNEL_INGRESS_WORKSPACES = workspaceId;
  assert.equal(await captureWhatsAppReceipt(f.db, input, now), "disabled");
  assert.equal(resolutions, 0); assert.deepEqual(f.calls, []);
});

test("ambiguous or invalid reception config cannot authorize receipt storage", async () => {
  const f = fixture(); process.env.YCLOUD_INBOX_ONLY_WORKSPACES = workspaceId;
  process.env.YCLOUD_VERIFICATION_ONLY_WORKSPACES = workspaceId;
  await assert.rejects(captureWhatsAppReceipt(f.db, input, now), { message: "YCLOUD_RECEPTION_CONFIG_CONFLICT" });
  delete process.env.YCLOUD_VERIFICATION_ONLY_WORKSPACES; process.env.YCLOUD_INBOX_ONLY_WORKSPACES = "*";
  await assert.rejects(captureWhatsAppReceipt(f.db, input, now), { message: "YCLOUD_VERIFICATION_CONFIG_INVALID" });
  assert.equal(resolutions, 0); assert.deepEqual(f.calls, []);
});

test("receipt storage errors expose no raw database error", async () => {
  process.env.YCLOUD_INBOX_ONLY_WORKSPACES = workspaceId;
  await assert.rejects(captureWhatsAppReceipt(fixture(true).db, input, now), { message: "CHANNEL_RECEIPT_STORAGE_FAILED" });
});
