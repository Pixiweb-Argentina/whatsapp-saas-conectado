-- F3 durable pipeline. No legacy writer/cron is switched to this queue yet.
CREATE TABLE public.inbound_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  provider_event_id text NOT NULL CHECK (length(provider_event_id) BETWEEN 1 AND 512),
  kind text NOT NULL CHECK (kind IN ('message','comment','outbound_echo','delivery_receipt')),
  envelope jsonb NOT NULL CHECK (jsonb_typeof(envelope) = 'object'),
  historical boolean NOT NULL DEFAULT false,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','planned','ignored')),
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (workspace_id,connection_id) REFERENCES public.channel_connections(workspace_id,id),
  UNIQUE (workspace_id,connection_id,provider_event_id),
  UNIQUE (workspace_id,connection_id,id)
);
CREATE INDEX idx_inbound_pending ON public.inbound_events(workspace_id,received_at,id) WHERE state = 'pending';

CREATE TABLE public.message_jobs (
  operation_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  conversation_id uuid,
  event_id uuid,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 512),
  actor text NOT NULL CHECK (actor IN ('human','ai','automation')),
  request jsonb NOT NULL,
  expected_state_revision bigint CHECK (expected_state_revision >= 0),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN
    ('pending','leased','sending','accepted','rejected','unknown','cancelled','dead_letter')),
  run_after timestamptz NOT NULL DEFAULT clock_timestamp(),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  fence bigint NOT NULL DEFAULT 0 CHECK (fence >= 0),
  lease_owner uuid,
  lease_until timestamptz,
  result_external_id text,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (workspace_id,connection_id) REFERENCES public.channel_connections(workspace_id,id),
  FOREIGN KEY (workspace_id,conversation_id,connection_id)
    REFERENCES public.conversations(workspace_id,id,connection_id),
  FOREIGN KEY (workspace_id,connection_id,event_id)
    REFERENCES public.inbound_events(workspace_id,connection_id,id),
  UNIQUE (workspace_id,connection_id,idempotency_key),
  UNIQUE (workspace_id,operation_id),
  CHECK ((conversation_id IS NULL) = (expected_state_revision IS NULL)),
  CHECK (conversation_id IS NOT NULL OR event_id IS NOT NULL),
  CHECK ((jsonb_typeof(request) = 'object' AND request->>'operationId' = operation_id::text
    AND request->>'action' IN ('text','template','private_reply','public_reply','media')
    AND length(request->>'recipient') BETWEEN 1 AND 512) IS TRUE),
  CHECK (conversation_id IS NOT NULL OR request->>'action' IN ('private_reply','public_reply')),
  CHECK ((state IN ('leased','sending')) = (lease_owner IS NOT NULL AND lease_until IS NOT NULL)),
  CHECK ((lease_owner IS NULL) = (lease_until IS NULL)),
  CHECK ((state = 'accepted') = (result_external_id IS NOT NULL))
);
CREATE INDEX idx_jobs_due ON public.message_jobs(workspace_id,run_after,created_at,operation_id)
  WHERE state = 'pending';
CREATE INDEX idx_jobs_expired ON public.message_jobs(workspace_id,lease_until,operation_id)
  WHERE state IN ('leased','sending');
CREATE INDEX idx_jobs_conversation ON public.message_jobs(workspace_id,conversation_id)
  WHERE state IN ('pending','leased','sending');
CREATE INDEX idx_jobs_event ON public.message_jobs(workspace_id,connection_id,event_id);

-- A durable send permit per attempt, committed BEFORE calling a remote provider.
-- A permit may have reached the network even if its result could not be stored.
CREATE TABLE public.message_outbox (
  workspace_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  fence bigint NOT NULL,
  state text NOT NULL DEFAULT 'sending' CHECK (state IN ('sending','accepted','rejected','unknown')),
  policy_evidence_id text NOT NULL CHECK (length(policy_evidence_id) BETWEEN 1 AND 512),
  policy_valid_until timestamptz NOT NULL,
  result_external_id text,
  error_code text,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  PRIMARY KEY (workspace_id,operation_id,fence),
  FOREIGN KEY (workspace_id,operation_id) REFERENCES public.message_jobs(workspace_id,operation_id),
  CHECK ((state = 'accepted') = (result_external_id IS NOT NULL))
);

-- Payloads are server-only. An eventual inbox status endpoint must redact content
-- and enforce the existing operator permissions, rather than expose these tables.
ALTER TABLE public.inbound_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inbound_events,public.message_jobs,public.message_outbox FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.inbound_events,public.message_jobs,public.message_outbox TO service_role;

-- This internal trigger needs to see jobs even for an authenticated operator.
-- Scope comes from the conversation row already authorized by existing RLS.
-- No callable definer RPC is exposed and no provider request occurs in a trigger.
CREATE FUNCTION private.invalidate_channel_jobs() RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (NEW.state,NEW.ai_enabled,NEW.assigned_to) IS DISTINCT FROM (OLD.state,OLD.ai_enabled,OLD.assigned_to) THEN
    NEW.state_revision := OLD.state_revision + 1;
    UPDATE public.message_jobs SET state = 'cancelled', last_error_code = 'conversation_changed',
      lease_owner = NULL, lease_until = NULL, updated_at = clock_timestamp()
    WHERE workspace_id = OLD.workspace_id AND conversation_id = OLD.id
      AND actor <> 'human' AND state IN ('pending','leased');
  ELSE
    NEW.state_revision := OLD.state_revision;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.invalidate_channel_jobs() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER trg_conversations_channel_revision BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION private.invalidate_channel_jobs();
