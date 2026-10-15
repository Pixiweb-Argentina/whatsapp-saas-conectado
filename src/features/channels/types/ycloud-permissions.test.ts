import assert from "node:assert/strict";
import { test } from "node:test";
import { configuredYCloudCallback, ycloudPermissionMutationSchema } from "./ycloud-permissions";
const ws = "00000000-0000-4000-8000-000000000001";
const mutation = { action: "grant", connectionId: ws, operationId: "00000000-0000-4000-8000-000000000002",
  connectionUpdatedAt: "2026-10-15T12:00:00.000Z", verificationCheckedAt: "2026-10-15T12:00:00.000Z", acknowledgeTextPermission: true };

test("a public callback can only come from a valid stable server origin", () => {
  assert.equal(configuredYCloudCallback(ws, "https://app.example.org"), `https://app.example.org/api/webhooks/ycloud?wsid=${ws}`);
  for (const origin of [undefined, "http://app.example.org", "https://test.trycloudflare.com", "https://x.ngrok-free.app",
    "https://x.ngrok.io", "https://user:pass@app.example.org", "https://app.example.org/other", "https://app.example.org/?wsid=foreign",
    "https://app.example.org/#secret", "https://127.0.0.1", "https://app.localhost", "https://app.example.org:8443"]) {
    assert.equal(configuredYCloudCallback(ws, origin), null);
  }
  assert.equal(configuredYCloudCallback("foreign", "https://app.example.org"), null);
});

test("grant needs explicit acknowledgement and immutable server-review timestamps; clients cannot supply policy facts", () => {
  assert.equal(ycloudPermissionMutationSchema.safeParse(mutation).success, true);
  for (const patch of [{ acknowledgeTextPermission: false }, { verificationCheckedAt: undefined }, { connectionId: "foreign" },
    { expectedCallback: "https://evil.example.org" }, { workspaceId: ws }, { capabilities: ["text"] }, { validUntil: "2099-01-01T00:00:00Z" }]) {
    assert.equal(ycloudPermissionMutationSchema.safeParse({ ...mutation, ...patch }).success, false);
  }
  assert.equal(ycloudPermissionMutationSchema.safeParse({ action: "revoke", connectionId: ws,
    operationId: mutation.operationId, connectionUpdatedAt: mutation.connectionUpdatedAt }).success, true);
});
