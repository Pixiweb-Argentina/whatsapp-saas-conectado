import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireWorkspaceMember, readJsonBody } from "@/lib/auth/workspace-access";
import { decryptCredentials } from "@/shared/lib/integration-secrets";
import { verifyYCloudAccount } from "@/features/channels/services/ycloud-verification";
import { validYCloudCallback, ycloudVerificationInputSchema, ycloudVerificationRecordSchema }
  from "@/features/channels/types/ycloud-verification";

const sourceSchema = z.object({ id: z.uuid(), workspace_id: z.uuid(), provider: z.literal("ycloud"), enabled: z.literal(true),
  config: z.object({ phone_number: z.string().regex(/^\+[1-9]\d{7,14}$/) }).passthrough(),
  credentials: z.record(z.string(), z.unknown()) });
const secretSchema = z.object({ ycloud_api_key: z.string().min(1).max(4096), webhook_signing_secret: z.string().min(1).max(4096) });
type Context = { params: Promise<{ id: string }> };
function serviceClient() {
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
  try {
    const { data, error } = await serviceClient().rpc("read_ycloud_verification", { p_workspace: id, p_actor: auth.userId });
    if (error) throw new Error("READ_FAILED");
    return reply({ verification: data === null ? null : ycloudVerificationRecordSchema.parse(data) });
  } catch { return reply({ error: "No se pudo leer la verificación de YCloud" }, 503); }
}

export async function POST(req: NextRequest, context: Context) {
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return reply({ error: "Workspace inválido" }, 400);
  const auth = await requireWorkspaceMember(id, { minRole: "admin" });
  if (!auth.ok) return auth.response;
  const body = await readJsonBody(req); if (!body.ok) return body.response;
  const input = ycloudVerificationInputSchema.safeParse(body.body);
  if (!input.success || !validYCloudCallback(input.data.callbackUrl, id)) {
    return reply({ error: "Usá el ID del webhook y su URL HTTPS con el wsid de este workspace" }, 400);
  }
  return verifyAndSave(id, auth.userId, input.data);
}

async function verifyAndSave(workspaceId: string, actorId: string, input: z.infer<typeof ycloudVerificationInputSchema>) {
  try {
    const db = serviceClient();
    const { data, error } = await db.from("integrations").select("id,workspace_id,provider,enabled,credentials,config")
      .eq("workspace_id", workspaceId).eq("provider", "ycloud").single();
    const source = sourceSchema.safeParse(data);
    if (error || !source.success || source.data.workspace_id !== workspaceId) {
      return reply({ error: "Primero guardá la integración YCloud activa y su número en formato internacional" }, 409);
    }
    const secrets = secretSchema.safeParse(await decryptCredentials(source.data.credentials, workspaceId, "ycloud"));
    if (!secrets.success) return reply({ error: "Guardá la API Key y el Signing Secret antes de verificar" }, 409);
    const report = await verifyYCloudAccount({ workspaceId, phoneNumber: source.data.config.phone_number,
      apiKey: secrets.data.ycloud_api_key, signingSecret: secrets.data.webhook_signing_secret, input });
    const saved = await db.rpc("save_ycloud_verification", { p_workspace: workspaceId, p_actor: actorId,
      p_source: source.data, p_input: input, p_report: report });
    if (saved.error) return reply({ error: "La configuración o los permisos cambiaron. Volvé a verificar" }, 409);
    return reply({ verification: { input, report, current: true } });
  } catch { return reply({ error: "No se pudo completar la verificación de YCloud" }, 503); }
}
