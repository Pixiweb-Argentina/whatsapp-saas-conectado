import { z } from "zod";
import { encrypt, decrypt, isEncrypted } from "@/shared/lib/crypto";

const ownerSchema = z.strictObject({ workspaceId: z.uuid(), connectionId: z.uuid(), provider: z.enum(["ycloud", "kapso"]) });
const credentialsSchema = z.strictObject({ apiKey: z.string().min(1).max(4096), signingSecret: z.string().min(1).max(4096) });
type Owner = z.infer<typeof ownerSchema>;
function accountAad(value: Owner): string {
  const owner = ownerSchema.parse(value);
  return `channel-account:${owner.workspaceId}:${owner.connectionId}:${owner.provider}`;
}

/** No plaintext fallback and no ciphertext accepted from the form. */
export async function sealAccountCredentials(owner: Owner, value: unknown) {
  const credentials = credentialsSchema.parse(value);
  if (Object.values(credentials).some(isEncrypted)) throw new Error("ACCOUNT_CREDENTIAL_INPUT_INVALID");
  const encryptedPayload = await encrypt(JSON.stringify(credentials), accountAad(owner));
  const version = /^enc:v([1-9]\d{0,3}):/.exec(encryptedPayload)?.[1];
  if (!version) throw new Error("ACCOUNT_KEY_VERSION_INVALID");
  return { encryptedPayload, keyVersion: Number(version) };
}

export async function openAccountCredentials(owner: Owner, payload: string) {
  if (!isEncrypted(payload)) throw new Error("ACCOUNT_CREDENTIAL_FORMAT_INVALID");
  try { return credentialsSchema.parse(JSON.parse(await decrypt(payload, accountAad(owner)))); }
  catch { throw new Error("ACCOUNT_CREDENTIAL_DECRYPT_FAILED"); }
}
