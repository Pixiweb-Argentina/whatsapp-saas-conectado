import assert from "node:assert/strict";
import { test } from "node:test";
import {
  instagramCommentEvidence, instagramHumanAgentEvidence, instagramMessageEvidence,
  type CommentFacts, type StoredInstagramEvent,
} from "./instagram-policy.ts";
import { evaluateSendPolicy } from "../../services/send-policy.ts";
import type { SendPolicyInput } from "../../types/send-policy.ts";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const connectionId = "22222222-2222-4222-8222-222222222222";
const eventId = "44444444-4444-4444-8444-444444444444";
const occurredAt = "2026-10-10T10:00:00.000Z";
const HOUR = 60 * 60 * 1000;
const at = (hours: number) => Date.parse(occurredAt) + hours * HOUR;

function stored(kind: "message" | "comment", overrides: Partial<StoredInstagramEvent> = {}): StoredInstagramEvent {
  return {
    id: eventId, historical: false, ...overrides,
    envelope: {
      schemaVersion: 1, workspaceId, connectionId, channel: "instagram", provider: "meta",
      providerEventId: "evt-1", kind, occurredAt, receivedAt: occurredAt,
      externalActorId: "actor-1",
      ...(kind === "comment" ? { externalCommentId: "comment-1" } : { externalMessageId: "mid-1" }),
      content: { type: "text", text: "guía", rawType: "text" }, mediaRefs: [],
      sourceContext: { channel: "instagram", sourceType: kind === "comment" ? "comment" : "direct_message" },
      ...overrides.envelope,
    },
  };
}

const facts = (overrides: Partial<CommentFacts> = {}): CommentFacts => ({
  state: "available", operationId: null, isOwn: false, isDeleted: false, ...overrides,
});

function policy(evidence: SendPolicyInput["evidence"], now: number, extra: Partial<SendPolicyInput> = {}) {
  const input: SendPolicyInput = {
    workspaceId, connection: { workspaceId, connectionId, channel: "instagram", provider: "meta",
      externalAccountId: "ig-account", status: "ready" },
    identity: { workspaceId, connectionId, externalActorId: "actor-1" },
    request: { action: "text", channel: "instagram", operationId: "op-1", recipient: "actor-1", body: "Hola" },
    actor: "ai", phase: "enqueue", now, optedOut: false,
    conversation: { workspaceId, connectionId, channel: "instagram", externalActorId: "actor-1",
      state: "ai_active", aiEnabled: true, revision: 1, expectedRevision: 1 },
    capabilities: [{ workspaceId, connectionId, capability: "text", verifiedAt: occurredAt,
      evidenceRef: "synthetic-test-only" }],
    evidence, ...extra,
  };
  return evaluateSendPolicy(input);
}

test("a DM opens a 24h window that the policy enforces", () => {
  const evidence = instagramMessageEvidence(stored("message"), at(1));
  assert.equal(evidence?.kind, "inbound_message");
  assert.equal(evidence?.validUntil, "2026-10-11T10:00:00.000Z");
  assert.equal(policy(evidence, at(23)).allowed, true);
  assert.equal(policy(evidence, at(25)).reasonCode, "expired");
});

test("historical DMs, echoes, receipts and future events never open a window", () => {
  assert.equal(instagramMessageEvidence(stored("message", { historical: true }), at(1)), null);
  for (const kind of ["outbound_echo", "delivery_receipt"] as const) {
    const event = stored("message");
    event.envelope = { ...event.envelope, kind };
    assert.equal(instagramMessageEvidence(event, at(1)), null);
  }
  assert.equal(instagramMessageEvidence(stored("message"), at(-1)), null);
  assert.equal(instagramMessageEvidence(stored("comment"), at(1)), null);
});

test("HUMAN_AGENT lasts 7 days from the DM", () => {
  const evidence = instagramHumanAgentEvidence(stored("message"), at(30));
  assert.equal(evidence?.kind, "human_agent");
  assert.equal(evidence?.validUntil, "2026-10-17T10:00:00.000Z");
  assert.equal(instagramHumanAgentEvidence(stored("message", { historical: true }), at(1)), null);
});

test("a fresh comment allows exactly one private reply within 7 days", () => {
  const evidence = instagramCommentEvidence(stored("comment"), facts(), at(2));
  assert.equal(evidence?.kind, "comment");
  assert.equal(evidence?.validUntil, "2026-10-17T10:00:00.000Z");
  assert.equal(evidence?.kind === "comment" && evidence.eligible, true);
  const late = instagramCommentEvidence(stored("comment"), facts(), at(7 * 24 + 1));
  assert.equal(late?.kind === "comment" && late.eligible, false);
});

test("own, deleted and historical comments stay ineligible", () => {
  for (const evidence of [
    instagramCommentEvidence(stored("comment"), facts({ isOwn: true }), at(1)),
    instagramCommentEvidence(stored("comment"), facts({ isDeleted: true }), at(1)),
    instagramCommentEvidence(stored("comment", { historical: true }), facts(), at(1)),
  ]) {
    assert.equal(evidence?.kind === "comment" && evidence.eligible, false);
  }
});

test("a comment never opens the normal DM window", () => {
  const evidence = instagramCommentEvidence(stored("comment"), facts(), at(1));
  assert.equal(policy(evidence, at(1)).allowed, false);
});

test("reservation facts must be coherent and are passed through for the send phase", () => {
  assert.equal(instagramCommentEvidence(stored("comment"), facts({ state: "reserved" }), at(1)), null);
  assert.equal(instagramCommentEvidence(stored("comment"), facts({ operationId: "op-1" }), at(1)), null);
  const reserved = instagramCommentEvidence(stored("comment"),
    facts({ state: "reserved", operationId: "op-1" }), at(1));
  assert.equal(reserved?.kind === "comment" && reserved.reservedOperationId, "op-1");
  const sent = instagramCommentEvidence(stored("comment"), facts({ state: "sent", operationId: "op-0" }), at(1));
  assert.equal(sent?.kind === "comment" && sent.privateReply, "sent");
});
