import { NextResponse } from "next/server";
import { channelRolloutWorkspaces } from "./channel-rollout";
import { enqueueHumanMessage } from "./human-message-producer";

interface HumanRequest {
  workspaceId: string;
  conversationId: string;
  senderUserId: string;
  body: string;
  operationId?: string;
  deliveryMode?: "legacy" | "queue";
}

/** null explicitly selects legacy. A pinned queue attempt NEVER falls back. */
export async function humanMessageResponse(input: HumanRequest): Promise<NextResponse | null> {
  try {
    const enabled = channelRolloutWorkspaces("human").includes(input.workspaceId);
    if (!enabled && input.deliveryMode !== "queue") return null;
    if (!enabled) return NextResponse.json({ error: "El envío en cola está pausado. Conservá el intento y reintentá más tarde." }, { status: 503 });
    if (input.deliveryMode === "legacy") return NextResponse.json(
      { error: "Cambió el modo de envío. Actualizá la conversación antes de enviar." }, { status: 409 });
    if (!input.operationId) return NextResponse.json({ error: "Actualizá la conversación para iniciar el envío." }, { status: 400 });
    const result = await enqueueHumanMessage({ workspaceId: input.workspaceId, conversationId: input.conversationId,
      senderUserId: input.senderUserId, operationId: input.operationId, body: input.body });
    return NextResponse.json({ ok: true, ...result }, { status: ["pending", "leased", "sending"].includes(result.state) ? 202 : 200 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "HUMAN_ENQUEUE_UNAVAILABLE";
    if (code === "HUMAN_FORBIDDEN" || code === "HUMAN_NOT_FOUND") return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
    if (code === "HUMAN_CONFLICT") return NextResponse.json({ error: "Este intento ya corresponde a otro mensaje." }, { status: 409 });
    if (code === "HUMAN_CONTEXT_UNAVAILABLE") return NextResponse.json(
      { error: "No se verificó permiso, destinatario o ventana de envío. Revisá la cuenta y la conversación." }, { status: 422 });
    return NextResponse.json({ error: "No se pudo confirmar el intento. Reintentá sin cambiar el mensaje para consultar la misma operación." }, { status: 503 });
  }
}
