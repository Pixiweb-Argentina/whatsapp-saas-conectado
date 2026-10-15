import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { registerWhatsAppAccountSchema, revokeWhatsAppAccountSchema, whatsAppAccountsSchema } from "../types/whatsapp-account";
import { sealAccountCredentials } from "./account-credentials";

export async function readWhatsAppAccounts(db: SupabaseClient, workspaceId: string, actorId: string) {
  z.uuid().parse(workspaceId); z.uuid().parse(actorId);
  const { data, error } = await db.rpc("read_whatsapp_accounts", { p_workspace: workspaceId, p_actor: actorId });
  if (error) throw new Error("ACCOUNT_LIST_UNAVAILABLE");
  return whatsAppAccountsSchema.parse(data);
}

export async function registerWhatsAppAccount(db: SupabaseClient, workspaceId: string, actorId: string, value: unknown) {
  z.uuid().parse(workspaceId); z.uuid().parse(actorId);
  const input = registerWhatsAppAccountSchema.parse(value);
  const sealed = await sealAccountCredentials({ workspaceId, connectionId: input.connectionId, provider: input.provider },
    { apiKey: input.apiKey, signingSecret: input.signingSecret });
  const { data, error } = await db.rpc("register_whatsapp_account", { p_workspace: workspaceId, p_actor: actorId,
    p_connection: input.connectionId, p_provider: input.provider, p_account: input.externalAccountId,
    p_label: input.displayName, p_payload: sealed.encryptedPayload, p_key_version: sealed.keyVersion });
  if (error || data !== input.connectionId) throw new Error("ACCOUNT_REGISTER_UNCONFIRMED");
  return { connectionId: input.connectionId };
}

export async function revokeWhatsAppAccount(db: SupabaseClient, workspaceId: string, actorId: string, value: unknown) {
  z.uuid().parse(workspaceId); z.uuid().parse(actorId);
  const input = revokeWhatsAppAccountSchema.parse(value);
  const { data, error } = await db.rpc("revoke_whatsapp_account", { p_workspace: workspaceId, p_actor: actorId,
    p_connection: input.connectionId, p_expected_updated_at: input.updatedAt });
  if (error || data !== true) throw new Error("ACCOUNT_REVOKE_UNCONFIRMED");
  return { revoked: true };
}
