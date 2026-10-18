import { z } from "zod";
import { inboundEventSchema, type InboundEvent } from "../../types/channel-contracts";

const id = z.string().regex(/^[0-9A-Za-z_.:=-]{1,512}$/);
const epoch = z.number().int().positive();
const attachmentSchema = z.object({
  type: z.string().min(1).max(64),
  payload: z.object({ url: z.url({ protocol: /^https$/ }).max(4096).optional() }).passthrough().optional(),
}).passthrough();
const messagingSchema = z.object({
  sender: z.object({ id }), recipient: z.object({ id }), timestamp: epoch,
  message: z.object({
    mid: id, text: z.string().max(8192).optional(), attachments: z.array(attachmentSchema).max(10).optional(),
    is_echo: z.boolean().optional(), is_deleted: z.boolean().optional(), is_unsupported: z.boolean().optional(),
  }).passthrough().optional(),
}).passthrough();
const commentChangeSchema = z.object({
  field: z.literal("comments"),
  value: z.object({
    id, text: z.string().max(8192), parent_id: id.optional(),
    from: z.object({ id, username: z.string().max(64).optional() }),
    media: z.object({ id, media_product_type: z.string().max(32).optional() }),
  }).passthrough(),
});
const changeSchema = z.object({ field: z.string().min(1).max(64), value: z.unknown() });
const entrySchema = z.object({
  id, time: epoch,
  messaging: z.array(messagingSchema).max(100).optional(),
  changes: z.array(changeSchema).max(100).optional(),
}).passthrough();

export const instagramWebhookSchema = z.object({
  object: z.literal("instagram"), entry: z.array(entrySchema).min(1).max(100),
});

type Draft = Omit<InboundEvent, "workspaceId" | "connectionId" | "receivedAt">;
export type InstagramIgnoreReason =
  | "echo" | "deleted" | "own_comment" | "unsupported_event" | "invalid_event" | "asset_mismatch";
export interface InstagramDraft { assetId: string; event: Draft; mediaUrls: string[] }
export type InstagramNormalized =
  | { status: "accepted"; draft: InstagramDraft }
  | { status: "ignored"; assetId: string; reason: InstagramIgnoreReason; field: string };

const MEDIA_TYPES: Record<string, Draft["content"]["type"]> = {
  image: "image", video: "video", audio: "audio", file: "document",
};

/** Meta mixes seconds (entry.time) and milliseconds (messaging.timestamp). */
function toIso(value: number): string {
  return new Date(value < 1e12 ? value * 1000 : value).toISOString();
}

function normalizeMessage(assetId: string, raw: z.infer<typeof messagingSchema>): InstagramNormalized {
  const message = raw.message;
  const ignored = (reason: InstagramIgnoreReason): InstagramNormalized =>
    ({ status: "ignored", assetId, reason, field: "messages" });
  if (!message) return ignored("unsupported_event");
  if (message.is_echo) return ignored("echo");
  if (message.is_deleted) return ignored("deleted");
  if (raw.recipient.id !== assetId) return ignored("asset_mismatch");
  const attachments = message.attachments ?? [];
  const first = attachments[0];
  const mediaType = first ? MEDIA_TYPES[first.type] : undefined;
  const supported = !message.is_unsupported && (!first || mediaType !== undefined);
  const text = message.text?.trim() ? message.text : null;
  if (!text && !first && !message.is_unsupported) return ignored("unsupported_event");
  const mediaUrls = supported ? attachments.flatMap((item) => item.payload?.url ? [item.payload.url] : []) : [];
  return { status: "accepted", draft: { assetId, mediaUrls, event: {
    schemaVersion: 1, channel: "instagram", provider: "meta", providerEventId: message.mid, kind: "message",
    occurredAt: toIso(raw.timestamp), externalActorId: raw.sender.id, externalMessageId: message.mid,
    content: {
      type: !supported ? "system" : mediaType ?? "text", text,
      rawType: !supported ? `unsupported:${first?.type ?? "message"}`.slice(0, 64) : first?.type ?? "text",
    },
    mediaRefs: mediaUrls.map((_, index) => ({ externalId: `${message.mid}:${index}`, mimeType: null, filename: null })),
    sourceContext: { channel: "instagram", sourceType: "direct_message", assetId },
  } } };
}

function normalizeComment(assetId: string, time: number, change: z.infer<typeof changeSchema>): InstagramNormalized {
  const parsed = commentChangeSchema.safeParse(change);
  if (!parsed.success) {
    const reason = change.field === "comments" ? "invalid_event" : "unsupported_event";
    return { status: "ignored", assetId, reason, field: change.field };
  }
  const value = parsed.data.value;
  if (value.from.id === assetId) return { status: "ignored", assetId, reason: "own_comment", field: "comments" };
  return { status: "accepted", draft: { assetId, mediaUrls: [], event: {
    schemaVersion: 1, channel: "instagram", provider: "meta", providerEventId: value.id, kind: "comment",
    occurredAt: toIso(time), externalActorId: value.from.id, externalCommentId: value.id,
    content: { type: "text", text: value.text, rawType: "comment" }, mediaRefs: [],
    sourceContext: { channel: "instagram", sourceType: "comment", assetId, postId: value.media.id,
      evidenceEventId: value.id },
  } } };
}

/** Pure: schema-checks a signed body and splits it per event. Nothing here sends or stores. */
export function normalizeInstagramWebhook(body: unknown): InstagramNormalized[] | null {
  const parsed = instagramWebhookSchema.safeParse(body);
  if (!parsed.success) return null;
  return parsed.data.entry.flatMap((entry) => [
    ...(entry.messaging ?? []).map((item) => normalizeMessage(entry.id, item)),
    ...(entry.changes ?? []).map((change) => normalizeComment(entry.id, entry.time, change)),
  ]);
}

/** Attach the connection resolved from the asset; the full contract re-validates the result. */
export function bindInstagramDraft(draft: InstagramDraft, owner: { workspaceId: string; connectionId: string },
  receivedAt: Date): InboundEvent {
  return inboundEventSchema.parse({ ...draft.event, ...owner, receivedAt: receivedAt.toISOString() });
}
