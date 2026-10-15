"use client";

import { useEffect, useId, useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { YCloudPermissionsPanel } from "./ycloud-permissions-panel";
import { validYCloudCallback, YCLOUD_CHECKS, ycloudVerificationRecordSchema,
  type YCloudVerificationRecord } from "@/features/channels/types/ycloud-verification";

const responseSchema = z.object({ verification: ycloudVerificationRecordSchema.nullable() });
const CHECK_LABELS = { api_access: "Acceso a la API", connected_number: "Número conectado en YCloud",
  webhook_active: "Webhook activo", webhook_url: "URL del webhook coincidente",
  webhook_events: "Eventos de mensajes y comprobantes", webhook_secret: "Signing Secret coincidente" };
interface Props { workspaceId: string; canEdit: boolean }

function useVerification(workspaceId: string) {
  const generation = useRef(0);
  const [record, setRecord] = useState<YCloudVerificationRecord | null>(null);
  const [endpointId, setEndpointId] = useState(""); const [callbackUrl, setCallbackUrl] = useState("");
  const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const url = `/api/workspace/${workspaceId}/integrations/ycloud/verification`;
  useEffect(() => {
    const started = ++generation.current;
    const controller = new AbortController();
    void readVerification(url, controller.signal).then((value) => {
      if (controller.signal.aborted) return;
      setRecord(value); setEndpointId(value?.input.endpointId ?? ""); setCallbackUrl(value?.input.callbackUrl ?? "");
    }).catch(() => {
      if (!controller.signal.aborted) setError("No se pudo leer la verificación. Recargá Ajustes para volver a intentar.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); generation.current = started + 1; };
  }, [url]);
  async function verify() {
    const started = generation.current;
    setBusy(true); setError("");
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpointId: endpointId.trim(), callbackUrl: callbackUrl.trim() }) });
      const raw: unknown = await res.json();
      if (started !== generation.current) return;
      if (!res.ok) {
        const parsed = z.object({ error: z.string() }).safeParse(raw);
        throw new Error(parsed.success ? parsed.data.error : "No se pudo completar la verificación");
      }
      setRecord(responseSchema.parse(raw).verification);
    } catch (e) {
      if (started === generation.current) { setRecord(null); setError(e instanceof Error ? e.message : "No se pudo completar la verificación"); }
    } finally { if (started === generation.current) setBusy(false); }
  }
  return { record, endpointId, setEndpointId, callbackUrl, setCallbackUrl, busy, loading, error, verify };
}

async function readVerification(url: string, signal: AbortSignal): Promise<YCloudVerificationRecord | null> {
  const res = await fetch(url, { cache: "no-store", signal });
  if (!res.ok) throw new Error("VERIFICATION_UNAVAILABLE");
  return responseSchema.parse(await res.json()).verification;
}

function VerificationReport({ record, endpointId, callbackUrl }: {
  record: YCloudVerificationRecord; endpointId: string; callbackUrl: string;
}) {
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    const remaining = Math.max(0, Date.parse(record.report.checkedAt) + 86_400_000 - Date.now());
    const timer = setTimeout(() => setExpired(true), remaining);
    return () => clearTimeout(timer);
  }, [record.report.checkedAt]);
  const edited = record && (record.input.endpointId !== endpointId.trim() || record.input.callbackUrl !== callbackUrl.trim());
  const current = record.current && !edited && !expired;
  const allPassed = record && YCLOUD_CHECKS.every((check) => record.report.checks[check]) && record.report.providerRead === "complete";
  return <>
    <p className="font-medium">{!current ? "Verificación desactualizada: volvé a comprobar la cuenta."
      : allPassed ? "Cuenta y configuración del webhook verificadas" : "La cuenta tiene comprobaciones pendientes"}</p>
    <p className="text-xs text-muted-foreground">Última comprobación: {new Date(record.report.checkedAt).toLocaleString("es-AR", { timeZone: "UTC", hour12: false })} UTC · Vigencia máxima: 24 horas.</p>
    <ul className="grid gap-2 sm:grid-cols-2">{YCLOUD_CHECKS.map((check) => <li key={check}>
      {current && record.report.checks[check] ? "✓" : "○"} {CHECK_LABELS[check]}: {current ? record.report.checks[check] ? "verificado" : "pendiente" : "volver a verificar"}
    </li>)}</ul>
    {record.report.providerRead === "incomplete" && <p>YCloud no devolvió toda la información necesaria. Volvé a intentar.</p>}
    <p>{record.report.destination === "temporary" ? "El destino usa un túnel temporal. Falta una URL estable para completar el alta."
      : "La URL HTTPS coincide; falta validar su publicación estable y la recepción de eventos."}</p>
  </>;
}

