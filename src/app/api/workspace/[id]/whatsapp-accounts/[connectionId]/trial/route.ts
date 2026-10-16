import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireWorkspaceMember, readJsonBody } from "@/lib/auth/workspace-access";
import { accountTrialMutationSchema } from "@/features/channels/types/account-trial";
import { readAccountTrial, mutateAccountTrial } from "@/features/channels/services/account-trial";

interface Context { params: Promise<{ id: string; connectionId: string }> }
const paramsSchema = z.strictObject({ id: z.uuid(), connectionId: z.uuid() });
function db() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }); }
function reply(value: unknown, status = 200) { return NextResponse.json(value, { status, headers: { "Cache-Control": "no-store" } }); }

export async function GET(_request: NextRequest, context: Context) {
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return reply({ error: "Cuenta inválida" }, 400);
  const { id, connectionId } = params.data, auth = await requireWorkspaceMember(id, { minRole: "manager" });
  if (!auth.ok) return auth.response;
  try { return reply({ review: await readAccountTrial(db(), { workspaceId: id, actorId: auth.userId, connectionId }) }); }
  catch { return reply({ error: "No se pudo revisar la prueba" }, 503); }
}
export async function POST(request: NextRequest, context: Context) {
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return reply({ error: "Cuenta inválida" }, 400);
  const { id, connectionId } = params.data, auth = await requireWorkspaceMember(id, { minRole: "admin" });
  if (!auth.ok) return auth.response;
  const body = await readJsonBody(request); if (!body.ok) return body.response;
  const input = accountTrialMutationSchema.safeParse(body.body);
  if (!input.success) return reply({ error: "Revisá y confirmá una única prueba" }, 400);
  try { return reply(await mutateAccountTrial(db(), { workspaceId: id, actorId: auth.userId, connectionId }, input.data)); }
  catch { return reply({ error: "Resultado sin confirmar. Revisá la misma operación antes de intentar otra prueba" }, 409); }
}
