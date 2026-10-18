import { z } from "zod";

/** Names only; values live in the server environment, never NEXT_PUBLIC_. */
const metaConfigSchema = z.strictObject({
  appId: z.string().regex(/^[0-9]{5,32}$/),
  appSecret: z.string().min(16).max(256),
  webhookVerifyToken: z.string().min(16).max(256),
  // Pinned from the App Dashboard; never defaulted or guessed here.
  graphApiVersion: z.string().regex(/^v[1-9][0-9]?\.[0-9]$/),
  redirectUri: z.url({ protocol: /^https$/ }),
});

export type MetaConfig = z.infer<typeof metaConfigSchema>;

/** Null means "Meta not configured": callers must refuse, not fall back. */
export function readMetaConfig(env: Readonly<Record<string, string | undefined>> = process.env): MetaConfig | null {
  const result = metaConfigSchema.safeParse({
    appId: env.META_APP_ID, appSecret: env.META_APP_SECRET,
    webhookVerifyToken: env.META_WEBHOOK_VERIFY_TOKEN,
    graphApiVersion: env.META_GRAPH_API_VERSION, redirectUri: env.META_REDIRECT_URI,
  });
  return result.success ? result.data : null;
}
