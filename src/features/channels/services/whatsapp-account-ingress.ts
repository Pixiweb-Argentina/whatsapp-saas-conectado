import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { verifyYCloudSignature } from "@/features/inbox/services/ycloud-webhook-handler";
import { verifyKapsoSignature, resolveEventName } from "@/features/inbox/services/kapso-webhook-handler";
import { workspaceCountryCode } from "@/features/inbox/services/country-code";
import { normalizeWhatsAppEvent } from "./whatsapp-inbound-event";
import { normalizeWhatsAppReceipt } from "./whatsapp-delivery-receipt";
import { readWhatsAppAccountSource } from "./whatsapp-account-source";

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
  | { status: "persisted"; kind: "message" | "receipt" };

/** Signed shadow intake only: no legacy normalizer, contact/conversation creation, buffer, model or send. */
export async function captureWhatsAppAccountDelivery(db: SupabaseClient, input: Delivery,
  now = Date.now()): Promise<AccountIngressResult> {
  z.uuid().parse(input.workspaceId); z.uuid().parse(input.connectionId);
  if (!accountIngressEnabled(input.connectionId)) return { status: "disabled" };
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
  const normalized = normalizeWhatsAppEvent({ connection: { workspaceId: source.workspaceId, connectionId: source.connectionId,
    channel: "whatsapp", provider: source.provider, externalAccountId: source.externalAccountId, status: source.status },
    payload, kapsoEventName, receivedAt: new Date(now).toISOString(),
    defaultCountryCode: await workspaceCountryCode(db, source.workspaceId) });
  if (normalized.status === "rejected") return { status: "invalid" };
  if (normalized.status === "ignored" || normalized.event.content.rawType === "reaction") return { status: "ignored" };
  if (Date.parse(normalized.event.occurredAt) > now) throw new Error("ACCOUNT_EVENT_CLOCK_SKEW");
  return persist(db, source, "message", normalized.event);
}

async function persist(db: SupabaseClient, source: NonNullable<Awaited<ReturnType<typeof readWhatsAppAccountSource>>>,
  kind: "message" | "receipt", delivery: unknown): Promise<AccountIngressResult> {
  const { data, error } = await db.rpc("persist_whatsapp_account_delivery", { p_workspace: source.workspaceId,
    p_connection: source.connectionId, p_source_revision: source.sourceRevision, p_kind: kind, p_delivery: delivery });
  if (error || !z.uuid().safeParse(data).success) throw new Error("ACCOUNT_DELIVERY_STORAGE_FAILED");
  return { status: "persisted", kind };
}
