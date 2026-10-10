import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { channelRolloutWorkspaces } from "./channel-rollout";
import { resolveWhatsAppConnection, type AuthenticatedWhatsAppDelivery } from "./whatsapp-event-ingress";
import { normalizeWhatsAppReceipt } from "./whatsapp-delivery-receipt";

/** Call only after verifying the raw webhook signature. A persisted receipt grants no send permission. */
export async function captureWhatsAppReceipt(db: SupabaseClient, input: AuthenticatedWhatsAppDelivery,
  now: () => number = Date.now): Promise<"disabled" | "ignored" | "persisted"> {
  if (!channelRolloutWorkspaces("ingress").includes(input.workspaceId)) return "disabled";
  const connection=await resolveWhatsAppConnection(db,input);
  const receipt=normalizeWhatsAppReceipt(input,connection.id,now());
  if (!receipt) return "ignored";
  const {data,error}=await db.rpc("persist_channel_receipt",{p_workspace_id:input.workspaceId,
    p_integration_id:input.integrationId,p_receipt:receipt});
  if (error || !z.uuid().safeParse(data).success) throw new Error("CHANNEL_RECEIPT_STORAGE_FAILED");
  return "persisted";
}
