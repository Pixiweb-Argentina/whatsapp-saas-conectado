import type { SendPolicyReason } from "./send-policy";
import type { PolicyConnection } from "./policy-context";

export type PilotBlocker = "connection_not_ready" | "grant_missing" | "transport_unavailable"
  | "identity_unverified" | "inbound_policy_unavailable" | "context_unavailable";
export type PreflightPolicyReason = SendPolicyReason | "opt_in_required";

export interface ConnectionPilotPreflight {
  connectionId: string;
  channel: PolicyConnection["channel"];
  provider: PolicyConnection["provider"];
  storedStatus: PolicyConnection["status"];
  configuredTransport: boolean;
  storedTextGrantCurrent: boolean;
  verifiedIdentities: number;
  sampledPolicies: PreflightPolicyReason[];
  blockers: PilotBlocker[];
}

/** Local/server checks only. Neither a grant nor a credential proves remote delivery. */
export interface PilotPreflight {
  schemaVersion: 1;
  workspaceId: string;
  checkedAt: string;
  coverage: "complete" | "partial";
  connections: ConnectionPilotPreflight[];
  rollout: Record<"ingress" | "worker" | "human" | "ai", boolean>;
  externalValidation: "pending";
  sideEffects: false;
}
