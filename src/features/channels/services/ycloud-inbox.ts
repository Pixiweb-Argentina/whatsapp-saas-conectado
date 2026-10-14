import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseInbound } from "@/features/inbox/services/ycloud-webhook-handler";
import { normalizeWhatsAppEvent } from "./whatsapp-inbound-event";
import { resolveWhatsAppConnection, type AuthenticatedWhatsAppDelivery } from "./whatsapp-event-ingress";

const resultSchema = z.strictObject({ eventId: z.uuid(), conversationId: z.uuid(), messageId: z.uuid(), inserted: z.boolean() });
export interface YCloudInboxResult {
  eventId: string;
  conversationId: string;
  messageId: string;
  inserted: boolean;
}

/** Call after signature + exact business-account validation. No legacy writer,
 * consent inference, jobs, media downloads, model or external send.
 * Historical imports from a verified delivery log never become send evidence.
 */
export async function materializeYCloudInbox(db: SupabaseClient, input: AuthenticatedWhatsAppDelivery,
  historical = false, now = Date.now()): Promise<YCloudInboxResult | null> {
  if (input.provider !== "ycloud") throw new Error("YCLOUD_INBOX_CONTEXT_INVALID");
  z.boolean().parse(historical); z.number().int().nonnegative().parse(now);
  const parsed = parseInbound(input.payload);
  if (!parsed || parsed.type !== "text" || parsed.rawType !== "text") return null;
  const name = z.string().max(200).nullable().safeParse(parsed.customerName);
  if (!name.success) throw new Error("YCLOUD_INBOX_CONTEXT_INVALID");
  const row = await resolveWhatsAppConnection(db, input);
  const normalized = normalizeWhatsAppEvent({ connection: { workspaceId: row.workspace_id, connectionId: row.id,
    channel: row.channel, provider: row.provider, status: row.status, externalAccountId: row.external_account_id },
    payload: input.payload, defaultCountryCode: "1", receivedAt: new Date(now).toISOString() });
  if (normalized.status !== "normalized" || !/^\+[1-9]\d{7,14}$/.test(parsed.from)
    || !normalized.event.content.text || normalized.event.content.text.length > 16000
    || Date.parse(normalized.event.occurredAt) > now) throw new Error("YCLOUD_INBOX_CONTEXT_INVALID");
  const response = await db.rpc("materialize_ycloud_inbound", { p_workspace: input.workspaceId,
    p_integration: input.integrationId, p_event: normalized.event, p_customer_name: name.data, p_historical: historical });
  const result = resultSchema.safeParse(response.data);
  if (response.error || !result.success) throw new Error("YCLOUD_INBOX_PERSIST_FAILED");
  return result.data;
}
