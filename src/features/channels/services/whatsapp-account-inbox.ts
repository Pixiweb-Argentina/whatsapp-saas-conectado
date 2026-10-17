import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseInbound as parseYCloud } from "@/features/inbox/services/ycloud-webhook-handler";
import { parseInbound as parseKapso } from "@/features/inbox/services/kapso-webhook-handler";
import { inboundEventSchema, type InboundEvent } from "../types/channel-contracts";
import type { WhatsAppAccountSource } from "./whatsapp-account-source";

/** Reception is separate from capture and from all outbound/AI workspace flags. */
export function accountInboxEnabled(connectionId: string, raw = process.env.CHANNEL_ACCOUNT_INBOX_CONNECTIONS): boolean {
  if (!raw?.trim()) return false;
  const result = z.array(z.uuid()).max(100).safeParse(raw.split(",").map((s) => s.trim().toLowerCase()));
  if (!result.success) throw new Error("ACCOUNT_INBOX_CONFIG_INVALID");
  return result.data.includes(connectionId.toLowerCase());
}

const INBOX_TYPES = new Set(["text", "audio", "image", "document", "video", "sticker", "location"]);
/** Template/system and empty text stay capture-only; everything else a contact can send is materialized. */
export function accountInboxMaterializable(event: InboundEvent): boolean {
  if (!INBOX_TYPES.has(event.content.type) || event.mediaRefs.length > 1) return false;
  return event.content.type !== "text" || (event.content.text?.length ?? 0) > 0;
}

export interface AccountInboxMedia { link: string; mimeType?: string; filename?: string; mediaId?: string; caption?: string }
const resultSchema = z.strictObject({ eventId: z.uuid(), conversationId: z.uuid(), messageId: z.uuid(), inserted: z.boolean() });
/** Only after raw signature and destination validation. No legacy writer, buffer, model or send; download is the caller's. */
export async function materializeAccountInbox(db: SupabaseClient, source: NonNullable<WhatsAppAccountSource>,
  event: InboundEvent, payload: unknown, eventName: string | null) {
  const checked = inboundEventSchema.parse(event);
  if (checked.workspaceId !== source.workspaceId || checked.connectionId !== source.connectionId || checked.provider !== source.provider
    || checked.channel !== "whatsapp" || checked.kind !== "message" || !accountInboxMaterializable(checked)) {
    throw new Error("ACCOUNT_INBOX_SCOPE_INVALID");
  }
  const parsed = source.provider === "ycloud" ? parseYCloud(payload) : parseKapso(payload, eventName);
  const name = typeof parsed?.customerName === "string" ? parsed.customerName.slice(0, 200) : null;
  const { data, error } = await db.rpc("materialize_whatsapp_account_inbound", { p_workspace: source.workspaceId,
    p_connection: source.connectionId, p_source_revision: source.sourceRevision, p_event: checked, p_customer_name: name });
  const result = resultSchema.safeParse(data);
  if (error || !result.success) throw new Error("ACCOUNT_INBOX_STORAGE_FAILED");
  const media: AccountInboxMedia | null = checked.content.type !== "text" && parsed?.mediaLink ? {
    link: parsed.mediaLink, mimeType: parsed.mediaMime ?? undefined, filename: parsed.mediaFilename ?? undefined,
    mediaId: parsed.mediaId ?? undefined,
    caption: parsed.text && parsed.text !== "[Multimedia]" ? parsed.text : undefined } : null;
  return { ...result.data, media };
}
