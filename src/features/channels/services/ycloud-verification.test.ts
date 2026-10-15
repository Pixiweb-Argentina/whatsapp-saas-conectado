import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyYCloudAccount } from "./ycloud-verification";
import { validYCloudCallback } from "../types/ycloud-verification";

const ws = "00000000-0000-4000-8000-000000000001";
const input = { endpointId: "endpoint-1", callbackUrl: `https://test.trycloudflare.com/api/webhooks/ycloud?wsid=${ws}` };
const options = { workspaceId: ws, input, apiKey: "private-key", signingSecret: "private-secret", phoneNumber: "+15555550101" };
const endpoint = { id: input.endpointId, url: input.callbackUrl, status: "active", secret: options.signingSecret,
  enabledEvents: ["whatsapp.inbound_message.received", "whatsapp.message.updated"] };
const numbers = { items: [{ phoneNumber: options.phoneNumber, status: "CONNECTED" }], total: 1 };
function fetcher(replies: (path: string) => unknown, calls: string[] = []): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const target = String(url); calls.push(target);
    assert.equal(new URL(target).origin, "https://api.ycloud.com");
    assert.equal(init?.method, "GET"); assert.equal(init?.redirect, "error"); assert.equal(init?.cache, "no-store");
    assert.deepEqual(init?.headers, { "X-API-Key": options.apiKey });
    const value = replies(new URL(target).pathname + new URL(target).search);
    if (value instanceof Error) throw value;
    return value instanceof Response ? value : Response.json(value);
  }) as typeof fetch;
}

test("provider proof is read-only, exact, sanitized and never authorizes sending", async () => {
  const calls: string[] = [];
  const result = await verifyYCloudAccount(options, fetcher((path) => path.includes("webhookEndpoints") ? endpoint : numbers, calls), 1_790_000_000_000);
  assert.equal(calls.length, 2); assert.ok(Object.values(result.checks).every(Boolean));
  assert.equal(result.destination, "temporary"); assert.equal(result.sendAuthorization, false);
  assert.equal(result.providerRead, "complete");
  for (const value of [options.apiKey, options.signingSecret, options.phoneNumber]) assert.equal(JSON.stringify(result).includes(value), false);
});

test("wrong workspace destinations, credentials in URLs and injection never reach the network", async () => {
  for (const callbackUrl of [input.callbackUrl.replace(ws, "foreign"), input.callbackUrl + "&wsid=" + ws,
    input.callbackUrl + "#fragment", input.callbackUrl.replace("https:", "http:"),
    input.callbackUrl.replace("test.trycloudflare.com", "user:pass@example.org"),
    input.callbackUrl.replace("test.trycloudflare.com", "127.0.0.1"), input.callbackUrl.replace("test.trycloudflare.com", "x.local")]) {
    assert.equal(validYCloudCallback(callbackUrl, ws), false);
    await assert.rejects(() => verifyYCloudAccount({ ...options, input: { ...input, callbackUrl } },
      fetcher(() => { assert.fail("network must not be used"); })));
  }
  await assert.rejects(() => verifyYCloudAccount({ ...options, input: { ...input, endpointId: "../balance" } }, fetcher(() => assert.fail())));
});

test("every webhook mismatch remains pending and secret equality is exact", async () => {
  for (const [field, patch] of [
    ["webhook_active", { status: "pending" }], ["webhook_url", { url: input.callbackUrl + "&extra=1" }],
    ["webhook_events", { enabledEvents: ["whatsapp.inbound_message.received"] }],
    ["webhook_secret", { secret: "private-secreT" }], ["webhook_secret", { secret: "" }],
  ] as const) {
    const result = await verifyYCloudAccount(options, fetcher((path) => path.includes("webhookEndpoints") ? { ...endpoint, ...patch } : numbers));
    assert.equal(result.checks[field], false); assert.equal(result.sendAuthorization, false);
  }
  const wrongId = await verifyYCloudAccount(options, fetcher((path) => path.includes("webhookEndpoints") ? { ...endpoint, id: "other" } : numbers));
  assert.equal(wrongId.checks.webhook_secret, false); assert.equal(wrongId.providerRead, "incomplete");
});

test("pagination searches the saved number without returning another customer's numbers", async () => {
  const calls: string[] = [];
  const page = Array.from({ length: 100 }, (_, i) => ({ phoneNumber: `+1555555${String(i).padStart(4, "0")}`, status: "CONNECTED" }));
  const result = await verifyYCloudAccount(options, fetcher((path) => path.includes("webhookEndpoints") ? endpoint
    : path.includes("page=1&") ? { items: page, total: 101 } : numbers, calls));
  assert.equal(calls.length, 3); assert.equal(result.checks.connected_number, true);
  const partial = await verifyYCloudAccount(options, fetcher((path) => path.includes("webhookEndpoints") ? endpoint : { items: page, total: 600 }));
  assert.equal(partial.providerRead, "incomplete"); assert.equal(partial.checks.connected_number, false);
});

test("disconnected or inaccessible account and malformed/oversized responses fail closed", async () => {
  const disconnected = await verifyYCloudAccount(options, fetcher((p) => p.includes("webhookEndpoints") ? endpoint
    : { items: [{ ...numbers.items[0], status: "DISCONNECTED" }] }));
  assert.equal(disconnected.checks.connected_number, false);
  for (const value of [new Error("secret raw details"), new Response("private details", { status: 401 }),
    new Response("x".repeat(1_048_577)), { items: "bad" }]) {
    const result = await verifyYCloudAccount(options, fetcher(() => value));
    assert.equal(result.providerRead, "incomplete"); assert.ok(Object.values(result.checks).every((v) => !v));
    assert.equal(JSON.stringify(result).includes("private"), false);
  }
  const publicReport = await verifyYCloudAccount({ ...options, input: { ...input, callbackUrl: input.callbackUrl.replace("test.trycloudflare.com", "app.example.org") } },
    fetcher((p) => p.includes("webhookEndpoints") ? endpoint : numbers));
  assert.equal(publicReport.destination, "https_unconfirmed");
});
