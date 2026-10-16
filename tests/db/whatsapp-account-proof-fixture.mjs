import { permissionEvidenceSql } from "./ycloud-permission-fixture.mjs";

/** Synthetic fixture only. Create a managed source at birth; routing identities are immutable. */
export function accountProofFixtureSql(id) {
  const legacy = permissionEvidenceSql(id);
  const start = legacy.indexOf("INSERT INTO public.message_jobs"), end = legacy.indexOf("SELECT public.save_ycloud_verification");
  if (start < 0 || end <= start) throw new Error("PROOF_FIXTURE_TEMPLATE_CHANGED");
  return `SELECT public.register_whatsapp_account('${id(1)}','${id(101)}','${id(51)}','ycloud','+15555550700',
    'QA cuenta gestionada','enc:v1:YWJj:ZGVm',1);
INSERT INTO public.contact_identities(id,workspace_id,contact_id,connection_id,external_user_id,verified_at)
  VALUES('${id(81)}','${id(1)}','${id(21)}','${id(51)}','+15555550101',now());
UPDATE public.conversations SET connection_id='${id(51)}',identity_id='${id(81)}',state='human_active',ai_enabled=false WHERE id='${id(31)}';
UPDATE public.messages SET connection_id='${id(51)}',provider='ycloud' WHERE conversation_id='${id(31)}';
${legacy.slice(start, end)}`;
}
