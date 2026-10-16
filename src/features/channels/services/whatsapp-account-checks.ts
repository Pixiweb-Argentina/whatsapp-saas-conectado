import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountPermissionReviewSchema, accountVerificationInputSchema, configuredAccountCallback } from "../types/whatsapp-account-checks";
import { ycloudVerificationRecordSchema } from "../types/ycloud-verification";
import { ycloudPermissionMutationSchema } from "../types/ycloud-permissions";
import { readWhatsAppAccountSource } from "./whatsapp-account-source";
import { verifyYCloudAccount } from "./ycloud-verification";
import { verifyKapsoAccount } from "./kapso-verification";

function scope(workspaceId: string, actorId: string, connectionId: string) {
  z.uuid().parse(workspaceId); z.uuid().parse(actorId); z.uuid().parse(connectionId);
  return { p_workspace: workspaceId, p_actor: actorId, p_connection: connectionId };
}
export async function readAccountVerification(db: SupabaseClient, workspaceId: string, actorId: string, connectionId: string) {
  const { data, error } = await db.rpc("read_whatsapp_account_verification", scope(workspaceId, actorId, connectionId));
  if (error) throw new Error("ACCOUNT_VERIFICATION_UNAVAILABLE");
  return data === null ? null : ycloudVerificationRecordSchema.parse(data);
}

/** Provider GETs only; stable destination is from server configuration, never request body. */
export async function verifyManagedAccount(db: SupabaseClient, workspaceId: string, actorId: string, connectionId: string,
  value: unknown, origin = process.env.CHANNEL_PUBLIC_ORIGIN, fetcher: typeof fetch = fetch) {
  const args = scope(workspaceId, actorId, connectionId), input = accountVerificationInputSchema.parse(value);
  const callbackUrl = configuredAccountCallback(workspaceId, connectionId, origin);
  if (!callbackUrl) throw new Error("ACCOUNT_PUBLIC_ORIGIN_REQUIRED");
  const source = await readWhatsAppAccountSource(db, workspaceId, connectionId, actorId);
  if (!source) throw new Error("ACCOUNT_VERIFIER_UNAVAILABLE");
  const options = { workspaceId, connectionId, apiKey: source.credentials.apiKey,
    signingSecret: source.credentials.signingSecret, input: { ...input, callbackUrl } };
  const report = source.provider === "ycloud"
    ? await verifyYCloudAccount({ ...options, phoneNumber: source.externalAccountId }, fetcher)
    : await verifyKapsoAccount({ ...options, phoneNumberId: source.externalAccountId }, fetcher);
  const { error } = await db.rpc("save_whatsapp_account_verification", { ...args, p_source_revision: source.sourceRevision,
    p_input: { ...input, callbackUrl }, p_report: report });
  if (error) throw new Error("ACCOUNT_VERIFICATION_STALE");
  return readAccountVerification(db, workspaceId, actorId, connectionId);
}
export async function readAccountPermissionReview(db: SupabaseClient, workspaceId: string, actorId: string, connectionId: string,
  origin = process.env.CHANNEL_PUBLIC_ORIGIN) {
  const { data, error } = await db.rpc("read_whatsapp_account_permission_review", { ...scope(workspaceId, actorId, connectionId),
    p_callback: configuredAccountCallback(workspaceId, connectionId, origin) });
  if (error) throw new Error("ACCOUNT_PERMISSION_UNAVAILABLE");
  return data === null ? null : accountPermissionReviewSchema.parse(data);
}
export async function changeAccountTextPermission(db: SupabaseClient, workspaceId: string, actorId: string, connectionId: string,
  value: unknown, origin = process.env.CHANNEL_PUBLIC_ORIGIN) {
  const args = scope(workspaceId, actorId, connectionId), input = ycloudPermissionMutationSchema.parse(value);
  if (input.connectionId !== connectionId) throw new Error("ACCOUNT_PERMISSION_SCOPE_INVALID");
  const { data, error } = await db.rpc("change_whatsapp_account_text_permission", { ...args, p_operation: input.operationId,
    p_action: input.action, p_expected_updated_at: input.connectionUpdatedAt,
    p_expected_verification: input.action === "grant" ? input.verificationCheckedAt : null,
    p_callback: configuredAccountCallback(workspaceId, connectionId, origin) });
  if (error || typeof data !== "boolean") throw new Error("ACCOUNT_PERMISSION_CHANGE_UNCONFIRMED");
  return { applied: data, review: await readAccountPermissionReview(db, workspaceId, actorId, connectionId, origin) };
}
