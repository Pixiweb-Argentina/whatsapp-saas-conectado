import { z } from "zod";

export const queuedMessageSchema = z.strictObject({
  operationId: z.uuid(), state: z.enum(["pending", "leased", "cancelled", "dead_letter"]),
  actor: z.enum(["human", "ai", "automation"]), body: z.string().min(1).max(4096),
  createdAt: z.iso.datetime({ offset: true }),
});
export type QueuedMessage = z.infer<typeof queuedMessageSchema>;
export interface ConversationQueue {
  messages: QueuedMessage[];
  more: boolean;
  error: boolean;
}
