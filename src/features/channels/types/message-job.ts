import { z } from "zod";
import { channelSendRequestSchema, sendIdSchema } from "./send-contracts";

export const enqueueJobSchema = z.strictObject({
  workspaceId: z.uuid(), connectionId: z.uuid(), conversationId: z.uuid().nullable(),
  eventId: z.uuid().nullable(), idempotencyKey: sendIdSchema,
  actor: z.enum(["human", "ai", "automation"]),
  expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  request: channelSendRequestSchema,
}).superRefine((job, ctx) => {
  if (!z.uuid().safeParse(job.request.operationId).success) {
    ctx.addIssue({ code: "custom", message: "Durable operations require UUIDs" });
  }
  if ((job.conversationId === null) !== (job.expectedRevision === null)) {
    ctx.addIssue({ code: "custom", message: "Conversation and revision must be paired" });
  }
  if (!job.conversationId && (!job.eventId || !["private_reply", "public_reply"].includes(job.request.action))) {
    ctx.addIssue({ code: "custom", message: "A conversationless reply requires a comment event" });
  }
});

/** Validate a claimed database row before any policy or transport work. */
export const claimedJobSchema = z.object({
  operation_id: z.uuid(), workspace_id: z.uuid(), connection_id: z.uuid(),
  conversation_id: z.uuid().nullable(), event_id: z.uuid().nullable(),
  actor: z.enum(["human", "ai", "automation"]), request: channelSendRequestSchema,
  expected_state_revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  state: z.literal("leased"), attempts: z.number().int().min(1).max(5),
  fence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER), lease_owner: z.uuid(),
  lease_until: z.iso.datetime({ offset: true }),
}).refine((job) => job.operation_id === job.request.operationId
  && (job.conversation_id === null) === (job.expected_state_revision === null));

export type EnqueueJob = z.infer<typeof enqueueJobSchema>;
export type ClaimedJob = z.infer<typeof claimedJobSchema>;
