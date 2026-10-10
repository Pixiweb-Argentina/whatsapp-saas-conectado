import type { SupabaseClient } from "@supabase/supabase-js";
import { enqueueJobSchema, type EnqueueJob } from "../types/message-job";
import type { SendPolicyDecision } from "../types/send-policy";
import type { PolicySubject } from "../types/policy-context";
import { createMessageJobStore } from "./message-job-store";
import { drainMessageJobs, type JobAttemptResult } from "./message-job-worker";
import { loadMessagePolicyContext } from "./message-policy-context";
import { resolveConnectionAdapter } from "./connection-adapter";
import { evaluateSendPolicy } from "./send-policy";

function subject(job: EnqueueJob): PolicySubject {
  return { workspaceId: job.workspaceId, connectionId: job.connectionId,
    conversationId: job.conversationId, eventId: job.eventId,
    recipient: job.request.recipient, channel: job.request.channel };
}

export type EnqueueResult = { queued: true; operationId: string }
  | { queued: false; decision: SendPolicyDecision };

export interface MessagePipeline {
  enqueue(input: unknown): Promise<EnqueueResult>;
  drain(workspaceId: string, workerId: string, limit?: number): Promise<JobAttemptResult[]>;
}

/** Internal producer/worker composition, not an HTTP authorization boundary.
 * Caller must authenticate the webhook/operator and own workspace/actor/IDs.
 * No webhook, cron or legacy buffer is switched to this pipeline yet.
 */
export function createMessagePipeline(db: SupabaseClient, now: () => number = Date.now): MessagePipeline {
  const store = createMessageJobStore(db);
  return {
    async enqueue(input: unknown): Promise<EnqueueResult> {
      const job = enqueueJobSchema.parse(input);
      const { conversationId: _conversationId, ...context } = await loadMessagePolicyContext(db, subject(job), now());
      const decision = evaluateSendPolicy({ ...context, workspaceId: job.workspaceId,
        request: job.request, actor: job.actor, phase: "enqueue", now: now(),
        conversation: context.conversation ? { ...context.conversation, expectedRevision: job.expectedRevision } : null });
      if (!decision.allowed) return { queued: false, decision };
      return { queued: true, operationId: await store.enqueue(job) };
    },
    async drain(workspaceId: string, workerId: string, limit = 5) {
      return drainMessageJobs(workspaceId, workerId, {
        store, now,
        resolveAdapter: (job) => resolveConnectionAdapter(db, job.workspace_id, job.connection_id),
        loadContext: (job) => loadMessagePolicyContext(db, {
          workspaceId: job.workspace_id, connectionId: job.connection_id, conversationId: job.conversation_id,
          eventId: job.event_id, recipient: job.request.recipient, channel: job.request.channel,
        }, now()),
      }, limit);
    },
  };
}
