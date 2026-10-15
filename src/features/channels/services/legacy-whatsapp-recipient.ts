import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readLegacyWhatsAppConversation } from "@/features/inbox/services/legacy-whatsapp-context";

const conversationSchema = z.object({
  channel: z.literal("whatsapp"), contact_id: z.string().min(1),
  window_expires_at: z.string().nullable(),
  connection_id: z.string().nullable().optional(),
});
const contactSchema = z.object({ phone: z.string().nullable(), opt_in: z.boolean().nullable() });

export interface LegacyWhatsAppRecipient {
  window_expires_at: string | null;
  toPhone: string;
  optIn: boolean;
}

/** Tenant-scoped compatibility reader. Never routes a non-WA chat by its contact's phone. */
export async function loadLegacyWhatsAppRecipient(
  conversationId: string, workspaceId: string, supabase: SupabaseClient,
): Promise<LegacyWhatsAppRecipient | null> {
  const { data, error } = await supabase.from("conversations")
    .select("channel, window_expires_at, contact_id, connection_id")
    .eq("id", conversationId).eq("workspace_id", workspaceId).maybeSingle();
  if (error) throw new Error(`[dispatch] conversation lookup failed: ${error.message}`);
  const conversation = conversationSchema.safeParse(data);
  if (!conversation.success) return null;
  if (conversation.data.connection_id) {
    const legacy = await readLegacyWhatsAppConversation(supabase, workspaceId, conversation.data.contact_id);
    if (!legacy || legacy.id !== conversationId) return null;
  }
  const { data: contactData, error: contactError } = await supabase.from("contacts")
    .select("phone, opt_in").eq("id", conversation.data.contact_id)
    .eq("workspace_id", workspaceId).maybeSingle();
  if (contactError) throw new Error(`[dispatch] contact lookup failed: ${contactError.message}`);
  const contact = contactSchema.safeParse(contactData);
  if (!contact.success || !contact.data.phone?.trim()) return null;
  return { window_expires_at: conversation.data.window_expires_at,
    toPhone: contact.data.phone, optIn: contact.data.opt_in !== false };
}
