import { z } from "zod";
import { claimedJobSchema, type ClaimedJob } from "../types/message-job";
import { channelSendResultSchema, type ChannelAdapter, type ChannelSendResult } from "../types/send-contracts";
import type { SendPolicyInput } from "../types/send-policy";
import { evaluateSendPolicy } from "./send-policy";
import type { MessageJobStore } from "./message-job-store";

export type JobPolicyContext = Omit<SendPolicyInput, "workspaceId" | "request" | "actor" | "phase" | "now"> & {
  conversationId: string | null;
};

export interface MessageWorkerDependencies {
  store: MessageJobStore;
  /** Reload verified evidence from server storage, never from the queued request. */
  loadContext(job: ClaimedJob): Promise<JobPolicyContext>;
  /** Resolve exactly this connection's adapter, with a bounded network timeout. */
  resolveAdapter(job: ClaimedJob): Promise<ChannelAdapter | null>;
  now?: () => number;
}

export interface JobAttemptResult {
  operationId: string;
  status: "accepted" | "rejected" | "unknown" | "deferred" | "cancelled" | "lost_lease" | "recovery_pending";
}

function policyInput(job: ClaimedJob, context: JobPolicyContext, now: number): SendPolicyInput | null {
  if (context.connection.connectionId !== job.connection_id || context.conversationId !== job.conversation_id
    || (context.conversation === null) !== (job.conversation_id === null)
    || (context.conversation !== null && job.expected_state_revision === null)) return null;
  const { conversationId: _conversationId, ...evidence } = context;
  return { ...evidence, workspaceId: job.workspace_id, request: job.request, actor: job.actor,
    phase: "send", now, conversation: evidence.conversation ? { ...evidence.conversation,
      expectedRevision: job.expected_state_revision ?? 0 } : null };
}

async function callAdapter(adapter: ChannelAdapter, job: ClaimedJob): Promise<ChannelSendResult> {
  try {
    const result = channelSendResultSchema.parse(await adapter.send(job.request));
    if (result.status === "unknown" && result.operationId !== job.operation_id) throw new Error("OPERATION_MISMATCH");
    return result;
  } catch {
    // Once permitted, even a thrown error may follow a successful provider POST.
    return { status: "unknown", operationId: job.operation_id };
  }
}

export async function processClaimedJob(job: ClaimedJob, deps: MessageWorkerDependencies): Promise<JobAttemptResult> {
  const outcome = (status: JobAttemptResult["status"]): JobAttemptResult => ({ operationId: job.operation_id, status });
  try {
    claimedJobSchema.parse(job);
    const adapter = await deps.resolveAdapter(job);
    if (!adapter?.live || adapter.channel !== job.request.channel || !adapter.implementedActions.includes(job.request.action)) {
      return outcome(await deps.store.cancel(job, "transport_unavailable") ? "cancelled" : "lost_lease");
    }
    const context = await deps.loadContext(job);
    const input = policyInput(job, context, (deps.now ?? Date.now)());
    const policy = evaluateSendPolicy(input);
    if (!policy.allowed || adapter.provider !== context.connection.provider) {
      return outcome(await deps.store.cancel(job, policy.allowed ? "provider_mismatch" : policy.reasonCode)
        ? "cancelled" : "lost_lease");
    }
    // Atomic revision/lease check + durable permit. No asynchronous work is added
    // between this boundary and the provider call. A takeover cannot retract a
    // send already permitted/in flight; its eventual result must be reconciled.
    const permit = await deps.store.begin(job, policy);
    if (permit === "deferred") return outcome("deferred");
    if (!permit) return outcome("lost_lease");
    const result = await callAdapter(adapter, job);
    if (!await deps.store.finish(job, result)) return outcome("recovery_pending");
    return outcome(result.status);
  } catch {
    // Do not retry inside the worker. Durable recovery decides whether the job
    // was pre-send (safe to reclaim) or sending (unknown, never auto-replayed).
    return outcome("recovery_pending");
  }
}

/** Await this bounded drain before returning HTTP. No cron/webhook is enabled here. */
export async function drainMessageJobs(
  workspaceId: string, workerId: string, deps: MessageWorkerDependencies, limit = 5,
): Promise<JobAttemptResult[]> {
  z.uuid().parse(workspaceId);
  z.uuid().parse(workerId);
  z.number().int().min(1).max(10).parse(limit);
  await deps.store.recover(workspaceId);
  const results: JobAttemptResult[] = [];
  for (let index = 0; index < limit; index++) {
    const job = await deps.store.claim(workspaceId, workerId);
    if (!job) break;
    results.push(await processClaimedJob(job, deps));
  }
  return results;
}
