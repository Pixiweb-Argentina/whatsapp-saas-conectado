import { z } from "zod";
import { validYCloudCallback } from "./ycloud-verification";

export const permissionBlockerSchema = z.enum(["account_mismatch", "account_revoked", "verification_required",
  "public_origin_missing", "stable_callback_required", "delivery_proof_required", "unmanaged_capabilities"]);
export const ycloudPermissionReviewSchema = z.strictObject({
  connectionId: z.uuid(), connectionUpdatedAt: z.iso.datetime({ offset: true }),
  storedStatus: z.enum(["connecting", "needs_permissions", "awaiting_webhook", "ready", "degraded", "revoked"]),
  managed: z.boolean(), current: z.boolean(), validUntil: z.iso.datetime({ offset: true }).nullable(),
  canGrant: z.boolean(), canRevoke: z.boolean(), verificationCheckedAt: z.iso.datetime({ offset: true }).nullable(),
  blockers: z.array(permissionBlockerSchema).max(7),
});
const mutationFields = { connectionId: z.uuid(), operationId: z.uuid(),
  connectionUpdatedAt: z.iso.datetime({ offset: true }) };
export const ycloudPermissionMutationSchema = z.discriminatedUnion("action", [
  z.strictObject({ ...mutationFields, action: z.literal("grant"), verificationCheckedAt: z.iso.datetime({ offset: true }),
    acknowledgeTextPermission: z.literal(true) }),
  z.strictObject({ ...mutationFields, action: z.literal("revoke") }),
]);
export type YCloudPermissionReview = z.infer<typeof ycloudPermissionReviewSchema>;
export type YCloudPermissionMutation = z.infer<typeof ycloudPermissionMutationSchema>;

/** Deployment configuration belongs to the server, never to the request body. */
export function configuredYCloudCallback(workspaceId: string, origin: string | undefined): string | null {
  if (!z.uuid().safeParse(workspaceId).success || !origin) return null;
  try {
    const url = new URL(origin);
    if (url.pathname !== "/" || url.search || url.hash || /(^|\.)(trycloudflare\.com|ngrok(-free)?\.(app|dev|io)|loca\.lt)$/.test(url.hostname)) return null;
    url.pathname = "/api/webhooks/ycloud"; url.searchParams.set("wsid", workspaceId);
    return validYCloudCallback(url.href, workspaceId) ? url.href : null;
  } catch { return null; }
}
