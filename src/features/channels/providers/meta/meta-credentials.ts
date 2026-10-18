/**
 * Per-connection Meta credentials (F4-T1.2). Sealed with the same envelope as WhatsApp
 * accounts, bound to workspace + connection + provider "meta", so a token can never be
 * opened under another account. The app secret stays in server env (meta-config), never here.
 */
import { z } from "zod";
import { encrypt, decrypt, isEncrypted } from "@/shared/lib/crypto";
import type { ChannelConnection } from "../../types/channel-contracts";

const ownerSchema = z.strictObject({ workspaceId: z.uuid(), connectionId: z.uuid() });
const opaque = z.string().min(1).max(512);
const credentialsSchema = z.strictObject({
  accessToken: z.string().min(1).max(4096),
  tokenExpiresAt: z.iso.datetime({ offset: true }).nullable(),
  igUserId: opaque,
  pageId: opaque.nullable(),
  grantedScopes: z.array(z.string().min(1).max(128)).max(64),
});
type Owner = z.infer<typeof ownerSchema>;
export type MetaCredentials = z.infer<typeof credentialsSchema>;

function metaAad(value: Owner): string {
  const owner = ownerSchema.parse(value);
  return `channel-account:${owner.workspaceId}:${owner.connectionId}:meta`;
}

/** No plaintext fallback and no ciphertext accepted from the OAuth callback. */
export async function sealMetaCredentials(owner: Owner, value: unknown) {
  const credentials = credentialsSchema.parse(value);
  if (isEncrypted(credentials.accessToken)) throw new Error("META_CREDENTIAL_INPUT_INVALID");
  const encryptedPayload = await encrypt(JSON.stringify(credentials), metaAad(owner));
  const version = /^enc:v([1-9]\d{0,3}):/.exec(encryptedPayload)?.[1];
  if (!version) throw new Error("META_KEY_VERSION_INVALID");
  return { encryptedPayload, keyVersion: Number(version) };
}

export async function openMetaCredentials(owner: Owner, payload: string): Promise<MetaCredentials> {
  if (!isEncrypted(payload)) throw new Error("META_CREDENTIAL_FORMAT_INVALID");
  try { return credentialsSchema.parse(JSON.parse(await decrypt(payload, metaAad(owner)))); }
  catch { throw new Error("META_CREDENTIAL_DECRYPT_FAILED"); }
}

export interface MetaReadinessFacts {
  revoked: boolean;
  grantedScopes: readonly string[];
  /** Fixed once the Meta app and its App Review scopes exist; passed in, never guessed. */
  requiredScopes: readonly string[];
  tokenExpiresAt: string | null;
  webhookVerifiedAt: string | null;
}

export interface MetaReadiness {
  status: ChannelConnection["status"];
  missingScopes: string[];
}

/**
 * Connection state from server facts only. Ready means token alive, every required scope
 * granted and a signed webhook seen; anything less keeps sending closed.
 */
export function metaConnectionReadiness(facts: MetaReadinessFacts, now: number): MetaReadiness {
  const granted = new Set(facts.grantedScopes);
  const missingScopes = [...new Set(facts.requiredScopes)].filter((scope) => !granted.has(scope)).sort();
  if (facts.revoked) return { status: "revoked", missingScopes };
  const expires = facts.tokenExpiresAt === null ? null : Date.parse(facts.tokenExpiresAt);
  const expired = expires !== null && !(expires > now);
  if (expired || missingScopes.length > 0 || facts.requiredScopes.length === 0) {
    return { status: "needs_permissions", missingScopes };
  }
  if (facts.webhookVerifiedAt === null) return { status: "awaiting_webhook", missingScopes };
  return { status: "ready", missingScopes };
}
