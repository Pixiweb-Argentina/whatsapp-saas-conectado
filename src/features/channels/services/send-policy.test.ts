import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateSendPolicy, legacyWhatsAppTextAllowed } from "./send-policy.ts";
import type { SendPolicyInput } from "../types/send-policy.ts";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const connectionId = "22222222-2222-4222-8222-222222222222";
const otherId = "33333333-3333-4333-8333-333333333333";
const occurredAt = "2026-10-10T10:00:00Z";
const validUntil = "2026-10-11T10:00:00Z";
const now = Date.parse("2026-10-10T12:00:00Z");

function context(): SendPolicyInput {
  return {
    workspaceId, connection: { workspaceId, connectionId, channel: "instagram",
      provider: "meta", externalAccountId: "ig-account", status: "ready" },
    identity: { workspaceId, connectionId, externalActorId: "actor-1" },
    request: { action: "text", channel: "instagram", operationId: "op-1",
      recipient: "actor-1", body: "Tu guía" },
    actor: "ai", phase: "enqueue", now, optedOut: false,
    conversation: { workspaceId, connectionId, channel: "instagram",
      externalActorId: "actor-1", state: "ai_active", aiEnabled: true, revision: 4, expectedRevision: 4 },
    capabilities: [{ workspaceId, connectionId, capability: "text", verifiedAt: occurredAt,
      evidenceRef: "synthetic-test-only" }],
    evidence: { workspaceId, connectionId, externalActorId: "actor-1", id: "message-1",
      kind: "inbound_message", occurredAt, validUntil },
  };
}

function comment(): SendPolicyInput {
  const input = context();
  input.request = { ...input.request, action: "private_reply", commentId: "comment-1",
    body: "Tu guía" };
  input.capabilities[0].capability = "private_reply";
  input.conversation = null;
  input.evidence = { workspaceId, connectionId, externalActorId: "actor-1", id: "comment-1",
    kind: "comment", externalCommentId: "comment-1", occurredAt, validUntil, eligible: true, privateReply: "available",
    reservedOperationId: null };
  return input;
}

test("a verified DM preserves evidence and expiry for revalidation", () => {
  const result = evaluateSendPolicy(context());
  assert.equal(result.allowed, true);
  assert.equal(result.evidenceId, "message-1");
  assert.equal(result.validUntil, validUntil);
});

test("malformed context and admin overrides cannot open a new-channel window", () => {
  assert.equal(evaluateSendPolicy({ ...context(), overrideAdmin: true }).reasonCode, "invalid_context");
  assert.equal(evaluateSendPolicy({ ...context(), now: NaN }).allowed, false);
  assert.equal(evaluateSendPolicy({ ...context(), optedOut: "false" }).allowed, false);
});

test("every identity boundary rejects tenant, account, actor or channel substitution", () => {
  const changes: Array<(input: SendPolicyInput) => void> = [
    (input) => { input.connection.workspaceId = otherId; },
    (input) => { input.identity.connectionId = otherId; },
    (input) => { input.identity.workspaceId = otherId; },
    (input) => { input.conversation!.workspaceId = otherId; },
    (input) => { input.conversation!.channel = "messenger"; },
    (input) => { input.evidence!.connectionId = otherId; },
    (input) => { input.evidence!.externalActorId = "other-actor"; },
    (input) => { input.request.recipient = "other-actor"; },
    (input) => { input.request.channel = "messenger"; },
  ];
  for (const change of changes) {
    const input = context(); change(input);
    assert.equal(evaluateSendPolicy(input).reasonCode, "scope_mismatch");
  }
});

test("a token/implemented method is insufficient without verified account capability", () => {
  for (const status of ["connecting", "awaiting_webhook", "degraded", "revoked", "needs_permissions"] as const) {
    const input = context(); input.connection.status = status;
    assert.equal(evaluateSendPolicy(input).allowed, false);
  }
  const input = context(); input.capabilities = [];
  assert.equal(evaluateSendPolicy(input).reasonCode, "unsupported_capability");
});

test("a capability from a different account or a future verification is unusable", () => {
  for (const patch of [{ workspaceId: otherId }, { connectionId: otherId }, { verifiedAt: validUntil }]) {
    const input = context(); Object.assign(input.capabilities[0], patch);
    assert.equal(evaluateSendPolicy(input).reasonCode, "unsupported_capability");
  }
});

