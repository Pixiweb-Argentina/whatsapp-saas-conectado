"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ACCOUNT_TRIAL_BODY, type AccountTrialReview, type AccountTrialMutation } from "../types/account-trial";
import { useAccountTrial } from "../hooks/use-account-trial";

const BLOCKERS: Record<string, string> = {
  account_mismatch: "La cuenta no coincide con su comprobación.", account_revoked: "La cuenta está revocada.",
  unsupported_provider: "El proveedor no admite esta prueba.", verification_required: "Primero verificá la cuenta y su webhook.",
  public_origin_missing: "Falta el dominio HTTPS estable del SaaS.", stable_callback_required: "Revisá la URL estable del webhook.",
  unmanaged_capabilities: "Los permisos existentes requieren revisión.", initial_trial_only: "La prueba inicial requiere una cuenta pendiente y sin permisos de envío.",
};
const STATES: Record<string, string> = { pending: "Preparada; todavía no enviada", leased: "Prueba en preparación; revisá el resultado",
  sending: "Envío iniciado; esperá el resultado", accepted: "Aceptada por el proveedor", unknown: "Resultado incierto; no la reenvíes",
  rejected: "Rechazada por el proveedor", cancelled: "Prueba retirada o cancelada", dead_letter: "Prueba detenida" };
type Mutate = (input: AccountTrialMutation) => Promise<void>;

function TrialForm({ review, disabled, mutate }: { review: AccountTrialReview; disabled: boolean; mutate: Mutate }) {
  const id = useId(), [selected, setSelected] = useState(""), [confirmed, setConfirmed] = useState(false);
  const candidate = review.candidates.find((row) => row.conversationId === selected);
  const unresolved = review.latest && !["cancelled", "rejected"].includes(review.latest.state);
  const blocked = disabled || !review.dispatchEnabled || review.blockers.length > 0 || !!unresolved;
  return <form className="space-y-3" onSubmit={(event) => {
    event.preventDefault();
    if (!candidate || !confirmed || blocked || !review.verificationCheckedAt) return;
    void mutate({ action: "authorize", operationId: crypto.randomUUID(), conversationId: candidate.conversationId,
      recipient: candidate.recipient, connectionUpdatedAt: review.connectionUpdatedAt,
      verificationCheckedAt: review.verificationCheckedAt, acknowledgeOneMessage: true });
    setConfirmed(false);
  }}>
    <Label htmlFor={`${id}-recipient`}>Número propio para la prueba</Label>
    <select id={`${id}-recipient`} value={selected} required disabled={blocked} onChange={(event) => { setSelected(event.target.value); setConfirmed(false); }}
      className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm">
      <option value="">Elegí una conversación recibida</option>
      {review.candidates.map((row) => <option key={row.conversationId} value={row.conversationId}>{row.name} · {row.recipient}</option>)}
    </select>
    <p className="text-xs text-muted-foreground">Primero escribí desde ese número a esta cuenta. La conversación debe estar en atención humana, con un texto recibido dentro de las últimas 24 horas.</p>
    <blockquote className="rounded-xl bg-muted p-3 text-sm">{ACCOUNT_TRIAL_BODY}</blockquote>
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={blocked || !candidate}
      onChange={(event) => setConfirmed(event.target.checked)} />Confirmo que este número es mío o tengo autorización para probar con él. Autorizo únicamente el mensaje mostrado, con vigencia máxima de diez minutos.</label>
    <Button type="submit" variant="outline" disabled={blocked || !candidate || !confirmed}>Preparar una prueba única</Button>
    <p className="text-xs text-muted-foreground">Preparar no envía el mensaje. El consentimiento general del contacto, la IA y las campañas conservan su configuración.</p>
  </form>;
}
function TrialResult({ latest, disabled, enabled, mutate }: {
  latest: NonNullable<AccountTrialReview["latest"]>; disabled: boolean; enabled: boolean; mutate: Mutate;
}) {
  return <div className="space-y-2 rounded-xl border border-border p-3 text-sm" role="group" aria-label="Resultado de la prueba única">
    <p className="break-all font-medium">Destino: {latest.recipient}</p><p>{latest.body}</p>
    <p role="status">{STATES[latest.state] ?? "Revisá el resultado"}{latest.revoked ? " · autorización retirada" : ""}</p>
    {latest.deliveryStatus && <p>Comprobante: {latest.deliveryStatus === "delivered" ? "Entregado" : latest.deliveryStatus === "read" ? "Leído" : latest.deliveryStatus === "sent" ? "Enviado; falta confirmar entrega" : "Pendiente de conciliación"}</p>}
    <p>Vence: {new Date(latest.validUntil).toLocaleString("es-AR")}</p>
    <div className="flex flex-wrap gap-2">
      <Button type="button" disabled={disabled || !enabled || !latest.canSend}
        onClick={() => void mutate({ action: "send", operationId: latest.operationId, acknowledgeSend: true })}>Enviar esta única prueba</Button>
      <Button type="button" variant="outline" disabled={disabled || latest.revoked}
        onClick={() => void mutate({ action: "revoke", operationId: latest.operationId })}>Retirar autorización de prueba</Button>
    </div>
    <p className="text-xs text-muted-foreground">No hay reenvíos automáticos. Retirar la autorización evita nuevos intentos; un envío ya iniciado puede completarse. La entrega confirmada permite volver a revisar el permiso de texto de esta cuenta.</p>
  </div>;
}
export function WhatsAppAccountTrial({ workspaceId, connectionId, canEdit }: { workspaceId: string; connectionId: string; canEdit: boolean }) {
  const state = useAccountTrial(`/api/workspace/${workspaceId}/whatsapp-accounts/${connectionId}/trial`);
  return <section className="space-y-3 border-t border-border pt-3" aria-label="Primera prueba de entrega">
    <h4 className="font-semibold">Primera prueba de entrega</h4>
    <Button type="button" variant="outline" disabled={state.busy} onClick={() => void state.read()}>Revisar prueba y destinos</Button>
    {state.busy && <p role="status" className="text-sm">Revisando prueba…</p>}
    {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
    {state.review && <>
      {!state.review.dispatchEnabled && <p className="text-sm text-muted-foreground">La prueba todavía no está habilitada para esta cuenta.</p>}
      <ul className="space-y-1 text-sm">{state.review.blockers.map((key) => <li key={key}>{BLOCKERS[key] ?? "Revisá los permisos de esta cuenta."}</li>)}</ul>
      {canEdit && <TrialForm review={state.review} disabled={state.busy || state.uncertain} mutate={state.mutate} />}
      {state.review.latest && (canEdit
        ? <TrialResult latest={state.review.latest} disabled={state.busy || state.uncertain} enabled={state.review.dispatchEnabled} mutate={state.mutate} />
        : <p role="status" className="text-sm">{STATES[state.review.latest.state] ?? "Revisá el resultado"}</p>)}
    </>}
    {state.uncertain && canEdit && <Button type="button" variant="outline" disabled={state.busy} onClick={() => void state.retry()}>Revisar/reintentar la misma operación</Button>}
  </section>;
}
