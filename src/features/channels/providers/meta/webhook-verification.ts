import { createHmac, timingSafeEqual } from "node:crypto";

/** Meta rejects bodies far below this; anything larger is not a webhook we accept. */
export const META_WEBHOOK_MAX_BYTES = 1_048_576;
const SIGNATURE_PATTERN = /^sha256=([0-9a-f]{64})$/;
const CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;

function sameBytes(left: Buffer, right: Buffer): boolean {
  return left.length > 0 && left.length === right.length && timingSafeEqual(left, right);
}

/** GET subscription handshake: echo the challenge only for our own verify token. */
export function verifyMetaSubscription(params: URLSearchParams, verifyToken: string): string | null {
  const token = params.get("hub.verify_token") ?? "";
  const challenge = params.get("hub.challenge") ?? "";
  if (params.get("hub.mode") !== "subscribe" || !verifyToken) return null;
  if (!CHALLENGE_PATTERN.test(challenge)) return null;
  return sameBytes(Buffer.from(token), Buffer.from(verifyToken)) ? challenge : null;
}

/** POST: HMAC-SHA256 of the exact raw bytes with the app secret, compared in constant time. */
export function verifyMetaSignature(rawBody: Uint8Array, header: string | null, appSecret: string): boolean {
  if (!appSecret || rawBody.byteLength === 0 || rawBody.byteLength > META_WEBHOOK_MAX_BYTES) return false;
  const provided = SIGNATURE_PATTERN.exec((header ?? "").trim().toLowerCase())?.[1];
  if (!provided) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  return sameBytes(expected, Buffer.from(provided, "hex"));
}
