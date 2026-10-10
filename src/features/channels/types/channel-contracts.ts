import { z } from "zod";

export const channelSchema = z.enum(["whatsapp", "instagram", "messenger", "web"]);
export const connectionStatusSchema = z.enum([
  "connecting", "needs_permissions", "awaiting_webhook", "ready", "degraded", "revoked",
]);

const opaqueIdSchema = z.string().min(1).max(512).refine(
  (value) => value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value),
  "Expected a nonblank opaque identifier without control characters",
);

const connectionFields = {
  workspaceId: z.uuid(),
  connectionId: z.uuid(),
  externalAccountId: opaqueIdSchema,
  status: connectionStatusSchema,
};

export const connectionSchema = z.discriminatedUnion("channel", [
  z.strictObject({ ...connectionFields, channel: z.literal("whatsapp"),
    provider: z.enum(["ycloud", "kapso"]) }),
  z.strictObject({ ...connectionFields, channel: z.literal("instagram"),
    provider: z.literal("meta") }),
  z.strictObject({ ...connectionFields, channel: z.literal("messenger"),
    provider: z.literal("meta") }),
  z.strictObject({ ...connectionFields, channel: z.literal("web"),
    provider: z.literal("widget") }),
]);

export const identityScopeSchema = z.strictObject({
  workspaceId: z.uuid(),
  connectionId: z.uuid(),
  externalActorId: opaqueIdSchema,
});

export const sourceContextSchema = z.strictObject({
  channel: channelSchema,
  sourceType: z.enum([
    "direct_message", "comment", "story", "link", "ad", "website", "unknown",
  ]),
  assetId: opaqueIdSchema.optional(),
  postId: opaqueIdSchema.optional(),
  storyId: opaqueIdSchema.optional(),
  adId: opaqueIdSchema.optional(),
  referralRef: z.string().max(2048).optional(),
  evidenceEventId: opaqueIdSchema.optional(),
});

export const inboundEventSchema = z.strictObject({
  schemaVersion: z.literal(1),
  workspaceId: z.uuid(),
  connectionId: z.uuid(),
  channel: channelSchema,
  provider: z.enum(["ycloud", "kapso", "meta", "widget"]),
  providerEventId: opaqueIdSchema,
  kind: z.enum(["message", "comment", "outbound_echo", "delivery_receipt"]),
  occurredAt: z.iso.datetime({ offset: true }),
  receivedAt: z.iso.datetime({ offset: true }),
  externalActorId: opaqueIdSchema,
  externalMessageId: opaqueIdSchema.optional(),
  externalCommentId: opaqueIdSchema.optional(),
  content: z.strictObject({
    type: z.enum(["text", "audio", "image", "document", "video", "sticker",
      "location", "template", "system"]),
    text: z.string().nullable(),
    rawType: z.string().min(1).max(64),
  }),
  mediaRefs: z.array(z.strictObject({
    externalId: opaqueIdSchema,
    mimeType: z.string().max(255).nullable(),
    filename: z.string().max(1024).nullable(),
  })),
  sourceContext: sourceContextSchema,
}).superRefine((event, ctx) => {
  const allowed = event.channel === "whatsapp" ? ["ycloud", "kapso"]
    : event.channel === "web" ? ["widget"] : ["meta"];
  if (!allowed.includes(event.provider)) {
    ctx.addIssue({ code: "custom", path: ["provider"], message: "Provider/channel mismatch" });
  }
  if (event.sourceContext.channel !== event.channel) {
    ctx.addIssue({ code: "custom", path: ["sourceContext"], message: "Source/channel mismatch" });
  }
  const id = event.kind === "comment" ? event.externalCommentId : event.externalMessageId;
  if (!id) ctx.addIssue({ code: "custom", message: "Event must identify its message or comment" });
});

export type Channel = z.infer<typeof channelSchema>;
export type ChannelConnection = z.infer<typeof connectionSchema>;
export type IdentityScope = z.infer<typeof identityScopeSchema>;
export type InboundEvent = z.infer<typeof inboundEventSchema>;
export type SourceContext = z.infer<typeof sourceContextSchema>;

/** A timeout after submission is unknown, never an automatic retry instruction. */
export type SendResult =
  | { status: "accepted"; externalId: string }
  | { status: "rejected"; errorCode: string; retryable: boolean }
  | { status: "unknown"; operationId: string };

/** Phone/email are optional attributes, not identity keys across accounts. */
export interface ChannelContact {
  id: string;
  workspaceId: string;
  name: string | null;
  phone: string | null;
  email: string | null;
}
