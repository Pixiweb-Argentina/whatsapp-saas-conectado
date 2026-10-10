-- Historical increment-3 probes. After migration 20261010180354, use
-- cloud-atomic-send.mjs + cloud-atomic-assertions.sql for valid send permits.
-- Run inside BEGIN/ROLLBACK after omnichannel-fixture.sql and registering the
-- synthetic connections below. This file never calls a messaging provider.
INSERT INTO public.channel_connections(id,workspace_id,channel,provider,external_account_id,status,legacy_integration_id)
VALUES ('00000000-0000-4000-8000-000000000051','00000000-0000-4000-8000-000000000001','whatsapp','ycloud','+15555550100','ready','00000000-0000-4000-8000-000000000011'),
 ('00000000-0000-4000-8000-000000000052','00000000-0000-4000-8000-000000000002','whatsapp','kapso','fixture-phone-b','ready','00000000-0000-4000-8000-000000000012');
SELECT private.backfill_whatsapp_workspace('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000051',100);
SELECT private.backfill_whatsapp_workspace('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000052',100);

DO $assertions$
DECLARE ws uuid := '00000000-0000-4000-8000-000000000001';
  conn uuid := '00000000-0000-4000-8000-000000000051';
  conv uuid := '00000000-0000-4000-8000-000000000031';
  op uuid := '00000000-0000-4000-8000-000000000061';
  worker uuid := '00000000-0000-4000-8000-000000000071';
  job public.message_jobs; fresh public.message_jobs; event_id uuid; duplicate_id uuid;
  request jsonb := jsonb_build_object('operationId',op,'channel','whatsapp','recipient','+15555550101','action','text','body','Synthetic Cloud fixture');
  envelope jsonb := jsonb_build_object('workspaceId',ws,'connectionId',conn,'providerEventId','cloud-event-1',
    'channel','whatsapp','provider','ycloud','kind','message','externalActorId','+15555550101','externalMessageId','cloud-message-1');
BEGIN
  IF has_table_privilege('anon','public.message_jobs','SELECT') OR
    has_table_privilege('authenticated','public.message_outbox','SELECT') OR
    has_function_privilege('authenticated','public.claim_channel_job(uuid,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'QUEUE_PERMISSIONS_EXPOSED';
  END IF;
  event_id := public.persist_channel_event(envelope,false);
  duplicate_id := public.persist_channel_event(envelope,false);
  IF event_id <> duplicate_id THEN RAISE EXCEPTION 'EVENT_DEDUP_FAILED'; END IF;
  PERFORM public.enqueue_channel_job(ws,conn,conv,event_id,'cloud-job-1','ai',0,request);
  SELECT * INTO STRICT job FROM public.claim_channel_job(ws,worker);
  IF EXISTS (SELECT 1 FROM public.claim_channel_job(ws,gen_random_uuid())) THEN RAISE EXCEPTION 'DOUBLE_CLAIM'; END IF;
  UPDATE public.message_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE operation_id=op;
  PERFORM public.recover_channel_jobs(ws);
  SELECT * INTO STRICT fresh FROM public.claim_channel_job(ws,gen_random_uuid());
  IF fresh.fence <= job.fence OR public.begin_channel_send(ws,op,worker,job.fence,'event',now()+interval '1 hour') THEN
    RAISE EXCEPTION 'FENCING_FAILED';
  END IF;
  IF NOT public.begin_channel_send(ws,op,fresh.lease_owner,fresh.fence,'event',now()+interval '1 hour') THEN
    RAISE EXCEPTION 'SEND_PERMIT_FAILED';
  END IF;
  UPDATE public.message_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE operation_id=op;
  PERFORM public.recover_channel_jobs(ws);
  IF (SELECT state FROM public.message_jobs WHERE operation_id=op) <> 'unknown'
    OR (SELECT state FROM public.message_outbox WHERE operation_id=op) <> 'unknown'
    OR EXISTS (SELECT 1 FROM public.claim_channel_job(ws,worker)) THEN RAISE EXCEPTION 'UNKNOWN_RETRY'; END IF;
  op := '00000000-0000-4000-8000-000000000062';
  request := jsonb_set(request,'{operationId}',to_jsonb(op::text));
  PERFORM public.enqueue_channel_job(ws,conn,conv,event_id,'cloud-job-2','ai',0,request);
  UPDATE public.conversations SET state='human_active',ai_enabled=false WHERE id=conv;
  IF (SELECT state FROM public.message_jobs WHERE operation_id=op) <> 'cancelled'
    OR (SELECT state_revision FROM public.conversations WHERE id=conv) <> 1 THEN RAISE EXCEPTION 'TAKEOVER_FAILED'; END IF;
END;
$assertions$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000101',true);
DO $rls$
BEGIN
  IF (SELECT count(*) FROM public.channel_connections) <> 1 OR
    EXISTS (SELECT 1 FROM public.channel_connections WHERE workspace_id <> '00000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'CLOUD_RLS_TENANT_LEAK';
  END IF;
  BEGIN
    PERFORM 1 FROM public.message_jobs;
    RAISE EXCEPTION 'AUTHENTICATED_QUEUE_ACCESS';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$rls$;
RESET ROLE;
