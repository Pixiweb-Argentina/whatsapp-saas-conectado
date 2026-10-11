import assert from "node:assert/strict";
import { test } from "node:test";
import { drainMessageJobs, processClaimedJob, type JobPolicyContext, type MessageWorkerDependencies } from "./message-job-worker.ts";
import type { ClaimedJob } from "../types/message-job.ts";
import type { ChannelAdapter, ChannelSendResult } from "../types/send-contracts.ts";

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = Date.parse("2026-10-10T12:00:00Z");
const validUntil = "2026-10-10T13:00:00Z";
const occurredAt = "2026-10-10T11:00:00Z";
function fixture(): { job: ClaimedJob; context: JobPolicyContext; adapter: ChannelAdapter;
  deps: MessageWorkerDependencies; calls: string[]; saved: ChannelSendResult[] } {
  const calls: string[] = [];
  const saved: ChannelSendResult[] = [];
  const job: ClaimedJob = { operation_id: id(61), workspace_id: id(1), connection_id: id(51),
    conversation_id: id(31), event_id: null, actor: "ai", expected_state_revision: 4,
    state: "leased", attempts: 1, fence: 1, lease_owner: id(71), lease_until: validUntil,
    request: { operationId: id(61), channel: "instagram", recipient: "actor-1", action: "text", body: "Guía fixture" } };
  const scope = { workspaceId: id(1), connectionId: id(51), externalActorId: "actor-1" };
  const context: JobPolicyContext = { conversationId: id(31),
    connection: { workspaceId: id(1), connectionId: id(51), channel: "instagram", provider: "meta",
      externalAccountId: "test-account", status: "ready" }, identity: scope, optedOut: false,
    conversation: { ...scope, channel: "instagram", aiEnabled: true, state: "ai_active", revision: 4, expectedRevision: 4 },
    capabilities: [{ workspaceId: id(1), connectionId: id(51), capability: "text", verifiedAt: occurredAt, evidenceRef: "fixture" }],
    evidence: { ...scope, id: "event-1", kind: "inbound_message", occurredAt, validUntil } };
  const adapter: ChannelAdapter = { channel: "instagram", provider: "meta", live: true, implementedActions: ["text"],
    async send(request) { calls.push("POST"); assert.deepEqual(request, job.request);
      return { status: "accepted", externalId: "provider-1" }; } };
  const deps: MessageWorkerDependencies = { now: () => now,
    async loadContext() { calls.push("fresh-policy"); return context; },
    async resolveAdapter() { calls.push("adapter"); return adapter; },
    store: {
      async recover() { calls.push("recover"); return 0; },
      async claim() { calls.push("claim"); return job; },
      async begin() { calls.push("permit"); return true; },
      async cancel(_job, reason) { calls.push("cancel:" + reason); return true; },
      async finish(_job, result) { calls.push("finish"); saved.push(result); return true; },
    } };
  return { job, context, adapter, deps, calls, saved };
}

test("worker persists a permit after fresh policy and before exactly one provider call", async () => {
  const f = fixture();
  assert.equal((await processClaimedJob(f.job, f.deps)).status, "accepted");
  assert.deepEqual(f.calls, ["adapter", "fresh-policy", "permit", "POST", "finish"]);
  assert.deepEqual(f.saved, [{ status: "accepted", externalId: "provider-1" }]);
});

test("new state/revision, permissions and identity are revalidated from fresh context", async () => {
  const changes: Array<(f: ReturnType<typeof fixture>) => void> = [
    (f) => { f.context.conversation!.state = "human_active"; },
    (f) => { f.context.conversation!.revision = 5; f.context.conversation!.expectedRevision = 5; },
    (f) => { f.context.conversationId = id(32); },
    (f) => { f.context.connection.connectionId = id(52); },
    (f) => { f.context.identity.externalActorId = "someone-else"; },
    (f) => { f.context.capabilities = []; },
    (f) => { f.context.optedOut = true; },
    (f) => { f.context.evidence!.validUntil = occurredAt; },
  ];
  for (const change of changes) {
    const f = fixture(); change(f);
    assert.equal((await processClaimedJob(f.job, f.deps)).status, "cancelled");
    assert.equal(f.calls.includes("POST"), false);
    assert.equal(f.calls.includes("permit"), false);
  }
});

