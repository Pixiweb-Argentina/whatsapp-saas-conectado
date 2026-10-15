import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireWorkspaceMember, readJsonBody } from "@/lib/auth/workspace-access";
import { readYCloudPermissionReview, changeYCloudTextPermission } from "@/features/channels/services/ycloud-permissions";
import { ycloudPermissionMutationSchema } from "@/features/channels/types/ycloud-permissions";

type Context = { params: Promise<{ id: string }> };
function db() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } });
}
function reply(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(_req: NextRequest, context: Context) {
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return reply({ error: "Workspace inválido" }, 400);
  const auth = await requireWorkspaceMember(id, { minRole: "manager" });
  if (!auth.ok) return auth.response;
  try { return reply({ review: await readYCloudPermissionReview(db(), id, auth.userId) }); }
  catch { return reply({ error: "No se pudo revisar el permiso de texto" }, 503); }
}

export async function POST(req: NextRequest, context: Context) {
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return reply({ error: "Workspace inválido" }, 400);
  const auth = await requireWorkspaceMember(id, { minRole: "admin" });
  if (!auth.ok) return auth.response;
  const body = await readJsonBody(req); if (!body.ok) return body.response;
  const parsed = ycloudPermissionMutationSchema.safeParse(body.body);
  if (!parsed.success) return reply({ error: "Revisá la cuenta y confirmá el permiso de texto antes de continuar" }, 400);
  try { return reply(await changeYCloudTextPermission(db(), id, auth.userId, parsed.data)); }
  catch { return reply({ error: "No pudimos confirmar el resultado. Actualizá la revisión antes de volver a intentar" }, 409); }
}
