import type { SupabaseClient } from "@supabase/supabase-js";
import type { EnqueueJob } from "../types/message-job";

export const contextId = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const contextNow = Date.parse("2026-10-10T12:00:00Z");
export const verifiedAt = "2026-10-10T11:00:00Z";
export const contextExpiry = "2026-10-10T13:00:00Z";
export interface QueryCall { table: string; filters: Array<[string, unknown]>; columns: string }
type Row = Record<string, unknown>;
interface RpcCall { name: string; args: Record<string, unknown> }

export function policyContextFixture() {
  const workspaceId = contextId(1), connectionId = contextId(51);
  const request: EnqueueJob = { workspaceId, connectionId, conversationId: contextId(31), eventId: contextId(41),
    actor: "ai", expectedRevision: 4, idempotencyKey: "fixture-policy", request: { operationId: contextId(61),
      action: "text", channel: "whatsapp", recipient: "+15555550101", body: "Mensaje sintético" } };
  const envelope = { schemaVersion: 1, workspaceId, connectionId, channel: "whatsapp", provider: "ycloud",
    providerEventId: "provider-fixture", kind: "message", occurredAt: verifiedAt, receivedAt: verifiedAt,
    externalActorId: request.request.recipient, externalMessageId: "message-fixture",
    content: { type: "text", text: "Hola", rawType: "text" }, mediaRefs: [],
    sourceContext: { channel: "whatsapp", sourceType: "direct_message" } };
  const grants = [{ workspaceId, connectionId, capability: "text", verifiedAt, validUntil: contextExpiry,
    evidenceRef: "fixture-verification" }];
  const rows: Record<string, Row[]> = {
    channel_connections: [{ id: connectionId, workspace_id: workspaceId, channel: "whatsapp", provider: "ycloud",
      external_account_id: "+15555550100", status: "ready", revoked_at: null,
      capabilities: { version: 1, grants }, legacy_integration_id: contextId(11) }],
    contact_identities: [{ id: contextId(21), workspace_id: workspaceId, connection_id: connectionId,
      contact_id: contextId(22), external_user_id: request.request.recipient, verified_at: verifiedAt }],
    conversations: [{ id: contextId(31), workspace_id: workspaceId, connection_id: connectionId,
      identity_id: contextId(21), contact_id: contextId(22), channel: "whatsapp", ai_enabled: true,
      state: "ai_active", state_revision: 4 }],
    contacts: [{ id: contextId(22), workspace_id: workspaceId, phone: request.request.recipient, opt_in: true }],
    contact_opt_outs: [],
    inbound_events: [{ id: contextId(41), workspace_id: workspaceId, connection_id: connectionId,
      historical: false, kind: "message", envelope }],
    integrations: [{ id: contextId(11), workspace_id: workspaceId, provider: "ycloud", enabled: true,
      config: { phone_number: "+15555550100" }, credentials: { ycloud_api_key: "placeholder" } }],
  };
  const queries: QueryCall[] = [];
  const rpcCalls: RpcCall[] = [];
  const errors: Record<string, unknown> = {};
  const db = fixtureDb(rows, queries, errors, rpcCalls, request.request.operationId);
  return { db, rows, queries, errors, rpcCalls, request, envelope, grants };
}

function fixtureDb(rows: Record<string, Row[]>, queries: QueryCall[], errors: Record<string, unknown>,
  rpcCalls: RpcCall[], operationId: string): SupabaseClient {
  return {
    from(table: string) {
      const call: QueryCall = { table, filters: [], columns: "" }; queries.push(call);
      const result = () => ({ error: errors[table] ?? null, data: (rows[table] ?? []).filter((row) =>
        call.filters.every(([key, value]) => {
          const [column, property] = key.split("->>");
          return (property ? (row[column] as Row)?.[property] : row[column]) === value;
        })) });
      const query = {
        select(columns: string) { call.columns = columns; return query; },
        eq(key: string, value: unknown) { call.filters.push([key, value]); return query; },
        limit() { return query; },
        async maybeSingle() { const value = result(); return { ...value, data: value.data[0] ?? null }; },
        then(resolve: (value: ReturnType<typeof result>) => unknown) { return Promise.resolve(result()).then(resolve); },
      };
      return query;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      return { data: operationId, error: errors.rpc ?? null };
    },
  } as unknown as SupabaseClient;
}
