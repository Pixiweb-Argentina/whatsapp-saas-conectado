import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { whatsappSender } from "@/features/inbox/services/whatsapp-sender";
import { accountTrialEnabled, accountTrialMutationSchema, accountTrialReviewSchema } from "../types/account-trial";
import { configuredAccountCallback } from "../types/whatsapp-account-checks";
import { claimedJobSchema } from "../types/message-job";
import { channelSendResultSchema, type ChannelSendResult } from "../types/send-contracts";
import { readWhatsAppAccountSource } from "./whatsapp-account-source";
import { durableWhatsAppAdapter } from "./whatsapp-channel-adapter";
import { createMessageJobStore } from "./message-job-store";

interface Scope { workspaceId: string; actorId: string; connectionId: string }
function args(s: Scope) {
  Object.values(s).forEach((value) => z.uuid().parse(value));
  return { p_workspace: s.workspaceId, p_actor: s.actorId, p_connection: s.connectionId };
}
async function rpc(db: SupabaseClient, name: string, input: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await db.rpc(name, input);
  if (error) throw new Error("ACCOUNT_TRIAL_UNCONFIRMED");
  return data;
}
export async function readAccountTrial(db: SupabaseClient, s: Scope, origin = process.env.CHANNEL_PUBLIC_ORIGIN) {
  const data = await rpc(db, "read_whatsapp_account_trial", { ...args(s),
    p_callback: configuredAccountCallback(s.workspaceId, s.connectionId, origin) });
  return data === null ? null : accountTrialReviewSchema.parse({ ...z.record(z.string(), z.unknown()).parse(data),
    dispatchEnabled: accountTrialEnabled(s.connectionId) });
}

/** Claims exactly the explicitly selected operation. It never drains a workspace or changes global consent. */
export async function sendAccountTrial(db: SupabaseClient, s: Scope, operationId: string, origin = process.env.CHANNEL_PUBLIC_ORIGIN) {
  const callback = configuredAccountCallback(s.workspaceId, s.connectionId, origin);
  if (!callback || !accountTrialEnabled(s.connectionId)) throw new Error("ACCOUNT_TRIAL_DISABLED");
  const source = await readWhatsAppAccountSource(db, s.workspaceId, s.connectionId, s.actorId);
  if (!source || source.status !== "needs_permissions") throw new Error("ACCOUNT_TRIAL_SOURCE_UNAVAILABLE");
  const claim = await rpc(db, "claim_whatsapp_account_trial", { ...args(s), p_operation: z.uuid().parse(operationId),
    p_worker: randomUUID(), p_callback: callback, p_source_revision: source.sourceRevision });
  if (claim === null) return { status: "not_claimed" };
  const { job, validUntil } = z.strictObject({ job: claimedJobSchema, validUntil: z.iso.datetime({ offset: true }) }).parse(claim);
  if (job.workspace_id !== s.workspaceId || job.connection_id !== s.connectionId || job.operation_id !== operationId
    || job.actor !== "human" || job.request.action !== "text" || !job.event_id) throw new Error("ACCOUNT_TRIAL_SCOPE_INVALID");
  const adapter = durableWhatsAppAdapter(whatsappSender(source.provider,
    { [source.provider === "ycloud" ? "ycloud_api_key" : "kapso_api_key"]: source.credentials.apiKey },
    { [source.provider === "ycloud" ? "phone_number" : "phone_number_id"]: source.externalAccountId }));
  const store = createMessageJobStore(db);
  // SQL owns the operation-scoped trial consent, proof, suppression, source, identity and window.
  const permit = await store.begin(job, { allowed: true, reasonCode: "allowed", message: "Prueba única autorizada",
    evidenceId: job.event_id, validUntil });
  if (permit !== true) return { status: permit === "deferred" ? "deferred" : "not_permitted" };
  let result: ChannelSendResult;
  try { result = channelSendResultSchema.parse(await adapter.send(job.request)); }
  catch { result = { status: "unknown", operationId }; }
  // A trial never retries provider rejection, even when the general queue would back off.
  if (result.status === "rejected") result = { ...result, retryable: false };
  return { status: await store.finish(job, result) ? result.status : "recovery_pending" };
}

export async function mutateAccountTrial(db: SupabaseClient, s: Scope, value: unknown, origin = process.env.CHANNEL_PUBLIC_ORIGIN) {
  const input = accountTrialMutationSchema.parse(value), base = { ...args(s), p_operation: input.operationId };
  if (input.action === "send") return sendAccountTrial(db, s, input.operationId, origin);
  if (input.action === "revoke") return { revoked: z.boolean().parse(await rpc(db, "revoke_whatsapp_account_trial", base)) };
  const callback = configuredAccountCallback(s.workspaceId, s.connectionId, origin);
  if (!callback || !accountTrialEnabled(s.connectionId)) throw new Error("ACCOUNT_TRIAL_DISABLED");
  return z.strictObject({ operationId: z.uuid(), duplicate: z.boolean() }).parse(await rpc(db, "authorize_whatsapp_account_trial", {
    ...base, p_conversation: input.conversationId, p_recipient: input.recipient, p_expected_updated_at: input.connectionUpdatedAt,
    p_expected_verification: input.verificationCheckedAt, p_callback: callback, p_acknowledge: input.acknowledgeOneMessage }));
}
