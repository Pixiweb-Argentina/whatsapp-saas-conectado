import { z } from "zod";
import { channelSchema } from "@/features/channels/types/channel-contracts";

export const INBOX_CHANNEL_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp", instagram: "Instagram", messenger: "Messenger", web: "Chat web",
};
export const inboxFiltersSchema = z.object({
  channel: channelSchema.optional().catch(undefined),
  account: z.uuid().optional().catch(undefined),
  state: z.enum(["ai_active", "human_active", "handoff_pending", "waiting_reply", "paused", "closed"])
    .optional().catch(undefined),
  q: z.string().trim().max(80).catch(""),
  before: z.iso.datetime({ offset: true }).optional().catch(undefined),
  cursor: z.uuid().optional().catch(undefined),
});
export type InboxFilters = z.infer<typeof inboxFiltersSchema>;
export type InboxSearchParams = Record<string, string | string[] | undefined>;

export function parseInboxFilters(params: InboxSearchParams): InboxFilters {
  const filters = inboxFiltersSchema.parse(params);
  if (!filters.before || !filters.cursor) {
    filters.before = undefined;
    filters.cursor = undefined;
  }
  return filters;
}

/** Preserve validated filters on thread navigation; callers clear the cursor when changing filters. */
export function inboxQuery(filters: InboxFilters, changes: Partial<InboxFilters> = {}): string {
  const next = { ...filters, ...changes };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(next)) if (value) params.set(key, value);
  return params.toString() ? `?${params}` : "";
}
