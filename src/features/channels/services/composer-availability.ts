import { channelRolloutWorkspaces } from "./channel-rollout";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { channelSchema, connectionStatusSchema } from "../types/channel-contracts";
import type { ComposerAvailability } from "../types/composer-availability";

const conversationSchema = z.object({
  workspace_id: z.uuid(), channel: channelSchema, connection_id: z.uuid().nullable(),
  source_context: z.record(z.string(), z.unknown()).optional(),
});
const connectionSchema = z.object({
  id: z.uuid(), workspace_id: z.uuid(), channel: channelSchema,
  status: connectionStatusSchema, revoked_at: z.string().nullable(),
});
const unavailable: ComposerAvailability = { allowed: false, reason: "context_unavailable",
  message: "No se pudo verificar la cuenta. Actualizá la conversación para volver a intentar." };

/** Advisory UI + server gate with the session client. No credentials or service role.
 * Keeps WA's existing window/template checks in dispatch; never grants a Meta send.
 */
export async function readComposerAvailability(db: SupabaseClient, input: unknown): Promise<ComposerAvailability> {
  const parsed = conversationSchema.safeParse(input);
  if (!parsed.success) return unavailable;
  const conversation = parsed.data;
  if (conversation.channel !== "whatsapp") return { allowed: false, reason: "transport_unavailable",
    message: "Los envíos de este canal todavía no están habilitados." };
  const legacy: ComposerAvailability = { allowed: true, reason: "legacy_whatsapp", message: null };
  if (!conversation.connection_id) return legacy;
  try {
    const { data, error } = await db.from("channel_connections").select("id,workspace_id,channel,status,revoked_at")
      .eq("workspace_id", conversation.workspace_id).eq("id", conversation.connection_id).maybeSingle();
    const parsedConnection = connectionSchema.safeParse(data);
    if (error || !parsedConnection.success) return unavailable;
    const connection = parsedConnection.data;
    if (connection.workspace_id !== conversation.workspace_id || connection.id !== conversation.connection_id
      || connection.channel !== conversation.channel) return unavailable;
    if (connection.revoked_at || connection.status === "revoked") return { allowed: false, reason: "revoked",
      message: "La cuenta fue desconectada. Volvé a conectarla para enviar mensajes." };
    if (connection.status === "needs_permissions") return { allowed: false, reason: "permission_missing",
      message: "La cuenta necesita permisos para enviar. Revisá la conexión." };
    if (connection.status !== "ready") return { allowed: false, reason: "connection_not_ready",
      message: "Esta cuenta todavía no está lista para enviar mensajes." };
    if (channelRolloutWorkspaces("human").includes(conversation.workspace_id)) {
      if (!channelRolloutWorkspaces("worker").includes(conversation.workspace_id)) return unavailable;
      return { ...legacy, deliveryMode: "queue" };
    }
    if (Object.keys(conversation.source_context ?? {}).length) return {
      allowed: false, reason: "transport_unavailable",
      message: "Esta cuenta requiere el motor de canales habilitado para enviar mensajes.",
    };
    return legacy;
  } catch {
    return unavailable;
  }
}
