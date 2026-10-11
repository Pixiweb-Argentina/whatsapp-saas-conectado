import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { optOutKey } from "@/features/inbox/services/opt-out";
import { connectionSchema, inboundEventSchema } from "../types/channel-contracts";
import { policyConnectionSchema, policyConversationSchema, policyIdentitySchema,
  policySubjectSchema, verifiedCapabilitiesSchema, type PolicySubject, type PolicyConnection } from "../types/policy-context";
import type { SendPolicyInput } from "../types/send-policy";
import type { JobPolicyContext } from "./message-job-worker";
import { readCommentPolicyEvidence } from "./comment-policy-context";

const CONTEXT_ERROR = "CHANNEL_POLICY_CONTEXT_UNAVAILABLE";
const contactSchema = z.object({ id: z.uuid(), workspace_id: z.uuid(), opt_in: z.boolean().nullable() });
const eventRowSchema = z.object({ id: z.uuid(), workspace_id: z.uuid(), connection_id: z.uuid(),
  historical: z.literal(false), kind: z.literal("message"), envelope: inboundEventSchema });

function checked<T>(schema: z.ZodType<T>, data: unknown, error: unknown): T {
  const result = schema.safeParse(data);
  if (error || !result.success) throw new Error(CONTEXT_ERROR);
  return result.data;
}

export async function readPolicyConnection(db: SupabaseClient, workspaceId: string, connectionId: string)
  : Promise<PolicyConnection> {
  z.uuid().parse(workspaceId); z.uuid().parse(connectionId);
  const { data, error } = await db.from("channel_connections")
    .select("id,workspace_id,channel,provider,external_account_id,status,revoked_at,capabilities,legacy_integration_id")
    .eq("workspace_id", workspaceId).eq("id", connectionId).maybeSingle();
  const row = checked(policyConnectionSchema, data, error);
  if (row.workspace_id !== workspaceId || row.id !== connectionId
    || (row.status === "revoked") !== (row.revoked_at !== null)) throw new Error(CONTEXT_ERROR);
  return row;
}

async function readRecipient(db: SupabaseClient, subject: PolicySubject, now: number)
  : Promise<z.infer<typeof policyIdentitySchema>> {
  const { data, error } = await db.from("contact_identities")
    .select("id,workspace_id,connection_id,contact_id,external_user_id,verified_at")
    .eq("workspace_id", subject.workspaceId).eq("connection_id", subject.connectionId)
    .eq("external_user_id", subject.recipient).maybeSingle();
  const row = checked(policyIdentitySchema, data, error);
  if (row.workspace_id !== subject.workspaceId || row.connection_id !== subject.connectionId
    || row.external_user_id !== subject.recipient || !row.verified_at
    || Date.parse(row.verified_at) > now) throw new Error(CONTEXT_ERROR);
  return row;
}

async function readConversation(db: SupabaseClient, subject: PolicySubject, identityId: string, contactId: string)
  : Promise<SendPolicyInput["conversation"]> {
  if (!subject.conversationId) return null;
  const { data, error } = await db.from("conversations")
    .select("id,workspace_id,connection_id,identity_id,contact_id,channel,ai_enabled,state,state_revision")
    .eq("workspace_id", subject.workspaceId).eq("connection_id", subject.connectionId)
    .eq("id", subject.conversationId).maybeSingle();
  const row = checked(policyConversationSchema, data, error);
  if (row.id !== subject.conversationId || row.workspace_id !== subject.workspaceId
    || row.connection_id !== subject.connectionId || row.channel !== subject.channel
    || row.identity_id !== identityId || row.contact_id !== contactId) throw new Error(CONTEXT_ERROR);
  return { workspaceId: row.workspace_id, connectionId: row.connection_id,
    externalActorId: subject.recipient, channel: row.channel, aiEnabled: row.ai_enabled,
    state: row.state, revision: row.state_revision, expectedRevision: row.state_revision };
}

