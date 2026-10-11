import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { inboundEventSchema } from "../types/channel-contracts";
import { policyConnectionSchema, policyIdentitySchema, verifiedCapabilitiesSchema, type PolicyConnection } from "../types/policy-context";
import type { ConnectionPilotPreflight, PilotBlocker, PilotPreflight, PreflightPolicyReason } from "../types/pilot-preflight";
import { channelRolloutWorkspaces } from "./channel-rollout";
import { resolveConnectionAdapter } from "./connection-adapter";
import { loadMessagePolicyContext } from "./message-policy-context";
import { evaluateSendPolicy } from "./send-policy";

const ERROR = "CHANNEL_PREFLIGHT_UNAVAILABLE";
const conversationSchema = z.object({ id: z.uuid(), workspace_id: z.uuid(), connection_id: z.uuid().nullable(),
  identity_id: z.uuid().nullable(), state_revision: z.number().int().nonnegative() });
const eventSchema = z.object({ id: z.uuid(), workspace_id: z.uuid(), connection_id: z.uuid(),
  historical: z.literal(false), kind: z.literal("message"), envelope: inboundEventSchema });
interface Snapshot {
  connections: PolicyConnection[];
  identities: z.infer<typeof policyIdentitySchema>[];
  conversations: z.infer<typeof conversationSchema>[];
  events: z.infer<typeof eventSchema>[];
}

async function readRows<T extends { workspace_id: string }>(query: PromiseLike<{ data: unknown; error: unknown }>, schema: z.ZodType<T>, workspaceId: string)
  : Promise<T[]> {
  const { data, error } = await query;
  const parsed = z.array(schema).safeParse(data);
  if (error || !parsed.success || parsed.data.some((row) => row.workspace_id !== workspaceId)) {
    throw new Error(ERROR);
  }
  return parsed.data;
}

async function readSnapshot(db: SupabaseClient, workspaceId: string): Promise<Snapshot> {
  const [connections, identities, conversations, events] = await Promise.all([
    readRows(db.from("channel_connections").select("id,workspace_id,channel,provider,external_account_id,status,revoked_at,capabilities,legacy_integration_id")
      .eq("workspace_id", workspaceId).limit(101), policyConnectionSchema, workspaceId),
    readRows(db.from("contact_identities").select("id,workspace_id,connection_id,contact_id,external_user_id,verified_at")
      .eq("workspace_id", workspaceId).limit(1001), policyIdentitySchema, workspaceId),
    readRows(db.from("conversations").select("id,workspace_id,connection_id,identity_id,state_revision")
      .eq("workspace_id", workspaceId).limit(101), conversationSchema, workspaceId),
    readRows(db.from("inbound_events").select("id,workspace_id,connection_id,historical,kind,envelope")
      .eq("workspace_id", workspaceId).eq("kind", "message").eq("historical", false).limit(1001), eventSchema, workspaceId),
  ]);
  return { connections, identities, conversations, events };
}

async function pilotOptIn(db: SupabaseClient, workspaceId: string, contactId: string): Promise<boolean> {
  const { data, error } = await db.from("contacts").select("id,workspace_id,opt_in")
    .eq("workspace_id", workspaceId).eq("id", contactId).maybeSingle();
  const parsed = z.object({ id: z.uuid(), workspace_id: z.uuid(), opt_in: z.boolean().nullable() }).safeParse(data);
  if (error || !parsed.success || parsed.data.id !== contactId || parsed.data.workspace_id !== workspaceId) throw new Error(ERROR);
  return parsed.data.opt_in === true;
}

function textGrantCurrent(connection: PolicyConnection, now: number): boolean {
  const result = verifiedCapabilitiesSchema.safeParse(connection.capabilities);
  return result.success && result.data.grants.some((grant) => grant.workspaceId === connection.workspace_id
    && grant.connectionId === connection.id && grant.capability === "text"
    && Date.parse(grant.verifiedAt) <= now && Date.parse(grant.validUntil) > now);
}

