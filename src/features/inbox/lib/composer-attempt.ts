export interface ComposerAttempt {
  conversationId: string;
  body: string;
  deliveryMode: "legacy" | "queue";
  operationId: string;
}

/** Keep the same circuit and ID after an uncertain HTTP result, even if flags change. */
export function composerAttempt(previous: ComposerAttempt | null, conversationId: string, body: string,
  deliveryMode: "legacy" | "queue", createId: () => string = () => crypto.randomUUID()): ComposerAttempt {
  if (previous?.conversationId === conversationId && previous.body === body) return previous;
  return { conversationId, body, deliveryMode, operationId: createId() };
}
