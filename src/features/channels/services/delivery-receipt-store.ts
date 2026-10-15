import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { channelRolloutWorkspaces } from "./channel-rollout";
import { resolveWhatsAppConnection, type AuthenticatedWhatsAppDelivery } from "./whatsapp-event-ingress";
import { normalizeWhatsAppReceipt } from "./whatsapp-delivery-receipt";
import { ycloudReceptionMode } from "./ycloud-verification-mode";

/** Call only after verifying the raw webhook signature. A persisted receipt grants no send permission. */
export async function captureWhatsAppReceipt(db: SupabaseClient, input: AuthenticatedWhatsAppDelivery,
  now: () => number = Date.now): Promise<"disabled" | "ignored" | "persisted"> {
  // The receive-only YCloud pilot needs delivery evidence without enabling
  // normal ingress (which can reach the legacy AI workflow). Verify mode still
  // forbids every write, even if normal ingress happens to be enabled.
  const receptionMode = input.provider === "ycloud" ? ycloudReceptionMode(input.workspaceId) : null;
  if (receptionMode === "verify") return "disabled";
  if (receptionMode !== "inbox" && !channelRolloutWorkspaces("ingress").includes(input.workspaceId)) return "disabled";
  const connection=await resolveWhatsAppConnection(db,input);
  const receipt=normalizeWhatsAppReceipt(input,connection.id,now());
  if (!receipt) return "ignored";
  const {data,error}=await db.rpc("persist_channel_receipt",{p_workspace_id:input.workspaceId,
    p_integration_id:input.integrationId,p_receipt:receipt});
  if (error || !z.uuid().safeParse(data).success) throw new Error("CHANNEL_RECEIPT_STORAGE_FAILED");
  return "persisted";
}
