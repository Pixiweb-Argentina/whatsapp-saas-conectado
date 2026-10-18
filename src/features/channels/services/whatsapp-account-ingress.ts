import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { verifyYCloudSignature } from "@/features/inbox/services/ycloud-webhook-handler";
import { verifyKapsoSignature, resolveEventName } from "@/features/inbox/services/kapso-webhook-handler";
import { workspaceCountryCode } from "@/features/inbox/services/country-code";
import { normalizeWhatsAppEvent } from "./whatsapp-inbound-event";
import { normalizeWhatsAppReceipt } from "./whatsapp-delivery-receipt";
import { readWhatsAppAccountSource } from "./whatsapp-account-source";
import { accountInboxEnabled, accountInboxMaterializable, materializeAccountInbox,
  type AccountInboxMedia } from "./whatsapp-account-inbox";
import { downloadAndStoreMedia, patchMessageMedia } from "@/features/inbox/services/media-handler";
import { echoResultSchema, normalizeBusinessAppEcho } from "./business-app-echo";

/** Per-account opt-in, independent of all legacy/pilot workspace switches. Empty is off. */
export function accountIngressEnabled(connectionId: string, raw = process.env.CHANNEL_ACCOUNT_INGRESS_CONNECTIONS): boolean {
  if (!raw?.trim()) return false;
  const list = z.array(z.uuid()).max(100).safeParse(raw.split(",").map((s) => s.trim().toLowerCase()));
  if (!list.success) throw new Error("ACCOUNT_INGRESS_CONFIG_INVALID");
  return list.data.includes(connectionId.toLowerCase());
}

interface Delivery {
  workspaceId: string;
  connectionId: string;
  rawBody: string;
  headers: Headers;
}
export type AccountIngressResult = { status: "disabled" | "unauthorized" | "invalid" | "ignored" }
  | { status: "persisted"; kind: "message" | "receipt" | "echo"; materialized?: true; media?: () => Promise<void> };
type Source = NonNullable<Awaited<ReturnType<typeof readWhatsAppAccountSource>>>;
export interface MediaStore { download: typeof downloadAndStoreMedia; patch: typeof patchMessageMedia }
const defaultStore: MediaStore = { download: downloadAndStoreMedia, patch: patchMessageMedia };

/** Signed capture with separately opted-in receive-only inbox. No legacy normalizer, buffer, model or send. */
export async function captureWhatsAppAccountDelivery(db: SupabaseClient, input: Delivery,
  now = Date.now(), store: MediaStore = defaultStore): Promise<AccountIngressResult> {
  z.uuid().parse(input.workspaceId); z.uuid().parse(input.connectionId);
  if (!accountIngressEnabled(input.connectionId)) return { status: "disabled" };
  const inbox = accountInboxEnabled(input.connectionId);
  const source = await readWhatsAppAccountSource(db, input.workspaceId, input.connectionId);
  if (!source) return { status: "unauthorized" };
  const verified = source.provider === "ycloud"
    ? verifyYCloudSignature(input.rawBody, input.headers.get("YCloud-Signature"), source.credentials.signingSecret)
    : verifyKapsoSignature(input.rawBody, input.headers.get("X-Webhook-Signature"), source.credentials.signingSecret);
  if (!verified) return { status: "unauthorized" };
  let payload: unknown;
  try { payload = JSON.parse(input.rawBody); } catch { return { status: "invalid" }; }
  const kapsoEventName = source.provider === "kapso" ? resolveEventName(input.headers.get("X-Webhook-Event"), payload) : null;
  const context = { workspaceId: source.workspaceId, provider: source.provider,
    configuredAccountId: source.externalAccountId, payload, kapsoEventName };
  const receipt = normalizeWhatsAppReceipt(context, source.connectionId, now);
  if (receipt) return persist(db, source, "receipt", receipt);
  if (normalizeWhatsAppReceipt(context, source.connectionId, now + 5000)) throw new Error("ACCOUNT_RECEIPT_CLOCK_SKEW");
  const echo = inbox && source.provider === "kapso" ? normalizeBusinessAppEcho(context, source.connectionId, now) : null;
  if (echo) return persistEcho(db, source, echo);
  const normalized = normalizeWhatsAppEvent({ connection: { workspaceId: source.workspaceId, connectionId: source.connectionId,
    channel: "whatsapp", provider: source.provider, externalAccountId: source.externalAccountId, status: source.status },
    payload, kapsoEventName, receivedAt: new Date(now).toISOString(),
    defaultCountryCode: await workspaceCountryCode(db, source.workspaceId) });
  if (normalized.status === "rejected") return { status: "invalid" };
  if (normalized.status === "ignored" || normalized.event.content.rawType === "reaction") return { status: "ignored" };
  if (Date.parse(normalized.event.occurredAt) > now) throw new Error("ACCOUNT_EVENT_CLOCK_SKEW");
  if (inbox && accountInboxMaterializable(normalized.event)) {
    const stored = await materializeAccountInbox(db, source, normalized.event, payload, kapsoEventName);
    const media = stored.inserted && stored.media ? stored.media : null;
    return { status: "persisted", kind: "message", materialized: true,
      ...(media ? { media: () => storeMedia(store, source, stored.conversationId, stored.messageId, media) } : {}) };
  }
  return persist(db, source, "message", normalized.event);
}

/** Post-response copy into private storage. Best effort: the message is already in the inbox; no model or send. */
async function storeMedia(store: MediaStore, source: Source, conversationId: string, messageId: string,
  media: AccountInboxMedia): Promise<void> {
  try {
    const meta = await store.download({ provider: source.provider, link: media.link, workspaceId: source.workspaceId,
      conversationId, mimeType: media.mimeType, filename: media.filename, caption: media.caption, mediaId: media.mediaId,
      ...(source.provider === "ycloud" ? { apiKey: source.credentials.apiKey } : {}) });
    if (meta) await store.patch(source.workspaceId, messageId, meta);
  } catch { console.error("[account-ingress] media copy failed"); }
}

async function persist(db: SupabaseClient, source: Source,
  kind: "message" | "receipt", delivery: unknown): Promise<AccountIngressResult> {
  const { data, error } = await db.rpc("persist_whatsapp_account_delivery", { p_workspace: source.workspaceId,
    p_connection: source.connectionId, p_source_revision: source.sourceRevision, p_kind: kind, p_delivery: delivery });
  if (error || !z.uuid().safeParse(data).success) throw new Error("ACCOUNT_DELIVERY_STORAGE_FAILED");
  return { status: "persisted", kind };
}

/** Phone-app reply: stored as a human outgoing message that pauses the AI. Never sends, never creates contacts. */
async function persistEcho(db: SupabaseClient, source: Source, echo: unknown): Promise<AccountIngressResult> {
  const { data, error } = await db.rpc("persist_whatsapp_account_echo", { p_workspace: source.workspaceId,
    p_connection: source.connectionId, p_source_revision: source.sourceRevision, p_echo: echo });
  if (error || !echoResultSchema.safeParse(data).success) throw new Error("ACCOUNT_ECHO_STORAGE_FAILED");
  return { status: "persisted", kind: "echo" };
}
