/** RFC 9110: delta seconds or an HTTP date. Invalid/oversized hints fail closed. */
export function retryAfterSeconds(value: string | null | undefined, now = Date.now()): number | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  const seconds = /^\d+$/.test(trimmed) ? Number(trimmed)
    : /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(trimmed)
      ? Math.max(0, Math.ceil((Date.parse(trimmed) - now) / 1000)) : NaN;
  // A hint beyond the bounded queue lifetime parks the operation, never shortens it.
  return Number.isSafeInteger(seconds) && seconds >= 0 && seconds <= 2_147_483_647 ? seconds : undefined;
}
