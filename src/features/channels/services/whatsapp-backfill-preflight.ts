import { z } from "zod";
import { connectionSchema, type ChannelConnection } from "../types/channel-contracts";

const rowScope = { id: z.uuid(), workspaceId: z.uuid() };
export const backfillSnapshotSchema = z.strictObject({
  connections: z.array(connectionSchema),
  contacts: z.array(z.strictObject({ ...rowScope, phone: z.string().nullable() })),
  conversations: z.array(z.strictObject({
    ...rowScope, contactId: z.uuid(), channel: z.string().min(1),
  })),
  messages: z.array(z.strictObject({
    ...rowScope, conversationId: z.uuid(), wamid: z.string().nullable(),
  })),
});
type Snapshot = z.infer<typeof backfillSnapshotSchema>;

export interface BackfillBlocker {
  code: "duplicate_id" | "account_shared" | "connection_ambiguous" | "contact_missing"
    | "tenant_mismatch" | "phone_invalid" | "identity_collision"
    | "conversation_missing" | "message_collision";
  entityId: string;
}

export interface BackfillAssignment {
  workspaceId: string;
  conversationId: string;
  contactId: string;
  connectionId: string;
  externalActorId: string;
}

export interface BackfillPreflight {
  readyForDryRun: boolean;
  counts: { contacts: number; conversations: number; messages: number; whatsappConversations: number };
  blockers: BackfillBlocker[];
  assignments: BackfillAssignment[];
}

function indexRows<T extends { id: string }>(rows: T[], blockers: BackfillBlocker[]): Map<string, T> {
  const indexed = new Map<string, T>();
  for (const row of rows) {
    if (indexed.has(row.id)) blockers.push({ code: "duplicate_id", entityId: row.id });
    else indexed.set(row.id, row);
  }
  return indexed;
}

function indexConnections(connections: ChannelConnection[], blockers: BackfillBlocker[]) {
  const byWorkspace = new Map<string, ChannelConnection[]>();
  const accounts = new Map<string, string>();
  const ids = new Set<string>();
  for (const connection of connections) {
    if (ids.has(connection.connectionId)) {
      blockers.push({ code: "duplicate_id", entityId: connection.connectionId });
    }
    ids.add(connection.connectionId);
    if (connection.channel !== "whatsapp") continue;
    const accountKey = JSON.stringify([connection.provider, connection.externalAccountId]);
    const owner = accounts.get(accountKey);
    if (owner && owner !== connection.workspaceId) {
      blockers.push({ code: "account_shared", entityId: connection.connectionId });
    }
    accounts.set(accountKey, connection.workspaceId);
    const list = byWorkspace.get(connection.workspaceId) ?? [];
    list.push(connection);
    byWorkspace.set(connection.workspaceId, list);
  }
  return byWorkspace;
}

function planConversation(
  row: Snapshot["conversations"][number],
  contacts: Map<string, Snapshot["contacts"][number]>,
  connections: Map<string, ChannelConnection[]>,
  identities: Map<string, string>,
  blockers: BackfillBlocker[],
): BackfillAssignment | null {
  const contact = contacts.get(row.contactId);
  if (!contact) { blockers.push({ code: "contact_missing", entityId: row.id }); return null; }
  if (contact.workspaceId !== row.workspaceId) {
    blockers.push({ code: "tenant_mismatch", entityId: row.id }); return null;
  }
  if (row.channel !== "whatsapp") return null;
  const candidates = connections.get(row.workspaceId) ?? [];
  if (candidates.length !== 1) {
    blockers.push({ code: "connection_ambiguous", entityId: row.id }); return null;
  }
  if (!contact.phone || !/^\+[1-9]\d{7,14}$/.test(contact.phone)) {
    blockers.push({ code: "phone_invalid", entityId: row.id }); return null;
  }
  const key = JSON.stringify([row.workspaceId, candidates[0].connectionId, contact.phone]);
  if (identities.has(key)) {
    blockers.push({ code: "identity_collision", entityId: row.id }); return null;
  }
  identities.set(key, row.id);
  return { workspaceId: row.workspaceId, conversationId: row.id, contactId: contact.id,
    connectionId: candidates[0].connectionId, externalActorId: contact.phone };
}

function checkMessages(snapshot: Snapshot, blockers: BackfillBlocker[]): void {
  const conversations = new Map(snapshot.conversations.map((row) => [row.id, row]));
  const wamids = new Set<string>();
  for (const message of snapshot.messages) {
    const conversation = conversations.get(message.conversationId);
    if (!conversation) {
      blockers.push({ code: "conversation_missing", entityId: message.id });
    } else if (conversation.workspaceId !== message.workspaceId) {
      blockers.push({ code: "tenant_mismatch", entityId: message.id });
    }
    if (conversation?.channel !== "whatsapp" || message.wamid === null) continue;
    const key = JSON.stringify([message.workspaceId, message.wamid]);
    if (wamids.has(key)) blockers.push({ code: "message_collision", entityId: message.id });
    wamids.add(key);
  }
}

/**
 * Read-only preflight of a COMPLETE, consistent snapshot. No DB/network access.
 * This detects unsafe input; it does not execute a backfill or prove backup/rollback.
 * Return zero assignments on any blocker so callers cannot accidentally apply a partial plan.
 * Phone aliases are not merged and historical provider switches are never guessed.
 */
export function assessWhatsAppBackfill(input: unknown): BackfillPreflight {
  const snapshot = backfillSnapshotSchema.parse(input);
  const blockers: BackfillBlocker[] = [];
  const contacts = indexRows(snapshot.contacts, blockers);
  indexRows(snapshot.conversations, blockers);
  indexRows(snapshot.messages, blockers);
  const connections = indexConnections(snapshot.connections, blockers);
  const identities = new Map<string, string>();
  const assignments: BackfillAssignment[] = [];
  for (const row of snapshot.conversations) {
    const assignment = planConversation(row, contacts, connections, identities, blockers);
    if (assignment) assignments.push(assignment);
  }
  checkMessages(snapshot, blockers);
  return {
    readyForDryRun: blockers.length === 0,
    counts: { contacts: snapshot.contacts.length, conversations: snapshot.conversations.length,
      messages: snapshot.messages.length,
      whatsappConversations: snapshot.conversations.filter((row) => row.channel === "whatsapp").length },
    blockers,
    assignments: blockers.length === 0 ? assignments : [],
  };
}