test("human takeover invalidates prior AI work even if later returned to AI", () => {
  const input = context();
  assert.equal(evaluateSendPolicy(input).allowed, true);
  input.phase = "send"; input.conversation!.state = "human_active";
  assert.equal(evaluateSendPolicy(input).reasonCode, "human_hold");
  input.conversation!.state = "ai_active"; input.conversation!.revision++;
  assert.equal(evaluateSendPolicy(input).reasonCode, "stale_revision");
});

test("automatic work is held in all non-AI states, but a human can reply after takeover", () => {
  for (const state of ["human_active", "handoff_pending", "waiting_reply", "paused", "closed"] as const) {
    const input = context(); input.conversation!.state = state;
    assert.equal(evaluateSendPolicy(input).allowed, false);
  }
  const input = context(); input.conversation!.state = "human_active"; input.actor = "human";
  assert.equal(evaluateSendPolicy(input).allowed, true);
  input.conversation!.state = "ai_active"; input.conversation!.aiEnabled = false; input.actor = "ai";
  assert.equal(evaluateSendPolicy(input).reasonCode, "human_hold");
});

test("expiry is exclusive and missing or future evidence fails closed", () => {
  const input = context(); input.now = Date.parse(validUntil);
  assert.equal(evaluateSendPolicy(input).reasonCode, "expired");
  input.now = Date.parse(occurredAt) - 1; input.capabilities[0].verifiedAt = "2026-10-09T00:00:00Z";
  assert.equal(evaluateSendPolicy(input).reasonCode, "ineligible_evidence");
  input.evidence = null;
  assert.equal(evaluateSendPolicy(input).reasonCode, "missing_evidence");
});

test("a public comment does not authorize an ordinary DM", () => {
  const input = context(); input.evidence = comment().evidence;
  assert.equal(evaluateSendPolicy(input).reasonCode, "ineligible_evidence");
});

test("private replies require a reservation for this operation before POST", () => {
  const input = comment();
  assert.equal(evaluateSendPolicy(input).allowed, true);
  input.phase = "send";
  assert.equal(evaluateSendPolicy(input).reasonCode, "reservation_required");
  if (input.evidence?.kind !== "comment") throw new Error("fixture");
  input.evidence.privateReply = "reserved";
  input.evidence.reservedOperationId = "op-1";
  assert.equal(evaluateSendPolicy(input).allowed, true);
  input.evidence.reservedOperationId = "op-other";
  assert.equal(evaluateSendPolicy(input).reasonCode, "duplicate_private_reply");
  input.evidence.privateReply = "sent";
  assert.equal(evaluateSendPolicy(input).reasonCode, "duplicate_private_reply");
});

test("comment eligibility and target are checked independently of its reservation", () => {
  const input = comment();
  if (input.evidence?.kind !== "comment") throw new Error("fixture");
  input.evidence.eligible = false;
  assert.equal(evaluateSendPolicy(input).allowed, false);
  input.evidence.eligible = true; input.evidence.externalCommentId = "another-comment";
  assert.equal(evaluateSendPolicy(input).reasonCode, "ineligible_evidence");
});

test("public reply is independent of a private reply already sent", () => {
  const input = comment();
  input.request = { ...input.request, action: "public_reply", commentId: "comment-1", body: "Enviada" };
  input.capabilities[0].capability = "public_reply";
  if (input.evidence?.kind !== "comment") throw new Error("fixture");
  input.evidence.privateReply = "sent";
  input.evidence.reservedOperationId = "op-previous";
  assert.equal(evaluateSendPolicy(input).allowed, true);
});

test("Human Agent evidence cannot be used by AI or unverified accounts", () => {
  const input = context();
  input.evidence = { ...input.evidence!, kind: "human_agent" };
  assert.equal(evaluateSendPolicy(input).allowed, false);
  input.actor = "human";
  assert.equal(evaluateSendPolicy(input).allowed, false);
  input.capabilities.push({ ...input.capabilities[0], capability: "human_agent" });
  assert.equal(evaluateSendPolicy(input).allowed, true);
  input.actor = "automation";
  assert.equal(evaluateSendPolicy(input).allowed, false);
});

