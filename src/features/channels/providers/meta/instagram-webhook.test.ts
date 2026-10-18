import assert from "node:assert/strict";
import { test } from "node:test";
import { bindInstagramDraft, normalizeInstagramWebhook } from "./instagram-webhook.ts";

const asset = "17841400000000001", actor = "990000000000001";
const owner = { workspaceId: "00000000-0000-4000-8000-000000000001", connectionId: "00000000-0000-4000-8000-000000000061" };
const dm = (message: Record<string, unknown>, recipient = asset) => ({ object: "instagram", entry: [{ id: asset,
  time: 1760745600, messaging: [{ sender: { id: actor }, recipient: { id: recipient }, timestamp: 1760745600123, message }] }] });
const comment = (value: Record<string, unknown>) => ({ object: "instagram", entry: [{ id: asset, time: 1760745600,
  changes: [{ field: "comments", value: { id: "18000000000000001", text: "Hola, quiero la guía",
    from: { id: actor, username: "synthetic_user" }, media: { id: "18100000000000001", media_product_type: "REELS" },
    ...value } }] }] });
const reasonOf = (body: unknown) => {
  const first = normalizeInstagramWebhook(body)?.[0];
  return first?.status === "ignored" ? first.reason : first?.status;
};

test("a text DM becomes a scoped inbound message bound only after asset resolution", () => {
  const [result] = normalizeInstagramWebhook(dm({ mid: "m_synthetic_1", text: "hola" })) ?? [];
  assert.equal(result?.status, "accepted");
  if (result?.status !== "accepted") return;
  assert.equal(result.draft.assetId, asset);
  const event = bindInstagramDraft(result.draft, owner, new Date("2026-10-18T00:00:01Z"));
  assert.equal(event.kind, "message"); assert.equal(event.externalActorId, actor);
  assert.equal(event.occurredAt, "2025-10-18T00:00:00.123Z");
  assert.deepEqual(event.sourceContext, { channel: "instagram", sourceType: "direct_message", assetId: asset });
});

test("supported media keeps https refs; unsupported media is surfaced, not dropped", () => {
  const [image] = normalizeInstagramWebhook(dm({ mid: "m_synthetic_2",
    attachments: [{ type: "image", payload: { url: "https://cdn.example.test/a.jpg" } }] })) ?? [];
  assert.equal(image?.status === "accepted" && image.draft.event.content.type, "image");
  assert.deepEqual(image?.status === "accepted" && image.draft.mediaUrls, ["https://cdn.example.test/a.jpg"]);
  const [story] = normalizeInstagramWebhook(dm({ mid: "m_synthetic_3",
    attachments: [{ type: "story_mention", payload: { url: "https://cdn.example.test/s" } }] })) ?? [];
  assert.equal(story?.status === "accepted" && story.draft.event.content.rawType, "unsupported:story_mention");
  assert.deepEqual(story?.status === "accepted" && story.draft.mediaUrls, []);
  const [flagged] = normalizeInstagramWebhook(dm({ mid: "m_synthetic_4", is_unsupported: true })) ?? [];
  assert.equal(flagged?.status === "accepted" && flagged.draft.event.content.type, "system");
});

test("echoes, deletions, empty events and foreign recipients never reach the inbox", () => {
  assert.equal(reasonOf(dm({ mid: "m_e", text: "x", is_echo: true })), "echo");
  assert.equal(reasonOf(dm({ mid: "m_d", is_deleted: true })), "deleted");
  assert.equal(reasonOf(dm({ mid: "m_r" })), "unsupported_event");
  assert.equal(reasonOf(dm({ mid: "m_f", text: "x" }, "17841400000000999")), "asset_mismatch");
  const read = { object: "instagram", entry: [{ id: asset, time: 1, messaging: [
    { sender: { id: actor }, recipient: { id: asset }, timestamp: 1760745600123, read: { mid: "m_x" } }] }] };
  assert.equal(reasonOf(read), "unsupported_event");
});

test("a comment carries post, recipient and evidence; own comments are excluded", () => {
  const [result] = normalizeInstagramWebhook(comment({})) ?? [];
  assert.equal(result?.status, "accepted");
  if (result?.status !== "accepted") return;
  const event = bindInstagramDraft(result.draft, owner, new Date("2026-10-18T00:00:01Z"));
  assert.equal(event.kind, "comment"); assert.equal(event.externalCommentId, "18000000000000001");
  assert.equal(event.sourceContext.postId, "18100000000000001");
  assert.equal(event.sourceContext.evidenceEventId, "18000000000000001");
  assert.equal(reasonOf(comment({ from: { id: asset } })), "own_comment");
});

test("unknown fields are logged as ignored and bad envelopes are rejected whole", () => {
  const mentions = { object: "instagram", entry: [{ id: asset, time: 1, changes: [{ field: "mentions", value: {} }] }] };
  assert.equal(reasonOf(mentions), "unsupported_event");
  assert.equal(reasonOf(comment({ media: undefined })), "invalid_event");
  assert.equal(normalizeInstagramWebhook({ object: "page", entry: [] }), null);
  assert.equal(normalizeInstagramWebhook({ object: "instagram", entry: [] }), null);
  assert.equal(normalizeInstagramWebhook("not json"), null);
});
