import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadWhatsAppSettings } from "@/features/inbox/services/whatsapp-provider";
import type { Channel } from "../types/channel-contracts";
import type { SendAction } from "../types/send-contracts";

const settingsSchema = z.object({
  message_history_window: z.unknown().optional(),
  cost_cut_handoff: z.unknown().optional(),
});

export interface ConversationRuntimeSettings {
  historyWindow: number;
  costCutHandoff: boolean;
}

export interface ConversationRuntime extends ConversationRuntimeSettings {
  channel: Channel;
  implementedSendActions: readonly SendAction[];
}

/** Preserve the legacy coercion/defaults while keeping the buffer provider-neutral. */
export function conversationRuntimeSettings(value: unknown): ConversationRuntimeSettings {
  const checked = settingsSchema.safeParse(value);
  const config = checked.success ? checked.data : {};
  const raw = config.message_history_window;
  const numeric = typeof raw === "number" || typeof raw === "string" || raw === null
    || typeof raw === "boolean" ? Number(raw) : Number.NaN;
  return { historyWindow: Number.isFinite(numeric) ? Math.min(50, Math.max(5, numeric)) : 10,
    costCutHandoff: config.cost_cut_handoff === true };
}

/** New transports use their durable pipeline; never feed them into the legacy WA buffer. */
export function legacyBufferSupports(channel: unknown): channel is "whatsapp" {
  return channel === "whatsapp";
}

export async function loadConversationRuntime(
  supabase: SupabaseClient, workspaceId: string, channel: Channel,
): Promise<ConversationRuntime | null> {
  if (!legacyBufferSupports(channel)) return null;
  const settings = await loadWhatsAppSettings(supabase, workspaceId);
  if (!settings) return null;
  return { channel, implementedSendActions: ["text", "template"],
    ...conversationRuntimeSettings(settings.config) };
}
