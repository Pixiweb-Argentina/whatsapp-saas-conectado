import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { accountIngressEnabled, captureWhatsAppAccountDelivery } from "@/features/channels/services/whatsapp-account-ingress";

const scope = z.strictObject({ workspaceId: z.uuid(), connectionId: z.uuid() });
const headers = { "Cache-Control": "no-store" };
interface Context { params: Promise<{ workspaceId: string; connectionId: string }> }

/** Prepared shadow endpoint. No provider webhook is configured or activated by registration. */
export async function POST(request: NextRequest, context: Context): Promise<NextResponse> {
  try {
    const parsed = scope.safeParse(await context.params);
    if (!parsed.success) return NextResponse.json({ error: "Invalid account" }, { status: 400, headers });
    if (!accountIngressEnabled(parsed.data.connectionId)) {
      return NextResponse.json({ error: "Account intake unavailable" }, { status: 503, headers });
    }
    const rawBody = await boundedBody(request);
    if (rawBody === null) return NextResponse.json({ error: "Body too large" }, { status: 413, headers });
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } });
    const result = await captureWhatsAppAccountDelivery(db, { ...parsed.data, rawBody, headers: request.headers });
    if (result.status === "unauthorized") return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
    if (result.status === "invalid") return NextResponse.json({ error: "Invalid delivery" }, { status: 400, headers });
    if (result.status === "disabled") return NextResponse.json({ error: "Account intake unavailable" }, { status: 503, headers });
    return NextResponse.json({ received: true, shadowOnly: true, recorded: result.status === "persisted" }, { headers });
  } catch { return NextResponse.json({ error: "Account intake unavailable" }, { status: 503, headers }); }
}

async function boundedBody(request: NextRequest): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 1_048_576) return null;
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally { await reader.cancel().catch(() => undefined); }
}
