import {
  sendPolicyInputSchema, type SendPolicyInput, type SendPolicyDecision, type SendPolicyReason,
} from "../types/send-policy";

const MESSAGES: Record<SendPolicyReason, string> = {
  allowed: "Podés enviar este mensaje.",
  invalid_context: "No se pudo comprobar el contexto del envío.",
  scope_mismatch: "La cuenta o el contacto no pertenecen a esta conversación.",
  connection_not_ready: "La conexión todavía no está lista para enviar.",
  permission_missing: "Faltan permisos de la cuenta para enviar.",
  revoked: "La conexión fue revocada. Volvé a conectarla.",
  unsupported_capability: "Esta acción todavía no está verificada para la cuenta.",
  identity_unknown: "No se pudo identificar al destinatario en esta cuenta.",
  stale_revision: "La conversación cambió. Revisá su estado antes de enviar.",
  human_hold: "La automatización está pausada por la atención humana.",
  closed: "La conversación está cerrada.",
  opted_out: "El contacto pidió no recibir este tipo de mensajes.",
  missing_evidence: "Falta una interacción que permita este envío.",
  ineligible_evidence: "Esta interacción no habilita el mensaje solicitado.",
  expired: "Venció el permiso de respuesta de esta interacción.",
  duplicate_private_reply: "Ese comentario ya tiene una respuesta privada reservada o enviada.",
  reservation_required: "La respuesta privada debe reservarse antes de enviarla.",
};

function decision(reasonCode: SendPolicyReason, input?: SendPolicyInput): SendPolicyDecision {
  const allowed = reasonCode === "allowed";
  const expiry = allowed && input?.evidence ? permissionExpiry(input) : null;
  return { allowed, reasonCode, message: MESSAGES[reasonCode],
    validUntil: expiry,
    evidenceId: input?.evidence?.id ?? null };
}

function scopeMatches(input: SendPolicyInput): boolean {
  const { workspaceId, connection, identity, conversation, evidence } = input;
  if (connection.workspaceId !== workspaceId || identity.workspaceId !== workspaceId
    || identity.connectionId !== connection.connectionId
    || input.request.channel !== connection.channel
    || input.request.recipient !== identity.externalActorId) return false;
  for (const record of [conversation, evidence]) {
    if (record && (record.workspaceId !== workspaceId
      || record.connectionId !== connection.connectionId
      || record.externalActorId !== identity.externalActorId)) return false;
  }
  return !conversation || conversation.channel === connection.channel;
}

function verified(input: SendPolicyInput, capability: string): boolean {
  return validGrants(input, capability).length > 0;
}

function validGrants(input: SendPolicyInput, capability: string): SendPolicyInput["capabilities"] {
  return input.capabilities.filter((grant) => grant.capability === capability
    && grant.workspaceId === input.workspaceId && grant.connectionId === input.connection.connectionId
    && Date.parse(grant.verifiedAt) <= input.now
    && (grant.validUntil === undefined || Date.parse(grant.validUntil) > input.now));
}

function permissionExpiry(input: SendPolicyInput): string {
  const actions = [input.request.action, ...(input.evidence?.kind === "human_agent" ? ["human_agent"] : [])];
  const deadlines = actions.map((action) => Math.max(...validGrants(input, action).map(
    (grant) => grant.validUntil ? Date.parse(grant.validUntil) : Infinity,
  )));
  const evidenceExpiry = Date.parse(input.evidence!.validUntil);
  const deadline = Math.min(evidenceExpiry, ...deadlines);
  return deadline === evidenceExpiry ? input.evidence!.validUntil : new Date(deadline).toISOString();
}

function checkEvidence(input: SendPolicyInput): SendPolicyReason {
  const { evidence, request, connection, actor } = input;
  const { action } = request;
  if (!evidence) return "missing_evidence";
  if (Date.parse(evidence.occurredAt) > input.now) return "ineligible_evidence";
  if (Date.parse(evidence.validUntil) <= input.now) return "expired";
  if (action === "template") return connection.channel === "whatsapp"
    && evidence.kind === "approved_template" && evidence.templateName === request.templateName
    ? "allowed" : "ineligible_evidence";
  if (action === "private_reply" || action === "public_reply") return checkComment(input);
  if (connection.channel === "web") {
    return evidence.kind === "visitor_session" ? "allowed" : "ineligible_evidence";
  }
  if (evidence.kind === "human_agent") {
    return actor === "human" && connection.provider === "meta" && verified(input, "human_agent")
      ? "allowed" : "ineligible_evidence";
  }
  return evidence.kind === "inbound_message" ? "allowed" : "ineligible_evidence";
}

function checkComment(input: SendPolicyInput): SendPolicyReason {
  const { evidence, connection, request, phase } = input;
  if ((request.action !== "private_reply" && request.action !== "public_reply")
    || connection.provider !== "meta" || evidence?.kind !== "comment" || !evidence.eligible
    || request.commentId !== evidence.id) {
    return "ineligible_evidence";
  }
  if (request.action === "public_reply") return "allowed";
  if (evidence.privateReply === "sent" || (evidence.privateReply === "reserved"
    && evidence.reservedOperationId !== request.operationId)) return "duplicate_private_reply";
  if (phase === "send" && evidence.privateReply !== "reserved") return "reservation_required";
  return "allowed";
}

function checkState(input: SendPolicyInput): SendPolicyReason | null {
  const { conversation, actor } = input;
  if (!conversation) return input.request.action === "private_reply" || input.request.action === "public_reply"
    ? null : "identity_unknown";
  if (conversation.revision !== conversation.expectedRevision) return "stale_revision";
  if (conversation.state === "closed") return "closed";
  if (actor !== "human" && (!conversation.aiEnabled || conversation.state !== "ai_active")) {
    return "human_hold";
  }
  return null;
}

/** Pure policy for the new pipeline. Evaluate again with fresh server data just before POST. */
export function evaluateSendPolicy(value: unknown): SendPolicyDecision {
  const checked = sendPolicyInputSchema.safeParse(value);
  if (!checked.success) return decision("invalid_context");
  const input = checked.data;
  if (!scopeMatches(input)) return decision("scope_mismatch");
  const status = input.connection.status;
  if (status !== "ready") return decision(status === "revoked" ? "revoked"
    : status === "needs_permissions" ? "permission_missing" : "connection_not_ready");
  if (!verified(input, input.request.action)) return decision("unsupported_capability");
  const state = checkState(input);
  if (state) return decision(state);
  // WA STOP semantics remain in the legacy path: free replies differ from templates.
  if (input.optedOut && (input.connection.channel !== "whatsapp" || input.request.action === "template")) {
    return decision("opted_out");
  }
  return decision(checkEvidence(input), input);
}

/** Compatibility only: retains the existing WA null-window/admin behavior until cutover. */
export function legacyWhatsAppTextAllowed(
  windowExpiresAt: string | null, overrideAdmin: boolean, now: number,
): boolean {
  return windowExpiresAt === null || overrideAdmin || now <= Date.parse(windowExpiresAt);
}
