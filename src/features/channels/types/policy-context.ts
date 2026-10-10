import { z } from "zod";
import { channelSchema, connectionStatusSchema } from "./channel-contracts";
import { sendIdSchema } from "./send-contracts";
import { sendPolicyInputSchema } from "./send-policy";

export const policySubjectSchema = z.strictObject({
  workspaceId: z.uuid(), connectionId: z.uuid(), conversationId: z.uuid().nullable(),
  eventId: z.uuid().nullable(), recipient: sendIdSchema, channel: channelSchema,
});
export type PolicySubject = z.infer<typeof policySubjectSchema>;

export const policyConnectionSchema = z.object({
  id: z.uuid(), workspace_id: z.uuid(), channel: channelSchema,
  provider: z.enum(["ycloud", "kapso", "meta", "widget"]),
  external_account_id: sendIdSchema, status: connectionStatusSchema,
  revoked_at: z.string().nullable(), capabilities: z.unknown(),
  legacy_integration_id: z.uuid().nullable(),
});
export type PolicyConnection = z.infer<typeof policyConnectionSchema>;

/** Only server verification may write this metadata; booleans/tokens are not grants. */
export const verifiedCapabilitiesSchema = z.strictObject({
  version: z.literal(1),
  grants: z.array(sendPolicyInputSchema.shape.capabilities.element.extend({
    validUntil: z.iso.datetime({ offset: true }),
  })).max(32),
});

export const policyConversationSchema = z.object({
  id: z.uuid(), workspace_id: z.uuid(), connection_id: z.uuid(), identity_id: z.uuid(),
  contact_id: z.uuid(), channel: channelSchema, ai_enabled: z.boolean(),
  state: sendPolicyInputSchema.shape.conversation.unwrap().shape.state,
  state_revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});

export const policyIdentitySchema = z.object({
  id: z.uuid(), workspace_id: z.uuid(), connection_id: z.uuid(), contact_id: z.uuid(),
  external_user_id: sendIdSchema, verified_at: z.iso.datetime({ offset: true }).nullable(),
});
