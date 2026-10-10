import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAuthorized } from "@/lib/cron-auth";
import { channelRolloutWorkspaces } from "@/features/channels/services/channel-rollout";
import { createMessagePipeline } from "@/features/channels/services/message-pipeline";

export const maxDuration = 300;

/** Manual opt-in only; no scheduler is installed. One job per workspace/tick,
 * at most three workspaces. Request parameters never select a tenant or job.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const startedAt = Date.now();
  if (!isAuthorized(request.headers.get("Authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const workspaces = channelRolloutWorkspaces("worker");
    if (!workspaces.length) return NextResponse.json({ enabled: false, processed: 0 });
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } });
    const pipeline = createMessagePipeline(db);
    const outcomes: Record<string, number> = {};
    let failed = false;
    for (const workspaceId of workspaces) {
      // Leave at least one full 90-second lease before the function deadline.
      if (Date.now() - startedAt >= (maxDuration - 90) * 1000) { failed = true; break; }
      try {
        const results = await pipeline.drain(workspaceId, randomUUID(), 1);
        for (const result of results) {
          outcomes[result.status] = (outcomes[result.status] ?? 0) + 1;
          if (result.status === "recovery_pending" || result.status === "lost_lease") failed = true;
        }
      } catch {
        failed = true;
      }
    }
    return NextResponse.json({ enabled: true, outcomes, ...(failed ? { error: "CHANNEL_DRAIN_INCOMPLETE" } : {}) },
      { status: failed ? 503 : 200 });
  } catch {
    return NextResponse.json({ error: "CHANNEL_DRAIN_UNAVAILABLE" }, { status: 503 });
  }
}
