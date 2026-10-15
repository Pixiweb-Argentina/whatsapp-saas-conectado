// SQL-only probe for the explicitly selected new project. Every row rolls back.
// No credentials, network transport, scheduler or model invocation.
const id = (n) => `00000000-0000-4000-8000-${String(999000 + n).padStart(12, "0")}`;
export const workspace = id(1);
const connection = id(51), integration = id(11);
export const probe = `BEGIN;
SET LOCAL ROLE service_role;
INSERT INTO public.workspaces(id,name,slug) VALUES('${workspace}','Synthetic pipeline F3','f3-ycloud-pipeline-rollback-probe');
INSERT INTO public.integrations(id,workspace_id,provider,enabled,config)
 VALUES('${integration}','${workspace}','ycloud',true,'{"phone_number":"+15555559900"}');
INSERT INTO public.channel_connections(id,workspace_id,channel,provider,external_account_id,status,legacy_integration_id)
 VALUES('${connection}','${workspace}','whatsapp','ycloud','+15555559900','needs_permissions','${integration}');
DO $probe$
DECLARE envelope jsonb; first jsonb; active jsonb; burst jsonb; held jsonb; resumed jsonb; prep jsonb;
BEGIN
 envelope:=jsonb_build_object('schemaVersion',1,'workspaceId','${workspace}','connectionId','${connection}',
  'channel','whatsapp','provider','ycloud','providerEventId','wamid.pipeline.cloud.1','externalMessageId','wamid.pipeline.cloud.1',
  'kind','message','externalActorId','+15555559901','occurredAt',now()-interval '1 minute','receivedAt',now()-interval '1 minute',
  'content',jsonb_build_object('type','text','text','Synthetic pipeline input; never send','rawType','text'),
  'mediaRefs','[]'::jsonb,'sourceContext',jsonb_build_object('channel','whatsapp','sourceType','direct_message'));
 first:=public.materialize_ycloud_pipeline('${workspace}','${integration}',envelope,'Synthetic',true,3000);
 IF first->>'inserted'<>'true' OR first->>'batchId' IS NOT NULL THEN RAISE EXCEPTION 'EXPECTED_HUMAN_ONLY'; END IF;
 IF (public.materialize_ycloud_pipeline('${workspace}','${integration}',envelope,null,true,3000))->>'inserted'<>'false'
  THEN RAISE EXCEPTION 'EXPECTED_DEDUP'; END IF;
 IF EXISTS(SELECT 1 FROM public.contacts WHERE workspace_id='${workspace}' AND opt_in)
  OR NOT EXISTS(SELECT 1 FROM public.conversations WHERE id=(first->>'conversationId')::uuid AND state='human_active' AND NOT ai_enabled)
  THEN RAISE EXCEPTION 'CONSENT_OR_STATE_INFERRED'; END IF;
 UPDATE public.contacts SET opt_in=true WHERE workspace_id='${workspace}';
 UPDATE public.channel_connections SET status='ready',capabilities=jsonb_build_object('version',1,'grants',
  jsonb_build_array(jsonb_build_object('workspaceId','${workspace}','connectionId','${connection}',
   'capability','text','evidenceRef','synthetic-only','verifiedAt',now()-interval '1 minute','validUntil',now()+interval '10 minutes')))
  WHERE workspace_id='${workspace}';
 UPDATE public.conversations SET ai_enabled=true,state='ai_active' WHERE id=(first->>'conversationId')::uuid;
 envelope:=envelope||'{"providerEventId":"wamid.pipeline.cloud.2","externalMessageId":"wamid.pipeline.cloud.2"}'::jsonb;
 active:=public.materialize_ycloud_pipeline('${workspace}','${integration}',envelope,null,true,3000);
 envelope:=envelope||'{"providerEventId":"wamid.pipeline.cloud.3","externalMessageId":"wamid.pipeline.cloud.3"}'::jsonb;
 burst:=public.materialize_ycloud_pipeline('${workspace}','${integration}',envelope,null,true,3000);
 IF active->>'batchId' IS NULL OR active->>'batchId' IS DISTINCT FROM burst->>'batchId'
  THEN RAISE EXCEPTION 'EXPECTED_SHARED_PINNED_BATCH'; END IF;
 UPDATE public.message_batches SET flush_at=clock_timestamp()-interval '1 second' WHERE id=(active->>'batchId')::uuid;
 IF (SELECT count(*) FROM public.claim_ai_channel_batch('${workspace}',(active->>'batchId')::uuid))<>1
  OR EXISTS(SELECT 1 FROM public.claim_ai_channel_batch('${workspace}',(active->>'batchId')::uuid))
  THEN RAISE EXCEPTION 'EXPECTED_ONE_SCOPED_CLAIM'; END IF;
 prep:=public.prepare_ai_channel_reply('${workspace}',(active->>'batchId')::uuid,'legacy');
 IF prep->>'mode'<>'queue' OR prep->>'eligible'<>'true' THEN RAISE EXCEPTION 'EXPECTED_PINNED_QUEUE'; END IF;
 PERFORM public.checkpoint_ai_channel_reply('${workspace}',(active->>'batchId')::uuid,'Synthetic checkpoint; never send');
 IF (public.enqueue_ai_channel_reply('${workspace}',(active->>'batchId')::uuid,'Synthetic checkpoint; never send'))->>'queued'<>'true'
  THEN RAISE EXCEPTION 'EXPECTED_ENQUEUE'; END IF;
 IF (public.enqueue_ai_channel_reply('${workspace}',(active->>'batchId')::uuid,'Synthetic checkpoint; never send'))->>'duplicate'<>'true'
  THEN RAISE EXCEPTION 'EXPECTED_ONE_OPERATION'; END IF;
 UPDATE public.message_batches SET status='processed' WHERE id=(active->>'batchId')::uuid;
 UPDATE public.conversations SET ai_enabled=false,state='human_active' WHERE id=(first->>'conversationId')::uuid;
 IF (public.prepare_ai_channel_reply('${workspace}',(active->>'batchId')::uuid,'legacy'))->>'eligible'<>'false'
  THEN RAISE EXCEPTION 'EXPECTED_HUMAN_INVALIDATION'; END IF;
 envelope:=envelope||'{"providerEventId":"wamid.pipeline.cloud.4","externalMessageId":"wamid.pipeline.cloud.4"}'::jsonb;
 held:=public.materialize_ycloud_pipeline('${workspace}','${integration}',envelope,null,true,3000);
 UPDATE public.conversations SET ai_enabled=true,state='ai_active' WHERE id=(first->>'conversationId')::uuid;
 IF (public.materialize_ycloud_pipeline('${workspace}','${integration}',envelope,null,true,3000))->>'batchId' IS NOT NULL
  THEN RAISE EXCEPTION 'REPLAY_MUST_NOT_QUEUE'; END IF;
 envelope:=envelope||'{"providerEventId":"wamid.pipeline.cloud.5","externalMessageId":"wamid.pipeline.cloud.5"}'::jsonb;
 resumed:=public.materialize_ycloud_pipeline('${workspace}','${integration}',envelope,null,true,3000);
 IF resumed->>'batchId' IS NULL OR resumed->>'batchId'=active->>'batchId' THEN RAISE EXCEPTION 'EXPECTED_NEW_REVISION'; END IF;
 UPDATE public.message_batches SET flush_at=clock_timestamp()-interval '1 second' WHERE id=(resumed->>'batchId')::uuid;
 IF EXISTS(SELECT 1 FROM public.claim_ai_channel_batch('${id(2)}',(resumed->>'batchId')::uuid))
  OR (SELECT count(*) FROM public.claim_ai_channel_batch('${workspace}',(resumed->>'batchId')::uuid))<>1
  THEN RAISE EXCEPTION 'EXPECTED_EXACT_TENANT_CLAIM'; END IF;
 IF public.handoff_ai_channel_reply('${workspace}',(resumed->>'batchId')::uuid,'keyword')<>'{"settled":true,"changed":true}'::jsonb
  OR public.handoff_ai_channel_reply('${workspace}',(resumed->>'batchId')::uuid,'keyword')<>'{"settled":true,"changed":false}'::jsonb
  THEN RAISE EXCEPTION 'EXPECTED_IDEMPOTENT_HANDOFF'; END IF;
 IF (SELECT count(*) FROM public.message_jobs WHERE workspace_id='${workspace}')<>1
  OR EXISTS(SELECT 1 FROM public.message_outbox WHERE workspace_id='${workspace}') THEN RAISE EXCEPTION 'UNEXPECTED_DISPATCH'; END IF;
END $probe$;
SELECT 'synthetic_pipeline_contract_passed' AS result,
 (SELECT count(*)::int FROM public.messages WHERE workspace_id='${workspace}' AND direction='in') AS incoming,
 (SELECT count(*)::int FROM public.message_batches WHERE workspace_id='${workspace}') AS batches,
 (SELECT count(*)::int FROM public.message_jobs WHERE workspace_id='${workspace}') AS jobs_not_dispatched,
 (SELECT count(*)::int FROM public.message_outbox WHERE workspace_id='${workspace}') AS outbox;
ROLLBACK;`;