test("missing/live-disabled/wrong provider or channel adapters never reach the network", async () => {
  const changes: Array<(f: ReturnType<typeof fixture>) => void> = [
    (f) => { f.adapter.live = false; },
    (f) => { f.adapter.channel = "whatsapp"; },
    (f) => { f.adapter.provider = "kapso"; },
    (f) => { f.adapter.implementedActions = []; },
    (f) => { f.deps.resolveAdapter = async () => null; },
  ];
  for (const change of changes) {
    const f = fixture(); change(f);
    assert.equal((await processClaimedJob(f.job, f.deps)).status, "cancelled");
    assert.equal(f.calls.includes("POST"), false);
  }
});

test("takeover or lost lease between policy and permit prevents POST", async () => {
  const f = fixture();
  f.deps.store.begin = async () => false;
  assert.equal((await processClaimedJob(f.job, f.deps)).status, "lost_lease");
  assert.equal(f.calls.includes("POST"), false);
});

test("failed cancellation does not claim that another worker's job was cancelled", async () => {
  const f = fixture(); f.context.optedOut = true;
  f.deps.store.cancel = async () => false;
  assert.equal((await processClaimedJob(f.job, f.deps)).status, "lost_lease");
});

test("exceptions after permission and invalid provider results become unknown, never retry", async () => {
  for (const response of [null, { status: "accepted", externalId: "" },
    { status: "unknown", operationId: "different" }]) {
    const f = fixture();
    f.adapter.send = async () => { f.calls.push("POST");
      if (!response) throw new Error("private remote detail");
      return response as ChannelSendResult;
    };
    assert.equal((await processClaimedJob(f.job, f.deps)).status, "unknown");
    assert.equal(f.calls.filter((call) => call === "POST").length, 1);
    assert.deepEqual(f.saved, [{ status: "unknown", operationId: f.job.operation_id }]);
  }
});

test("confirmed retryable rejection is recorded without a worker retry loop", async () => {
  const f = fixture();
  f.adapter.send = async () => { f.calls.push("POST"); return { status: "rejected", errorCode: "limited", retryable: true }; };
  assert.equal((await processClaimedJob(f.job, f.deps)).status, "rejected");
  assert.equal(f.calls.filter((call) => call === "POST").length, 1);
});

test("database failure before permit makes no provider call; after acceptance awaits recovery", async () => {
  for (const stage of ["begin", "finish"] as const) {
    const f = fixture();
    f.deps.store[stage] = async () => { throw new Error("storage offline"); };
    assert.equal((await processClaimedJob(f.job, f.deps)).status, "recovery_pending");
    assert.equal(f.calls.includes("POST"), stage === "finish");
  }
});

test("late completion cannot overwrite a recovered or fenced attempt", async () => {
  const f = fixture(); f.deps.store.finish = async () => false;
  assert.equal((await processClaimedJob(f.job, f.deps)).status, "recovery_pending");
  assert.equal(f.calls.filter((call) => call === "POST").length, 1);
});

test("drain recovers first, obeys its bound and awaits every send result", async () => {
  const f = fixture();
  let count = 0;
  f.deps.store.claim = async () => { count++; return count === 1 ? f.job : null; };
  assert.equal((await drainMessageJobs(id(1), id(71), f.deps, 3)).length, 1);
  assert.equal(f.calls[0], "recover");
  assert.equal(f.calls.at(-1), "finish");
  assert.equal(count, 2);
  await assert.rejects(drainMessageJobs(id(1), id(71), f.deps, 11));
});

test("quota deferral never calls transport or finalizes a send",async()=>{
  const f=fixture();f.deps.store.begin=async()=>"deferred";
  assert.equal((await processClaimedJob(f.job,f.deps)).status,"deferred");
  assert.equal(f.calls.includes("POST"),false);assert.equal(f.calls.includes("finish"),false);
});
