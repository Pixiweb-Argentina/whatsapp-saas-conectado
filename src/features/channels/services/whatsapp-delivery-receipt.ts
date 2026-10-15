import { createHash } from "node:crypto";
import { z } from "zod";
import { normalizePhone } from "@/features/inbox/services/phone";
import { deliveryReceiptSchema, type DeliveryReceipt } from "../types/delivery-receipt";
import type { AuthenticatedWhatsAppDelivery } from "./whatsapp-event-ingress";

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function string(value: unknown): string | null { return typeof value === "string" && value.length > 0 ? value : null; }
const kapsoStatuses: Record<string, string> = { "whatsapp.message.sent": "sent", "whatsapp.message.delivered": "delivered",
  "whatsapp.message.read": "read", "whatsapp.message.failed": "failed" };
function operationId(value: unknown): string | null {
  const text=string(value);
  return text?.startsWith("channel:") && z.uuid().safeParse(text.slice(8)).success ? text.slice(8) : null;
}
function recipient(value: unknown): string | null {
  const raw=string(value);
  if (!raw || !/^\+?\d{8,15}$/.test(raw)) return null;
  const normalized=normalizePhone(raw,"1");
  return /^\+[1-9]\d{7,14}$/.test(normalized) ? normalized : null;
}
function kapsoTimestamp(value: unknown): string | null {
  const raw=string(value); if (!raw || !/^\d+$/.test(raw)) return null;
  const time=Number(raw)*1000; return Number.isFinite(time) && time>0 && time<8.64e15 ? new Date(time).toISOString() : null;
}

/** Strict account identity comes from both the signed payload and server connection.
 * No body, error detail, URL or token is retained. Business App/history echoes are not receipts.
 */
export function normalizeWhatsAppReceipt(input: Omit<AuthenticatedWhatsAppDelivery, "integrationId">, connectionId: string,
  now: number = Date.now()): DeliveryReceipt | null {
  const body=record(input.payload); const message=record(body[input.provider === "ycloud" ? "whatsappMessage" : "message"]);
  const conversation=record(body.conversation); const kapso=record(message.kapso);
  const ycloud=input.provider === "ycloud";
  if (ycloud ? body.type !== "whatsapp.message.updated" : kapso.origin !== "cloud_api") return null;
  const status=ycloud ? message.status : kapsoStatuses[input.kapsoEventName ?? ""];
  const account=ycloud ? message.from : body.phone_number_id;
  if (account !== input.configuredAccountId) return null;
  const wamid=string(ycloud ? message.wamid : message.id);
  const providerMessageId=ycloud ? string(message.id) : null;
  const occurredAt=ycloud ? string(body.createTime) : kapsoTimestamp(message.timestamp);
  if (!occurredAt || !Number.isFinite(Date.parse(occurredAt)) || Date.parse(occurredAt)>now) return null;
  const data={connectionId,provider:input.provider,externalAccountId:account,status,wamid,providerMessageId,
    operationId:ycloud ? operationId(message.externalId) : null,
    recipient:recipient(message.to ?? conversation.phone_number),occurredAt};
  const providerEventId=ycloud ? string(body.id) : `receipt:${createHash("sha256").update(JSON.stringify(data)).digest("hex")}`;
  const checked=deliveryReceiptSchema.safeParse({...data,providerEventId});
  return checked.success ? checked.data : null;
}
