import { createClient } from "@supabase/supabase-js";
import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { decryptCredentials } from "../src/shared/lib/integration-secrets.ts";

const PROJECT = "https://bzanbpyzujlogipxvkfn.supabase.co";
const WORKSPACE = "ff50ed19-6330-43c1-a69d-32252c9ca756";
const ENDPOINT = "6acfef56108a835e37b5c86d";
const phone = z.string().regex(/^\+[1-9]\d{7,14}$/);
async function checkedRead(query) {
  const result = await query;
  if (result.error) throw new Error("PILOT_SCOPED_READ_FAILED");
  return result.data;
}
async function verifyAccount(db) {
  const data = await checkedRead(db.from("integrations").select("id,workspace_id,enabled,config,credentials")
    .eq("workspace_id", WORKSPACE).eq("provider", "ycloud").single());
  const row = z.object({ id: z.uuid(), workspace_id: z.literal(WORKSPACE), enabled: z.literal(true),
    config: z.object({ phone_number: phone }), credentials: z.record(z.string(), z.unknown()) }).parse(data);
  const credentials = z.object({ ycloud_api_key: z.string().min(1), webhook_signing_secret: z.string().min(1) })
    .parse(await decryptCredentials(row.credentials, WORKSPACE, "ycloud"));
  const get = async (path) => {
    const response = await fetch(`https://api.ycloud.com/v2${path}`, { redirect: "error",
      headers: { "X-API-Key": credentials.ycloud_api_key }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error("PILOT_PROVIDER_READ_FAILED");
    return response.json();
  };
  const runtime = JSON.parse(await readFile(new URL("../test-results/f3-ycloud-runtime.json", import.meta.url), "utf8"));
  if (runtime.workspaceId !== WORKSPACE || runtime.endpointId !== ENDPOINT) throw new Error("PILOT_SCOPE_INVALID");
  const endpoint = await get(`/webhookEndpoints/${ENDPOINT}`);
  if (endpoint.id !== ENDPOINT || endpoint.url !== runtime.callback || endpoint.status !== "active"
    || endpoint.secret !== credentials.webhook_signing_secret) throw new Error("PILOT_ENDPOINT_INVALID");
  const numbers = z.object({ items: z.array(z.object({ phoneNumber: phone, status: z.string() })) })
    .parse(await get("/whatsapp/phoneNumbers"));
  if (!numbers.items.some((n) => n.phoneNumber === row.config.phone_number && n.status === "CONNECTED")) {
    throw new Error("PILOT_NUMBER_NOT_CONNECTED");
  }
  return row;
}
async function bindAccount(db, row) {
  const read = () => checkedRead(db.from("channel_connections").select("id,workspace_id,provider,channel,external_account_id,revoked_at,status,capabilities")
    .eq("workspace_id", WORKSPACE).eq("legacy_integration_id", row.id).maybeSingle());
  let connection = await read();
  if (!connection) {
    const result = await db.from("channel_connections").insert({ workspace_id: WORKSPACE, channel: "whatsapp", provider: "ycloud",
      external_account_id: row.config.phone_number, legacy_integration_id: row.id, display_name: "YCloud · prueba dedicada",
      status: "needs_permissions", capabilities: { version: 1, grants: [] }, last_verified_at: new Date().toISOString() });
    if (result.error) throw new Error("PILOT_BIND_FAILED");
    connection = await read();
  }
  if (!connection || connection.workspace_id !== WORKSPACE || connection.channel !== "whatsapp" || connection.provider !== "ycloud"
    || connection.external_account_id !== row.config.phone_number || connection.revoked_at
    || connection.status !== "needs_permissions" || connection.capabilities?.version !== 1
    || !Array.isArray(connection.capabilities.grants) || connection.capabilities.grants.length !== 0) throw new Error("PILOT_BIND_INVALID");
  return { workspaceId: WORKSPACE, connectionId: connection.id, integrationId: row.id,
    status: connection.status, accountVerifiedByProviderRead: true, sendGranted: false };
}

if (process.argv[2] !== WORKSPACE || process.env.NEXT_PUBLIC_SUPABASE_URL !== PROJECT) {
  console.error("PILOT_SCOPE_INVALID"); process.exitCode = 1;
} else {
  try {
    const db = createClient(PROJECT, process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } });
    const report = await bindAccount(db, await verifyAccount(db));
    await writeFile(new URL("../test-results/f3-ycloud-account.json", import.meta.url), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } catch { console.error("PILOT_ACCOUNT_UNAVAILABLE: no se habilitó ningún envío."); process.exitCode = 1; }
}
