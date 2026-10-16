import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireWorkspaceMember, readJsonBody } from "@/lib/auth/workspace-access";
import { ycloudPermissionMutationSchema } from "@/features/channels/types/ycloud-permissions";
import { readAccountPermissionReview, changeAccountTextPermission } from "@/features/channels/services/whatsapp-account-checks";

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
  try { return reply({ review: await readAccountPermissionReview(db(), id, auth.userId, connectionId) }); }
  catch { return reply({ error: "No se pudo revisar el permiso" }, 503); }
}
export async function POST(req: NextRequest, context: Context) {
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return reply({ error: "Cuenta inválida" }, 400);
  const { id, connectionId } = params.data, auth = await requireWorkspaceMember(id, { minRole: "admin" });
  if (!auth.ok) return auth.response;
  const body = await readJsonBody(req); if (!body.ok) return body.response;
  const input = ycloudPermissionMutationSchema.safeParse(body.body);
  if (!input.success || input.data.connectionId !== connectionId) return reply({ error: "Revisá la cuenta y confirmá el permiso de texto" }, 400);
  try { return reply(await changeAccountTextPermission(db(), id, auth.userId, connectionId, input.data)); }
  catch { return reply({ error: "Resultado sin confirmar. Actualizá la revisión antes de volver a intentar" }, 409); }
}
