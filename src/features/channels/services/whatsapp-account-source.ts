import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { connectionStatusSchema } from "../types/channel-contracts";
import { openAccountCredentials } from "./account-credentials";

const sourceSchema = z.strictObject({
  workspaceId: z.uuid(), connectionId: z.uuid(), provider: z.enum(["ycloud", "kapso"]),
  externalAccountId: z.string().min(1).max(512), status: connectionStatusSchema.exclude(["revoked"]),
  encryptedPayload: z.string().min(1).max(32768), keyVersion: z.number().int().min(1).max(9999),
  sourceRevision: z.string().regex(/^[a-f0-9]{32}$/),
});
export type WhatsAppAccountSource = Awaited<ReturnType<typeof readWhatsAppAccountSource>>;

/** Internal service-client boundary. Ciphertext/plaintext must never be returned to the browser or logged. */
export async function readWhatsAppAccountSource(db: SupabaseClient, workspaceId: string, connectionId: string) {
  z.uuid().parse(workspaceId); z.uuid().parse(connectionId);
  const { data, error } = await db.rpc("read_whatsapp_account_source", { p_workspace: workspaceId, p_connection: connectionId });
  if (error) throw new Error("ACCOUNT_SOURCE_UNAVAILABLE");
  if (data === null) return null;
  const parsed = sourceSchema.safeParse(data);
  if (!parsed.success || parsed.data.workspaceId !== workspaceId || parsed.data.connectionId !== connectionId
    || !parsed.data.encryptedPayload.startsWith(`enc:v${parsed.data.keyVersion}:`)) {
    throw new Error("ACCOUNT_SOURCE_UNAVAILABLE");
  }
  const { encryptedPayload, keyVersion: _keyVersion, ...source } = parsed.data;
  const owner = { workspaceId, connectionId, provider: source.provider };
  try { return { ...source, credentials: await openAccountCredentials(owner, encryptedPayload) }; }
  catch { throw new Error("ACCOUNT_SOURCE_UNAVAILABLE"); }
}
