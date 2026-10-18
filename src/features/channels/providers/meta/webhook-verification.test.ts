import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { META_WEBHOOK_MAX_BYTES, verifyMetaSignature, verifyMetaSubscription } from "./webhook-verification.ts";
import { readMetaConfig } from "./meta-config.ts";

const secret = "synthetic-app-secret-0001";
const body = Buffer.from('{"object":"instagram","entry":[]}');
const sign = (bytes: Uint8Array, key = secret) => `sha256=${createHmac("sha256", key).update(bytes).digest("hex")}`;

test("subscription echoes the challenge only for subscribe mode and the exact token", () => {
  const token = "synthetic-verify-token-0001";
  const params = (patch: Record<string, string>) => new URLSearchParams({
    "hub.mode": "subscribe", "hub.verify_token": token, "hub.challenge": "1158201444", ...patch });
  assert.equal(verifyMetaSubscription(params({}), token), "1158201444");
  assert.equal(verifyMetaSubscription(params({ "hub.verify_token": `${token}x` }), token), null);
  assert.equal(verifyMetaSubscription(params({ "hub.mode": "unsubscribe" }), token), null);
  assert.equal(verifyMetaSubscription(params({ "hub.challenge": "<script>" }), token), null);
  assert.equal(verifyMetaSubscription(params({ "hub.verify_token": "" }), ""), null);
});

test("signature covers the raw bytes, not a re-serialized body", () => {
  assert.equal(verifyMetaSignature(body, sign(body), secret), true);
  assert.equal(verifyMetaSignature(body, sign(body).toUpperCase().replace("SHA256", "sha256"), secret), true);
  const reformatted = Buffer.from(JSON.stringify(JSON.parse(body.toString()), null, 1));
  assert.equal(verifyMetaSignature(reformatted, sign(body), secret), false);
  assert.equal(verifyMetaSignature(body, sign(body, "another-secret-value"), secret), false);
});

test("missing, legacy sha1, malformed or oversized input is rejected", () => {
  assert.equal(verifyMetaSignature(body, null, secret), false);
  assert.equal(verifyMetaSignature(body, `sha1=${"a".repeat(40)}`, secret), false);
  assert.equal(verifyMetaSignature(body, "sha256=zz", secret), false);
  assert.equal(verifyMetaSignature(body, sign(body), ""), false);
  assert.equal(verifyMetaSignature(new Uint8Array(), sign(new Uint8Array()), secret), false);
  const huge = Buffer.alloc(META_WEBHOOK_MAX_BYTES + 1, 32);
  assert.equal(verifyMetaSignature(huge, sign(huge), secret), false);
});

test("Meta config is all-or-nothing and never invents a Graph version", () => {
  const env = { META_APP_ID: "123456789012345", META_APP_SECRET: "synthetic-app-secret-0001",
    META_WEBHOOK_VERIFY_TOKEN: "synthetic-verify-token-0001", META_GRAPH_API_VERSION: "v23.0",
    META_REDIRECT_URI: "https://dashboard.example.test/api/integrations/meta/callback" };
  assert.equal(readMetaConfig(env)?.graphApiVersion, "v23.0");
  assert.equal(readMetaConfig({ ...env, META_GRAPH_API_VERSION: undefined }), null);
  assert.equal(readMetaConfig({ ...env, META_GRAPH_API_VERSION: "latest" }), null);
  assert.equal(readMetaConfig({ ...env, META_REDIRECT_URI: "http://insecure.example.test/cb" }), null);
  assert.equal(readMetaConfig({}), null);
});
