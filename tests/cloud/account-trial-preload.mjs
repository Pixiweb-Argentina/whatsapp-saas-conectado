// QA process only. Import explicitly via NODE_OPTIONS; never referenced by application code.
import assert from "node:assert/strict";
import { appendFile } from "node:fs/promises";
assert.equal(process.env.ACCOUNT_TRIAL_NETWORK_QA, "synthetic-only");
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (["api.ycloud.com", "api.kapso.ai"].includes(url.hostname)) {
    const provider = url.hostname === "api.ycloud.com" ? "ycloud" : "kapso";
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init.headers).get("X-API-Key"), `synthetic-account-trial-${provider}`);
    const body = JSON.parse(init.body);
    assert.equal(body.to.replace(/^\+/, ""), "15555550101");
    assert.equal(body.text.body, "Hola, este es un mensaje de prueba de Pixiweb. Recibimos tu mensaje correctamente.");
    assert.equal(url.href, provider === "ycloud" ? "https://api.ycloud.com/v2/whatsapp/messages"
      : "https://api.kapso.ai/meta/whatsapp/v24.0/155555507000001/messages");
    if (provider === "ycloud") assert.equal(body.from, "+15555550700");
    await appendFile("test-results/f3-account-trial-intercepts.jsonl", JSON.stringify({ provider, intercepted: true, realProviderCalls: 0 }) + "\n");
    if (provider === "ycloud") throw new Error("Synthetic uncertainty after authorization; no real POST");
    return Response.json({ messages: [{ id: "wamid.trial36" }] });
  }
  // Only Cloud project data and this laboratory may leave the QA process.
  assert.ok(["https://bzanbpyzujlogipxvkfn.supabase.co", "http://localhost:3100", "http://127.0.0.1:3100"].includes(url.origin), "QA network destination blocked");
  return realFetch(input, init);
};
