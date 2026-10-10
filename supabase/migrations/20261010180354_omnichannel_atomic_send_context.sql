-- Only the WA text path has persisted evidence today. Other actions fail closed.
-- Context row locks use NOWAIT: a concurrent change defers the job, never a send.
CREATE FUNCTION private.channel_timestamp(value text) RETURNS timestamptz
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF value IS NULL OR value !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$' THEN RETURN NULL; END IF;
  RETURN value::timestamptz;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN NULL;
END;
$$;

-- A row lock cannot protect an absent suppression. All INSERT/UPDATE/DELETE
-- writers (including legacy STOP and manual opt-out) share this recipient lock.
CREATE FUNCTION private.lock_channel_suppression() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE lock_key text;
BEGIN
  FOR lock_key IN SELECT DISTINCT k FROM unnest(ARRAY[
    CASE WHEN TG_OP <> 'INSERT' THEN OLD.workspace_id::text || ':' || OLD.phone_key END,
    CASE WHEN TG_OP <> 'DELETE' THEN NEW.workspace_id::text || ':' || NEW.phone_key END
  ]) AS keys(k) WHERE k IS NOT NULL ORDER BY k LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('channel-suppression:' || lock_key,0));
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_contact_opt_outs_channel_lock BEFORE INSERT OR UPDATE OR DELETE ON public.contact_opt_outs
  FOR EACH ROW EXECUTE FUNCTION private.lock_channel_suppression();

CREATE FUNCTION private.channel_text_grant_until(connection public.channel_connections)
RETURNS timestamptz LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE grant_record jsonb; expires timestamptz; verified timestamptz; latest timestamptz;
BEGIN
  IF connection.capabilities->'version' IS DISTINCT FROM '1'::jsonb
    OR jsonb_typeof(connection.capabilities->'grants') IS DISTINCT FROM 'array' THEN RETURN NULL; END IF;
  IF jsonb_array_length(connection.capabilities->'grants') > 32 THEN RETURN NULL; END IF;
  FOR grant_record IN SELECT value FROM jsonb_array_elements(connection.capabilities->'grants') LOOP
    verified := private.channel_timestamp(grant_record->>'verifiedAt');
    expires := private.channel_timestamp(grant_record->>'validUntil');
    IF (grant_record->>'workspaceId' = connection.workspace_id::text
      AND grant_record->>'connectionId' = connection.id::text AND grant_record->>'capability' = 'text'
      AND length(btrim(grant_record->>'evidenceRef')) BETWEEN 1 AND 512
      AND verified <= clock_timestamp() AND expires > clock_timestamp()) IS TRUE THEN
      latest := greatest(latest,expires);
    END IF;
  END LOOP;
  RETURN latest;
END;
$$;

CREATE FUNCTION private.channel_recipient_allowed(job public.message_jobs, conv public.conversations)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE identity public.contact_identities; contact public.contacts; recipient_key text;
BEGIN
  SELECT * INTO identity FROM public.contact_identities WHERE workspace_id = job.workspace_id
    AND connection_id = job.connection_id AND id = conv.identity_id FOR SHARE NOWAIT;
  IF NOT FOUND OR identity.contact_id IS DISTINCT FROM conv.contact_id
    OR identity.external_user_id IS DISTINCT FROM job.request->>'recipient'
    OR identity.verified_at IS NULL OR identity.verified_at > clock_timestamp() THEN RETURN false; END IF;
  SELECT * INTO contact FROM public.contacts WHERE workspace_id = job.workspace_id
    AND id = identity.contact_id FOR SHARE NOWAIT;
  IF NOT FOUND OR contact.opt_in IS NOT TRUE THEN RETURN false; END IF;
  recipient_key := public.contact_phone_key(identity.external_user_id);
  IF recipient_key IS NULL OR NOT pg_try_advisory_xact_lock(hashtextextended(
    'channel-suppression:' || job.workspace_id::text || ':' || recipient_key,0)) THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.contact_opt_outs o WHERE o.workspace_id = job.workspace_id
    AND o.phone_key = recipient_key) THEN RETURN false; END IF;
  IF job.actor = 'human' THEN
    PERFORM 1 FROM public.memberships WHERE workspace_id = job.workspace_id AND user_id = job.sender_user_id
      AND is_active AND role IN ('admin','manager','agent') FOR SHARE NOWAIT;
    IF NOT FOUND THEN RETURN false; END IF;
  END IF;
  RETURN true;
