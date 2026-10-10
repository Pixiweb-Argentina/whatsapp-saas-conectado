import { z } from "zod";

type RolloutStage = "ingress" | "worker" | "human" | "ai";
const keys = { ingress: "CHANNEL_INGRESS_WORKSPACES", worker: "CHANNEL_WORKER_WORKSPACES",
  human: "CHANNEL_HUMAN_WORKSPACES", ai: "CHANNEL_AI_WORKSPACES" } as const;

/** Server-only, explicit workspace lists. Empty is off; no wildcard/global switch. */
export function channelRolloutWorkspaces(
  stage: RolloutStage, env: Readonly<Record<string, string | undefined>> = process.env,
): string[] {
  const raw = env[keys[stage]]?.trim();
  if (!raw) return [];
  const parsed = z.array(z.uuid()).max(stage === "worker" || stage === "ai" ? 3 : 100)
    .safeParse(raw.split(",").map((value) => value.trim().toLowerCase()));
  if (!parsed.success) throw new Error("CHANNEL_ROLLOUT_INVALID");
  return [...new Set(parsed.data)];
}
