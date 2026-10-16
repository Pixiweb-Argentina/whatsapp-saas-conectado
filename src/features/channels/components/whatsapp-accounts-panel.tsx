"use client";

import { useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { registerWhatsAppAccountSchema, type RegisterWhatsAppAccount, type WhatsAppAccount } from "../types/whatsapp-account";
import { useWhatsAppAccounts } from "../hooks/use-whatsapp-accounts";
import { WhatsAppAccountChecks } from "./whatsapp-account-checks";

interface Props { workspaceId: string; canEdit: boolean }
interface FormProps { disabled: boolean; onSubmit: (input: RegisterWhatsAppAccount) => Promise<void> }

function AccountForm({ disabled, onSubmit }: FormProps) {
  const id = useId();
  const [provider, setProvider] = useState<"ycloud" | "kapso">("ycloud");
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = event.currentTarget; const values = new FormData(form);
    const parsed = registerWhatsAppAccountSchema.safeParse({ connectionId: crypto.randomUUID(), provider,
      externalAccountId: values.get("account"), displayName: values.get("label"), apiKey: values.get("apiKey"), signingSecret: values.get("signingSecret") });
    if (!parsed.success) { setError("Completá los campos; para YCloud usá el número internacional con +."); return; }
    setError(null); await onSubmit(parsed.data);
    for (const name of ["apiKey", "signingSecret"]) {
      const input = form.elements.namedItem(name); if (input instanceof HTMLInputElement) input.value = "";
    }
  };
  return <form onSubmit={submit} className="space-y-4" aria-label="Agregar cuenta de WhatsApp">
    <fieldset disabled={disabled} className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2"><Label htmlFor={`${id}-provider`}>Proveedor</Label>
        <select id={`${id}-provider`} value={provider} onChange={(event) => setProvider(event.target.value === "kapso" ? "kapso" : "ycloud")}
          className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"><option value="ycloud">YCloud</option><option value="kapso">Kapso</option></select></div>
      <div className="space-y-2"><Label htmlFor={`${id}-label`}>Nombre de la cuenta</Label><Input id={`${id}-label`} name="label" maxLength={80} placeholder="Ej. Ventas" required /></div>
      <div className="space-y-2 sm:col-span-2"><Label htmlFor={`${id}-account`}>{provider === "ycloud" ? "Número de WhatsApp" : "Phone Number ID de Kapso"}</Label>
        <Input id={`${id}-account`} name="account" maxLength={512} placeholder={provider === "ycloud" ? "+549…" : "ID del número"} required />
        <p className="text-xs text-muted-foreground">Usá una cuenta dedicada que tengas autorización para conectar.</p></div>
      <div className="space-y-2"><Label htmlFor={`${id}-key`}>API Key</Label><Input id={`${id}-key`} name="apiKey" type="password" autoComplete="new-password" maxLength={4096} required /></div>
      <div className="space-y-2"><Label htmlFor={`${id}-secret`}>Signing Secret del webhook</Label><Input id={`${id}-secret`} name="signingSecret" type="password" autoComplete="new-password" maxLength={4096} required /></div>
    </fieldset>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <p className="text-sm text-muted-foreground">Guardamos las credenciales cifradas. La cuenta queda pendiente de verificación; este paso no habilita recepción, respuestas ni automatizaciones.</p>
    <Button type="submit" disabled={disabled}>Guardar cuenta pendiente</Button>
  </form>;
}

function AccountRow({ workspaceId, account, canEdit, disabled, onRevoke }: {
  workspaceId: string; account: WhatsAppAccount; canEdit: boolean; disabled: boolean; onRevoke: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const label = account.status === "revoked" ? "Revocada" : !account.managed ? "Conexión existente"
    : account.status === "ready" ? "Cuenta preparada" : "Pendiente de verificación";
  return <li className="space-y-3 rounded-2xl border border-border p-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0">
      <p className="break-words font-semibold">{account.displayName || account.externalAccountId}</p>
      <p className="break-all text-sm text-muted-foreground">{account.provider === "ycloud" ? "YCloud" : "Kapso"} · {account.externalAccountId}</p>
      <p className="text-sm">{label}</p>
    </div>{canEdit && account.managed && account.credentialsStored && account.status !== "revoked" &&
      <Button type="button" variant="outline" disabled={disabled} onClick={() => setConfirming(true)}>Revocar cuenta</Button>}</div>
    {account.managed && account.provider === "ycloud" && <WhatsAppAccountChecks workspaceId={workspaceId} account={account} canEdit={canEdit} />}
    {confirming && <div className="space-y-3" role="group" aria-label="Confirmar revocación">
      <p className="text-sm">La cuenta dejará de estar disponible. Conservamos su historial; volver a conectarla requerirá una revisión.</p>
      <div className="flex flex-wrap gap-2"><Button type="button" variant="destructive" disabled={disabled} onClick={async () => { await onRevoke(); setConfirming(false); }}>Confirmar revocación</Button>
        <Button type="button" variant="outline" disabled={disabled} onClick={() => setConfirming(false)}>Cancelar</Button></div>
    </div>}
  </li>;
}

export function WhatsAppAccountsPanel({ workspaceId, canEdit }: Props) {
  const state = useWhatsAppAccounts(workspaceId);
  const [showForm, setShowForm] = useState(false);
  const disabled = state.busy || !!state.pending || !state.ready;
  return <section className="space-y-4" aria-label="Cuentas adicionales de WhatsApp">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-lg font-semibold">Cuentas de WhatsApp</h3>
      <div className="flex flex-wrap gap-2"><Button variant="outline" type="button" disabled={state.busy} onClick={() => void state.refresh()}>{state.pending ? "Revisar resultado" : "Actualizar cuentas"}</Button>
        {canEdit && <Button type="button" variant="outline" disabled={disabled} onClick={() => setShowForm(!showForm)}>{showForm ? "Cerrar formulario" : "Agregar otra cuenta"}</Button>}</div></div>
    <p className="text-sm text-muted-foreground">Cada cuenta adicional conserva sus propias credenciales. La conexión existente se administra en la sección principal.</p>
    {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
    {state.busy && <p role="status" className="text-sm">Guardando cambio…</p>}
    {!state.ready && !state.error && <p role="status" className="text-sm text-muted-foreground">Cargando cuentas…</p>}
    {state.ready && state.accounts.length === 0 && <p className="text-sm text-muted-foreground">Todavía no hay cuentas registradas.</p>}
    <ul className="space-y-3">{state.accounts.map((account) => <AccountRow key={account.id} workspaceId={workspaceId} account={account} canEdit={canEdit} disabled={disabled} onRevoke={() => state.revoke(account)} />)}</ul>
    {showForm && <AccountForm disabled={disabled} onSubmit={state.register} />}
  </section>;
}
