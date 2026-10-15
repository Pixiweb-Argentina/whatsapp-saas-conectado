import type { ConversationWithContact } from "../types";
import { INBOX_CHANNEL_LABELS } from "./inbox-filters";

/** Name only the channel account; the contact's phone is never its fallback. */
export function conversationAccountLabel(
  conversation: Pick<ConversationWithContact, "channel" | "connection" | "connection_id">,
): string {
  const channel = INBOX_CHANNEL_LABELS[conversation.channel] ?? "Canal desconocido";
  const accountId = conversation.connection?.id ?? conversation.connection_id;
  const account = conversation.connection?.display_name?.trim()
    || (accountId ? `Cuenta ${accountId.slice(0, 8)}` : "Cuenta sin vincular");
  return `${channel} · ${account}`;
}
