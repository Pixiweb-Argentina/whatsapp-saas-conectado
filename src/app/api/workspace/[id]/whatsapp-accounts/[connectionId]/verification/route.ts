import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireWorkspaceMember, readJsonBody } from "@/lib/auth/workspace-access";
import { accountVerificationInputSchema } from "@/features/channels/types/whatsapp-account-checks";
import { readAccountVerification, verifyManagedAccount } from "@/features/channels/services/whatsapp-account-checks";

interface Context { params: Promise<{ id: string; connectionId: string }> }
const paramsSchema = z.strictObject({ id: z.uuid(), connectionId: z.uuid() });
function db() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }); }
function reply(value: unknown, status = 200) { return NextResponse.json(value, { status, headers: { "Cache-Control": "no-store" } }); }

export async function GET(_req: NextRequest, context: Context) {
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return reply({ error: "Cuenta inválida" }, 400);
  const { id, connectionId } = params.data, auth = await requireWorkspaceMember(id, { minRole: "manager" });
  if (!auth.ok) return auth.response;
  try { return reply({ verification: await readAccountVerification(db(), id, auth.userId, connectionId) }); }
  catch { return reply({ error: "No se pudo leer la verificación" }, 503); }
}
export async function POST(req: NextRequest, context: Context) {
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return reply({ error: "Cuenta inválida" }, 400);
  const { id, connectionId } = params.data, auth = await requireWorkspaceMember(id, { minRole: "admin" });
  if (!auth.ok) return auth.response;
  const body = await readJsonBody(req); if (!body.ok) return body.response;
  const input = accountVerificationInputSchema.safeParse(body.body);
  if (!input.success) return reply({ error: "Ingresá sólo el ID del webhook de esta cuenta" }, 400);
  try { return reply({ verification: await verifyManagedAccount(db(), id, auth.userId, connectionId, input.data) }); }
  catch { return reply({ error: "No pudimos confirmar la verificación. Revisá el origen público, la cuenta y tus permisos antes de reintentar" }, 409); }
}
