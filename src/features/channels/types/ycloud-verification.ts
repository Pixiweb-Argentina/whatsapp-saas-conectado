import { z } from "zod";

export const ycloudVerificationInputSchema = z.strictObject({
  endpointId: z.string().trim().regex(/^[a-zA-Z0-9_-]{1,128}$/),
  callbackUrl: z.url().max(500),
});
export const YCLOUD_CHECKS = ["api_access", "connected_number", "webhook_active", "webhook_url", "webhook_events", "webhook_secret"] as const;
export const ycloudVerificationReportSchema = z.strictObject({
  version: z.literal(1),
  checkedAt: z.iso.datetime({ offset: true }),
  checks: z.strictObject({ api_access: z.boolean(), connected_number: z.boolean(), webhook_active: z.boolean(),
    webhook_url: z.boolean(), webhook_events: z.boolean(), webhook_secret: z.boolean() }),
  destination: z.enum(["temporary", "https_unconfirmed"]),
  providerRead: z.enum(["complete", "incomplete"]),
  sendAuthorization: z.literal(false),
});
export const ycloudVerificationRecordSchema = z.strictObject({
  input: ycloudVerificationInputSchema,
  report: ycloudVerificationReportSchema,
  current: z.boolean(),
});
export type YCloudVerificationInput = z.infer<typeof ycloudVerificationInputSchema>;
export type YCloudVerificationReport = z.infer<typeof ycloudVerificationReportSchema>;
export type YCloudVerificationRecord = z.infer<typeof ycloudVerificationRecordSchema>;

/** Validates the intended destination; this URL is compared, never fetched. */
export function validYCloudCallback(value: string, workspaceId: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password && !u.port && !u.hash
      && u.pathname === "/api/webhooks/ycloud" && [...u.searchParams].length === 1
      && u.searchParams.get("wsid") === workspaceId && !u.hostname.includes(":")
      && !/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname)
      && u.hostname.includes(".") && !/(^|\.)(localhost|local|internal|test|invalid)$/.test(u.hostname);
  } catch { return false; }
}
