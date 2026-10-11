// Synthetic Cloud fixture. Only the new project; no Meta/LLM/cron calls.
const id=(n)=>`00000000-0000-4000-8000-${String(998000+n).padStart(12,"0")}`;
export const workspace=id(1),connection=id(55),event=id(91);
export const operation=(n)=>id(60+n);
const slug="f3-comment-synthetic-probe";
export const setup=`BEGIN;
INSERT INTO public.workspaces(id,name,slug) VALUES('${workspace}','Prueba reservas F3','${slug}');
INSERT INTO public.contacts(id,workspace_id,phone,name,opt_in) VALUES('${id(21)}','${workspace}',NULL,'Contacto sintético',true);
INSERT INTO public.channel_connections(id,workspace_id,channel,provider,external_account_id,status,capabilities)
VALUES('${connection}','${workspace}','instagram','meta','synthetic-f3-ig-account','ready',
 jsonb_build_object('version',1,'grants',(SELECT jsonb_agg(jsonb_build_object('workspaceId','${workspace}',
 'connectionId','${connection}','capability',a,'evidenceRef','synthetic-only-not-a-Meta-grant',
 'verifiedAt',now()-interval '1 minute','validUntil',now()+interval '1 hour'))
 FROM unnest(ARRAY['private_reply','public_reply']) a)));
INSERT INTO public.contact_identities(id,workspace_id,contact_id,connection_id,external_user_id,verified_at)
VALUES('${id(81)}','${workspace}','${id(21)}','${connection}','synthetic-meta-actor',now()-interval '1 minute');
INSERT INTO public.inbound_events(id,workspace_id,connection_id,provider_event_id,kind,envelope)
VALUES('${event}','${workspace}','${connection}','synthetic-comment','comment',jsonb_build_object('schemaVersion',1,
 'workspaceId','${workspace}','connectionId','${connection}','channel','instagram','provider','meta',
 'providerEventId','synthetic-comment','kind','comment','externalActorId','synthetic-meta-actor','externalCommentId','synthetic-comment-id',
 'occurredAt',now()-interval '1 minute','receivedAt',now()-interval '1 minute',
 'content',jsonb_build_object('type','text','text','hola','rawType','comment'),'mediaRefs','[]'::jsonb,
 'sourceContext',jsonb_build_object('channel','instagram','sourceType','comment')));
INSERT INTO private.channel_comment_evidence(workspace_id,connection_id,event_id,external_comment_id,external_account_id,
 external_actor_id,source_kind,occurred_at,valid_until,verification_ref)
SELECT '${workspace}','${connection}','${event}','synthetic-comment-id','synthetic-f3-ig-account','synthetic-meta-actor',
 'post',private.channel_timestamp(envelope->>'occurredAt'),now()+interval '1 hour','synthetic-only-no-external-verification'
FROM public.inbound_events WHERE id='${event}' AND workspace_id='${workspace}';
COMMIT;
SELECT (SELECT count(*) FROM private.channel_comment_evidence WHERE workspace_id='${workspace}') AS proofs;`;

export function enqueueArgs(n,action="private_reply") {
 return {p_workspace_id:workspace,p_connection_id:connection,p_conversation_id:null,p_event_id:event,
  p_idempotency_key:"synthetic-comment-rule-"+n,p_actor:"automation",p_expected_revision:null,
  p_request:{operationId:operation(n),channel:"instagram",recipient:"synthetic-meta-actor",action,
   commentId:"synthetic-comment-id",body:"Guía sintética; no hay envío a Meta."}};
}
export const readerArgs={p_workspace_id:workspace,p_connection_id:connection,p_event_id:event,p_recipient:"synthetic-meta-actor"};

export const verify=`BEGIN;
DO $check$ DECLARE job public.message_jobs; BEGIN
 SELECT * INTO STRICT job FROM public.claim_channel_job('${workspace}','${id(71)}');
 IF public.begin_channel_send('${workspace}',job.operation_id,job.lease_owner,job.fence,'${event}',now()+interval '1 minute')
 THEN RAISE EXCEPTION 'META_MUST_REMAIN_DISABLED'; END IF;
 IF NOT public.cancel_channel_job('${workspace}',job.operation_id,job.lease_owner,job.fence,'transport_unavailable')
 THEN RAISE EXCEPTION 'EXPECTED_CANCELLATION'; END IF;
END $check$;
COMMIT;
SELECT (SELECT count(*) FROM private.private_reply_claims WHERE workspace_id='${workspace}') AS claims,
 (SELECT count(*) FROM public.message_jobs WHERE workspace_id='${workspace}') AS jobs,
 (SELECT count(*) FROM public.message_outbox WHERE workspace_id='${workspace}') AS outbox,
 public.read_channel_comment_evidence('${workspace}','${connection}','${event}','synthetic-meta-actor') AS evidence;`;

export const cleanup=`BEGIN;
DO $guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.workspaces WHERE id='${workspace}' AND slug='${slug}')
 THEN RAISE EXCEPTION 'FIXTURE_SCOPE_MISMATCH'; END IF; END $guard$;
DELETE FROM private.private_reply_claims WHERE workspace_id='${workspace}';
DELETE FROM private.channel_comment_evidence WHERE workspace_id='${workspace}';
DELETE FROM private.channel_send_budgets WHERE workspace_id='${workspace}';
DELETE FROM public.message_outbox WHERE workspace_id='${workspace}';
DELETE FROM public.message_jobs WHERE workspace_id='${workspace}';
DELETE FROM public.inbound_events WHERE workspace_id='${workspace}';
DELETE FROM public.contact_identities WHERE workspace_id='${workspace}';
DELETE FROM public.channel_connections WHERE workspace_id='${workspace}';
DELETE FROM public.contacts WHERE workspace_id='${workspace}';
DELETE FROM public.workspaces WHERE id='${workspace}' AND slug='${slug}';
COMMIT;
SELECT (SELECT count(*) FROM public.workspaces) AS workspaces,(SELECT count(*) FROM public.messages) AS messages,
 (SELECT count(*) FROM private.channel_comment_evidence) AS proofs,(SELECT count(*) FROM private.private_reply_claims) AS claims,
 (SELECT count(*) FROM private.channel_send_budgets) AS budgets,(SELECT count(*) FROM public.message_outbox) AS outbox,
 (SELECT count(*) FROM cron.job WHERE active) AS active_cron;`;
