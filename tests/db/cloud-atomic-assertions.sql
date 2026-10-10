-- Run only with cloud-atomic-send.mjs's synthetic fixture present; rolls back.
BEGIN;
UPDATE public.channel_connections SET status='ready'
WHERE id='00000000-0000-4000-8000-000000990051' AND workspace_id='00000000-0000-4000-8000-000000990001';
SET LOCAL ROLE service_role;
DO $probe$
DECLARE ws uuid := '00000000-0000-4000-8000-000000990001';
  operation uuid := '00000000-0000-4000-8000-000000990062';
  worker uuid := '00000000-0000-4000-8000-000000990071';
  job public.message_jobs; message public.messages;
BEGIN
  PERFORM public.enqueue_channel_job(ws,'00000000-0000-4000-8000-000000990051',
    '00000000-0000-4000-8000-000000990031','00000000-0000-4000-8000-000000990091',
    'atomic-human-control','human',0,jsonb_build_object('operationId',operation,'channel','whatsapp',
    'recipient','+15555559901','action','text','body','Synthetic accepted result, SQL only'),
    'f2913ed0-08e2-4700-91c5-fe2760e724b2');
  SELECT * INTO STRICT job FROM public.claim_channel_job(ws,worker);
  IF job.operation_id <> operation THEN RAISE EXCEPTION 'WRONG_JOB'; END IF;
  IF public.begin_channel_send(ws,operation,worker,job.fence,'forged-evidence',now()+interval '1 minute')
    THEN RAISE EXCEPTION 'FORGED_EVIDENCE_ACCEPTED'; END IF;
  IF NOT public.begin_channel_send(ws,operation,worker,job.fence,job.event_id::text,now()+interval '1 minute')
    THEN RAISE EXCEPTION 'CONTROL_PERMIT_DENIED'; END IF;
  SELECT * INTO STRICT message FROM public.messages WHERE workspace_id=ws AND channel_operation_id=operation;
  IF message.status <> 'queued' OR message.sender_user_id <> 'f2913ed0-08e2-4700-91c5-fe2760e724b2'
    OR message.meta->>'channel_actor' <> 'human' THEN RAISE EXCEPTION 'VISIBLE_MESSAGE_MISMATCH'; END IF;
  IF NOT public.finish_channel_send(ws,operation,worker,job.fence,
    '{"status":"accepted","externalId":"synthetic-provider-id","providerMessageId":"synthetic-provider-id"}')
    THEN RAISE EXCEPTION 'FINISH_FAILED'; END IF;
  SELECT * INTO STRICT message FROM public.messages WHERE workspace_id=ws AND channel_operation_id=operation;
  IF message.status <> 'sent' OR message.wamid IS NOT NULL OR message.external_message_id IS NOT NULL
    OR message.meta->>'ycloud_id' <> 'synthetic-provider-id' THEN RAISE EXCEPTION 'PROVIDER_ID_MISMATCH'; END IF;
  IF public.finish_channel_send(ws,operation,worker,job.fence,'{"status":"accepted","externalId":"duplicate"}')
    THEN RAISE EXCEPTION 'DOUBLE_FINISH'; END IF;
  IF EXISTS (SELECT 1 FROM public.claim_channel_job(ws,worker)) THEN RAISE EXCEPTION 'TERMINAL_RECLAIMED'; END IF;
END $probe$;
ROLLBACK;
SELECT 'atomic assertions passed and rolled back' AS result;
