import assert from "node:assert/strict";
import { test } from "node:test";
import { Readable } from "node:stream";
import { createPilotRelay } from "./ycloud-pilot-relay.mjs";
const ws = "ff50ed19-6330-43c1-a69d-32252c9ca756";
const url = `/api/webhooks/ycloud?wsid=${ws}`;
function request(patch = {}, body = [Buffer.from('{"private":"sentinel"}')]) {
  return Object.assign(Readable.from(body), { method: "POST", url,
    headers: { "content-type": "application/json", "ycloud-signature": "signature", cookie: "private-session" } }, patch);
}
function response() {
  return { headersSent: false, status: 0, body: "", writeHead(status) { this.status = status; this.headersSent = true; },
    end(value) { this.body = value; } };
}
function fixture(healthy = true) {
  const calls = [];
  const relay = createPilotRelay(ws, async (target, options) => {
    calls.push({ target, options });
    return new Response(JSON.stringify(options.method === "POST" ? { verificationOnly: true, accountMatched: true }
      : { verificationOnly: healthy, workspaceId: ws }), { status: 200 });
  });
  return { relay, calls };
}
test("relay exposes only one POST route/workspace and never forwards other APIs or query overrides", async () => {
  const { relay, calls } = fixture();
  for (const patch of [{ method: "GET" }, { url: "/settings" }, { url: "/api/workspace/x/integrations" },
    { url: `${url}&wsid=foreign` }, { url: `${url}&extra=1` }, { url: "/api/webhooks/ycloud?wsid=foreign" }]) {
    const res = response(); await relay.handler(request(patch), res); assert.equal(res.status, 404);
  }
  assert.equal(calls.length, 0);
});
test("relay requires signature, JSON and bounded bodies before forwarding", async () => {
  const { relay, calls } = fixture();
  for (const [headers, code] of [[{}, 401], [{ "ycloud-signature": "x", "content-type": "text/plain" }, 415],
    [{ "ycloud-signature": "x", "content-type": "application/json", "content-length": "131073" }, 413]]) {
    const res = response(); await relay.handler(request({ headers }), res); assert.equal(res.status, code);
  }
  const res = response(); await relay.handler(request({}, [Buffer.alloc(131073)]), res); assert.equal(res.status, 413);
  assert.equal(calls.filter((c) => c.options.method === "POST").length, 0);
});
test("disabled verification mode stops a delivery before forwarding; no cookies or arbitrary target", async () => {
  const disabled = fixture(false), res = response();
  await disabled.relay.handler(request(), res); assert.equal(res.status, 503); assert.equal(disabled.calls.length, 1);
  const enabled = fixture(), ok = response(); await enabled.relay.handler(request(), ok);
  assert.equal(ok.status, 200); assert.equal(enabled.relay.stats.matched, 1);
  const send = enabled.calls[1]; assert.equal(send.target, `http://127.0.0.1:3100${url}`);
  assert.deepEqual(send.options.headers, { "content-type": "application/json", "YCloud-Signature": "signature",
    "X-YCloud-Reception-Mode": "verify" });
  assert.equal(send.options.body.toString(), '{"private":"sentinel"}'); assert(!ok.body.includes("sentinel"));
});
test("upstream errors and timeouts are redacted and never acknowledged as verified", async () => {
  const relay = createPilotRelay(ws, async () => { throw new Error("private-credential-sentinel"); });
  const res = response(); await relay.handler(request(), res); assert.equal(res.status, 503); assert(!res.body.includes("sentinel"));
  assert.equal(relay.stats.matched, 0);
});
test("verification relay has a bounded request budget", async () => {
  const { relay, calls } = fixture(false);
  for (let i = 0; i < 31; i++) { const res = response(); await relay.handler(request(), res);
    assert.equal(res.status, i === 30 ? 429 : 503); }
  assert.equal(calls.length, 30);
});

test("inbox relay requires an equally scoped inbox acknowledgement and never leaks upstream data", async () => {
  for (const correct of [true, false]) {
    const calls = [];
    const relay = createPilotRelay(ws, async (target, options) => {
      calls.push({ target, options });
      return new Response(JSON.stringify(options.method === "POST"
        ? { inboxOnly: correct, verificationOnly: !correct, accountMatched: true, recorded: true, private: "sentinel" }
        : { inboxOnly: true, workspaceId: ws }), { status: 200 });
    });
    const res = response(); await relay.handler(request(), res);
    assert.equal(calls[1].options.headers["X-YCloud-Reception-Mode"], "inbox");
    assert.equal(res.status, correct ? 200 : 503); assert(!res.body.includes("sentinel"));
    assert.equal(relay.stats.matched, correct ? 1 : 0);
  }
});

test("inbox relay distinguishes receipt storage from a newly recorded incoming message", async () => {
  const relay = createPilotRelay(ws, async (_target, options) => new Response(JSON.stringify(options.method === "POST"
    ? { inboxOnly: true, accountMatched: true, recorded: false, receiptRecorded: true, private: "sentinel" }
    : { inboxOnly: true, workspaceId: ws }), { status: 200 }));
  const res = response(); await relay.handler(request(), res);
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.body), { received: true, inboxOnly: true, accountMatched: true,
    recorded: false, receiptRecorded: true });
  assert(!res.body.includes("sentinel"));
});

test("pipeline relay requires its explicit acknowledgement and only forwards bounded intake results", async () => {
  for (const ambiguous of [false, true]) {
    const relay = createPilotRelay(ws, async (_target, options) => new Response(JSON.stringify(options.method === "POST"
      ? { pipeline: true, inboxOnly: ambiguous, recorded: true, aiBuffered: true, accountMatched: true, private: "sentinel" }
      : { pipeline: true, workspaceId: ws }), { status: 200 }));
    const res = response(); await relay.handler(request(), res);
    assert.equal(res.status, ambiguous ? 503 : 200); assert(!res.body.includes("sentinel"));
    if (!ambiguous) assert.deepEqual(JSON.parse(res.body), { received: true, pipeline: true,
      recorded: true, aiBuffered: true, accountMatched: true });
  }
});
