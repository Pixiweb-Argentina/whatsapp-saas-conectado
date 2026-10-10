"use client";

import { useState } from "react";
import { ArrowLeft, Search, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { DetailPanel } from "@/shared/components/detail-panel";

const CONTACTS = [
  { name: "Lucía · ejemplo", initials: "LU", channel: "Instagram", account: "@estudio.ejemplo", message: "Hola, me gustaría recibir la guía.", state: "Atención humana" },
  { name: "Martín · ejemplo", initials: "MA", channel: "WhatsApp", account: "Línea de atención · ejemplo", message: "¿Podemos coordinar una llamada?", state: "IA pausada" },
  { name: "Sofía · ejemplo", initials: "SO", channel: "Messenger", account: "Estudio · página de ejemplo", message: "Quisiera conocer los servicios.", state: "Atención humana" },
  { name: "Visitante · ejemplo", initials: "VI", channel: "Chat web", account: "sitio.example.invalid", message: "Tengo una consulta sobre mi pedido.", state: "Sin asignar" },
];

function PreviewThread({ index, onBack }: { index: number; onBack: () => void }) {
  const contact = CONTACTS[index];
  const [details, setDetails] = useState(false);
  return (
    <div className="flex min-w-0 flex-1">
    <section aria-label="Conversación de ejemplo" className="flex min-h-[480px] min-w-0 flex-1 flex-col bg-card">
      <header className="flex items-center gap-3 border-b border-border/30 p-4">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label="Volver a conversaciones" className="md:hidden"><ArrowLeft /></Button>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-bold">{contact.name}</h3>
          <p className="truncate text-xs text-muted-foreground">{contact.channel} · {contact.account}</p>
        </div>
        <Button variant="outline" onClick={() => setDetails(!details)}>Ficha</Button>
      </header>
      <div className="flex-1 space-y-5 bg-muted/30 p-5 sm:p-8">
        <p className="text-center text-xs text-muted-foreground">Conversación ficticia · vista de diseño</p>
        <p className="max-w-[85%] rounded-xl rounded-tl-sm border border-border/30 bg-card p-4 text-sm leading-relaxed">{contact.message}</p>
        <div className="ml-auto max-w-[85%] rounded-xl rounded-br-sm bg-primary p-4 text-sm leading-relaxed text-primary-foreground">
          ¡Hola! Te ayudo con tu consulta.
          <p className="mt-2 text-xs">Respuesta de ejemplo · operador</p>
        </div>
        <p className="text-center text-xs text-muted-foreground">La política de envío se verificará al conectar el canal.</p>
      </div>
      <div className="border-t border-border/30 p-4">
        <div className="flex gap-2">
          <Input aria-label="Mensaje de ejemplo" placeholder="Conectá el canal para responder" disabled />
          <Button disabled aria-label="Enviar mensaje (vista de diseño)"><Send /></Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Vista de diseño: no envía mensajes.</p>
      </div>
    </section>
    <DetailPanel open={details} onOpenChange={setDetails} title="Datos del contacto">
      <div className="space-y-4 p-5"><h3 className="font-bold">{contact.name}</h3><Badge variant="secondary">{contact.state}</Badge><p className="text-sm">{contact.channel}</p><p className="text-sm text-muted-foreground">Datos ficticios. Brevo sin conectar.</p></div>
    </DetailPanel>
    </div>
  );
}

export function OmnichannelInboxPreview() {
  const [selected, setSelected] = useState(0);
  const [mobileThread, setMobileThread] = useState(false);
  const [query, setQuery] = useState("");
  const contacts = CONTACTS.map((contact, index) => ({ ...contact, index }))
    .filter((c) => `${c.name} ${c.channel}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="flex overflow-hidden rounded-xl border border-border/40 bg-card">
      <aside aria-label="Conversaciones de ejemplo" className={cn("w-full shrink-0 border-r border-border/30 md:block md:w-[300px]", mobileThread && "hidden")}>
        <div className="space-y-4 p-5">
          <h2 className="text-xl font-extrabold">Conversaciones <span className="ml-1 text-sm font-medium text-muted-foreground">4</span></h2>
          <div className="relative"><Search className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" aria-hidden="true" />
            <Input className="pl-10" aria-label="Buscar conversaciones de ejemplo" placeholder="Buscar contacto o canal" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
          <p className="text-xs font-semibold text-primary">Todos los canales</p>
        </div>
        {contacts.map((contact) => (
          <button key={contact.channel} type="button" onClick={() => { setSelected(contact.index); setMobileThread(true); }}
            aria-pressed={selected === contact.index}
            className={cn("flex w-full gap-3 border-t border-border/20 p-5 text-left hover:bg-muted", selected === contact.index && "bg-primary/10")}>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-bold">{contact.initials}</span>
            <span className="min-w-0 space-y-1">
              <span className="block text-sm font-bold">{contact.name}</span>
              <span className="block text-xs font-semibold text-primary">{contact.channel}</span>
              <span className="block truncate text-xs text-muted-foreground">{contact.message}</span>
            </span>
          </button>
        ))}
        {!contacts.length && <p role="status" className="p-6 text-sm text-muted-foreground">Sin resultados. Probá con otro contacto o canal.</p>}
      </aside>
      <div className={cn("min-w-0 flex-1 md:flex", !mobileThread && "hidden")}>
        <PreviewThread index={selected} onBack={() => setMobileThread(false)} />
      </div>
    </div>
  );
}
