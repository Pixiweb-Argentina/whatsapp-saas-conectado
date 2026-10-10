import { z } from "zod";
const opaqueId = z.string().min(1).max(512).refine((value) => value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value));
export const deliveryReceiptSchema = z.strictObject({
  connectionId: z.uuid(), provider: z.enum(["ycloud", "kapso"]), externalAccountId: opaqueId,
  providerEventId: opaqueId, status: z.enum(["sent", "delivered", "read", "failed"]),
  wamid: opaqueId.nullable(), providerMessageId: opaqueId.nullable(), operationId: z.uuid().nullable(),
  recipient: z.string().regex(/^\+[1-9]\d{7,14}$/).nullable(), occurredAt: z.iso.datetime({ offset: true }),
}).refine((value) => value.wamid !== null || value.providerMessageId !== null)
  .refine((value) => value.operationId === null || value.provider === "ycloud");
export type DeliveryReceipt = z.infer<typeof deliveryReceiptSchema>;
