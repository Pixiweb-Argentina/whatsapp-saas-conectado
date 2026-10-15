import { z } from "zod";
import { connectionStatusSchema } from "./channel-contracts";

const providerSchema = z.enum(["ycloud", "kapso"]);
const accountIdSchema = z.string().trim().min(1).max(512).regex(/^[^\u0000-\u0020\u007f]+$/);
const secretSchema = z.string().min(1).max(4096).refine((value) => value === value.trim() && !value.startsWith("enc:"));
export const registerWhatsAppAccountSchema = z.strictObject({
  connectionId: z.uuid(), provider: providerSchema, externalAccountId: accountIdSchema,
  displayName: z.string().trim().min(1).max(80), apiKey: secretSchema, signingSecret: secretSchema,
}).refine((value) => value.provider !== "ycloud" || /^\+[1-9]\d{7,14}$/.test(value.externalAccountId),
  { path: ["externalAccountId"], message: "Usá el número completo en formato internacional" });
export type RegisterWhatsAppAccount = z.infer<typeof registerWhatsAppAccountSchema>;
export const revokeWhatsAppAccountSchema = z.strictObject({
  connectionId: z.uuid(), updatedAt: z.iso.datetime({ offset: true }),
});
export const whatsAppAccountSchema = z.strictObject({
  id: z.uuid(), provider: providerSchema, externalAccountId: accountIdSchema,
  displayName: z.string().nullable(), status: connectionStatusSchema, managed: z.boolean(),
  credentialsStored: z.boolean(), updatedAt: z.iso.datetime({ offset: true }),
});
export type WhatsAppAccount = z.infer<typeof whatsAppAccountSchema>;
export const whatsAppAccountsSchema = z.array(whatsAppAccountSchema);
