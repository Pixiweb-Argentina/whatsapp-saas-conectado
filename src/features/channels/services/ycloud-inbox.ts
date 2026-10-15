import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthenticatedWhatsAppDelivery } from "./whatsapp-event-ingress";
import { readYCloudInboundText } from "./ycloud-inbound-text";

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
  z.boolean().parse(historical);
  const text = await readYCloudInboundText(db, input, now);
  if (!text) return null;
  const response = await db.rpc("materialize_ycloud_inbound", { p_workspace: input.workspaceId,
    p_integration: input.integrationId, p_event: text.event, p_customer_name: text.customerName, p_historical: historical });
  const result = resultSchema.safeParse(response.data);
  if (response.error) {
    const code = z.string().regex(/^[A-Z0-9]{5,10}$/).safeParse(response.error.code);
    const reason = ["INBOX_EVENT_INVALID", "INBOX_EVENT_COLLISION", "INBOX_CONVERSATION_COLLISION", "INBOX_AI_MUST_BE_PAUSED"]
      .includes(response.error.message) ? response.error.message : "DATABASE_ERROR";
    throw new Error(`YCLOUD_INBOX_PERSIST_FAILED:${code.success ? code.data : "UNKNOWN"}:${reason}`);
  }
  if (!result.success) throw new Error("YCLOUD_INBOX_RESULT_INVALID");
  return result.data;
}
