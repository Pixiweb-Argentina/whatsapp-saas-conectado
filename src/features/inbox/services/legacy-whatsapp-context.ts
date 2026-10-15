import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContactRow, ConversationRow } from "../types";

const routingSchema = z.strictObject({ integrationId: z.uuid(), provider: z.enum(["ycloud", "kapso"]),
  accountId: z.string().trim().min(1).max(512).nullable() });
export type LegacyWhatsAppRouting = z.infer<typeof routingSchema>;
const conversationSchema = z.object({ id: z.string().min(1), workspace_id: z.string().min(1),
  contact_id: z.string().min(1), channel: z.literal("whatsapp") }).passthrough();
const contextSchema = z.object({
  contact: z.object({ id: z.string().min(1), workspace_id: z.string().min(1) }).passthrough(),
  conversation: conversationSchema,
});

/** Only signed, destination-checked legacy webhooks supply routing. No account guessing. */
export async function writeLegacyWhatsAppContext(db: SupabaseClient, workspaceId: string,
  phone: string, name: string | null, routing: LegacyWhatsAppRouting,
): Promise<{ contact: ContactRow; conversation: ConversationRow }> {
  const input = z.object({ workspaceId: z.uuid(), phone: z.string().regex(/^\+[1-9][0-9]{7,14}$/),
    name: z.string().max(200).nullable(), routing: routingSchema }).parse({ workspaceId, phone, name, routing });
  const result = await db.rpc("upsert_legacy_whatsapp_inbound", { p_workspace: input.workspaceId,
    p_phone: input.phone, p_name: input.name, p_routing: input.routing });
  const parsed = contextSchema.safeParse(result.data);
  if (result.error || !parsed.success || parsed.data.contact.workspace_id !== workspaceId
    || parsed.data.conversation.workspace_id !== workspaceId
    || parsed.data.conversation.contact_id !== parsed.data.contact.id) {
    throw new Error("LEGACY_WHATSAPP_CONTEXT_UNAVAILABLE");
  }
  return parsed.data as unknown as { contact: ContactRow; conversation: ConversationRow };
}

/** Contact-level rules never choose the newest account or a different channel. */
export async function readLegacyWhatsAppConversation(db: SupabaseClient, workspaceId: string,
  contactId: string, routing: LegacyWhatsAppRouting | null = null,
): Promise<ConversationRow | null> {
  const result = await db.rpc("read_legacy_whatsapp_conversation", { p_workspace: workspaceId,
    p_contact: contactId, p_routing: routing === null ? null : routingSchema.parse(routing) });
  const parsed = z.array(conversationSchema).max(1).safeParse(result.data);
  if (result.error || !parsed.success || parsed.data.some((row) => row.workspace_id !== workspaceId
    || row.contact_id !== contactId)) throw new Error("LEGACY_WHATSAPP_CONTEXT_UNAVAILABLE");
  return (parsed.data[0] as unknown as ConversationRow | undefined) ?? null;
}
