import type { SupabaseClient } from "@supabase/supabase-js";
import { aiHandoffReasonSchema, createAiReplyProducer, type AiHandoffReason,
  type AiReplyPreparation } from "@/features/channels/services/ai-reply-producer";

export interface AiQueueBatch {
  id: string; workspace_id: string; conversation_id: string; meta: Record<string, unknown>;
}
export type QueueContinuation = "continue" | "close" | "requeued";

async function writeBatch(db: SupabaseClient, batch: AiQueueBatch, patch: Record<string, unknown>): Promise<void> {
  const { data, error } = await db.from("message_batches").update(patch)
    .eq("workspace_id",batch.workspace_id).eq("id",batch.id).eq("status","processing").select("id");
  if (error || !data?.length) throw new Error("AI_BATCH_CHECKPOINT_FAILED");
}

export async function pauseAiQueueBatch(db: SupabaseClient, batch: AiQueueBatch, retry?: number): Promise<void> {
  batch.meta={...batch.meta,isolated:true,...(retry === undefined ? {} : {retry_count:retry}),
    queue_status:retry === undefined ? "waiting" : "preparation_retry"};
  await writeBatch(db,batch,{status:"buffering",flush_at:new Date(Date.now()+30_000).toISOString(),
    updated_at:new Date().toISOString(),meta:batch.meta});
}

/** Existing reply/job is recovered before flags or current eligibility are judged.
 * Only the immutable preparation authorizes queue mode. Batch meta is not a mode switch.
 */
export function createAiQueueControl(db: SupabaseClient, batch: AiQueueBatch, prep: AiReplyPreparation) {
  const producer=createAiReplyProducer(db);
  const scope={workspaceId:batch.workspace_id,batchId:batch.id};
  async function handoff(reason: AiHandoffReason): Promise<QueueContinuation> {
    batch.meta={...batch.meta,queue_handoff_reason:reason,isolated:true};
    await writeBatch(db,batch,{meta:batch.meta,updated_at:new Date().toISOString()});
    const result=await producer.handoff(scope,reason);
    if (result.settled) return "close";
    await pauseAiQueueBatch(db,batch);
    return "requeued";
  }
  async function deliver(text: string, wantsHandoff: boolean): Promise<QueueContinuation> {
    const result=await producer.enqueue({...scope,body:text});
    if (wantsHandoff) return handoff("tool");
    if (!result.queued) return handoff("blocked");
    return "close";
  }
  return {
    handoff, deliver,
    checkpoint: (text: string) => producer.checkpoint({...scope,body:text}),
    async resume(): Promise<QueueContinuation> {
      const reason=aiHandoffReasonSchema.safeParse(batch.meta.queue_handoff_reason);
      const wantsHandoff=typeof batch.meta.pending_handoff === "string";
      if (prep.state !== null) return reason.success || wantsHandoff ? handoff(reason.success ? reason.data : "tool") : "close";
      const reply=prep.reply;
      if (reply !== null) return deliver(reply,wantsHandoff);
      if (reason.success || wantsHandoff) return handoff(reason.success ? reason.data : "tool");
      if (typeof batch.meta.pending_reply === "string") return handoff("write_unconfirmed");
      if (Array.isArray(batch.meta.write_tools_ran) && batch.meta.write_tools_ran.length > 0) return handoff("write_unconfirmed");
      if (!prep.enabled) throw new Error("AI_ROLLOUT_DISABLED");
      if (!prep.eligible) return handoff("blocked");
      if (typeof batch.meta.retry_count === "number" && batch.meta.retry_count > 3) return handoff("retry_exhausted");
      return "continue";
    },
  };
}
export type AiQueueControl = ReturnType<typeof createAiQueueControl>;

export function queueHandoffCallback(control: AiQueueControl, reason: AiHandoffReason): () => Promise<void> {
  return async () => { await control.handoff(reason); };
}

export async function prepareAiQueueBatch(db: SupabaseClient, batch: AiQueueBatch): Promise<AiQueueControl | null> {
  const prep=await createAiReplyProducer(db).prepare({workspaceId:batch.workspace_id,batchId:batch.id});
  return prep.mode === "queue" ? createAiQueueControl(db,batch,prep) : null;
}

/** No legacy handoff, notification or transport is reachable from queue errors,
 * including a preparation error where the immutable mode could not be read.
 */
export async function recoverAiQueueFailure(db: SupabaseClient, batch: AiQueueBatch,
  control: AiQueueControl | null): Promise<void> {
  const retry=(typeof batch.meta.retry_count === "number" ? batch.meta.retry_count : 0)+1;
  if (retry <= 3) { await pauseAiQueueBatch(db,batch,retry); return; }
  if (control) {
    const outcome=await control.handoff("retry_exhausted");
    if (outcome === "requeued") return;
  }
  await writeBatch(db,batch,{status:"cancelled",updated_at:new Date().toISOString(),
    meta:{...batch.meta,isolated:true,retry_count:retry,queue_status:"preparation_stopped"}});
}
