"use client";

import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { accountPermissionReviewSchema, accountVerificationInputSchema, type AccountPermissionReview } from "../types/whatsapp-account-checks";
import { ycloudVerificationRecordSchema, type YCloudVerificationRecord } from "../types/ycloud-verification";
import type { WhatsAppAccount } from "../types/whatsapp-account";

interface Props { workspaceId: string; account: WhatsAppAccount; canEdit: boolean }
interface Result { review: AccountPermissionReview | null; verification: YCloudVerificationRecord | null }
interface Pending { target: "verification" | "permissions"; body: unknown }
const blockers: Record<string, string> = {
  account_mismatch: "La cuenta no coincide con su comprobación.", account_revoked: "La cuenta fue revocada.",
  unsupported_provider: "Este proveedor todavía no tiene verificación de permisos disponible.",
  verification_required: "Falta una verificación completa y vigente de la cuenta y el webhook.",
  public_origin_missing: "Falta configurar el origen público estable del SaaS.",
  stable_callback_required: "El webhook debe apuntar a la URL estable indicada para esta cuenta.",
  delivery_proof_required: "Falta una prueba de texto entregado, conciliada para esta cuenta.",
  unmanaged_capabilities: "La cuenta tiene permisos previos que requieren revisión.",
};
async function readResult(base: string): Promise<Result> {
  const responses = await Promise.all([fetch(`${base}/verification`, { cache: "no-store" }), fetch(`${base}/permissions`, { cache: "no-store" })]);
  if (responses.some((r) => !r.ok)) throw new Error("ACCOUNT_REVIEW_FAILED");
  const [proof, permission] = await Promise.all(responses.map((r) => r.json())) as [{ verification?: unknown }, { review?: unknown }];
  return { verification: proof.verification === null ? null : ycloudVerificationRecordSchema.parse(proof.verification),
    review: permission.review === null ? null : accountPermissionReviewSchema.parse(permission.review) };
}
function useAccountChecks(base: string) {
  const [result, setResult] = useState<Result | null>(null), [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null), [uncertain, setUncertain] = useState(false);
  const lock = useRef(false), pending = useRef<Pending | null>(null), readRevision = useRef(0);
  const refresh = async () => {
    const revision = ++readRevision.current; setReading(true);
    try { const next = await readResult(base); if (revision === readRevision.current) { setResult(next); setError(null); } }
    catch { if (revision === readRevision.current) setError("No pudimos actualizar la revisión. Volvé a consultar el resultado."); }
    finally { if (revision === readRevision.current) setReading(false); }
  };
  const mutate = async (change: Pending) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null); pending.current = change;
    readRevision.current++; let rejected = false;
    try {
      const response = await fetch(`${base}/${change.target}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(change.body) });
      if (response.ok || [400, 401, 403].includes(response.status)) {
        pending.current = null; setUncertain(false);
        rejected = !response.ok;
      } else { setUncertain(true); }
    } catch { setUncertain(true); }
    finally { await refresh(); if (rejected) setError("No se aplicó el cambio. Revisá los datos y tus permisos."); lock.current = false; setBusy(false); }
  };
  return { result, busy: busy || reading, error, uncertain, refresh, mutate,
    retry: () => pending.current ? mutate(pending.current) : Promise.resolve() };
}
function AccountProofForm({ id, disabled, onVerify }: { id: string; disabled: boolean; onVerify: (value: unknown) => Promise<void> }) {
  const [endpointId, setEndpointId] = useState("");
  return <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); const value = accountVerificationInputSchema.safeParse({ endpointId }); if (value.success) void onVerify(value.data); }}>
    <Label htmlFor={id}>ID del webhook de esta cuenta</Label><Input id={id} value={endpointId} onChange={(event) => setEndpointId(event.target.value)} maxLength={128} disabled={disabled} required />
    <Button type="submit" variant="outline" disabled={disabled || !accountVerificationInputSchema.safeParse({ endpointId }).success}>Verificar cuenta y webhook</Button>
    <p className="text-xs text-muted-foreground">La comprobación sólo consulta el proveedor. No envía mensajes ni modifica el webhook.</p>
  </form>;
}
export function WhatsAppAccountChecks({ workspaceId, account, canEdit }: Props) {
  const id = useId(), [acknowledged, setAcknowledged] = useState(false);
  const state = useAccountChecks(`/api/workspace/${workspaceId}/whatsapp-accounts/${account.id}`);
  const review = state.result?.review, proof = state.result?.verification;
  const disabled = state.busy || state.uncertain || account.status === "revoked";
  const permission = async (action: "grant" | "revoke") => {
    if (!review || (action === "grant" && (!acknowledged || !review.canGrant || !review.verificationCheckedAt))) return;
    await state.mutate({ target: "permissions", body: { connectionId: account.id, operationId: crypto.randomUUID(), action,
      connectionUpdatedAt: review.connectionUpdatedAt, ...(action === "grant" ? { acknowledgeTextPermission: true, verificationCheckedAt: review.verificationCheckedAt } : {}) } });
    setAcknowledged(false);
  };
  return <section className="space-y-3 border-t border-border pt-3" aria-label={`Verificación de ${account.displayName || account.externalAccountId}`}>
    <Button type="button" variant="outline" disabled={state.busy} onClick={() => void state.refresh()}>Revisar verificación y permiso</Button>
    {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
    {state.busy && <p role="status" className="text-sm">Revisando cuenta…</p>}
    {review && <div className="space-y-2 text-sm">
      <p>{review.current ? "Permiso local de texto vigente" : "Envío de texto pendiente de autorización"}</p>
      {review.validUntil && <p>Vence: {new Date(review.validUntil).toLocaleString("es-AR")}</p>}
      {review.callbackUrl && <div><p>URL del webhook para esta cuenta:</p><code className="block break-all text-xs">{review.callbackUrl}</code></div>}
      <ul className="space-y-1">{review.blockers.map((key) => <li key={key}>{blockers[key]}</li>)}</ul>
    </div>}
    {state.result && <p className="text-sm text-muted-foreground">{proof?.current && proof.report.providerRead === "complete" && Object.values(proof.report.checks).every(Boolean)
      ? "Cuenta y webhook verificados. Esta comprobación no concede permiso de envío." : "La cuenta todavía necesita una comprobación completa y vigente."}</p>}
    {canEdit && review && <>
      <AccountProofForm id={`${id}-endpoint`} disabled={disabled || !review.callbackUrl} onVerify={(body) => state.mutate({ target: "verification", body })} />
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} disabled={disabled || !review.canGrant} />Confirmo el permiso local de texto para esta cuenta.</label>
      <div className="flex flex-wrap gap-2"><Button type="button" disabled={disabled || !review.canGrant || !acknowledged} onClick={() => void permission("grant")}>Autorizar texto</Button>
        <Button type="button" variant="outline" disabled={disabled || !review.canRevoke} onClick={() => void permission("revoke")}>Revocar permiso de texto</Button></div>
      <p className="text-xs text-muted-foreground">No activa IA ni campañas. Los envíos siguen sujetos a las restricciones de la cuenta y al consentimiento del contacto.</p>
    </>}
    {state.uncertain && <div role="alert" className="space-y-2 text-sm"><p>El resultado no está confirmado. Consultá el estado; no repetimos cambios automáticamente.</p>
      <Button type="button" variant="outline" disabled={state.busy} onClick={() => void state.retry()}>Reintentar la misma operación</Button></div>}
  </section>;
}
