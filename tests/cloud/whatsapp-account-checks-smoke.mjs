import assert from "node:assert/strict";
import { createServerClient } from "@supabase/ssr";
import { workspace, connection, id } from "../db/cloud-whatsapp-account-checks.mjs";
assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL, "https://bzanbpyzujlogipxvkfn.supabase.co");
const jar = new Map(), phase = process.argv[2] ?? "blocked";
const auth = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (rows) => rows.forEach((r) => jar.set(r.name, r.value)) } });
const login = await auth.auth.signInWithPassword({ email: process.env.QA_EMAIL, password: process.env.QA_PASSWORD });
assert.equal(login.error, null); assert.equal(login.data.user.id, process.env.QA_USER_ID);
const base = `http://localhost:3100/api/workspace/${workspace}/whatsapp-accounts/${connection}`;
let checks = 0;
async function request(target, method = "GET", body, anonymous = false) {
  return fetch(`${base}/${target}`, { method, redirect: "manual", signal: AbortSignal.timeout(45000), headers: {
    "Content-Type": "application/json", ...(anonymous ? {} : { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") }) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
}
async function expected(response, status) { assert.equal(response.status, status); checks++; return response; }
try {
  const mutation = (review, action, operationId) => ({ connectionId: connection, operationId, action,
    connectionUpdatedAt: review.connectionUpdatedAt, ...(action === "grant" ? { verificationCheckedAt: review.verificationCheckedAt, acknowledgeTextPermission: true } : {}) });
  if (phase === "manager" || phase === "inactive") {
    await expected(await request("verification"), phase === "manager" ? 200 : 403);
    await expected(await request("permissions"), phase === "manager" ? 200 : 403);
    await expected(await request("verification", "POST", { endpointId: "synthetic" }), 403);
    await expected(await request("permissions", "POST", { action: "revoke", connectionId: connection,
      operationId: id(801), connectionUpdatedAt: new Date().toISOString() }), 403);
  } else {
    await expected(await request("permissions", "GET", null, true), 401);
    const read = await expected(await request("permissions"), 200), review = (await read.json()).review;
    assert.equal(read.headers.get("Cache-Control"), "no-store"); checks++;
    await expected(await request("verification", "POST", { endpointId: "synthetic", callbackUrl: "https://evil.invalid" }), 400);
    if (phase === "blocked" || phase === "restored") {
      assert.ok(review.blockers.includes("public_origin_missing")); checks++;
      await expected(await request("verification", "POST", { endpointId: "synthetic" }), 409);
      await expected(await request("permissions", "POST", mutation(review, "grant", phase === "restored" ? id(703) : id(701))), 409);
    } else {
      assert.equal(review.canGrant, true); checks++;
      await expected(await request("permissions", "POST", mutation(review, "grant", id(701))), 200);
      const granted = (await (await expected(await request("permissions"), 200)).json()).review;
      assert.equal(granted.current, true); assert.equal(granted.canRevoke, true); checks++;
      await expected(await request("permissions", "POST", mutation(granted, "revoke", id(702))), 200);
      const replay = await expected(await request("permissions", "POST", mutation(review, "grant", id(701))), 200);
      const after = await replay.json(); assert.equal(after.applied, false); assert.equal(after.review.current, false); checks++;
    }
  }
  console.log(JSON.stringify({ phase, checks, passed: true, realProviderCalls: 0, realModelCalls: 0 }));
} finally { await auth.auth.signOut({ scope: "local" }); }
