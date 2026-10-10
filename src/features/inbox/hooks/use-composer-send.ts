"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { composerAttempt, type ComposerAttempt } from "../lib/composer-attempt";

export function useComposerSend(conversationId: string, deliveryMode: "legacy" | "queue",
  onSent: (body: string) => void) {
  const attempt = useRef<ComposerAttempt | null>(null);
  const busy = useRef(false);
  const [sending, setSending] = useState(false);
  const router = useRouter();

  async function send(body: string): Promise<void> {
    if (!body || busy.current) return;
    busy.current = true; setSending(true);
    try {
      const current = composerAttempt(attempt.current, conversationId, body, deliveryMode);
      attempt.current = current;
      const response = await fetch(`/api/conversations/${conversationId}/messages`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, operationId: current.operationId, deliveryMode: current.deliveryMode }),
      });
      const data: { ok?: boolean; error?: string; state?: string } = await response.json();
      if (!response.ok || data.ok !== true) { toast.error(data.error ?? "No se pudo confirmar el envío."); return; }
      if (current.deliveryMode === "queue") {
        if (["unknown", "rejected", "cancelled", "dead_letter"].includes(data.state ?? "")) {
          toast.warning("El intento ya está registrado y no se reenviará. Revisá su estado antes de crear otro.");
        } else toast.success(data.state === "accepted" ? "Envío registrado" : "Mensaje en cola. Todavía no se confirmó la entrega.");
      }
      attempt.current = null; onSent(body); router.refresh();
    } catch {
      toast.error(attempt.current?.deliveryMode === "queue"
        ? "No se pudo confirmar el intento. Reintentá sin cambiar el texto para consultar la misma operación."
        : "No se pudo confirmar el envío. Revisá el hilo antes de reintentar.");
    } finally { busy.current = false; setSending(false); }
  }
  return { send, sending };
}
