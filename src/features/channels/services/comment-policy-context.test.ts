import assert from "node:assert/strict";
import { test } from "node:test";
import { readCommentPolicyEvidence } from "./comment-policy-context.ts";
import { createMessagePipeline } from "./message-pipeline.ts";
import { policyContextFixture, contextId, contextNow, verifiedAt, contextExpiry } from "../testing/policy-context-fixture.ts";

function fixture() {
  const f = policyContextFixture();
  Object.assign(f.rows.channel_connections[0], { channel: "instagram", provider: "meta", external_account_id: "ig-account" });
  f.grants[0].capability = "private_reply";
  f.request.actor = "automation"; f.request.conversationId = null; f.request.expectedRevision = null;
  f.request.request = { channel: "instagram", action: "private_reply", operationId: contextId(61),
    recipient: "+15555550101", commentId: "opaque-meta-comment", body: "Tu guía" };
  const evidence = { id: contextId(41), workspaceId: contextId(1), connectionId: contextId(51),
    externalActorId: f.request.request.recipient, kind: "comment", externalCommentId: "opaque-meta-comment",
    occurredAt: verifiedAt, validUntil: contextExpiry, eligible: true, privateReply: "available", reservedOperationId: null };
  f.rpcResults.read_channel_comment_evidence = evidence;
  const subject = { workspaceId: f.request.workspaceId, connectionId: f.request.connectionId,
    eventId: f.request.eventId, conversationId: null, channel: "instagram" as const, recipient: f.request.request.recipient };
  return { ...f, evidence, subject };
}

test("private-reply producer uses server proof and passes the event UUID independently of Meta comment ID", async () => {
  const f = fixture();
  assert.deepEqual(await createMessagePipeline(f.db, () => contextNow).enqueue(f.request), { queued: true, operationId: contextId(61) });
  assert.deepEqual(f.rpcCalls.map((c) => c.name), ["read_channel_comment_evidence", "enqueue_channel_job"]);
  assert.equal(f.rpcCalls[1].args.p_event_id, contextId(41));
  assert.equal((f.rpcCalls[1].args.p_request as Record<string, unknown>).commentId, "opaque-meta-comment");
  assert(!f.queries.some((q) => q.table === "inbound_events"), "a plain envelope cannot replace verified proof");
});

test("missing verified proof never queues a private reply", async () => {
  const f = fixture(); f.rpcResults.read_channel_comment_evidence = null;
  const result = await createMessagePipeline(f.db, () => contextNow).enqueue(f.request);
  assert.equal(result.queued, false);
  if (!result.queued) assert.equal(result.decision.reasonCode, "missing_evidence");
  assert.equal(f.rpcCalls.length, 1);
});

test("foreign or malformed proof and database errors stop producer without leaking details", async () => {
  for (const patch of [{ workspaceId: contextId(2) }, { connectionId: contextId(52) },
    { id: contextId(42) }, { externalActorId: "other" }, { kind: "inbound_message" }]) {
    const f = fixture(); Object.assign(f.evidence, patch);
    await assert.rejects(createMessagePipeline(f.db, () => contextNow).enqueue(f.request), { message: "CHANNEL_POLICY_CONTEXT_UNAVAILABLE" });
    assert.equal(f.rpcCalls.length, 1);
  }
  const f = fixture(); f.errors.rpc = { message: "private database details" };
  await assert.rejects(readCommentPolicyEvidence(f.db, f.subject), { message: "CHANNEL_POLICY_CONTEXT_UNAVAILABLE" });
});

test("expiry, opt-out and another operation's reservation fail before enqueue", async () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => { f.evidence.validUntil = verifiedAt; },
    (f: ReturnType<typeof fixture>) => { f.rows.contacts[0].opt_in = false; },
    (f: ReturnType<typeof fixture>) => { Object.assign(f.evidence, { privateReply: "reserved", reservedOperationId: contextId(62) }); },
    (f: ReturnType<typeof fixture>) => { Object.assign(f.evidence, { privateReply: "consumed", reservedOperationId: contextId(61) }); },
  ]) {
    const f = fixture(); change(f);
    assert.equal((await createMessagePipeline(f.db, () => contextNow).enqueue(f.request)).queued, false);
    assert.equal(f.rpcCalls.length, 1);
  }
});

test("comment evidence cannot bootstrap a normal DM even with a text grant", async () => {
  const f = fixture(); f.request.conversationId = contextId(31); f.request.expectedRevision = 4;
  Object.assign(f.rows.conversations[0], { channel: "instagram" }); f.grants[0].capability = "text";
  f.request.request = { channel: "instagram", action: "text", operationId: contextId(61), recipient: "+15555550101", body: "Seguimiento" };
  const result = await createMessagePipeline(f.db, () => contextNow).enqueue(f.request);
  assert.equal(result.queued, false);
  if (!result.queued) assert.equal(result.decision.reasonCode, "ineligible_evidence");
  assert.equal(f.rpcCalls.length, 1);
});

test("comment reader skips unrelated channels or an absent anchor", async () => {
  const f = fixture();
  assert.equal(await readCommentPolicyEvidence(f.db, { ...f.subject, channel: "whatsapp" }), null);
  assert.equal(await readCommentPolicyEvidence(f.db, { ...f.subject, eventId: null }), null);
  assert.equal(f.rpcCalls.length, 0);
});
