import { z } from "zod";
import { channelSchema, connectionSchema, identityScopeSchema } from "./channel-contracts";
import { channelSendRequestSchema, sendIdSchema } from "./send-contracts";

const timestamp = z.iso.datetime({ offset: true });
const evidenceFields = {
  id: sendIdSchema, workspaceId: z.uuid(), connectionId: z.uuid(),
  externalActorId: sendIdSchema, occurredAt: timestamp, validUntil: timestamp,
};

/** Loaded from verified server records. A request body is never policy evidence. */
export const sendPolicyInputSchema = z.strictObject({
  workspaceId: z.uuid(), connection: connectionSchema, identity: identityScopeSchema,
  request: channelSendRequestSchema,
  actor: z.enum(["human", "ai", "automation"]), phase: z.enum(["enqueue", "send"]),
  now: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  conversation: z.strictObject({
    workspaceId: z.uuid(), connectionId: z.uuid(), channel: channelSchema,
    externalActorId: sendIdSchema,
    aiEnabled: z.boolean(),
    state: z.enum(["ai_active", "human_active", "handoff_pending", "waiting_reply", "paused", "closed"]),
    revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  }).nullable(),
  optedOut: z.boolean(),
  capabilities: z.array(z.strictObject({
    workspaceId: z.uuid(), connectionId: z.uuid(),
    capability: z.enum(["text", "template", "private_reply", "public_reply", "media", "human_agent"]),
    verifiedAt: timestamp, evidenceRef: sendIdSchema, validUntil: timestamp.optional(),
  })),
  evidence: z.discriminatedUnion("kind", [
    z.strictObject({ ...evidenceFields, kind: z.literal("inbound_message") }),
    z.strictObject({ ...evidenceFields, kind: z.literal("human_agent") }),
    z.strictObject({ ...evidenceFields, kind: z.literal("visitor_session") }),
    z.strictObject({ ...evidenceFields, kind: z.literal("approved_template"),
      templateName: sendIdSchema }),
    z.strictObject({ ...evidenceFields, kind: z.literal("comment"), eligible: z.boolean(),
      privateReply: z.enum(["available", "reserved", "sent"]),
      reservedOperationId: sendIdSchema.nullable() }),
  ]).nullable(),
});

export type SendPolicyInput = z.infer<typeof sendPolicyInputSchema>;
export type SendPolicyReason = "allowed" | "invalid_context" | "scope_mismatch"
  | "connection_not_ready" | "permission_missing" | "revoked" | "unsupported_capability"
  | "identity_unknown" | "stale_revision" | "human_hold" | "closed" | "opted_out"
  | "missing_evidence" | "ineligible_evidence" | "expired" | "duplicate_private_reply"
  | "reservation_required";

export interface SendPolicyDecision {
  allowed: boolean;
  reasonCode: SendPolicyReason;
  /** Spanish copy is shared by the composer and the server; no provider detail. */
  message: string;
  validUntil: string | null;
  evidenceId: string | null;
}
