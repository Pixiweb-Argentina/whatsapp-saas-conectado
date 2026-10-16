import assert from "node:assert/strict";
import { createServerClient } from "@supabase/ssr";
import { workspace, connection, id } from "../db/cloud-kapso-account-checks.mjs";
assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL, "https://bzanbpyzujlogipxvkfn.supabase.co");
const jar = new Map(), phase = process.argv[2] ?? "blocked";
const auth = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (rows) => rows.forEach((r) => jar.set(r.name, r.value)) } });
const login = await auth.auth.signInWithPassword({ email: process.env.QA_EMAIL, password: process.env.QA_PASSWORD });
assert.equal(login.error, null); assert.equal(login.data.user.id, process.env.QA_USER_ID);
const base = `http://localhost:3100/api/workspace/${workspace}/whatsapp-accounts/${connection}`;
let checks = 0;
const check = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
async function request(target, method = "GET", body, anonymous = false) {
  return fetch(`${base}/${target}`, { method, redirect: "manual", signal: AbortSignal.timeout(45000), headers: {
    "Content-Type": "application/json", ...(anonymous ? {} : { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") }) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
}
async function expected(response, status) { check(response.status, status); return response; }
const grant = (review, operationId) => ({ connectionId: connection, operationId, action: "grant", acknowledgeTextPermission: true,
  connectionUpdatedAt: review.connectionUpdatedAt, verificationCheckedAt: review.verificationCheckedAt });
try {
  if (phase === "manager" || phase === "inactive") {
    await expected(await request("verification"), phase === "manager" ? 200 : 403);
    await expected(await request("permissions"), phase === "manager" ? 200 : 403);
    await expected(await request("verification", "POST", { endpointId: id(901) }), 403);
    await expected(await request("permissions", "POST", { action: "revoke", connectionId: connection,
      operationId: id(801), connectionUpdatedAt: new Date().toISOString() }), 403);
  } else {
    await expected(await request("permissions", "GET", null, true), 401);
    const read = await expected(await request("permissions"), 200), review = (await read.json()).review;
    check(read.headers.get("Cache-Control"), "no-store"); check(review.blockers.includes("unsupported_provider"), false);
    await expected(await request("verification", "POST", { endpointId: id(901), callbackUrl: "https://evil.invalid" }), 400);
    if (phase === "blocked" || phase === "restored") {
      check(review.blockers.includes("public_origin_missing"), true);
      await expected(await request("verification", "POST", { endpointId: id(901) }), 409);
      await expected(await request("permissions", "POST", grant(review, phase === "restored" ? id(705) : id(701))), 409);
    } else if (phase === "grant") {
      const proofResponse = await expected(await request("verification"), 200), proof = (await proofResponse.json()).verification;
      check(proof.current, true); check(proof.report.sendAuthorization, false); check(Object.values(proof.report.checks).every(Boolean), true);
      check(review.canGrant, true); check(review.current, false);
      await expected(await request("permissions", "POST", grant(review, id(701))), 200);
      const after = (await (await expected(await request("permissions"), 200)).json()).review;
      check(after.current, true); check(after.canRevoke, true);
      check(Date.parse(after.validUntil), Date.parse(after.verificationCheckedAt) + 86400000);
    } else if (phase === "renew") {
      check(review.current, true); const oldUntil = review.validUntil;
      check(Date.parse(review.verificationCheckedAt) + 86400000 > Date.parse(oldUntil), true);
      await expected(await request("permissions", "POST", grant(review, id(702))), 200);
      const renewed = (await (await expected(await request("permissions"), 200)).json()).review;
      check(renewed.current, true); check(Date.parse(renewed.validUntil) > Date.parse(oldUntil), true);
      await expected(await request("permissions", "POST", { connectionId: connection, operationId: id(703), action: "revoke",
        connectionUpdatedAt: renewed.connectionUpdatedAt }), 200);
      for (const operation of [id(701), id(702)]) {
        const replay = await expected(await request("permissions", "POST", grant(review, operation)), 200);
        const after = await replay.json(); check(after.applied, false); check(after.review.current, false);
      }
    } else throw new Error("UNKNOWN_SMOKE_PHASE");
  }
  console.log(JSON.stringify({ phase, checks, passed: true, providerReads: 0, providerSends: 0, modelCalls: 0, evidence: "fabricated SQL proof only" }));
} finally { await auth.auth.signOut({ scope: "local" }); }