END;
$$;

ALTER TABLE public.message_jobs ADD COLUMN sender_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL;
-- Preserve the proven enqueue implementation privately; the public wrapper
-- validates human attribution and includes it in idempotency semantics.
ALTER FUNCTION public.enqueue_channel_job(uuid,uuid,uuid,uuid,text,text,bigint,jsonb) SET SCHEMA private;
CREATE FUNCTION public.enqueue_channel_job(p_workspace_id uuid, p_connection_id uuid, p_conversation_id uuid,
  p_event_id uuid, p_idempotency_key text, p_actor text, p_expected_revision bigint, p_request jsonb,
  p_sender_user_id uuid DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE operation uuid; existing_sender uuid;
BEGIN
  IF (p_actor = 'human') IS DISTINCT FROM (p_sender_user_id IS NOT NULL) THEN
    RAISE EXCEPTION 'JOB_SENDER_REQUIRED' USING ERRCODE = '23514'; END IF;
  IF p_actor = 'human' AND NOT EXISTS (SELECT 1 FROM public.memberships WHERE workspace_id = p_workspace_id
    AND user_id = p_sender_user_id AND is_active AND role IN ('admin','manager','agent')) THEN
    RAISE EXCEPTION 'JOB_SENDER_FORBIDDEN' USING ERRCODE = '42501'; END IF;
  operation := private.enqueue_channel_job(p_workspace_id,p_connection_id,p_conversation_id,p_event_id,
    p_idempotency_key,p_actor,p_expected_revision,p_request);
  SELECT sender_user_id INTO existing_sender FROM public.message_jobs WHERE operation_id = operation FOR UPDATE;
  IF existing_sender IS NOT NULL AND existing_sender IS DISTINCT FROM p_sender_user_id THEN
    RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE = '23514'; END IF;
  UPDATE public.message_jobs SET sender_user_id = p_sender_user_id WHERE operation_id = operation;
  RETURN operation;
END;
$$;

CREATE FUNCTION private.channel_event_until(job public.message_jobs, connection public.channel_connections)
RETURNS timestamptz LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE event public.inbound_events; occurred timestamptz; received timestamptz;
BEGIN
  SELECT * INTO event FROM public.inbound_events WHERE workspace_id = job.workspace_id
    AND connection_id = job.connection_id AND id = job.event_id FOR SHARE NOWAIT;
  IF NOT FOUND OR event.historical OR event.kind <> 'message' THEN RETURN NULL; END IF;
  IF (event.envelope->>'workspaceId' = job.workspace_id::text
    AND event.envelope->>'connectionId' = job.connection_id::text
    AND event.envelope->>'channel' = 'whatsapp' AND event.envelope->>'provider' = connection.provider
    AND event.envelope->>'kind' = 'message' AND event.envelope->'schemaVersion' = '1'::jsonb
    AND event.envelope->>'externalActorId' = job.request->>'recipient'
    AND length(btrim(event.envelope->>'externalMessageId')) > 0) IS NOT TRUE THEN RETURN NULL; END IF;
  occurred := private.channel_timestamp(event.envelope->>'occurredAt');
  received := private.channel_timestamp(event.envelope->>'receivedAt');
  IF occurred IS NULL OR received IS NULL OR occurred > clock_timestamp() OR received > clock_timestamp()
    OR event.received_at > clock_timestamp() THEN RETURN NULL; END IF;
  RETURN occurred + interval '24 hours';
END;
$$;

CREATE FUNCTION private.channel_permit_until(job public.message_jobs, conv public.conversations)
RETURNS timestamptz LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE connection public.channel_connections; integration public.integrations;
  grant_until timestamptz; event_until timestamptz;
BEGIN
  IF job.conversation_id IS NULL OR job.request->>'channel' IS DISTINCT FROM 'whatsapp'
    OR job.request->>'action' IS DISTINCT FROM 'text' OR nullif(btrim(job.request->>'body'),'') IS NULL
    OR conv.connection_id IS DISTINCT FROM job.connection_id OR conv.channel <> 'whatsapp' THEN RETURN NULL; END IF;
  SELECT * INTO connection FROM public.channel_connections WHERE workspace_id = job.workspace_id
    AND id = job.connection_id FOR SHARE NOWAIT;
  IF NOT FOUND OR connection.channel <> 'whatsapp' OR connection.status <> 'ready'
    OR connection.revoked_at IS NOT NULL THEN RETURN NULL; END IF;
  SELECT * INTO integration FROM public.integrations WHERE workspace_id = job.workspace_id
    AND id = connection.legacy_integration_id FOR SHARE NOWAIT;
  IF NOT FOUND OR NOT integration.enabled OR integration.provider::text IS DISTINCT FROM connection.provider
    OR (CASE connection.provider WHEN 'ycloud' THEN integration.config->>'phone_number'
      WHEN 'kapso' THEN integration.config->>'phone_number_id' END)
      IS DISTINCT FROM connection.external_account_id THEN RETURN NULL; END IF;
  IF NOT private.channel_recipient_allowed(job,conv) THEN RETURN NULL; END IF;
  grant_until := private.channel_text_grant_until(connection);
  event_until := private.channel_event_until(job,connection);
  IF grant_until IS NULL OR event_until IS NULL THEN RETURN NULL; END IF;
  RETURN least(grant_until,event_until);
END;
$$;

CREATE OR REPLACE FUNCTION public.begin_channel_send(p_workspace_id uuid, p_operation_id uuid, p_worker_id uuid,
  p_fence bigint, p_evidence_id text, p_valid_until timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE job public.message_jobs; conv public.conversations; conversation uuid; verified_until timestamptz;
BEGIN
  SELECT conversation_id INTO conversation FROM public.message_jobs
    WHERE workspace_id = p_workspace_id AND operation_id = p_operation_id;
  IF conversation IS NOT NULL THEN
    SELECT * INTO conv FROM public.conversations WHERE workspace_id = p_workspace_id AND id = conversation FOR UPDATE;
  END IF;
  SELECT * INTO job FROM public.message_jobs WHERE workspace_id = p_workspace_id AND operation_id = p_operation_id FOR UPDATE;
  IF NOT FOUND OR job.state <> 'leased' OR job.lease_owner IS DISTINCT FROM p_worker_id
    OR job.fence IS DISTINCT FROM p_fence OR job.lease_until <= clock_timestamp() THEN RETURN false; END IF;
  IF conv.state_revision IS DISTINCT FROM job.expected_state_revision OR conv.state = 'closed'
    OR (job.actor <> 'human' AND (NOT conv.ai_enabled OR conv.state <> 'ai_active')) THEN
    UPDATE public.message_jobs SET state = 'cancelled', last_error_code = 'conversation_changed',
      lease_owner = NULL, lease_until = NULL, updated_at = clock_timestamp() WHERE operation_id = p_operation_id;
    RETURN false;
  END IF;
  IF job.event_id IS NULL OR p_evidence_id IS DISTINCT FROM job.event_id::text THEN RETURN false; END IF;
  verified_until := private.channel_permit_until(job,conv);
  IF verified_until IS NULL OR p_valid_until IS NULL OR p_valid_until > verified_until
    OR p_valid_until <= clock_timestamp() OR job.lease_until <= clock_timestamp() THEN RETURN false; END IF;
  INSERT INTO public.message_outbox(workspace_id,operation_id,fence,policy_evidence_id,policy_valid_until)
    VALUES (p_workspace_id,p_operation_id,p_fence,job.event_id::text,p_valid_until);
  UPDATE public.message_jobs SET state = 'sending', updated_at = clock_timestamp() WHERE operation_id = p_operation_id;
  RETURN true;
EXCEPTION WHEN lock_not_available THEN RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION private.channel_timestamp(text),private.lock_channel_suppression(),
  private.channel_text_grant_until(public.channel_connections),
  private.channel_recipient_allowed(public.message_jobs,public.conversations),
  private.channel_event_until(public.message_jobs,public.channel_connections),
  private.channel_permit_until(public.message_jobs,public.conversations),
  public.enqueue_channel_job(uuid,uuid,uuid,uuid,text,text,bigint,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.channel_timestamp(text),
  private.channel_text_grant_until(public.channel_connections),
  private.channel_recipient_allowed(public.message_jobs,public.conversations),
  private.channel_event_until(public.message_jobs,public.channel_connections),
  private.channel_permit_until(public.message_jobs,public.conversations),
  public.enqueue_channel_job(uuid,uuid,uuid,uuid,text,text,bigint,jsonb,uuid) TO service_role;
