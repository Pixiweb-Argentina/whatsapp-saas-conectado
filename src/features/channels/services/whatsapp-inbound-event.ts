import { parseInbound as parseYCloud } from "@/features/inbox/services/ycloud-webhook-handler";
import { parseInbound as parseKapso } from "@/features/inbox/services/kapso-webhook-handler";
import { normalizePhone } from "@/features/inbox/services/phone";
import {
  connectionSchema, inboundEventSchema,
  type ChannelConnection, type InboundEvent,
} from "../types/channel-contracts";

export interface WhatsAppInboundInput {
  /** Server-resolved connection after signature verification; never supplied by the body. */
  connection: ChannelConnection;
  payload: unknown;
  kapsoEventName?: string | null;
  receivedAt: string;
  defaultCountryCode: string;
}

export type NormalizeWhatsAppResult =
  | { status: "normalized"; event: InboundEvent }
  | { status: "ignored"; reason: "not_inbound" }
  | { status: "rejected"; reason: "invalid_context" | "account_mismatch" | "invalid_event" };

/**
 * Shared normalization boundary for signed webhook capture and contract tests.
 * Media download URLs/transcripts remain in the legacy pipeline; only stable media IDs
 * belong to this durable envelope. No sends, DB writes, opt-in changes or inference of ads.
 */
export function normalizeWhatsAppEvent(input: WhatsAppInboundInput): NormalizeWhatsAppResult {
  const checked = connectionSchema.safeParse(input.connection);
  if (!checked.success || checked.data.channel !== "whatsapp"
    || checked.data.status === "revoked" || !/^\d{1,3}$/.test(input.defaultCountryCode)) {
    return { status: "rejected", reason: "invalid_context" };
  }
  const connection = checked.data;
  const parsed = connection.provider === "ycloud"
    ? parseYCloud(input.payload)
    : parseKapso(input.payload, input.kapsoEventName ?? null);
  if (!parsed) return { status: "ignored", reason: "not_inbound" };
  const account = "workspacePhone" in parsed ? parsed.workspacePhone : parsed.phoneNumberId;
  if (!account || account !== connection.externalAccountId) {
    return { status: "rejected", reason: "account_mismatch" };
  }
  const actor = normalizePhone(parsed.from, input.defaultCountryCode);
  if (!/^\+[1-9]\d{7,14}$/.test(actor)) return { status: "rejected", reason: "invalid_event" };
  const event = inboundEventSchema.safeParse({
    schemaVersion: 1, workspaceId: connection.workspaceId, connectionId: connection.connectionId,
    channel: connection.channel, provider: connection.provider, providerEventId: parsed.wamid,
    kind: "message", occurredAt: parsed.createTime, receivedAt: input.receivedAt,
    externalActorId: actor, externalMessageId: parsed.wamid,
    content: { type: parsed.type, text: parsed.text, rawType: parsed.rawType },
    mediaRefs: parsed.mediaId ? [{
      externalId: parsed.mediaId, mimeType: parsed.mediaMime, filename: parsed.mediaFilename,
    }] : [],
    sourceContext: { channel: "whatsapp", sourceType: "direct_message" },
  });
  return event.success ? { status: "normalized", event: event.data }
    : { status: "rejected", reason: "invalid_event" };
}
