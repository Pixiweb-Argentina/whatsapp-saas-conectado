import { z } from "zod";
import { channelSchema } from "./channel-contracts";

export const sendIdSchema = z.string().min(1).max(512).refine(
  (value) => value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value),
  "Invalid send identifier",
);

export const sendActionSchema = z.enum(["text", "template", "private_reply", "public_reply", "media"]);
const requestFields = {
  operationId: sendIdSchema,
  channel: channelSchema,
  recipient: sendIdSchema,
};
const textFields = { body: z.string().min(1).refine((value) => value.trim().length > 0) };

export const templateComponentsSchema = z.array(z.strictObject({
  type: z.enum(["header", "body", "footer", "button"]),
  parameters: z.array(z.strictObject({ type: z.literal("text"), text: z.string() })),
}));

export const channelSendRequestSchema = z.discriminatedUnion("action", [
  z.strictObject({ ...requestFields, action: z.literal("text"), ...textFields }),
  z.strictObject({ ...requestFields, action: z.literal("template"),
    templateName: sendIdSchema, language: z.string().min(1).max(32),
    components: templateComponentsSchema.optional() }),
  z.strictObject({ ...requestFields, action: z.literal("private_reply"),
    commentId: sendIdSchema, ...textFields }),
  z.strictObject({ ...requestFields, action: z.literal("public_reply"),
    commentId: sendIdSchema, ...textFields }),
  // Media must already be stored/validated by the server; no arbitrary download URL.
  z.strictObject({ ...requestFields, action: z.literal("media"), mediaRef: sendIdSchema }),
]);

export const channelSendResultSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("accepted"), externalId: sendIdSchema,
    wamid: sendIdSchema.optional(), providerMessageId: sendIdSchema.optional() }),
  z.strictObject({ status: z.literal("rejected"), errorCode: sendIdSchema,
    retryable: z.boolean() }),
  z.strictObject({ status: z.literal("unknown"), operationId: sendIdSchema }),
]);

export type ChannelSendRequest = z.infer<typeof channelSendRequestSchema>;
export type ChannelSendResult = z.infer<typeof channelSendResultSchema>;
export type SendAction = z.infer<typeof sendActionSchema>;

/** Implemented actions are code support, NOT verified permissions for an account. */
export interface ChannelAdapter {
  channel: z.infer<typeof channelSchema>;
  provider: "ycloud" | "kapso" | "meta" | "widget";
  live: boolean;
  implementedActions: readonly SendAction[];
  /** Caller must persist first and revalidate policy. Transport never retries. */
  send(request: ChannelSendRequest): Promise<ChannelSendResult>;
}
