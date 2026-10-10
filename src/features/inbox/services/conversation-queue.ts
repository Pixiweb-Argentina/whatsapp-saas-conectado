import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { queuedMessageSchema, type ConversationQueue } from "../types/queued-message";

/** Session client only: the RPC checks current membership in this workspace. */
export async function readConversationQueue(
  db: SupabaseClient, workspaceId: string, conversationId: string,
): Promise<ConversationQueue> {
  z.uuid().parse(workspaceId); z.uuid().parse(conversationId);
  const result = await db.rpc("read_conversation_queue", {
    p_workspace_id: workspaceId, p_conversation_id: conversationId,
  });
  const rows = z.array(queuedMessageSchema).max(51).safeParse(result.data);
  if (result.error || !rows.success) return { messages: [], more: false, error: true };
  return { messages: rows.data.slice(0, 50).reverse(), more: rows.data.length > 50, error: false };
}
