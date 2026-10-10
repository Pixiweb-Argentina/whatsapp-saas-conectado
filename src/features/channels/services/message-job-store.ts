import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { inboundEventSchema } from "../types/channel-contracts";
import { claimedJobSchema, enqueueJobSchema, type ClaimedJob } from "../types/message-job";
import { channelSendResultSchema, type ChannelSendResult } from "../types/send-contracts";
import type { SendPolicyDecision } from "../types/send-policy";

export interface MessageJobStore {
  recover(workspaceId: string): Promise<number>;
  claim(workspaceId: string, workerId: string): Promise<ClaimedJob | null>;
  begin(job: ClaimedJob, policy: SendPolicyDecision): Promise<boolean>;
  cancel(job: ClaimedJob, reason: string): Promise<boolean>;
  finish(job: ClaimedJob, result: ChannelSendResult): Promise<boolean>;
}

function leaseArgs(job: ClaimedJob): Record<string, unknown> {
  const checked = claimedJobSchema.parse(job);
  return { p_workspace_id: checked.workspace_id, p_operation_id: checked.operation_id,
    p_worker_id: checked.lease_owner, p_fence: checked.fence };
}

type QueueRpc = (name: string, args: Record<string, unknown>) => Promise<unknown>;

async function persistEvent(rpc: QueueRpc, value: unknown, historical = false): Promise<string> {
  const event = inboundEventSchema.parse(value);
  return z.uuid().parse(await rpc("persist_channel_event", {
    p_event: event, p_historical: z.boolean().parse(historical),
  }));
}

async function enqueueJob(rpc: QueueRpc, value: unknown): Promise<string> {
  const job = enqueueJobSchema.parse(value);
  return z.uuid().parse(await rpc("enqueue_channel_job", {
    p_workspace_id: job.workspaceId, p_connection_id: job.connectionId,
    p_conversation_id: job.conversationId, p_event_id: job.eventId,
    p_idempotency_key: job.idempotencyKey, p_actor: job.actor,
    p_expected_revision: job.expectedRevision, p_request: job.request,
    p_sender_user_id: job.senderUserId ?? null,
  }));
}

/** Server dependency only: pass the service client, never the browser session client. */
export function createMessageJobStore(db: SupabaseClient): MessageJobStore & {
  persistEvent(event: unknown, historical?: boolean): Promise<string>;
  enqueue(job: unknown): Promise<string>;
} {
  async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
    const { data, error } = await db.rpc(name, args);
    // RPC errors can contain request payloads; don't propagate raw database details.
    if (error) throw new Error("CHANNEL_QUEUE_STORAGE_FAILED");
    return data;
  }
  return {
    persistEvent: (value, historical) => persistEvent(rpc, value, historical),
    enqueue: (value) => enqueueJob(rpc, value),
    async recover(workspaceId) {
      return z.number().int().nonnegative().parse(await rpc("recover_channel_jobs", {
        p_workspace_id: z.uuid().parse(workspaceId),
      }));
    },
    async claim(workspaceId, workerId) {
      const data = await rpc("claim_channel_job", {
        p_workspace_id: z.uuid().parse(workspaceId), p_worker_id: z.uuid().parse(workerId),
      });
      const jobs = z.array(claimedJobSchema).max(1).parse(data);
      const job = jobs[0] ?? null;
      if (job && (job.workspace_id !== workspaceId || job.lease_owner !== workerId)) {
        throw new Error("CHANNEL_QUEUE_SCOPE_MISMATCH");
      }
      return job;
    },
    async begin(job, policy) {
      if (!policy.allowed || !policy.evidenceId || !policy.validUntil) return false;
      return z.boolean().parse(await rpc("begin_channel_send", { ...leaseArgs(job),
        p_evidence_id: policy.evidenceId, p_valid_until: policy.validUntil }));
    },
    async cancel(job, reason) {
      return z.boolean().parse(await rpc("cancel_channel_job", { ...leaseArgs(job),
        p_reason: z.string().min(1).max(100).regex(/^[a-z0-9_]+$/i).parse(reason) }));
    },
    async finish(job, result) {
      return z.boolean().parse(await rpc("finish_channel_send", { ...leaseArgs(job),
        p_result: channelSendResultSchema.parse(result) }));
    },
  };
}
