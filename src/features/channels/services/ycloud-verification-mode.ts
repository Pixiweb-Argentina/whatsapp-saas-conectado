import { z } from "zod";
import { samePhone } from "@/features/inbox/services/phone";

const phone = z.string().regex(/^\+[1-9]\d{7,14}$/);
const event = z.discriminatedUnion("type", [
  z.object({ type: z.literal("whatsapp.inbound_message.received"), whatsappInboundMessage: z.object({ to: phone }) }),
  z.object({ type: z.literal("whatsapp.message.updated"), whatsappMessage: z.object({ from: phone }) }),
]);

function scopedList(rawValue: string | undefined): string[] {
  const raw = rawValue?.trim();
  if (!raw) return [];
  const parsed = z.array(z.uuid()).max(3).safeParse(raw.split(",").map((s) => s.trim().toLowerCase()));
  if (!parsed.success) throw new Error("YCLOUD_VERIFICATION_CONFIG_INVALID");
  return parsed.data;
}

export type YCloudReceptionMode = "verify" | "inbox" | "pipeline" | null;
/** Reception mode alone never authorizes sending or model execution. */
export function ycloudReceptionMode(workspaceId: string,
  env: Readonly<Record<string, string | undefined>> = process.env): YCloudReceptionMode {
  const verification = scopedList(env.YCLOUD_VERIFICATION_ONLY_WORKSPACES);
  const inbox = scopedList(env.YCLOUD_INBOX_ONLY_WORKSPACES);
  const pipeline = scopedList(env.YCLOUD_PIPELINE_WORKSPACES);
  if (verification.some((id) => inbox.includes(id) || pipeline.includes(id))
    || inbox.some((id) => pipeline.includes(id))) throw new Error("YCLOUD_RECEPTION_CONFIG_CONFLICT");
  return verification.includes(workspaceId) ? "verify" : inbox.includes(workspaceId) ? "inbox"
    : pipeline.includes(workspaceId) ? "pipeline" : null;
}

export function ycloudVerificationOnly(workspaceId: string,
  env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return ycloudReceptionMode(workspaceId, env) === "verify";
}

export interface YCloudVerificationResult {
  received: true;
  verificationOnly: true;
  accountMatched: boolean;
}

/** Signature verification must precede this; no payload or recipient is returned. */
export function ycloudVerificationResult(body: unknown, configuredPhone: unknown): YCloudVerificationResult {
  const parsed = event.safeParse(body), configured = phone.safeParse(configuredPhone);
  const account = parsed.success ? parsed.data.type === "whatsapp.inbound_message.received"
    ? parsed.data.whatsappInboundMessage.to : parsed.data.whatsappMessage.from : null;
  return { received: true, verificationOnly: true,
    accountMatched: !!account && configured.success && samePhone(account, configured.data) };
}