export function YCloudVerificationPanel({ workspaceId, canEdit }: Props) {
  const prefix = useId();
  const { record, endpointId, setEndpointId, callbackUrl, setCallbackUrl, busy, loading, error, verify } = useVerification(workspaceId);
  const valid = /^[a-zA-Z0-9_-]{1,128}$/.test(endpointId.trim()) && validYCloudCallback(callbackUrl.trim(), workspaceId);
  return (
    <><section aria-labelledby={`${prefix}-title`} className="space-y-4 rounded-xl border bg-card p-4 sm:p-6">
      <div>
        <h2 id={`${prefix}-title`} className="font-display text-base font-medium">Verificación de cuenta YCloud</h2>
        <p className="mt-1 text-sm text-muted-foreground">Comprobá el número y el webhook con las credenciales guardadas.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="min-w-0 space-y-2">
          <Label htmlFor={`${prefix}-endpoint`}>ID del webhook</Label>
          <Input id={`${prefix}-endpoint`} value={endpointId} onChange={(e) => setEndpointId(e.target.value)}
            disabled={!canEdit || busy || loading} maxLength={128} autoComplete="off" placeholder="ID de Webhooks en YCloud" />
        </div>
        <div className="min-w-0 space-y-2">
          <Label htmlFor={`${prefix}-callback`}>URL HTTPS del webhook</Label>
          <Input id={`${prefix}-callback`} type="url" value={callbackUrl} onChange={(e) => setCallbackUrl(e.target.value)}
            disabled={!canEdit || busy || loading} maxLength={500} autoComplete="off" placeholder="https://tu-dominio/api/webhooks/ycloud?wsid=…" />
        </div>
      </div>
      <p className="break-all text-xs text-muted-foreground">La URL debe terminar en /api/webhooks/ycloud?wsid={workspaceId}. No pegues claves ni secretos acá.</p>
      <Button onClick={() => void verify()} disabled={!canEdit || busy || loading || !valid}>
        {busy ? "Verificando…" : "Verificar cuenta y webhook"}
      </Button>
      {!canEdit && <p className="text-xs text-muted-foreground">Solo un administrador puede ejecutar y guardar la verificación.</p>}
      <div aria-live="polite" aria-busy={busy || loading} className="space-y-3 text-sm">
        {error && <p role="alert" className="text-destructive">{error}</p>}
        {loading ? <p>Cargando verificación…</p> : !record && !error ? <p className="text-muted-foreground">Todavía no hay una verificación guardada.</p> : null}
        {record && <VerificationReport key={record.report.checkedAt} record={record} endpointId={endpointId} callbackUrl={callbackUrl} />}
        <p className="rounded-lg bg-muted p-3 text-muted-foreground">Esta comprobación no habilita envíos ni IA. El permiso de envío, el consentimiento del contacto y las pruebas de recepción se validan por separado.</p>
      </div>
    </section>
    {!loading && <YCloudPermissionsPanel key={record?.report.checkedAt ?? "unverified"} workspaceId={workspaceId} canEdit={canEdit} />}</>
  );
}
