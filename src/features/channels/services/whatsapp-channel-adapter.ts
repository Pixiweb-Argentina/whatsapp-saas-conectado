import {
  WhatsAppConfigError, type WhatsAppSender,
} from "@/features/inbox/services/whatsapp-sender";
import { YCloudError } from "@/features/inbox/services/ycloud-client";
import { KapsoError } from "@/features/inbox/services/kapso-client";
import {
  parseWhatsAppError, wasNotAccepted, UNCONFIRMED_SEND_ERROR, type WhatsAppError,
} from "@/features/inbox/services/whatsapp-errors";
import {
  channelSendRequestSchema, channelSendResultSchema,
  type ChannelAdapter, type ChannelSendRequest, type ChannelSendResult,
} from "../types/send-contracts";

/** Server-only diagnostics must never be persisted in messages.meta or returned to UI. */
export type WhatsAppChannelResult = ChannelSendResult & { diagnostic?: WhatsAppError };
export interface WhatsAppChannelAdapter extends ChannelAdapter {
  send(request: ChannelSendRequest): Promise<WhatsAppChannelResult>;
}

function failure(error: unknown, operationId: string): WhatsAppChannelResult {
  if (error instanceof WhatsAppConfigError) {
    return { status: "rejected", errorCode: "CONFIG_ERROR", retryable: false,
      diagnostic: { ...parseWhatsAppError(null), message: error.message, detail: null } };
  }
  const providerError = error instanceof YCloudError || error instanceof KapsoError;
  const diagnostic = providerError
    ? parseWhatsAppError(error.body, error.status)
    : { ...parseWhatsAppError(null), message: UNCONFIRMED_SEND_ERROR,
      detail: error instanceof Error ? error.message : String(error) };
  // No automatic retry for a 5xx, timeout, malformed response or unknown exception.
  if (!providerError || error.status >= 500 || error.status === 408 || error.status < 400) {
    return { status: "unknown", operationId,
      diagnostic: { ...diagnostic, message: UNCONFIRMED_SEND_ERROR } };
  }
  return { status: "rejected", errorCode: diagnostic.code === null
    ? "PROVIDER_REJECTED" : String(diagnostic.code),
  retryable: wasNotAccepted(diagnostic), diagnostic };
}

function rejected(errorCode: string): WhatsAppChannelResult {
  return { status: "rejected", errorCode, retryable: false };
}

async function send(
  sender: WhatsAppSender, input: ChannelSendRequest,
): Promise<WhatsAppChannelResult> {
  const checked = channelSendRequestSchema.safeParse(input);
  if (!checked.success) return rejected("INVALID_REQUEST");
  const request = checked.data;
  if (request.channel !== "whatsapp") return rejected("CHANNEL_MISMATCH");
  if (request.action !== "text" && request.action !== "template") {
    return rejected("UNSUPPORTED_CAPABILITY");
  }
  if (!sender.live) return rejected("NOT_LIVE");
  try {
    const sent = request.action === "text"
      ? await sender.sendText(request.recipient, request.body, { operationId: request.operationId })
      : await sender.sendTemplate({ to: request.recipient,
        templateName: request.templateName, language: request.language,
        components: request.components });
    const result = channelSendResultSchema.safeParse({ status: "accepted",
      externalId: sent.wamid || sent.providerMessageId,
      wamid: sent.wamid, providerMessageId: sent.providerMessageId });
    return result.success ? result.data : { status: "unknown", operationId: request.operationId };
  } catch (error) {
    return failure(error, request.operationId);
  }
}

/** Reuses the existing clients; no new API endpoints, credentials or retry loops. */
export function whatsappChannelAdapter(sender: WhatsAppSender): WhatsAppChannelAdapter {
  return { channel: "whatsapp", provider: sender.provider, live: sender.live,
    implementedActions: ["text", "template"], send: (request) => send(sender, request) };
}
