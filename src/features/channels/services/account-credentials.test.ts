import assert from "node:assert/strict";
import { test } from "node:test";

process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.ENCRYPTION_KEY_VERSION = "v1";
const { sealAccountCredentials, openAccountCredentials } = await import("./account-credentials.ts");
const owner = { workspaceId: "00000000-0000-4000-8000-000000000001",
  connectionId: "00000000-0000-4000-8000-000000000051", provider: "ycloud" as const };
const secrets = { apiKey: "synthetic-api-key", signingSecret: "synthetic-signing-secret" };

test("account credentials round-trip with fresh randomized ciphertext and no plaintext", async () => {
  const first = await sealAccountCredentials(owner, secrets), second = await sealAccountCredentials(owner, secrets);
  assert.notEqual(first.encryptedPayload, second.encryptedPayload);
  assert.equal(first.keyVersion, 1); assert.match(first.encryptedPayload, /^enc:v1:/);
  assert.equal(first.encryptedPayload.includes(secrets.apiKey), false);
  assert.deepEqual(await openAccountCredentials(owner, first.encryptedPayload), secrets);
});
test("copying credentials to another account, workspace or provider fails authentication", async () => {
  const sealed = await sealAccountCredentials(owner, secrets);
  for (const patch of [{ connectionId: "00000000-0000-4000-8000-000000000052" },
    { workspaceId: "00000000-0000-4000-8000-000000000002" }, { provider: "kapso" as const }]) {
    await assert.rejects(() => openAccountCredentials({ ...owner, ...patch }, sealed.encryptedPayload), /DECRYPT_FAILED/);
  }
});
test("no plaintext fallback, malformed owner or already-encrypted form credentials", async () => {
  await assert.rejects(() => openAccountCredentials(owner, JSON.stringify(secrets)), /FORMAT_INVALID/);
  await assert.rejects(() => sealAccountCredentials({ ...owner, connectionId: "invalid" }, secrets));
  await assert.rejects(() => sealAccountCredentials(owner, { ...secrets, apiKey: "enc:v1:opaque:opaque" }), /INPUT_INVALID/);
  await assert.rejects(() => sealAccountCredentials(owner, { ...secrets, injected: true }));
});
