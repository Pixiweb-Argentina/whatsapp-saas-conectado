import type { SupabaseClient } from "@supabase/supabase-js";
import type { PolicySubject } from "../types/policy-context";
import { sendPolicyInputSchema, type SendPolicyInput } from "../types/send-policy";

/** Internal evidence reader; neither an envelope nor a browser claim proves eligibility.
 * Meta onboarding/webhook verification must persist the private proof in F4/F5.
 */
export async function readCommentPolicyEvidence(db: SupabaseClient, subject: PolicySubject)
  : Promise<SendPolicyInput["evidence"]> {
  if (!subject.eventId || !["instagram", "messenger"].includes(subject.channel)) return null;
  const { data, error } = await db.rpc("read_channel_comment_evidence", {
    p_workspace_id: subject.workspaceId, p_connection_id: subject.connectionId,
    p_event_id: subject.eventId, p_recipient: subject.recipient,
  });
  if (error) throw new Error("CHANNEL_POLICY_CONTEXT_UNAVAILABLE");
  if (data === null) return null;
  const checked = sendPolicyInputSchema.shape.evidence.safeParse(data);
  if (!checked.success || checked.data?.kind !== "comment") throw new Error("CHANNEL_POLICY_CONTEXT_UNAVAILABLE");
  const evidence = checked.data;
  if (evidence.id !== subject.eventId || evidence.workspaceId !== subject.workspaceId
    || evidence.connectionId !== subject.connectionId || evidence.externalActorId !== subject.recipient) {
    throw new Error("CHANNEL_POLICY_CONTEXT_UNAVAILABLE");
  }
  return evidence;
}