test("website chat requires a valid visitor session rather than a Meta event", () => {
  const input = context();
  input.connection = { ...input.connection, channel: "web", provider: "widget" };
  input.conversation!.channel = "web"; input.request.channel = "web";
  assert.equal(evaluateSendPolicy(input).allowed, false);
  input.evidence = { ...input.evidence!, kind: "visitor_session" };
  assert.equal(evaluateSendPolicy(input).allowed, true);
  input.optedOut = true;
  assert.equal(evaluateSendPolicy(input).reasonCode, "opted_out");
});

test("WA preserves free-reply opt-out semantics while templates need matching approval", () => {
  const input = context(); input.optedOut = true;
  input.connection = { ...input.connection, channel: "whatsapp", provider: "ycloud" };
  input.conversation!.channel = "whatsapp"; input.request.channel = "whatsapp";
  assert.equal(evaluateSendPolicy(input).allowed, true);
  input.request = { channel: "whatsapp", action: "template", operationId: "op-1",
    recipient: "actor-1", templateName: "welcome", language: "es" };
  input.capabilities[0].capability = "template";
  input.evidence = { ...input.evidence!, kind: "approved_template", templateName: "welcome", language: "es" };
  assert.equal(evaluateSendPolicy(input).reasonCode, "opted_out");
  input.optedOut = false;
  assert.equal(evaluateSendPolicy(input).allowed, true);
  input.evidence.templateName = "different-template";
  assert.equal(evaluateSendPolicy(input).reasonCode, "ineligible_evidence");
});

test("the separate legacy WA policy retains null window and existing admin behavior", () => {
  assert.equal(legacyWhatsAppTextAllowed(null, false, now), true);
  assert.equal(legacyWhatsAppTextAllowed(occurredAt, false, now), false);
  assert.equal(legacyWhatsAppTextAllowed(occurredAt, true, now), true);
  assert.equal(legacyWhatsAppTextAllowed(validUntil, false, now), true);
  assert.equal(legacyWhatsAppTextAllowed("invalid", false, now), false);
});

test("comment evidence preserves an internal UUID independently from the opaque Meta ID", () => {
  const input = comment(); input.evidence!.id = workspaceId;
  assert.equal(evaluateSendPolicy(input).allowed, true);
  assert.equal(evaluateSendPolicy(input).evidenceId, workspaceId);
});

test("ambiguous or in-flight private replies remain consumed even for the same operation", () => {
  const input = comment();
  if (input.evidence?.kind !== "comment") throw new Error("fixture");
  input.evidence.privateReply = "consumed"; input.evidence.reservedOperationId = "op-1";
  assert.equal(evaluateSendPolicy(input).reasonCode, "duplicate_private_reply");
  input.request = { ...input.request, action: "public_reply", commentId: "comment-1", body: "Enviada" };
  input.capabilities[0].capability = "public_reply";
  assert.equal(evaluateSendPolicy(input).allowed, true);
});

test("reservation flags without ownership are invalid, and a comment cannot authorize follow-up media", () => {
  const input = comment();
  if (input.evidence?.kind !== "comment") throw new Error("fixture");
  input.evidence.privateReply = "reserved";
  assert.equal(evaluateSendPolicy(input).reasonCode, "invalid_context");
  input.evidence.privateReply = "available";
  input.request = { channel: "instagram", action: "media", operationId: "op-1", recipient: "actor-1", mediaRef: "stored-1" };
  input.capabilities[0].capability = "media";
  input.conversation = context().conversation;
  assert.equal(evaluateSendPolicy(input).reasonCode, "ineligible_evidence");
});

test("template approval is bound to the requested language", () => {
  const input = context();
  input.connection = { ...input.connection, channel: "whatsapp", provider: "ycloud" };
  input.conversation!.channel = "whatsapp"; input.capabilities[0].capability = "template";
  input.request = { channel: "whatsapp", action: "template", operationId: "op-1", recipient: "actor-1", templateName: "welcome", language: "es_AR" };
  input.evidence = { ...input.evidence!, kind: "approved_template", templateName: "welcome", language: "es" };
  assert.equal(evaluateSendPolicy(input).reasonCode, "ineligible_evidence");
});
