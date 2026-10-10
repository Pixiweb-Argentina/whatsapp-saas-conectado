import assert from "node:assert/strict";
import { test } from "node:test";
import { whatsappChannelAdapter } from "./whatsapp-channel-adapter.ts";
import { channelSendRequestSchema, channelSendResultSchema } from "../types/send-contracts.ts";
import {
  WhatsAppConfigError, type WhatsAppSender, type SendResult,
} from "../../inbox/services/whatsapp-sender.ts";
import { YCloudError } from "../../inbox/services/ycloud-client.ts";
import { KapsoError } from "../../inbox/services/kapso-client.ts";

const textRequest = { action: "text" as const, channel: "whatsapp" as const,
  operationId: "op-1", recipient: "+15550001111", body: "Hola" };

function harness(provider: "ycloud" | "kapso", perform: () => Promise<SendResult>) {
  const calls: unknown[] = [];
  const sender: WhatsAppSender = {
    provider, label: provider, live: true,
    sendText: async (to, body) => { calls.push({ to, body }); return perform(); },
    sendTemplate: async (params) => { calls.push(params); return perform(); },
  };
  return { sender, calls, adapter: whatsappChannelAdapter(sender) };
}

test("both providers preserve WhatsApp and provider IDs without claiming delivery", async () => {
  for (const provider of ["ycloud", "kapso"] as const) {
    const h = harness(provider, async () => ({ wamid: "wamid-1", providerMessageId: "provider-1" }));
    const result = await h.adapter.send(textRequest);
    assert.deepEqual(result, { status: "accepted", externalId: "wamid-1",
      wamid: "wamid-1", providerMessageId: "provider-1" });
    assert.equal(h.calls.length, 1);
    assert.equal(channelSendResultSchema.safeParse(result).success, true);
  }
});

test("YCloud acceptance can use its provider ID before a wamid arrives", async () => {
  const h = harness("ycloud", async () => ({ providerMessageId: "yc-1" }));
  const result = await h.adapter.send(textRequest);
  assert.equal(result.status, "accepted");
  if (result.status === "accepted") assert.equal(result.externalId, "yc-1");
});

test("template language and flat component parameters survive the adapter", async () => {
  const h = harness("kapso", async () => ({ wamid: "wamid-template" }));
  const components = [{ type: "body" as const, parameters: [{ type: "text" as const, text: "Ana" }] }];
  const result = await h.adapter.send({ action: "template", channel: "whatsapp", operationId: "op-2",
    recipient: textRequest.recipient, templateName: "welcome", language: "es_MX", components });
  assert.equal(result.status, "accepted");
  assert.deepEqual(h.calls[0], { to: textRequest.recipient, templateName: "welcome",
    language: "es_MX", components });
});

test("a timeout or a malformed success response is unknown and never retried", async () => {
  for (const perform of [
    async () => { throw new Error("network timeout"); },
    async () => ({}),
    async () => ({ wamid: " " }),
  ]) {
    const h = harness("ycloud", perform);
    const result = await h.adapter.send(textRequest);
    assert.equal(result.status, "unknown");
    if (result.status === "unknown") assert.equal(result.operationId, "op-1");
    assert.equal(h.calls.length, 1);
    assert.equal("retryable" in result, false);
  }
});

test("HTTP 5xx and 408 stay ambiguous even with a retryable provider code", async () => {
  for (const ErrorClass of [YCloudError, KapsoError]) {
    for (const status of [503, 408]) {
      const h = harness("kapso", async () => {
        throw new ErrorClass(status, { error: { code: 130429 } }, "response");
      });
      const result = await h.adapter.send(textRequest);
      assert.equal(result.status, "unknown");
      assert.match(result.diagnostic?.message ?? "", /es posible que el mensaje sí haya llegado/);
      assert.equal(h.calls.length, 1);
    }
  }
});

test("explicit rate-limit rejection is safe to retry without an adapter retry loop", async () => {
  for (const body of [null, { error: { code: 130429 } }]) {
    const h = harness("ycloud", async () => { throw new YCloudError(429, body, "limit"); });
    const result = await h.adapter.send(textRequest);
    assert.equal(result.status, "rejected");
    if (result.status === "rejected") assert.equal(result.retryable, true);
    assert.equal(h.calls.length, 1);
  }
});

test("permanent errors keep remote details out of the normalized error code", async () => {
  const h = harness("kapso", async () => {
    throw new KapsoError(400, { error: { code: 131026, message: "remote detail" } }, "provider");
  });
  const result = await h.adapter.send(textRequest);
  assert.equal(result.status, "rejected");
  if (result.status === "rejected") {
    assert.equal(result.errorCode, "131026");
    assert.equal(result.retryable, false);
  }
  assert.equal(result.diagnostic?.message.includes("remote detail"), false);
});

test("missing configuration is rejected before submission, not ambiguous", async () => {
  const h = harness("ycloud", async () => { throw new WhatsAppConfigError("Falta configuración"); });
  const result = await h.adapter.send(textRequest);
  assert.equal(result.status, "rejected");
  if (result.status === "rejected") assert.equal(result.errorCode, "CONFIG_ERROR");
});

test("placeholder credentials never call the transport or claim acceptance", async () => {
  const h = harness("ycloud", async () => ({ wamid: "should-not-exist" }));
  h.sender.live = false;
  const result = await whatsappChannelAdapter(h.sender).send(textRequest);
  assert.deepEqual(result, { status: "rejected", errorCode: "NOT_LIVE", retryable: false });
  assert.equal(h.calls.length, 0);
});

test("unsupported channel/action and malformed input fail before provider invocation", async () => {
  const h = harness("ycloud", async () => ({ wamid: "should-not-exist" }));
  for (const request of [
    { ...textRequest, channel: "instagram" as const },
    { ...textRequest, action: "private_reply" as const, commentId: "comment-1" },
    { ...textRequest, recipient: "" },
    { ...textRequest, body: " " },
    { ...textRequest, operationId: "bad\nidentifier" },
  ]) assert.equal((await h.adapter.send(request)).status, "rejected");
  assert.equal(h.calls.length, 0);
});

test("schemas reject hidden request fields and ambiguous retry flags", () => {
  assert.equal(channelSendRequestSchema.safeParse({ ...textRequest, overrideAdmin: true }).success, false);
  assert.equal(channelSendResultSchema.safeParse({ status: "unknown", operationId: "op", retryable: true }).success, false);
  assert.equal(channelSendResultSchema.safeParse({ status: "accepted", externalId: "" }).success, false);
});
