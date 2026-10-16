import { z } from "zod";
import { configuredYCloudCallback, permissionBlockerSchema, ycloudPermissionReviewSchema } from "./ycloud-permissions";
import { validYCloudCallback } from "./ycloud-verification";

export const accountVerificationInputSchema = z.strictObject({ endpointId: z.string().trim().regex(/^[a-zA-Z0-9_-]{1,128}$/) });
export const accountPermissionReviewSchema = z.strictObject({ ...ycloudPermissionReviewSchema.shape,
  blockers: z.array(z.enum([...permissionBlockerSchema.options, "unsupported_provider"])).max(8),
  callbackUrl: z.url().nullable() });
export type AccountPermissionReview = z.infer<typeof accountPermissionReviewSchema>;

/** Callback is compared with provider metadata; it is never fetched. */
export function validAccountCallback(value: string, workspaceId: string, connectionId: string): boolean {
  if (!z.uuid().safeParse(workspaceId).success || !z.uuid().safeParse(connectionId).success) return false;
  try {
    const url = new URL(value);
    if (url.pathname !== `/api/webhooks/whatsapp-accounts/${workspaceId}/${connectionId}` || url.search) return false;
    url.pathname = "/api/webhooks/ycloud"; url.searchParams.set("wsid", workspaceId);
    return validYCloudCallback(url.href, workspaceId);
  } catch { return false; }
}

export function configuredAccountCallback(workspaceId: string, connectionId: string, origin: string | undefined): string | null {
  const legacy = configuredYCloudCallback(workspaceId, origin);
  if (!legacy || !z.uuid().safeParse(connectionId).success) return null;
  const url = new URL(legacy); url.search = "";
  url.pathname = `/api/webhooks/whatsapp-accounts/${workspaceId}/${connectionId}`;
  return validAccountCallback(url.href, workspaceId, connectionId) ? url.href : null;
}
