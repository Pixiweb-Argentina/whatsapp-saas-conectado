import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { validYCloudCallback, ycloudVerificationInputSchema, type YCloudVerificationInput,
  type YCloudVerificationReport } from "../types/ycloud-verification";
import { validAccountCallback } from "../types/whatsapp-account-checks";

const phoneSchema = z.string().regex(/^\+[1-9]\d{7,14}$/);
const pageSchema = z.object({ items: z.array(z.object({ phoneNumber: phoneSchema, status: z.string() })).max(100),
  total: z.number().int().nonnegative().optional() });
const endpointSchema = z.object({ id: z.string(), url: z.string(), status: z.string(),
  enabledEvents: z.array(z.string()).max(200), secret: z.string().max(4096) });
interface Options {
  workspaceId: string;
  connectionId?: string;
  phoneNumber: string;
  apiKey: string;
  signingSecret: string;
  input: YCloudVerificationInput;
}

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.ok || !response.body) throw new Error("YCLOUD_VERIFICATION_READ_FAILED");
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 1_048_576) throw new Error("YCLOUD_VERIFICATION_READ_FAILED");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } finally { await reader.cancel().catch(() => undefined); }
}

function secretsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length > 0 && left.length === right.length && timingSafeEqual(left, right);
}

/** Read-only provider proof. No sends, webhook mutations, grants, consent or rollout. */
export async function verifyYCloudAccount(options: Options, fetcher: typeof fetch = fetch,
  now = Date.now()): Promise<YCloudVerificationReport> {
  const { workspaceId, phoneNumber, apiKey, signingSecret } = options;
  const input = ycloudVerificationInputSchema.parse(options.input);
  const validCallback = options.connectionId === undefined ? validYCloudCallback(input.callbackUrl, workspaceId)
    : validAccountCallback(input.callbackUrl, workspaceId, options.connectionId);
  if (!z.uuid().safeParse(workspaceId).success || !phoneSchema.safeParse(phoneNumber).success
    || !apiKey || !signingSecret || !validCallback) {
    throw new Error("YCLOUD_VERIFICATION_CONFIG_INVALID");
  }
  const report: YCloudVerificationReport = { version: 1, checkedAt: new Date(now).toISOString(),
    checks: { api_access: false, connected_number: false, webhook_active: false, webhook_url: false,
      webhook_events: false, webhook_secret: false }, destination: temporaryDestination(input.callbackUrl)
      ? "temporary" : "https_unconfirmed", providerRead: "complete", sendAuthorization: false };
  const signal = AbortSignal.timeout(20_000);
  const get = async (path: string): Promise<unknown> => boundedJson(await fetcher(`https://api.ycloud.com/v2${path}`, {
    method: "GET", redirect: "error", cache: "no-store", headers: { "X-API-Key": apiKey }, signal }));
  await Promise.all([verifyNumber(report, phoneNumber, get), verifyEndpoint(report, input, signingSecret, get)]);
  return report;
}

function temporaryDestination(url: string): boolean {
  return /(^|\.)(trycloudflare\.com|ngrok(-free)?\.(app|dev|io)|loca\.lt)$/.test(new URL(url).hostname);
}

async function verifyNumber(report: YCloudVerificationReport, phoneNumber: string,
  get: (path: string) => Promise<unknown>): Promise<void> {
  try {
    for (let page = 1; page <= 5; page++) {
      const result = pageSchema.parse(await get(`/whatsapp/phoneNumbers?page=${page}&limit=100&includeTotal=true`));
      report.checks.api_access = true;
      const matches = result.items.filter((n) => n.phoneNumber === phoneNumber);
      if (matches.length) { report.checks.connected_number = matches.length === 1 && matches[0].status === "CONNECTED"; return; }
      if (result.items.length < 100 || (result.total !== undefined && page * 100 >= result.total)) return;
    }
    report.providerRead = "incomplete";
  } catch { report.providerRead = "incomplete"; }
}

async function verifyEndpoint(report: YCloudVerificationReport, input: YCloudVerificationInput, secret: string,
  get: (path: string) => Promise<unknown>): Promise<void> {
  try {
    const endpoint = endpointSchema.parse(await get(`/webhookEndpoints/${input.endpointId}`));
    report.checks.api_access = true;
    if (endpoint.id !== input.endpointId) { report.providerRead = "incomplete"; return; }
    report.checks.webhook_active = endpoint.status === "active";
    report.checks.webhook_url = endpoint.url === input.callbackUrl;
    report.checks.webhook_events = ["whatsapp.inbound_message.received", "whatsapp.message.updated"]
      .every((event) => endpoint.enabledEvents.includes(event));
    report.checks.webhook_secret = secretsMatch(endpoint.secret, secret);
  } catch { report.providerRead = "incomplete"; }
}
