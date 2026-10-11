-- Shared comment infrastructure only. No Meta handler/transport/permission is enabled.
-- A future authenticated Meta verifier writes a proof AFTER excluding own/deleted/Live
-- comments and validating the endpoint/account policy. Envelopes alone are not proofs.
CREATE TABLE private.channel_comment_evidence (
  workspace_id uuid NOT NULL, connection_id uuid NOT NULL, external_comment_id text NOT NULL,
  event_id uuid NOT NULL, external_account_id text NOT NULL, external_actor_id text NOT NULL,
  source_kind text NOT NULL CHECK (source_kind IN ('post','reel')),
  occurred_at timestamptz NOT NULL, valid_until timestamptz NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT clock_timestamp(), verification_ref text NOT NULL,
  revoked_at timestamptz,
  PRIMARY KEY (workspace_id,connection_id,external_comment_id),
  FOREIGN KEY (workspace_id,connection_id,event_id) REFERENCES public.inbound_events(workspace_id,connection_id,id),
  CHECK (length(btrim(external_comment_id)) BETWEEN 1 AND 512),
  CHECK (length(btrim(external_account_id)) BETWEEN 1 AND 512),
  CHECK (length(btrim(external_actor_id)) BETWEEN 1 AND 512),
  CHECK (length(btrim(verification_ref)) BETWEEN 1 AND 512),
  CHECK (occurred_at <= verified_at AND valid_until > occurred_at)
);
CREATE TABLE private.private_reply_claims (
  workspace_id uuid NOT NULL, connection_id uuid NOT NULL, external_comment_id text NOT NULL,
  message_operation_id uuid NOT NULL, claimed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id,connection_id,external_comment_id),
  UNIQUE (workspace_id,message_operation_id),
  FOREIGN KEY (workspace_id,connection_id,external_comment_id)
    REFERENCES private.channel_comment_evidence(workspace_id,connection_id,external_comment_id),
  FOREIGN KEY (workspace_id,message_operation_id) REFERENCES public.message_jobs(workspace_id,operation_id)
);
ALTER TABLE private.channel_comment_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.private_reply_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.channel_comment_evidence,private.private_reply_claims FROM PUBLIC,anon,authenticated;
GRANT ALL ON private.channel_comment_evidence,private.private_reply_claims TO service_role;

-- Same grant rules as WA; the action is explicit, never inferred from a token.
CREATE FUNCTION private.channel_action_grant_until(connection public.channel_connections, action text)
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
      AND grant_record->>'connectionId' = connection.id::text AND grant_record->>'capability' = action
      AND length(btrim(grant_record->>'evidenceRef')) BETWEEN 1 AND 512
      AND verified <= clock_timestamp() AND expires > clock_timestamp()) IS TRUE THEN
      latest := greatest(latest,expires);
    END IF;
  END LOOP;
  RETURN latest;
END;
$$;
CREATE OR REPLACE FUNCTION private.channel_text_grant_until(connection public.channel_connections)
RETURNS timestamptz LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT private.channel_action_grant_until(connection,'text');
$$;

CREATE FUNCTION private.eligible_channel_comment(p_workspace_id uuid, p_connection_id uuid,
  p_event_id uuid, p_recipient text) RETURNS SETOF private.channel_comment_evidence
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE proof private.channel_comment_evidence; event public.inbound_events;
  connection public.channel_connections;
BEGIN
  SELECT * INTO connection FROM public.channel_connections WHERE workspace_id = p_workspace_id
    AND id = p_connection_id FOR SHARE NOWAIT;
  IF NOT FOUND OR connection.provider <> 'meta' OR connection.channel NOT IN ('instagram','messenger')
    OR connection.status <> 'ready' OR connection.revoked_at IS NOT NULL THEN RETURN; END IF;
  SELECT * INTO proof FROM private.channel_comment_evidence WHERE workspace_id = p_workspace_id
    AND connection_id = p_connection_id AND event_id = p_event_id AND external_actor_id = p_recipient FOR SHARE NOWAIT;
  IF NOT FOUND OR proof.revoked_at IS NOT NULL OR proof.verified_at > clock_timestamp()
    OR proof.valid_until <= clock_timestamp() OR proof.external_account_id <> connection.external_account_id THEN RETURN; END IF;
  SELECT * INTO event FROM public.inbound_events WHERE workspace_id = p_workspace_id
    AND connection_id = p_connection_id AND id = p_event_id FOR SHARE NOWAIT;
  IF NOT FOUND OR event.historical OR event.kind <> 'comment' OR event.received_at > clock_timestamp() THEN RETURN; END IF;
  IF (event.envelope->'schemaVersion' = '1'::jsonb AND event.envelope->>'kind' = 'comment'
    AND event.envelope->>'workspaceId' = p_workspace_id::text
    AND event.envelope->>'connectionId' = p_connection_id::text
    AND event.envelope->>'channel' = connection.channel::text AND event.envelope->>'provider' = 'meta'
    AND event.envelope->>'externalCommentId' = proof.external_comment_id
    AND event.envelope->>'externalActorId' = p_recipient
    AND private.channel_timestamp(event.envelope->>'occurredAt') = proof.occurred_at
    AND private.channel_timestamp(event.envelope->>'receivedAt') <= clock_timestamp()) IS NOT TRUE THEN RETURN; END IF;
  PERFORM 1 FROM public.contact_identities i JOIN public.contacts c
    ON c.workspace_id = i.workspace_id AND c.id = i.contact_id
    WHERE i.workspace_id = p_workspace_id AND i.connection_id = p_connection_id
      AND i.external_user_id = p_recipient AND i.verified_at <= clock_timestamp()
      AND c.opt_in IS DISTINCT FROM false FOR SHARE OF i,c NOWAIT;
  IF NOT FOUND THEN RETURN; END IF;
  RETURN NEXT proof;
