import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

const scopeSchema = z.strictObject({ workspaceId: z.uuid(), batchId: z.uuid() });
export type BufferClaimScope = z.infer<typeof scopeSchema>;
const rowsSchema = z.array(z.object({ id: z.uuid(), workspace_id: z.uuid(), status: z.literal("processing") })).max(1);

/** Exact manual claim never falls back to the global scanner or stale recovery. */
export async function claimBufferBatch(db: SupabaseClient, target?: unknown) {
  if (target === undefined) return db.rpc("claim_next_batch");
  const scope = scopeSchema.safeParse(target);
  if (!scope.success) return { data: null, error: { message: "AI_CLAIM_INPUT_INVALID" } };
  const result = await db.rpc("claim_ai_channel_batch", {
    p_workspace_id: scope.data.workspaceId, p_batch_id: scope.data.batchId,
  });
  const rows = rowsSchema.safeParse(result.data);
  if (result.error || !rows.success || rows.data.some((row) => row.id !== scope.data.batchId
    || row.workspace_id !== scope.data.workspaceId)) {
    return { data: null, error: { message: "AI_CLAIM_UNAVAILABLE" } };
  }
  return result;
}
