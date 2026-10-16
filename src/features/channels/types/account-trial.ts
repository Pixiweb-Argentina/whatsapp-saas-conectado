import { z } from "zod";
import { accountPermissionReviewSchema } from "./whatsapp-account-checks";

export const ACCOUNT_TRIAL_BODY = "Hola, este es un mensaje de prueba de Pixiweb. Recibimos tu mensaje correctamente.";
const timestamp = z.iso.datetime({ offset: true });
export const accountTrialReviewSchema = z.strictObject({
  connectionUpdatedAt: timestamp, verificationCheckedAt: timestamp.nullable(),
  blockers: z.array(z.enum([...accountPermissionReviewSchema.shape.blockers.element.options, "initial_trial_only"])),
  candidates: z.array(z.strictObject({ conversationId: z.uuid(), recipient: z.string().min(1).max(512), name: z.string() })).max(20),
  latest: z.strictObject({ operationId: z.uuid(), conversationId: z.uuid(), recipient: z.string(), body: z.literal(ACCOUNT_TRIAL_BODY),
    validUntil: timestamp, revoked: z.boolean(), state: z.string(), deliveryStatus: z.string().nullable(), canSend: z.boolean() }).nullable(),
  dispatchEnabled: z.boolean(),
});
export type AccountTrialReview = z.infer<typeof accountTrialReviewSchema>;
export const accountTrialMutationSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("authorize"), operationId: z.uuid(), conversationId: z.uuid(),
    recipient: z.string().regex(/^\+[1-9]\d{7,14}$/), connectionUpdatedAt: timestamp,
    verificationCheckedAt: timestamp, acknowledgeOneMessage: z.literal(true) }),
  z.strictObject({ action: z.literal("send"), operationId: z.uuid(), acknowledgeSend: z.literal(true) }),
  z.strictObject({ action: z.literal("revoke"), operationId: z.uuid() }),
]);
export type AccountTrialMutation = z.infer<typeof accountTrialMutationSchema>;

/** A separate per-connection rollout; never inherit the general worker or AI flags. */
export function accountTrialEnabled(connectionId: string, value = process.env.CHANNEL_ACCOUNT_TRIAL_CONNECTIONS): boolean {
  return z.uuid().safeParse(connectionId).success && (value ?? "").split(",").map((id) => id.trim()).includes(connectionId);
}
