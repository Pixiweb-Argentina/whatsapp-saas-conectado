import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptWhatsAppCredentials } from "@/features/inbox/services/whatsapp-provider";
import { whatsappSender } from "@/features/inbox/services/whatsapp-sender";
import type { ChannelAdapter } from "../types/send-contracts";
import { readPolicyConnection } from "./message-policy-context";
import { whatsappChannelAdapter } from "./whatsapp-channel-adapter";

const integrationSchema = z.object({
  id: z.uuid(), workspace_id: z.uuid(), provider: z.enum(["ycloud", "kapso"]),
  enabled: z.literal(true), config: z.record(z.string(), z.unknown()),
  credentials: z.record(z.string(), z.unknown()).nullable(),
});

/** Resolve this account only. Never substitute the workspace's current provider. */
export async function resolveConnectionAdapter(
  db: SupabaseClient, workspaceId: string, connectionId: string,
): Promise<ChannelAdapter | null> {
  const connection = await readPolicyConnection(db, workspaceId, connectionId);
  if (connection.channel !== "whatsapp" || connection.status !== "ready" || !connection.legacy_integration_id) return null;
  const { data, error } = await db.from("integrations").select("id,workspace_id,provider,enabled,config,credentials")
    .eq("workspace_id", workspaceId).eq("id", connection.legacy_integration_id)
    .eq("provider", connection.provider).eq("enabled", true).maybeSingle();
  if (error) throw new Error("CHANNEL_ADAPTER_UNAVAILABLE");
  const result = integrationSchema.safeParse(data);
  if (!result.success) return null;
  const row = result.data;
  const senderId = row.config[row.provider === "kapso" ? "phone_number_id" : "phone_number"];
  if (row.workspace_id !== workspaceId || row.id !== connection.legacy_integration_id
    || row.provider !== connection.provider || senderId !== connection.external_account_id) return null;
  const credentials = await decryptWhatsAppCredentials(row, workspaceId);
  return whatsappChannelAdapter(whatsappSender(row.provider, credentials, row.config));
}