END;
$$;

-- AFTER INSERT makes the job + claim a single transaction. Unique contention
-- chooses one operation; a loser rolls back its job/event update as well.
-- No release/TTL path exists: cancellation or an ambiguous send never frees it.
CREATE FUNCTION private.reserve_channel_private_reply() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE proof private.channel_comment_evidence; connection public.channel_connections; owner uuid;
BEGIN
  IF NEW.request->>'action' NOT IN ('private_reply','public_reply') THEN RETURN NEW; END IF;
  SELECT * INTO proof FROM private.eligible_channel_comment(NEW.workspace_id,NEW.connection_id,
    NEW.event_id,NEW.request->>'recipient');
  IF NOT FOUND OR proof.external_comment_id IS DISTINCT FROM NEW.request->>'commentId' THEN
    RAISE EXCEPTION 'COMMENT_EVIDENCE_REQUIRED' USING ERRCODE = '23514'; END IF;
  SELECT * INTO STRICT connection FROM public.channel_connections
    WHERE workspace_id = NEW.workspace_id AND id = NEW.connection_id;
  IF private.channel_action_grant_until(connection,NEW.request->>'action') IS NULL THEN
    RAISE EXCEPTION 'COMMENT_CAPABILITY_REQUIRED' USING ERRCODE = '23514'; END IF;
  IF NEW.request->>'action' = 'public_reply' THEN RETURN NEW; END IF;
  INSERT INTO private.private_reply_claims(workspace_id,connection_id,external_comment_id,message_operation_id)
    VALUES (NEW.workspace_id,NEW.connection_id,proof.external_comment_id,NEW.operation_id)
    ON CONFLICT (workspace_id,connection_id,external_comment_id) DO NOTHING;
  SELECT message_operation_id INTO STRICT owner FROM private.private_reply_claims
    WHERE workspace_id = NEW.workspace_id AND connection_id = NEW.connection_id
      AND external_comment_id = proof.external_comment_id;
  IF owner IS DISTINCT FROM NEW.operation_id THEN
    RAISE EXCEPTION 'COMMENT_ALREADY_RESERVED' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_jobs_private_reply_reservation AFTER INSERT ON public.message_jobs
  FOR EACH ROW EXECUTE FUNCTION private.reserve_channel_private_reply();

-- Only service callers can read this proof/claim projection. It contains no
-- credentials, payload or rule configuration. The event ID and Meta ID differ.
CREATE FUNCTION public.read_channel_comment_evidence(p_workspace_id uuid, p_connection_id uuid,
  p_event_id uuid, p_recipient text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE proof private.channel_comment_evidence; owner uuid; job_state text; reply_state text;
BEGIN
  SELECT * INTO proof FROM private.eligible_channel_comment(p_workspace_id,p_connection_id,p_event_id,p_recipient);
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT c.message_operation_id,j.state INTO owner,job_state FROM private.private_reply_claims c
    JOIN public.message_jobs j ON j.workspace_id = c.workspace_id AND j.operation_id = c.message_operation_id
    WHERE c.workspace_id = p_workspace_id AND c.connection_id = p_connection_id
      AND c.external_comment_id = proof.external_comment_id;
  reply_state := CASE WHEN owner IS NULL THEN 'available' WHEN job_state = 'accepted' THEN 'sent'
    WHEN job_state IN ('sending','unknown') OR EXISTS (SELECT 1 FROM public.message_outbox o
      WHERE o.workspace_id = p_workspace_id AND o.operation_id = owner) THEN 'consumed' ELSE 'reserved' END;
  RETURN jsonb_build_object('id',proof.event_id,'workspaceId',p_workspace_id,'connectionId',p_connection_id,
    'externalActorId',proof.external_actor_id,'externalCommentId',proof.external_comment_id,'kind','comment',
    'occurredAt',proof.occurred_at,'validUntil',proof.valid_until,'eligible',true,
    'privateReply',reply_state,'reservedOperationId',owner);
END;
$$;
REVOKE ALL ON FUNCTION private.channel_action_grant_until(public.channel_connections,text),
  private.eligible_channel_comment(uuid,uuid,uuid,text),private.reserve_channel_private_reply(),
  public.read_channel_comment_evidence(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.channel_action_grant_until(public.channel_connections,text),
  private.eligible_channel_comment(uuid,uuid,uuid,text),private.reserve_channel_private_reply(),
  public.read_channel_comment_evidence(uuid,uuid,uuid,text) TO service_role;
