import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyKapsoAccount } from "./kapso-verification.ts";
import { kapsoAccountVerificationInputSchema } from "../types/whatsapp-account-checks.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const input = { endpointId: id(901), callbackUrl: `https://permissions.example.org/api/webhooks/whatsapp-accounts/${id(1)}/${id(51)}` };
const options = { workspaceId: id(1), connectionId: id(51), phoneNumberId: "155555507000001",
  apiKey: "synthetic-kapso-key", signingSecret: "synthetic-kapso-secret", input };
const number = { data: { id: options.phoneNumberId, phone_number_id: options.phoneNumberId, status: "CONNECTED", inbound_processing_enabled: true } };
const endpoint = { data: { id: input.endpointId, phone_number_id: options.phoneNumberId, kind: "kapso", active: true,
  url: input.callbackUrl, secret_key: options.signingSecret, buffer_enabled: false, payload_version: "v2",
  events: ["whatsapp.message.received", "whatsapp.message.sent", "whatsapp.message.delivered", "whatsapp.message.read", "whatsapp.message.failed"] } };
function fetcher(replies: (webhook: boolean) => unknown, calls: string[] = []): typeof fetch {
  return async (url, init) => {
    const target = String(url); calls.push(target);
    const base = `https://api.kapso.ai/platform/v1/whatsapp/phone_numbers/${options.phoneNumberId}`;
    assert.ok(target === base || target === `${base}/webhooks/${input.endpointId}`);
    assert.equal(init?.method, "GET"); assert.equal(init?.redirect, "error"); assert.equal(init?.cache, "no-store");
    assert.ok(init?.signal instanceof AbortSignal);
    assert.equal(new Headers(init?.headers).get("X-API-Key"), options.apiKey);
    const value = replies(target.includes("/webhooks/")); if (value instanceof Error) throw value;
    return value instanceof Response ? value : Response.json(value);
  };
}
test("Kapso verification reads only exact number/webhook, returns no secrets and grants nothing", async () => {
  const calls: string[] = [];
  const report = await verifyKapsoAccount(options, fetcher((webhook) => webhook ? endpoint : number, calls));
  assert.equal(calls.length, 2); assert.ok(Object.values(report.checks).every(Boolean));
  assert.equal(report.sendAuthorization, false); assert.equal(report.providerRead, "complete");
  assert.equal(report.destination, "https_unconfirmed");
  for (const value of [options.apiKey, options.signingSecret, options.phoneNumberId]) assert.equal(JSON.stringify(report).includes(value), false);
});
test("Kapso requires numeric phone ID, UUID endpoint and exact stable-shaped callback before network", async () => {
  const noFetch: typeof fetch = async () => assert.fail("network must not be used");
  for (const patch of [{ phoneNumberId: "../other" }, { phoneNumberId: "https://evil.invalid" }, { apiKey: "" }, { signingSecret: "" },
    { connectionId: id(52) }, { input: { ...input, endpointId: "not-a-uuid" } }, { input: { ...input, callbackUrl: input.callbackUrl + "?evil=true" } },
    { input: { ...input, callbackUrl: input.callbackUrl.replace("permissions.example.org", "127.0.0.1") } }]) {
    await assert.rejects(verifyKapsoAccount({ ...options, ...patch }, noFetch));
  }
  assert.equal(kapsoAccountVerificationInputSchema.safeParse({ endpointId: "not-a-uuid" }).success, false);
  assert.equal(kapsoAccountVerificationInputSchema.parse({ endpointId: ` ${input.endpointId} ` }).endpointId, input.endpointId);
});
test("wrong/unknown webhook owner, identity and project-wide destinations never verify", async () => {
  for (const patch of [{ id: id(902) }, { phone_number_id: "155555507000002" }, { phone_number_id: null }]) {
    const report = await verifyKapsoAccount(options, fetcher((webhook) => webhook ? { data: { ...endpoint.data, ...patch } } : number));
    assert.equal(report.providerRead, "incomplete"); assert.equal(report.checks.webhook_secret, false);
  }
  for (const patch of [{ id: "155555507000002" }, { phone_number_id: "155555507000002" }, { status: "DISCONNECTED" }, { inbound_processing_enabled: false }]) {
    const report = await verifyKapsoAccount(options, fetcher((webhook) => webhook ? endpoint : { data: { ...number.data, ...patch } }));
    assert.equal(report.checks.connected_number, false);
  }
});
test("inactive, wrong URL, secret, Meta/v1/buffered webhook or missing receipt events block permission proof", async () => {
  for (const [key, patch] of [["webhook_active", { active: false }], ["webhook_url", { url: input.callbackUrl + "/" }],
    ["webhook_secret", { secret_key: "wrong-secret" }], ["webhook_secret", { secret_key: null }],
    ["webhook_events", { events: ["whatsapp.message.received"] }], ["webhook_events", { kind: "meta" }],
    ["webhook_events", { payload_version: "v1" }], ["webhook_events", { payload_version: null }],
    ["webhook_events", { buffer_enabled: true }], ["webhook_events", { buffer_enabled: null }]] as const) {
    const report = await verifyKapsoAccount(options, fetcher((webhook) => webhook ? { data: { ...endpoint.data, ...patch } } : number));
    assert.equal(report.checks[key], false); assert.equal(report.sendAuthorization, false);
  }
});
test("Kapso read failures, malformed, oversized and aborted replies remain incomplete and redacted", async () => {
  for (const value of [new Error("private-provider-details"), new Response("private-provider-details", { status: 401 }),
    new Response("x".repeat(1_048_577)), new Response("{"), { data: { unexpected: true } }]) {
    const report = await verifyKapsoAccount(options, fetcher(() => value));
    assert.equal(report.providerRead, "incomplete"); assert.ok(Object.values(report.checks).every((value) => !value));
    assert.equal(JSON.stringify(report).includes("private-provider-details"), false);
  }
});
