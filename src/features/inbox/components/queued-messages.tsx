"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { ConversationQueue } from "../types/queued-message";

const STATUS = {
  pending: "En cola · todavía no enviado",
  leased: "Preparando envío · todavía no enviado",
  cancelled: "Cancelado · no enviado",
  dead_letter: "No enviado · se agotaron los intentos de preparación",
};

export function QueuedMessages({ queue, represented = [] }: {
  queue: ConversationQueue; represented?: string[];
}) {
  const router = useRouter();
  const active = queue.messages.some((message) => ["pending", "leased"].includes(message.state));
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 10000);
    return () => clearInterval(timer);
  }, [active, router]);
  const messages = queue.messages.filter((message) => !represented.includes(message.operationId));
  if (!messages.length && !queue.error && !queue.more) return null;
  return (
    <section aria-label="Mensajes en cola" className="space-y-2 border-t border-dashed border-border pt-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Envíos pendientes y no enviados</p>
        <Button size="sm" variant="ghost" onClick={() => router.refresh()}>Actualizar envíos</Button>
      </div>
      {queue.error && <p role="status" className="text-sm text-muted-foreground">
        No pudimos consultar la cola. Actualizá para comprobar los envíos.
      </p>}
      {queue.more && <p className="text-xs text-muted-foreground">Se muestran los últimos 50 envíos de la cola.</p>}
      {messages.map((message) => (
        <article key={message.operationId} className="ml-auto max-w-[85%] rounded-xl border border-border bg-muted/40 p-3">
          <p className="whitespace-pre-wrap break-words text-sm">{message.body}</p>
          <p className="mt-2 text-xs text-muted-foreground">{STATUS[message.state]}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {message.actor === "human" ? "Operador" : message.actor === "ai" ? "IA" : "Automatización"}
            {" · "}<time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString("es-AR", {
              timeZone: "America/Argentina/Buenos_Aires", hour12: false,
            })}</time>
          </p>
        </article>
      ))}
    </section>
  );
}