async function readOptOut(db: SupabaseClient, subject: PolicySubject, contactId: string): Promise<boolean> {
  const { data, error } = await db.from("contacts").select("id,workspace_id,opt_in")
    .eq("workspace_id", subject.workspaceId).eq("id", contactId).maybeSingle();
  const contact = checked(contactSchema, data, error);
  if (contact.id !== contactId || contact.workspace_id !== subject.workspaceId) throw new Error(CONTEXT_ERROR);
  if (contact.opt_in === false) return true;
  const key = subject.channel === "whatsapp" ? optOutKey(subject.recipient) : null;
  if (!key) return false;
  const suppression = await db.from("contact_opt_outs").select("phone_key")
    .eq("workspace_id", subject.workspaceId).eq("phone_key", key).limit(1);
  return checked(z.array(z.object({ phone_key: z.string() })), suppression.data, suppression.error).length > 0;
}

async function readEvidence(db: SupabaseClient, subject: PolicySubject, provider: string, now: number)
  : Promise<SendPolicyInput["evidence"]> {
  if (provider === "meta") return readCommentPolicyEvidence(db, subject);
  // Templates, Human Agent and visitor sessions need their own verified records.
  if (subject.channel !== "whatsapp" || !subject.conversationId || !subject.eventId) return null;
  const { data, error } = await db.from("inbound_events").select("id,workspace_id,connection_id,historical,kind,envelope")
    .eq("workspace_id", subject.workspaceId).eq("connection_id", subject.connectionId)
    .eq("id", subject.eventId).eq("historical", false).eq("kind", "message")
    .eq("envelope->>externalActorId", subject.recipient).maybeSingle();
  if (!error && data === null) return null;
  const row = checked(eventRowSchema, data, error);
  const event = row.envelope;
  if (row.workspace_id !== subject.workspaceId || row.connection_id !== subject.connectionId
    || (subject.eventId !== null && row.id !== subject.eventId)
    || event.workspaceId !== subject.workspaceId || event.connectionId !== subject.connectionId
    || event.channel !== subject.channel || event.provider !== provider || event.kind !== "message"
    || event.externalActorId !== subject.recipient || Date.parse(event.occurredAt) > now
    || Date.parse(event.receivedAt) > now) throw new Error(CONTEXT_ERROR);
  return { id: row.id, workspaceId: subject.workspaceId, connectionId: subject.connectionId,
    externalActorId: subject.recipient, kind: "inbound_message", occurredAt: event.occurredAt,
    validUntil: new Date(Date.parse(event.occurredAt) + 24 * 60 * 60 * 1000).toISOString() };
}

/** Internal server reader. It needs the service client; never accepts client policy facts. */
export async function loadMessagePolicyContext(
  db: SupabaseClient, input: PolicySubject, now = Date.now(),
): Promise<JobPolicyContext> {
  const subject = policySubjectSchema.parse(input);
  z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).parse(now);
  const row = await readPolicyConnection(db, subject.workspaceId, subject.connectionId);
  const identity = await readRecipient(db, subject, now);
  const connection = checked(connectionSchema, { workspaceId: row.workspace_id, connectionId: row.id,
    channel: row.channel, provider: row.provider, externalAccountId: row.external_account_id, status: row.status }, null);
  if (connection.channel !== subject.channel) throw new Error(CONTEXT_ERROR);
  const [conversation, optedOut, evidence] = await Promise.all([
    readConversation(db, subject, identity.id, identity.contact_id), readOptOut(db, subject, identity.contact_id),
    readEvidence(db, subject, connection.provider, now),
  ]);
  const grants = verifiedCapabilitiesSchema.safeParse(row.capabilities);
  return { connection, identity: { workspaceId: identity.workspace_id, connectionId: identity.connection_id,
    externalActorId: identity.external_user_id }, conversationId: subject.conversationId, conversation, optedOut,
    capabilities: grants.success ? grants.data.grants : [], evidence };
}
