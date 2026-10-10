import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { channelRolloutWorkspaces } from "./channel-rollout";

const inputSchema = z.strictObject({ workspaceId: z.uuid(), conversationId: z.uuid(),
  senderUserId: z.uuid(), operationId: z.uuid(), body: z.string().trim().min(1).max(4096) });
const resultSchema = z.strictObject({ operationId: z.uuid(), duplicate: z.boolean(),
  state: z.enum(["pending", "leased", "sending", "accepted", "rejected", "unknown", "cancelled", "dead_letter"]) });
export type HumanEnqueueResult = z.infer<typeof resultSchema>;

/** The route authenticates the operator. Never call with IDs copied from a body. */
export async function enqueueHumanMessage(input: z.infer<typeof inputSchema>): Promise<HumanEnqueueResult> {
  const value = inputSchema.parse(input);
  if (!channelRolloutWorkspaces("human").includes(value.workspaceId)
    || !channelRolloutWorkspaces("worker").includes(value.workspaceId)) throw new Error("HUMAN_ROLLOUT_DISABLED");
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db.rpc("enqueue_human_channel_text", {
    p_workspace_id: value.workspaceId, p_conversation_id: value.conversationId,
    p_sender_user_id: value.senderUserId, p_operation_id: value.operationId, p_body: value.body,
  });
  if (error) {
    const known = ["HUMAN_FORBIDDEN", "HUMAN_NOT_FOUND", "HUMAN_CONFLICT", "HUMAN_CONTEXT_UNAVAILABLE"];
    throw new Error(known.includes(error.message) ? error.message : "HUMAN_ENQUEUE_UNAVAILABLE");
  }
  const result = resultSchema.safeParse(data);
  if (!result.success || result.data.operationId !== value.operationId) throw new Error("HUMAN_ENQUEUE_UNAVAILABLE");
  return result.data;
}
