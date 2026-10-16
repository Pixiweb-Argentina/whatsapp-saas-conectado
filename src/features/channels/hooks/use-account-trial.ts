"use client";

import { useRef, useState } from "react";
import { accountTrialReviewSchema, type AccountTrialReview, type AccountTrialMutation } from "../types/account-trial";

export function useAccountTrial(base: string) {
  const [review, setReview] = useState<AccountTrialReview | null>(null), [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null), [uncertain, setUncertain] = useState(false);
  const pending = useRef<AccountTrialMutation | null>(null), lock = useRef(false), revision = useRef(0);
  const refresh = async () => {
    const current = ++revision.current;
    const response = await fetch(base, { cache: "no-store", signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error("TRIAL_READ_FAILED");
    const body = await response.json() as { review?: unknown };
    const next = body.review === null ? null : accountTrialReviewSchema.parse(body.review);
    if (current === revision.current) {
      setReview(next);
      const action = pending.current, latest = next?.latest;
      if (action && latest?.operationId === action.operationId && (action.action === "authorize"
        || action.action === "revoke" && latest.revoked || action.action === "send" && latest.state !== "pending")) {
        pending.current = null; setUncertain(false);
      }
    }
  };
  const read = async () => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null);
    try { await refresh(); }
    catch { setError("No pudimos revisar la prueba. No prepares otra hasta conocer este resultado."); }
    finally { lock.current = false; setBusy(false); }
  };
  const mutate = async (input: AccountTrialMutation) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null); revision.current++;
    pending.current = input;
    try {
      const response = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input), signal: AbortSignal.timeout(45000) });
      if (response.ok) {
        pending.current = null; setUncertain(false);
        if (input.action === "send") {
          const result = await response.json() as { status?: unknown };
          if (["not_claimed", "not_permitted"].includes(String(result.status))) setError("La prueba no inició otro envío. Revisá su estado, la vigencia y la verificación de la cuenta.");
          if (result.status === "deferred") setError("La prueba quedó pendiente por un límite temporal. Revisá la misma operación; no prepares otra.");
        }
      }
      else if ([400, 401, 403].includes(response.status)) {
        pending.current = null; setUncertain(false); setError("Revisá los datos y tus permisos antes de continuar.");
      } else { setUncertain(true); setError("Resultado sin confirmar. Revisá la misma operación antes de intentar otra."); }
      await refresh();
    } catch { setUncertain(true); setError("Resultado sin confirmar. Revisá la misma operación antes de intentar otra."); }
    finally { lock.current = false; setBusy(false); }
  };
  return { review, busy, error, uncertain, read, mutate,
    retry: () => pending.current ? mutate(pending.current) : Promise.resolve() };
}