async function samplePolicies(db: SupabaseClient, connection: PolicyConnection, snapshot: Snapshot, now: number)
  : Promise<{ policies: PreflightPolicyReason[]; failed: boolean; partial: boolean }> {
  const targets = snapshot.conversations.filter((c) => c.connection_id === connection.id);
  const policies: PreflightPolicyReason[] = [];
  let failed = false;
  for (const conversation of targets.slice(0, 10)) {
    const identity = snapshot.identities.find((i) => i.id === conversation.identity_id && i.connection_id === connection.id);
    if (!identity) continue;
    const event = snapshot.events.filter((e) => e.connection_id === connection.id
      && e.envelope.externalActorId === identity.external_user_id).sort((a, b) =>
      Date.parse(b.envelope.occurredAt) - Date.parse(a.envelope.occurredAt))[0];
    if (!event) continue;
    try {
      const { conversationId: _id, ...context } = await loadMessagePolicyContext(db, {
        workspaceId: connection.workspace_id, connectionId: connection.id, conversationId: conversation.id,
        eventId: event.id, recipient: identity.external_user_id, channel: connection.channel,
      }, now);
      if (context.optedOut) { policies.push("opted_out"); continue; }
      if (connection.channel === "whatsapp" && !await pilotOptIn(db, connection.workspace_id, identity.contact_id)) {
        policies.push("opt_in_required"); continue;
      }
      const decision = evaluateSendPolicy({ ...context, workspaceId: connection.workspace_id, actor: "human", phase: "enqueue", now,
        request: { operationId: "preflight-read-only", channel: connection.channel, action: "text",
          recipient: identity.external_user_id, body: "Preflight: no enqueue or send" } });
      policies.push(decision.reasonCode);
    } catch { failed = true; }
  }
  return { policies, failed, partial: targets.length > 10 };
}

async function checkConnection(db: SupabaseClient, connection: PolicyConnection, snapshot: Snapshot, now: number)
  : Promise<{ report: ConnectionPilotPreflight; partial: boolean }> {
  const blockers: PilotBlocker[] = [];
  const storedTextGrantCurrent = textGrantCurrent(connection, now);
  const verifiedIdentities = snapshot.identities.filter((i) => i.connection_id === connection.id
    && i.verified_at !== null && Date.parse(i.verified_at) <= now).length;
  if (connection.status !== "ready" || connection.revoked_at) blockers.push("connection_not_ready");
  if (!storedTextGrantCurrent) blockers.push("grant_missing");
  if (!verifiedIdentities) blockers.push("identity_unverified");
  let configuredTransport = false;
  try { configuredTransport = (await resolveConnectionAdapter(db, connection.workspace_id, connection.id))?.live === true; }
  catch { blockers.push("context_unavailable"); }
  if (!configuredTransport) blockers.push("transport_unavailable");
  const sample = await samplePolicies(db, connection, snapshot, now);
  if (sample.failed && !blockers.includes("context_unavailable")) blockers.push("context_unavailable");
  if (!sample.policies.includes("allowed")) blockers.push("inbound_policy_unavailable");
  return { report: { connectionId: connection.id, channel: connection.channel, provider: connection.provider,
    storedStatus: connection.status, configuredTransport, storedTextGrantCurrent, verifiedIdentities,
    sampledPolicies: sample.policies, blockers }, partial: sample.partial };
}

/** Service-side, bounded READ ONLY preflight. No provider/model calls, writes or drain.
 * This is an advisory snapshot; never use it as send permission or rollout approval.
 */
export async function readPilotPreflight(db: SupabaseClient, workspaceId: string,
  env: Readonly<Record<string, string | undefined>> = process.env, now = Date.now()): Promise<PilotPreflight> {
  z.uuid().parse(workspaceId); z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).parse(now);
  const rollout = { ingress: false, worker: false, human: false, ai: false };
  for (const stage of ["ingress", "worker", "human", "ai"] as const) rollout[stage] = channelRolloutWorkspaces(stage, env).includes(workspaceId);
  const snapshot = await readSnapshot(db, workspaceId);
  const reports: ConnectionPilotPreflight[] = [];
  let partial = snapshot.connections.length > 100 || snapshot.identities.length > 1000
    || snapshot.conversations.length > 100 || snapshot.events.length > 1000;
  for (const connection of snapshot.connections.slice(0, 100)) {
    const result = await checkConnection(db, connection, snapshot, now);
    reports.push(result.report); partial ||= result.partial;
  }
  return { schemaVersion: 1, workspaceId, checkedAt: new Date(now).toISOString(), coverage: partial ? "partial" : "complete",
    connections: reports, rollout, externalValidation: "pending", sideEffects: false };
}
