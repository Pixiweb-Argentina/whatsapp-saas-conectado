import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { validAccountCallback } from "../types/whatsapp-account-checks";
import { ycloudVerificationInputSchema, type YCloudVerificationInput, type YCloudVerificationReport } from "../types/ycloud-verification";

const phoneId = z.string().regex(/^[0-9]{5,32}$/);
const numberSchema = z.object({ data: z.object({ id: phoneId, phone_number_id: phoneId,
  status: z.string().nullable(), inbound_processing_enabled: z.boolean() }) });
const webhookSchema = z.object({ data: z.object({ id: z.uuid(), phone_number_id: phoneId.nullable(),
  url: z.string().max(500), kind: z.string(), active: z.boolean(), events: z.array(z.string()).max(200),
  secret_key: z.string().max(4096).nullable(), buffer_enabled: z.boolean().nullable(), payload_version: z.string().nullable() }) });
const requiredEvents = ["whatsapp.message.received", "whatsapp.message.sent", "whatsapp.message.delivered",
  "whatsapp.message.read", "whatsapp.message.failed"];
interface Options {
  workspaceId: string; connectionId: string; phoneNumberId: string;
  apiKey: string; signingSecret: string; input: YCloudVerificationInput;
}
async function boundedJson(response: Response): Promise<unknown> {
  if (!response.ok || !response.body) throw new Error("KAPSO_VERIFICATION_READ_FAILED");
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 1_048_576) throw new Error("KAPSO_VERIFICATION_READ_FAILED");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } finally { await reader.cancel().catch(() => undefined); }
}
function secretsMatch(left: string | null, right: string): boolean {
  const a = Buffer.from(left ?? ""), b = Buffer.from(right);
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}
/** Read-only exact-number v2 Kapso proof. No webhook mutations, sends or grants. */
export async function verifyKapsoAccount(options: Options, fetcher: typeof fetch = fetch,
  now = Date.now()): Promise<YCloudVerificationReport> {
  const { workspaceId, connectionId, phoneNumberId, apiKey, signingSecret } = options;
  const input = ycloudVerificationInputSchema.parse(options.input);
  if (!phoneId.safeParse(phoneNumberId).success || !z.uuid().safeParse(input.endpointId).success
    || !apiKey || !signingSecret || !validAccountCallback(input.callbackUrl, workspaceId, connectionId)) {
    throw new Error("KAPSO_VERIFICATION_CONFIG_INVALID");
  }
  const report: YCloudVerificationReport = { version: 1, checkedAt: new Date(now).toISOString(),
    checks: { api_access: false, connected_number: false, webhook_active: false, webhook_url: false, webhook_events: false, webhook_secret: false },
    destination: /(^|\.)(trycloudflare\.com|ngrok(-free)?\.(app|dev|io)|loca\.lt)$/.test(new URL(input.callbackUrl).hostname)
      ? "temporary" : "https_unconfirmed", providerRead: "complete", sendAuthorization: false };
  const signal = AbortSignal.timeout(20_000);
  const get = async (suffix: string): Promise<unknown> => boundedJson(await fetcher(
    `https://api.kapso.ai/platform/v1/whatsapp/phone_numbers/${phoneNumberId}${suffix}`, {
      method: "GET", redirect: "error", cache: "no-store", headers: { "X-API-Key": apiKey }, signal }));
  await Promise.all([readNumber(report, phoneNumberId, get), readWebhook(report, phoneNumberId, input, signingSecret, get)]);
  return report;
}
async function readNumber(report: YCloudVerificationReport, account: string, get: (suffix: string) => Promise<unknown>): Promise<void> {
  try {
    const { data } = numberSchema.parse(await get("")); report.checks.api_access = true;
    report.checks.connected_number = data.id === account && data.phone_number_id === account
      && data.status === "CONNECTED" && data.inbound_processing_enabled;
  } catch { report.providerRead = "incomplete"; }
}
async function readWebhook(report: YCloudVerificationReport, account: string, input: YCloudVerificationInput, secret: string,
  get: (suffix: string) => Promise<unknown>): Promise<void> {
  try {
    const { data } = webhookSchema.parse(await get(`/webhooks/${input.endpointId}`)); report.checks.api_access = true;
    if (data.id !== input.endpointId || data.phone_number_id !== account) { report.providerRead = "incomplete"; return; }
    report.checks.webhook_active = data.active;
    report.checks.webhook_url = data.url === input.callbackUrl;
    report.checks.webhook_events = data.kind === "kapso" && data.payload_version === "v2" && data.buffer_enabled === false
      && requiredEvents.every((event) => data.events.includes(event));
    report.checks.webhook_secret = secretsMatch(data.secret_key, secret);
  } catch { report.providerRead = "incomplete"; }
}
