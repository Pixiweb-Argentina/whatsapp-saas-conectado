/**
 * Instagram reply windows (F4-T2.2). Pure: turns a persisted inbound event into the
 * send-policy evidence. The policy engine still decides; this only states how long an
 * interaction authorizes a reply and whether a comment can receive its single private reply.
 */
import type { InboundEvent } from "../../types/channel-contracts";
import type { SendPolicyInput } from "../../types/send-policy";

const HOUR_MS = 60 * 60 * 1000;
/** Standard messaging window after the person's last DM. */
export const META_MESSAGING_WINDOW_MS = 24 * HOUR_MS;
/** HUMAN_AGENT tag: a person on the team may answer up to 7 days after the last DM. */
export const META_HUMAN_AGENT_WINDOW_MS = 7 * 24 * HOUR_MS;
/** One private reply per comment, only within 7 days of the comment. */
export const META_PRIVATE_REPLY_WINDOW_MS = 7 * 24 * HOUR_MS;

type Evidence = NonNullable<SendPolicyInput["evidence"]>;
export type PrivateReplyState = "available" | "reserved" | "sent" | "consumed";

/** A row already stored by the webhook; the id is our event UUID, never Meta's id. */
export interface StoredInstagramEvent {
  id: string;
  historical: boolean;
  envelope: InboundEvent;
}

/** Facts read from the database: the claim row plus what Meta told us about the comment. */
export interface CommentFacts {
  state: PrivateReplyState;
  operationId: string | null;
  isOwn: boolean;
  isDeleted: boolean;
}

function plus(occurredAt: string, windowMs: number): string {
  return new Date(Date.parse(occurredAt) + windowMs).toISOString();
}

function usable(event: StoredInstagramEvent, kind: InboundEvent["kind"], now: number): boolean {
  const envelope = event.envelope;
  return envelope.channel === "instagram" && envelope.provider === "meta"
    && envelope.kind === kind && Date.parse(envelope.occurredAt) <= now;
}

function base(event: StoredInstagramEvent, windowMs: number) {
  const { workspaceId, connectionId, externalActorId, occurredAt } = event.envelope;
  return { id: event.id, workspaceId, connectionId, externalActorId, occurredAt,
    validUntil: plus(occurredAt, windowMs) };
}

/** A DM opens the 24h window. Echoes, receipts, comments and history never do. */
export function instagramMessageEvidence(event: StoredInstagramEvent, now: number): Evidence | null {
  if (event.historical || !usable(event, "message", now)) return null;
  return { ...base(event, META_MESSAGING_WINDOW_MS), kind: "inbound_message" };
}

/** HUMAN_AGENT evidence: same DM, 7 days, and the policy still requires a human actor. */
export function instagramHumanAgentEvidence(event: StoredInstagramEvent, now: number): Evidence | null {
  if (event.historical || !usable(event, "message", now)) return null;
  return { ...base(event, META_HUMAN_AGENT_WINDOW_MS), kind: "human_agent" };
}

/**
 * A comment authorizes one private reply for 7 days. Own, deleted and historical comments
 * stay ineligible so the policy explains why. A public comment never opens the DM window.
 */
export function instagramCommentEvidence(
  event: StoredInstagramEvent, facts: CommentFacts, now: number,
): Evidence | null {
  const commentId = event.envelope.externalCommentId;
  if (!usable(event, "comment", now) || !commentId) return null;
  if ((facts.state === "available") !== (facts.operationId === null)) return null;
  const evidence = base(event, META_PRIVATE_REPLY_WINDOW_MS);
  const eligible = !event.historical && !facts.isOwn && !facts.isDeleted
    && Date.parse(evidence.validUntil) > now;
  return { ...evidence, kind: "comment", externalCommentId: commentId, eligible,
    privateReply: facts.state, reservedOperationId: facts.operationId };
}
