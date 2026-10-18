import assert from "node:assert/strict";
import { test } from "node:test";

process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.ENCRYPTION_KEY_VERSION = "v1";
const { sealMetaCredentials, openMetaCredentials, metaConnectionReadiness } = await import("./meta-credentials.ts");

const owner = {
  workspaceId: "11111111-1111-4111-8111-111111111111",
  connectionId: "22222222-2222-4222-8222-222222222222",
};
const credentials = {
  accessToken: "synthetic-token-test-only",
  tokenExpiresAt: "2026-12-01T00:00:00.000Z",
  igUserId: "ig-user-test",
  pageId: null,
  grantedScopes: ["scope_a", "scope_b"],
};

test("seal and open round trip without leaking the token", async () => {
  const sealed = await sealMetaCredentials(owner, credentials);
  assert.equal(sealed.keyVersion, 1);
  assert.match(sealed.encryptedPayload, /^enc:v1:/);
  assert.equal(sealed.encryptedPayload.includes(credentials.accessToken), false);
  assert.deepEqual(await openMetaCredentials(owner, sealed.encryptedPayload), credentials);
});

test("the sealed payload is bound to workspace and connection", async () => {
  const { encryptedPayload } = await sealMetaCredentials(owner, credentials);
  const otherWorkspace = { ...owner, workspaceId: "33333333-3333-4333-8333-333333333333" };
  const otherConnection = { ...owner, connectionId: "33333333-3333-4333-8333-333333333333" };
  for (const wrong of [otherWorkspace, otherConnection]) {
    await assert.rejects(openMetaCredentials(wrong, encryptedPayload), /META_CREDENTIAL_DECRYPT_FAILED/);
  }
});

test("plaintext is never accepted as a stored payload", async () => {
  await assert.rejects(openMetaCredentials(owner, JSON.stringify(credentials)), /META_CREDENTIAL_FORMAT_INVALID/);
});

test("ciphertext, extra fields and bad owners are rejected on seal", async () => {
  const { encryptedPayload } = await sealMetaCredentials(owner, credentials);
  await assert.rejects(sealMetaCredentials(owner, { ...credentials, accessToken: encryptedPayload }),
    /META_CREDENTIAL_INPUT_INVALID/);
  await assert.rejects(sealMetaCredentials(owner, { ...credentials, appSecret: "x" }));
  await assert.rejects(sealMetaCredentials({ ...owner, workspaceId: "not-a-uuid" }, credentials));
});

const now = Date.parse("2026-11-01T00:00:00.000Z");
const facts = {
  revoked: false, grantedScopes: ["scope_a", "scope_b"], requiredScopes: ["scope_a", "scope_b"],
  tokenExpiresAt: "2026-12-01T00:00:00.000Z", webhookVerifiedAt: "2026-10-30T00:00:00.000Z",
};

test("readiness is ready only with live token, all scopes and a verified webhook", () => {
  assert.deepEqual(metaConnectionReadiness(facts, now), { status: "ready", missingScopes: [] });
  assert.equal(metaConnectionReadiness({ ...facts, webhookVerifiedAt: null }, now).status, "awaiting_webhook");
  assert.equal(metaConnectionReadiness({ ...facts, tokenExpiresAt: null }, now).status, "ready");
});

test("missing scopes, expired token or unknown requirements need permissions", () => {
  assert.deepEqual(metaConnectionReadiness({ ...facts, grantedScopes: ["scope_a"] }, now),
    { status: "needs_permissions", missingScopes: ["scope_b"] });
  assert.equal(metaConnectionReadiness({ ...facts, tokenExpiresAt: "2026-11-01T00:00:00.000Z" }, now).status,
    "needs_permissions");
  assert.equal(metaConnectionReadiness({ ...facts, requiredScopes: [] }, now).status, "needs_permissions");
});

test("revocation wins over everything else", () => {
  assert.equal(metaConnectionReadiness({ ...facts, revoked: true }, now).status, "revoked");
});
