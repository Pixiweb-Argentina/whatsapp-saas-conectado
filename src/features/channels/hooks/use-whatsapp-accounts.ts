"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { whatsAppAccountsSchema, type RegisterWhatsAppAccount, type WhatsAppAccount } from "../types/whatsapp-account";

interface PendingChange { id: string; action: "register" | "revoke" }
async function readRows(url: string, signal?: AbortSignal): Promise<WhatsAppAccount[]> {
  const response = await fetch(url, { cache: "no-store", signal });
  if (!response.ok) throw new Error("read_failed");
  const json: unknown = await response.json();
  return whatsAppAccountsSchema.parse((json as { accounts?: unknown })?.accounts);
}

export function useWhatsAppAccounts(workspaceId: string) {
  const [accounts, setAccounts] = useState<WhatsAppAccount[]>([]);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState<PendingChange | null>(null);
  const pendingRef = useRef<PendingChange | null>(null);
  const [error, setError] = useState<string | null>(null);
  const url = `/api/workspace/${workspaceId}/whatsapp-accounts`;
  const acceptRows = useCallback((result: WhatsAppAccount[]) => {
      setAccounts(result); setReady(true); setError(null);
      const change = pendingRef.current;
      const row = result.find((account) => account.id === change?.id);
      if (change && (change.action === "revoke" ? row?.status === "revoked" : row?.managed && row.credentialsStored)) {
        pendingRef.current = null; setPending(null);
      } else if (change) setError("El cambio todavía no está confirmado. Revisá el resultado; no lo reenviamos automáticamente.");
  }, []);
  const refresh = useCallback(async () => {
    try { acceptRows(await readRows(url)); }
    catch { setReady(false); setError("No pudimos actualizar las cuentas. Volvé a revisar la lista."); }
  }, [url, acceptRows]);
  useEffect(() => {
    const controller = new AbortController();
    void readRows(url, controller.signal).then(acceptRows).catch(() => {
      if (!controller.signal.aborted) { setReady(false); setError("No pudimos actualizar las cuentas. Volvé a revisar la lista."); }
    });
    return () => controller.abort();
  }, [url, acceptRows]);

  const mutate = async (method: "POST" | "DELETE", body: unknown, change: PendingChange) => {
    if (busy || pendingRef.current) return;
    setBusy(true); setError(null); pendingRef.current = change; setPending(change);
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if ([400, 401, 403].includes(response.status)) {
        pendingRef.current = null; setPending(null);
        setError("No se guardó el cambio. Revisá los datos y tus permisos."); return;
      }
    } catch { /* A lost response is reconciled by a read, never another mutation. */ }
    finally { setBusy(false); }
    await refresh();
  };
  return { accounts, busy, pending, error, ready, refresh,
    register: (input: RegisterWhatsAppAccount) => mutate("POST", input, { id: input.connectionId, action: "register" }),
    revoke: (account: WhatsAppAccount) => mutate("DELETE", { connectionId: account.id, updatedAt: account.updatedAt },
      { id: account.id, action: "revoke" }) };
}
