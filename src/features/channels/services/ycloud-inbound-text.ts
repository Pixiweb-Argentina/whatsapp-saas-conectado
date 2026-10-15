import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseInbound } from "@/features/inbox/services/ycloud-webhook-handler";
import type { InboundEvent } from "../types/channel-contracts";
import { normalizeWhatsAppEvent } from "./whatsapp-inbound-event";
import { resolveWhatsAppConnection, type AuthenticatedWhatsAppDelivery } from "./whatsapp-event-ingress";

interface YCloudText {
  event: InboundEvent;
  customerName: string | null;
}

/** Raw signature and exact business-account checks belong to the HTTP boundary. */
export async function readYCloudInboundText(db: SupabaseClient, input: AuthenticatedWhatsAppDelivery,
  now: number): Promise<YCloudText | null> {
  if (input.provider !== "ycloud") throw new Error("YCLOUD_INBOX_CONTEXT_INVALID");
  z.number().int().nonnegative().parse(now);
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
  return { event: normalized.event, customerName: name.data };
}
