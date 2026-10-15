"use client";

import { useEffect, useId, useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { ycloudPermissionReviewSchema, type YCloudPermissionMutation,
  type YCloudPermissionReview } from "@/features/channels/types/ycloud-permissions";

const responseSchema = z.object({ review: ycloudPermissionReviewSchema.nullable() });
const BLOCKERS = { account_mismatch: "La cuenta vinculada no coincide con el número guardado.",
  account_revoked: "La cuenta está revocada; primero debe reconectarse.",
  verification_required: "Falta una verificación completa y vigente de la cuenta y el webhook.",
  public_origin_missing: "Falta configurar una URL pública estable en el servidor.",
  stable_callback_required: "El webhook debe coincidir con la URL pública estable del servidor.",
  delivery_proof_required: "Falta una entrega de texto confirmada para esta cuenta en los últimos 30 días.",
  unmanaged_capabilities: "La cuenta tiene permisos de otro flujo; requieren una revisión antes de reemplazarlos." };

async function readReview(url: string, signal?: AbortSignal): Promise<YCloudPermissionReview | null> {
  const response = await fetch(url, { cache: "no-store", signal });
  if (!response.ok) throw new Error("PERMISSION_REVIEW_UNAVAILABLE");
  return responseSchema.parse(await response.json()).review;
}

function usePermissionReview(workspaceId: string) {
  const [review, setReview] = useState<YCloudPermissionReview | null>(null);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const mounted = useRef(false); const url = `/api/workspace/${workspaceId}/integrations/ycloud/permissions`;
  useEffect(() => {
    mounted.current = true; const controller = new AbortController();
    void readReview(url, controller.signal).then((value) => {
      if (!controller.signal.aborted) setReview(value);
    }).catch(() => { if (!controller.signal.aborted) setError("No se pudo leer el permiso. Actualizá la revisión."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { mounted.current = false; controller.abort(); };
  }, [url]);
  async function refresh() {
    setLoading(true); setError("");
    try { const value = await readReview(url); if (mounted.current) setReview(value); }
    catch { if (mounted.current) { setReview(null); setError("No se pudo leer el permiso. Volvé a intentar."); } }
    finally { if (mounted.current) setLoading(false); }
  }
  async function change(action: "grant" | "revoke") {
    if (!review) return; setBusy(true); setError("");
    const common = { connectionId: review.connectionId, connectionUpdatedAt: review.connectionUpdatedAt, operationId: crypto.randomUUID() };
    const body: YCloudPermissionMutation = action === "grant"
      ? { ...common, action, verificationCheckedAt: review.verificationCheckedAt!, acknowledgeTextPermission: true } : { ...common, action };
    try {
      const result = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!result.ok) throw new Error("CHANGE_UNCONFIRMED");
      const value = responseSchema.parse(await result.json()).review; if (mounted.current) setReview(value);
    } catch {
      // Reconcile even when a mutation's response was lost. Never retry a grant blindly.
      try { const value = await readReview(url); if (mounted.current) setReview(value); }
      catch { if (mounted.current) setReview(null); }
      if (mounted.current) setError("No pudimos confirmar la solicitud. Revisá el estado actualizado antes de volver a intentar.");
    } finally { if (mounted.current) setBusy(false); }
  }
  return { review, loading, busy, error, refresh, change };
}

function PermissionStatus({ review }: { review: YCloudPermissionReview }) {
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    if (!review.validUntil) return;
    const timer = setTimeout(() => setExpired(true), Math.max(0, Date.parse(review.validUntil) - Date.now()));
    return () => clearTimeout(timer);
  }, [review.validUntil]);
  return <div className="space-y-2 text-sm">
    <p className="font-medium">{review.current && !expired ? "Permiso de texto vigente"
      : review.managed ? "Permiso de texto vencido o pendiente de revisión" : "Sin permiso de texto de este flujo"}</p>
    {review.validUntil && <p className="text-muted-foreground">Vence: {new Date(review.validUntil).toLocaleString("es-AR", { timeZone: "UTC", hour12: false })} UTC.</p>}
    {review.blockers.length > 0 && <ul className="list-disc space-y-1 pl-5">{review.blockers.map((code) => <li key={code}>{BLOCKERS[code]}</li>)}</ul>}
  </div>;
}

export function YCloudPermissionsPanel({ workspaceId, canEdit }: { workspaceId: string; canEdit: boolean }) {
  const title = useId(); const [acknowledged, setAcknowledged] = useState(false);
  const { review, loading, busy, error, refresh, change } = usePermissionReview(workspaceId);
  async function apply(action: "grant" | "revoke") { setAcknowledged(false); await change(action); }
  return <section aria-labelledby={title} className="space-y-4 rounded-xl border bg-card p-4 sm:p-6">
    <div>
      <h2 id={title} className="font-display text-base font-medium">Permiso de texto de WhatsApp</h2>
      <p className="mt-1 text-sm text-muted-foreground">Autorización del nuevo motor de canales para esta cuenta. Vence junto con la verificación, como máximo en 24 horas.</p>
    </div>
    <div aria-live="polite" aria-busy={loading || busy}>
      {loading ? <p className="text-sm">Revisando permiso…</p> : review
        ? <PermissionStatus key={`${review.connectionUpdatedAt}:${review.validUntil}`} review={review} />
        : !error && <p className="text-sm text-muted-foreground">Primero debe vincularse la cuenta de YCloud con su número verificado.</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
    {canEdit && review?.canGrant && <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} disabled={busy || loading} className="mt-1 accent-primary" />
      Autorizo el uso del motor para mensajes de texto de esta cuenta durante la vigencia indicada.
    </label>}
    <div className="flex flex-wrap gap-2">
      <Button disabled={!canEdit || !review?.canGrant || !acknowledged || busy || loading} onClick={() => void apply("grant")}>
        {review?.managed ? "Renovar permiso de texto" : "Autorizar permiso de texto"}
      </Button>
      <Button variant="outline" disabled={!canEdit || !review?.canRevoke || busy || loading} onClick={() => void apply("revoke")}>Revocar permiso</Button>
      <Button variant="ghost" disabled={busy || loading} onClick={() => void refresh()}>Actualizar revisión</Button>
    </div>
    {!canEdit && <p className="text-xs text-muted-foreground">Solo un administrador puede autorizar o revocar este permiso.</p>}
    <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">El permiso no activa la IA ni el transporte. Cada mensaje sigue sujeto al consentimiento, la identidad y la ventana de atención. Revocar bloquea nuevos envíos de este motor; los ya iniciados pueden completar.</p>
  </section>;
}
