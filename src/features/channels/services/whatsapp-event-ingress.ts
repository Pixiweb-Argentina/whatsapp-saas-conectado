import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { workspaceCountryCode } from "@/features/inbox/services/country-code";
import { connectionStatusSchema } from "../types/channel-contracts";
import { channelRolloutWorkspaces } from "./channel-rollout";
import { createMessageJobStore } from "./message-job-store";
import { normalizeWhatsAppEvent } from "./whatsapp-inbound-event";

export interface AuthenticatedWhatsAppDelivery {
  /** From the integration whose webhook secret verified the raw request. */
  workspaceId: string;
  integrationId: string;
  provider: "ycloud" | "kapso";
  configuredAccountId: unknown;
  payload: unknown;
  kapsoEventName?: string | null;
}

const rowSchema = z.object({
  id: z.uuid(), workspace_id: z.uuid(), legacy_integration_id: z.uuid(),
  channel: z.literal("whatsapp"), provider: z.enum(["ycloud", "kapso"]),
  external_account_id: z.string().min(1), status: connectionStatusSchema,
  revoked_at: z.string().nullable(),
});
export type IngressResult = { status: "disabled" | "ignored"; reason?: string }
  | { status: "persisted"; eventId: string };

async function resolveConnection(db: SupabaseClient, input: AuthenticatedWhatsAppDelivery) {
  const scope = z.object({ workspaceId: z.uuid(), integrationId: z.uuid(),
    provider: z.enum(["ycloud", "kapso"]), configuredAccountId: z.string().min(1) }).safeParse(input);
  if (!scope.success) throw new Error("CHANNEL_INGRESS_CONTEXT_INVALID");
  const { data, error } = await db.from("channel_connections")
    .select("id,workspace_id,legacy_integration_id,channel,provider,external_account_id,status,revoked_at")
    .eq("workspace_id", input.workspaceId).eq("legacy_integration_id", input.integrationId)
    .eq("channel", "whatsapp").eq("provider", input.provider).maybeSingle();
  const row = rowSchema.safeParse(data);
  if (error || !row.success || row.data.workspace_id !== input.workspaceId
    || row.data.legacy_integration_id !== input.integrationId || row.data.provider !== input.provider
    || row.data.external_account_id !== input.configuredAccountId) {
    throw new Error("CHANNEL_INGRESS_CONNECTION_UNAVAILABLE");
  }
  return row.data;
}

/** Call only AFTER raw signature and destination checks, BEFORE legacy dedup.
 * Shadow capture: no jobs, grants, verified identities, or outbound sends.
 * Storage failures propagate so the provider can retry the same durable event.
 */
export async function captureWhatsAppDelivery(
  db: SupabaseClient, input: AuthenticatedWhatsAppDelivery, now: () => number = Date.now,
): Promise<IngressResult> {
  if (!channelRolloutWorkspaces("ingress").includes(input.workspaceId)) return { status: "disabled" };
  const row = await resolveConnection(db, input);
  if (row.revoked_at || row.status === "revoked") return { status: "ignored", reason: "revoked" };
  const receivedAt = new Date(now()).toISOString();
  const result = normalizeWhatsAppEvent({
    connection: { workspaceId: row.workspace_id, connectionId: row.id, channel: row.channel,
      provider: row.provider, externalAccountId: row.external_account_id, status: row.status },
    payload: input.payload, kapsoEventName: input.kapsoEventName, receivedAt,
    defaultCountryCode: await workspaceCountryCode(db, input.workspaceId),
  });
  if (result.status !== "normalized") return { status: "ignored", reason: result.reason };
  if (result.event.content.rawType === "reaction") return { status: "ignored", reason: "reaction" };
  if (Date.parse(result.event.occurredAt) > Date.parse(receivedAt)) {
    return { status: "ignored", reason: "future_event" };
  }
  const eventId = await createMessageJobStore(db).persistEvent(result.event);
  return { status: "persisted", eventId };
}
