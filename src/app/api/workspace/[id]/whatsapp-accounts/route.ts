import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireWorkspaceMember, readJsonBody } from "@/lib/auth/workspace-access";
import { readWhatsAppAccounts, registerWhatsAppAccount, revokeWhatsAppAccount } from "@/features/channels/services/whatsapp-accounts";
import { registerWhatsAppAccountSchema, revokeWhatsAppAccountSchema } from "@/features/channels/types/whatsapp-account";

interface Context { params: Promise<{ id: string }> }
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
  try { return reply({ accounts: await readWhatsAppAccounts(db(), id, auth.userId) }); }
  catch { return reply({ error: "No pudimos cargar las cuentas" }, 503); }
}

export async function POST(req: NextRequest, context: Context) {
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return reply({ error: "Workspace inválido" }, 400);
  const auth = await requireWorkspaceMember(id, { minRole: "admin" });
  if (!auth.ok) return auth.response;
  const body = await readJsonBody(req); if (!body.ok) return body.response;
  const input = registerWhatsAppAccountSchema.safeParse(body.body);
  if (!input.success) return reply({ error: "Revisá proveedor, cuenta y credenciales" }, 400);
  try { return reply(await registerWhatsAppAccount(db(), id, auth.userId, input.data), 201); }
  catch { return reply({ error: "No pudimos confirmar el alta. Revisá la lista antes de volver a intentar" }, 409); }
}

export async function DELETE(req: NextRequest, context: Context) {
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return reply({ error: "Workspace inválido" }, 400);
  const auth = await requireWorkspaceMember(id, { minRole: "admin" });
  if (!auth.ok) return auth.response;
  const body = await readJsonBody(req); if (!body.ok) return body.response;
  const input = revokeWhatsAppAccountSchema.safeParse(body.body);
  if (!input.success) return reply({ error: "Actualizá la lista de cuentas" }, 400);
  try { return reply(await revokeWhatsAppAccount(db(), id, auth.userId, input.data)); }
  catch { return reply({ error: "No pudimos confirmar la baja. Actualizá la lista antes de volver a intentar" }, 409); }
}
