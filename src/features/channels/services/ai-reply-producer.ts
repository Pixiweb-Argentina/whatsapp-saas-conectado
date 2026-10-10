import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { channelRolloutWorkspaces } from "./channel-rollout";

const scopeSchema = z.strictObject({ workspaceId: z.uuid(), batchId: z.uuid() });
const inputSchema = scopeSchema.extend({ body: z.string().min(1).max(4096).refine((value) => value.trim().length > 0) });
const jobStateSchema = z.enum(["pending", "leased", "sending", "accepted", "rejected", "unknown", "cancelled", "dead_letter"]);
const preparationSchema = z.strictObject({ mode: z.enum(["legacy", "queue"]), operationId: z.uuid(),
  eligible: z.boolean(), reply: z.string().min(1).max(4096).nullable(), state: jobStateSchema.nullable() });
const resultSchema = z.strictObject({ operationId: z.uuid(), queued: z.boolean(), duplicate: z.boolean(),
  state: jobStateSchema.nullable(), reason: z.literal("context_unavailable").nullable() })
  .refine((value) => value.queued ? value.state !== null && value.reason === null
    : value.state === null && value.reason !== null && !value.duplicate);
type Scope = z.infer<typeof scopeSchema>;
export type AiReplyPreparation = z.infer<typeof preparationSchema> & { enabled: boolean };
export type AiReplyEnqueueResult = z.infer<typeof resultSchema>;

function queueEnabled(workspaceId: string, env: Readonly<Record<string, string | undefined>>): boolean {
  return (["ai", "ingress", "worker"] as const).every((stage) => channelRolloutWorkspaces(stage, env).includes(workspaceId));
}

/** Internal service dependency only. Not wired to the legacy buffer yet.
 * prepare must run before any model, tool or legacy send. A persisted queue
 * choice never authorizes a legacy fallback, even when flags change on retry.
 */
export function createAiReplyProducer(db: SupabaseClient, env: Readonly<Record<string, string | undefined>> = process.env) {
  async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
    const { data, error } = await db.rpc(name, args);
    if (error) {
      const known = ["AI_SCOPE_INVALID", "AI_BATCH_NOT_PROCESSING", "AI_PREPARATION_REQUIRED", "AI_REPLY_CONFLICT"];
      throw new Error(known.includes(error.message) ? error.message : "AI_QUEUE_STORAGE_FAILED");
    }
    return data;
  }
  return {
    async prepare(input: Scope): Promise<AiReplyPreparation> {
      const scope = scopeSchema.parse(input);
      const wantsQueue = channelRolloutWorkspaces("ai", env).includes(scope.workspaceId);
      const raw = await rpc("prepare_ai_channel_reply", { p_workspace_id: scope.workspaceId,
        p_batch_id: scope.batchId, p_mode: wantsQueue ? "queue" : "legacy" });
      const parsed = preparationSchema.safeParse(raw);
      if (!parsed.success || parsed.data.operationId !== scope.batchId) throw new Error("AI_QUEUE_STORAGE_FAILED");
      return { ...parsed.data, enabled: parsed.data.mode === "legacy" || queueEnabled(scope.workspaceId, env) };
    },
    async enqueue(input: z.infer<typeof inputSchema>): Promise<AiReplyEnqueueResult> {
      const scope = inputSchema.parse(input);
      if (!queueEnabled(scope.workspaceId, env)) throw new Error("AI_ROLLOUT_DISABLED");
      const raw = await rpc("enqueue_ai_channel_reply", { p_workspace_id: scope.workspaceId,
        p_batch_id: scope.batchId, p_body: scope.body });
      const parsed = resultSchema.safeParse(raw);
      if (!parsed.success || parsed.data.operationId !== scope.batchId) throw new Error("AI_QUEUE_STORAGE_FAILED");
      return parsed.data;
    },
  };
}
