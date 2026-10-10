import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConversationWithContact } from "../types";
import { channelSchema } from "@/features/channels/types/channel-contracts";
import { inboxFiltersSchema, type InboxFilters } from "../lib/inbox-filters";

const accountSchema = z.object({ id: z.uuid(), channel: channelSchema, display_name: z.string().nullable() });
export type InboxAccount = z.infer<typeof accountSchema>;
const rowSchema = z.object({
  id: z.uuid(), workspace_id: z.uuid(), channel: channelSchema,
  activity_at: z.iso.datetime({ offset: true }),
  contact: z.object({ id: z.uuid(), workspace_id: z.uuid() }).passthrough(),
  connection: accountSchema.nullable(),
  last_message: z.object({ body: z.string().nullable(), direction: z.enum(["in", "out"]),
    created_at: z.iso.datetime({ offset: true }) }).nullable(),
}).passthrough();

export interface InboxPageData {
  conversations: ConversationWithContact[];
  accounts: InboxAccount[];
  next: Pick<InboxFilters, "before" | "cursor"> | null;
  error: boolean;
}

/** Call only with the session client: SECURITY INVOKER preserves membership/RLS. */
export async function readInboxPage(
  db: SupabaseClient, workspaceId: string, filters: InboxFilters,
): Promise<InboxPageData> {
  z.uuid().parse(workspaceId);
  const input = inboxFiltersSchema.parse(filters);
  const [page, accounts] = await Promise.all([
    db.rpc("read_inbox_page", { p_workspace_id: workspaceId, p_channel: input.channel ?? null,
      p_connection_id: input.account ?? null, p_state: input.state ?? null, p_search: input.q,
      p_before_at: input.before ?? null, p_before_id: input.cursor ?? null }),
    db.from("channel_connections").select("id,channel,display_name").eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true }),
  ]);
  const rows = z.array(rowSchema).max(51).safeParse(page.data);
  const connections = z.array(accountSchema).safeParse(accounts.data);
  if (page.error || accounts.error || !rows.success || !connections.success
    || rows.data.some((row) => row.workspace_id !== workspaceId || row.contact.workspace_id !== workspaceId)) {
    return { conversations: [], accounts: [], next: null, error: true };
  }
  const visible = rows.data.slice(0, 50);
  const last = visible.at(-1);
  return { conversations: visible as unknown as ConversationWithContact[], accounts: connections.data,
    next: rows.data.length > 50 && last ? { before: last.activity_at, cursor: last.id } : null, error: false };
}
