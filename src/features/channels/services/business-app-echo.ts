import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseOutboundEcho } from "@/features/inbox/services/kapso-webhook-handler";
import { channelRolloutWorkspaces } from "./channel-rollout";
import { resolveWhatsAppConnection, type AuthenticatedWhatsAppDelivery } from "./whatsapp-event-ingress";

const echoSchema=z.strictObject({connectionId:z.uuid(),externalAccountId:z.string().min(1),wamid:z.string().min(1).max(512),
  recipient:z.string().regex(/^\+[1-9]\d{7,14}$/),occurredAt:z.iso.datetime({offset:true}),
  type:z.enum(["text","audio","image","document","video","sticker","location","template","system"]),
  body:z.string().max(4096).nullable()});
const resultSchema=z.strictObject({conversationId:z.uuid().nullable(),inserted:z.boolean(),aiDisabled:z.boolean()});
type BusinessAppEcho=z.infer<typeof echoSchema>;
type EchoCaptureResult={status:"not_echo"|"disabled"|"ignored"}
  | ({status:"persisted"} & z.infer<typeof resultSchema>);
function record(value:unknown):Record<string,unknown> {
  return value!==null && typeof value==="object" && !Array.isArray(value) ? value as Record<string,unknown> : {};
}
export function normalizeBusinessAppEcho(input:AuthenticatedWhatsAppDelivery,connectionId:string,now=Date.now()):BusinessAppEcho|null {
  const payload=record(input.payload); const message=record(payload.message); const rawTimestamp=message.timestamp;
  if(input.provider!=="kapso" || input.kapsoEventName!=="whatsapp.message.sent"
    || record(message.kapso).origin!=="business_app" || payload.phone_number_id!==input.configuredAccountId) return null;
  if(typeof rawTimestamp!=="string" || !/^\d+$/.test(rawTimestamp) || Number(rawTimestamp)<=0
    || Number(rawTimestamp)*1000>now) return null;
  const echo=parseOutboundEcho(input.payload,input.kapsoEventName); if(!echo) return null;
  // E.164 evidence only; do not guess a country or bind an echo by the contact's mutable phone.
  const rawPhone=echo.to;
  if(!/^\+?[1-9]\d{7,14}$/.test(rawPhone)) return null;
  const text=record(message.text).body; const caption=record(message[String(message.type)]).caption;
  const body=message.type==="text" ? text : typeof caption==="string" ? caption : "[Multimedia]";
  const checked=echoSchema.safeParse({connectionId,externalAccountId:input.configuredAccountId,wamid:echo.wamid,
    recipient:rawPhone.startsWith("+")?rawPhone:`+${rawPhone}`,occurredAt:echo.createTime,type:echo.type,body});
  return checked.success ? checked.data : null;
}

/** Must follow raw HMAC verification. Enabled mode never falls back after invalid data/storage failure. */
export async function captureBusinessAppEcho(db:SupabaseClient,input:AuthenticatedWhatsAppDelivery,now=Date.now()):Promise<EchoCaptureResult> {
  const message=record(record(input.payload).message);
  if(input.provider!=="kapso" || input.kapsoEventName!=="whatsapp.message.sent"
    || record(message.kapso).origin!=="business_app") return {status:"not_echo" as const};
  if(!channelRolloutWorkspaces("ingress").includes(input.workspaceId)) return {status:"disabled" as const};
  const connection=await resolveWhatsAppConnection(db,input);
  const echo=normalizeBusinessAppEcho(input,connection.id,now);
  if(!echo) return {status:"ignored" as const};
  const {data,error}=await db.rpc("persist_business_app_echo",{p_workspace_id:input.workspaceId,
    p_integration_id:input.integrationId,p_echo:echo});
  const result=resultSchema.safeParse(data);
  if(error || !result.success) throw new Error("CHANNEL_ECHO_STORAGE_FAILED");
  return {status:"persisted" as const,...result.data};
}
