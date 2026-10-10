-- A permit and its visible outbound message commit together, before HTTP.
-- Never retrofit an in-flight legacy permit with an invented message/result.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.message_jobs WHERE state = 'sending') THEN
    RAISE EXCEPTION 'RECONCILE_IN_FLIGHT_CHANNEL_JOBS_BEFORE_UPGRADE'; END IF;
END $$;
ALTER TABLE public.messages ADD COLUMN channel_operation_id uuid;
ALTER TABLE public.messages ADD CONSTRAINT messages_channel_operation_fk
  FOREIGN KEY(workspace_id,channel_operation_id) REFERENCES public.message_jobs(workspace_id,operation_id) ON DELETE CASCADE;
CREATE UNIQUE INDEX messages_channel_operation_unique ON public.messages(channel_operation_id)
  WHERE channel_operation_id IS NOT NULL;
ALTER TABLE public.message_jobs ADD COLUMN result_wamid text, ADD COLUMN result_provider_message_id text;

CREATE FUNCTION private.guard_channel_job_message() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (CASE WHEN TG_OP <> 'DELETE' THEN NEW.channel_operation_id IS NOT NULL ELSE false END)
    OR (CASE WHEN TG_OP <> 'INSERT' THEN OLD.channel_operation_id IS NOT NULL ELSE false END) THEN
    IF coalesce(current_setting('role',true),'none') IN ('anon','authenticated') THEN
      RAISE EXCEPTION 'CHANNEL_MESSAGE_SERVER_ONLY' USING ERRCODE = '42501'; END IF;
    IF TG_OP = 'UPDATE' AND OLD.channel_operation_id IS NOT NULL AND
      (NEW.channel_operation_id,NEW.workspace_id,NEW.conversation_id,NEW.connection_id,NEW.body)
      IS DISTINCT FROM (OLD.channel_operation_id,OLD.workspace_id,OLD.conversation_id,OLD.connection_id,OLD.body)
      THEN RAISE EXCEPTION 'CHANNEL_MESSAGE_IMMUTABLE' USING ERRCODE = '23514'; END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_messages_channel_job_guard BEFORE INSERT OR UPDATE OR DELETE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION private.guard_channel_job_message();

CREATE FUNCTION private.sync_channel_job_message() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.state = 'sending' AND OLD.state = 'leased' THEN
    INSERT INTO public.messages(workspace_id,conversation_id,connection_id,channel_operation_id,
      direction,type,body,status,sender_user_id,meta)
    VALUES (NEW.workspace_id,NEW.conversation_id,NEW.connection_id,NEW.operation_id,
      'out','text',NEW.request->>'body','queued',NEW.sender_user_id,
      jsonb_build_object('channel_actor',NEW.actor,'send_outcome','sending'));
  ELSIF NEW.state IN ('accepted','rejected','unknown') AND OLD.state = 'sending' THEN
    UPDATE public.messages SET
      status = (CASE WHEN NEW.state = 'accepted' THEN 'sent' ELSE 'failed' END)::public.message_status,
      wamid = NEW.result_wamid,
      error_message = CASE WHEN NEW.state = 'unknown' THEN
        'No pudimos confirmar el envío. No lo reenvíes hasta verificarlo para evitar duplicados.'
        WHEN NEW.state = 'rejected' THEN 'El proveedor rechazó el envío. El mensaje no fue aceptado.' END,
      meta = meta || jsonb_strip_nulls(jsonb_build_object('send_outcome',NEW.state,
        'provider_message_id',NEW.result_provider_message_id,
        'ycloud_id',CASE WHEN provider = 'ycloud' THEN NEW.result_provider_message_id END))
      WHERE workspace_id = NEW.workspace_id AND channel_operation_id = NEW.operation_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'CHANNEL_MESSAGE_MISSING' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER trg_message_jobs_visible_message AFTER UPDATE OF state ON public.message_jobs
  FOR EACH ROW WHEN (OLD.state IS DISTINCT FROM NEW.state) EXECUTE FUNCTION private.sync_channel_job_message();

CREATE OR REPLACE FUNCTION public.finish_channel_send(p_workspace_id uuid, p_operation_id uuid, p_worker_id uuid,
  p_fence bigint, p_result jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE outcome text := p_result->>'status'; external_id text := p_result->>'externalId';
BEGIN
  IF outcome IS NULL OR outcome NOT IN ('accepted','rejected','unknown') OR
    (outcome = 'accepted' AND (external_id IS NULL OR length(btrim(external_id)) = 0)) OR
    (outcome = 'unknown' AND p_result->>'operationId' IS DISTINCT FROM p_operation_id::text) THEN
    RAISE EXCEPTION 'INVALID_SEND_RESULT' USING ERRCODE = '23514'; END IF;
  UPDATE public.message_jobs SET state = outcome,
    result_external_id = CASE WHEN outcome = 'accepted' THEN external_id END,
    result_wamid = CASE WHEN outcome = 'accepted' THEN nullif(p_result->>'wamid','') END,
    result_provider_message_id = CASE WHEN outcome = 'accepted' THEN nullif(p_result->>'providerMessageId','') END,
    last_error_code = CASE WHEN outcome = 'rejected' THEN left(p_result->>'errorCode',100)
      WHEN outcome = 'unknown' THEN 'provider_unconfirmed' END,
    lease_owner = NULL, lease_until = NULL, updated_at = clock_timestamp()
    WHERE workspace_id = p_workspace_id AND operation_id = p_operation_id AND state = 'sending'
      AND lease_owner = p_worker_id AND fence = p_fence AND lease_until > clock_timestamp();
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.message_outbox SET state = outcome,
    result_external_id = CASE WHEN outcome = 'accepted' THEN external_id END,
    error_code = CASE WHEN outcome = 'rejected' THEN left(p_result->>'errorCode',100)
      WHEN outcome = 'unknown' THEN 'provider_unconfirmed' END, finished_at = clock_timestamp()
    WHERE workspace_id = p_workspace_id AND operation_id = p_operation_id AND fence = p_fence;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_channel_job_message(),private.sync_channel_job_message() FROM PUBLIC,anon,authenticated;
