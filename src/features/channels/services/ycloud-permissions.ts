import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { configuredYCloudCallback, ycloudPermissionMutationSchema, ycloudPermissionReviewSchema,
  type YCloudPermissionReview } from "../types/ycloud-permissions";

export async function readYCloudPermissionReview(db: SupabaseClient, workspaceId: string, actorId: string,
  origin = process.env.CHANNEL_PUBLIC_ORIGIN): Promise<YCloudPermissionReview | null> {
  z.uuid().parse(workspaceId); z.uuid().parse(actorId);
  const { data, error } = await db.rpc("read_ycloud_permission_review", { p_workspace: workspaceId, p_actor: actorId,
    p_callback: configuredYCloudCallback(workspaceId, origin) });
  if (error) throw new Error("YCLOUD_PERMISSION_UNAVAILABLE");
  return data === null ? null : ycloudPermissionReviewSchema.parse(data);
}

export async function changeYCloudTextPermission(db: SupabaseClient, workspaceId: string, actorId: string,
  value: unknown, origin = process.env.CHANNEL_PUBLIC_ORIGIN): Promise<{ applied: boolean; review: YCloudPermissionReview | null }> {
  z.uuid().parse(workspaceId); z.uuid().parse(actorId);
  const mutation = ycloudPermissionMutationSchema.parse(value);
  const { data, error } = await db.rpc("change_ycloud_text_permission", { p_workspace: workspaceId, p_actor: actorId,
    p_connection: mutation.connectionId, p_operation: mutation.operationId, p_action: mutation.action,
    p_expected_updated_at: mutation.connectionUpdatedAt,
    p_expected_verification: mutation.action === "grant" ? mutation.verificationCheckedAt : null,
    p_callback: configuredYCloudCallback(workspaceId, origin) });
  if (error || typeof data !== "boolean") throw new Error("YCLOUD_PERMISSION_CHANGE_REJECTED");
  // Replays return the current state: a previous grant must never reactivate after revocation.
  return { applied: data, review: await readYCloudPermissionReview(db, workspaceId, actorId, origin) };
}
