import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthenticatedWhatsAppDelivery } from "./whatsapp-event-ingress";
import { readYCloudInboundText } from "./ycloud-inbound-text";
import { ycloudReceptionMode } from "./ycloud-verification-mode";
import { channelRolloutWorkspaces } from "./channel-rollout";

const resultSchema = z.strictObject({ eventId: z.uuid(), conversationId: z.uuid(), messageId: z.uuid(),
  inserted: z.boolean(), batchId: z.uuid().nullable() });
export type YCloudPipelineResult = z.infer<typeof resultSchema>;

/** Atomic intake + pinned buffer only. No model, tool, legacy writer or send.
 * Removing AI rollout still accepts incoming messages, but never buffers them.
 */
export async function materializeYCloudPipeline(db: SupabaseClient, input: AuthenticatedWhatsAppDelivery,
  bufferSeconds?: unknown, now = Date.now()): Promise<YCloudPipelineResult | null> {
  if (ycloudReceptionMode(input.workspaceId) !== "pipeline") throw new Error("YCLOUD_PIPELINE_DISABLED");
  const text = await readYCloudInboundText(db, input, now);
  if (!text) return null;
  const seconds = typeof bufferSeconds === "number" || typeof bufferSeconds === "string" ? Number(bufferSeconds) : NaN;
  const silenceMs = Number.isFinite(seconds) && seconds >= 3 ? Math.round(Math.min(seconds, 120) * 1000) : 30000;
  const queueAi = (["ingress", "worker", "ai"] as const).every((stage) =>
    channelRolloutWorkspaces(stage).includes(input.workspaceId));
  const response = await db.rpc("materialize_ycloud_pipeline", { p_workspace: input.workspaceId,
    p_integration: input.integrationId, p_event: text.event, p_customer_name: text.customerName,
    p_queue_ai: queueAi, p_silence_ms: silenceMs });
  const result = resultSchema.safeParse(response.data);
  if (response.error || !result.success) throw new Error("YCLOUD_PIPELINE_STORAGE_FAILED");
  return result.data;
}
