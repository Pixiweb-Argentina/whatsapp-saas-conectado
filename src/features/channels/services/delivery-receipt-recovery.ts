import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Bounded and transport-free; matches evidence that preceded the stored send result. */
export async function reconcileChannelReceipts(db: SupabaseClient, workspaceId: string): Promise<number> {
  const {data,error}=await db.rpc("reconcile_channel_receipts",{p_workspace_id:z.uuid().parse(workspaceId),p_limit:50});
  const count=z.number().int().min(0).max(50).safeParse(data);
  if (error || !count.success) throw new Error("CHANNEL_RECEIPT_STORAGE_FAILED");
  return count.data;
}
