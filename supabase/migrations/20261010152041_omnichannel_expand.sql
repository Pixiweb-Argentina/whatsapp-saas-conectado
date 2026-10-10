-- F1 additive expansion. Existing WA constraints/writers stay compatible.
-- New transports remain disabled: F3 must replace the non-WA conversation gate
-- only after its authorization, send policy and worker contracts are implemented.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO service_role;

ALTER TABLE public.integrations ADD CONSTRAINT uq_integrations_workspace_id UNIQUE (workspace_id,id);

CREATE TABLE public.channel_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  channel public.conversation_channel NOT NULL,
  provider text NOT NULL,
  external_account_id text NOT NULL CHECK (length(btrim(external_account_id)) > 0),
  display_name text,
  status text NOT NULL DEFAULT 'connecting' CHECK (status IN
    ('connecting','needs_permissions','awaiting_webhook','ready','degraded','revoked')),
  capabilities jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(capabilities) = 'object'),
  legacy_integration_id uuid UNIQUE,
  last_verified_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_channel_connections_workspace_id UNIQUE (workspace_id,id),
  CONSTRAINT uq_channel_connections_workspace_id_channel UNIQUE (workspace_id,id,channel),
  CONSTRAINT uq_channel_connection_account UNIQUE (workspace_id,channel,provider,external_account_id),
  CONSTRAINT fk_channel_connection_legacy FOREIGN KEY (workspace_id,legacy_integration_id)
    REFERENCES public.integrations(workspace_id,id) ON DELETE RESTRICT,
  CONSTRAINT ck_channel_provider CHECK (
    (channel = 'whatsapp' AND provider IN ('ycloud','kapso')) OR
    (channel IN ('instagram','messenger') AND provider = 'meta') OR
    (channel = 'web' AND provider = 'widget')
  ),
  CONSTRAINT ck_channel_revoked CHECK ((status = 'revoked') = (revoked_at IS NOT NULL)),
  CONSTRAINT ck_legacy_is_whatsapp CHECK (legacy_integration_id IS NULL OR channel = 'whatsapp')
);
CREATE UNIQUE INDEX uq_channel_active_asset ON public.channel_connections(provider,channel,external_account_id)
  WHERE revoked_at IS NULL;
CREATE INDEX idx_channel_workspace ON public.channel_connections(workspace_id,status);
ALTER TABLE public.channel_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.channel_connections FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.channel_connections TO authenticated;
GRANT ALL ON public.channel_connections TO service_role;
CREATE POLICY channel_connections_read ON public.channel_connections FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT public.auth_workspace_ids()));
CREATE TRIGGER trg_channel_connections_updated_at BEFORE UPDATE ON public.channel_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TABLE private.channel_credentials (
  connection_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  encrypted_payload text NOT NULL CHECK (length(encrypted_payload) > 0),
  key_version integer NOT NULL CHECK (key_version > 0),
  expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id,connection_id) REFERENCES public.channel_connections(workspace_id,id) ON DELETE CASCADE
);
ALTER TABLE private.channel_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.channel_credentials FROM PUBLIC, anon, authenticated;
GRANT ALL ON private.channel_credentials TO service_role;

CREATE TABLE public.contact_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  external_user_id text NOT NULL CHECK (length(btrim(external_user_id)) > 0),
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_identity_contact FOREIGN KEY (workspace_id,contact_id)
    REFERENCES public.contacts(workspace_id,id) ON DELETE CASCADE,
  CONSTRAINT fk_identity_connection FOREIGN KEY (workspace_id,connection_id)
    REFERENCES public.channel_connections(workspace_id,id) ON DELETE RESTRICT,
  CONSTRAINT uq_identity_external UNIQUE (workspace_id,connection_id,external_user_id),
  CONSTRAINT uq_identity_workspace_id UNIQUE (workspace_id,id),
  CONSTRAINT uq_identity_conversation_ref UNIQUE (workspace_id,connection_id,id,contact_id)
);
CREATE INDEX idx_identity_contact ON public.contact_identities(workspace_id,contact_id);
ALTER TABLE public.contact_identities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contact_identities FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.contact_identities TO authenticated;
GRANT ALL ON public.contact_identities TO service_role;
CREATE POLICY contact_identities_read ON public.contact_identities FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT public.auth_workspace_ids()));

ALTER TABLE public.contacts ALTER COLUMN phone DROP NOT NULL;
ALTER TABLE public.conversations
  ADD COLUMN connection_id uuid,
  ADD COLUMN identity_id uuid,
  ADD COLUMN state_revision bigint NOT NULL DEFAULT 0 CHECK (state_revision >= 0),
  ADD COLUMN source_context jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(source_context) = 'object'),
  ADD CONSTRAINT ck_conversation_identity_pair CHECK ((connection_id IS NULL) = (identity_id IS NULL)),
  ADD CONSTRAINT fk_conversation_channel FOREIGN KEY (workspace_id,connection_id,channel)
    REFERENCES public.channel_connections(workspace_id,id,channel) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conversation_identity FOREIGN KEY (workspace_id,connection_id,identity_id,contact_id)
    REFERENCES public.contact_identities(workspace_id,connection_id,id,contact_id) ON DELETE RESTRICT,
  ADD CONSTRAINT uq_conversation_connection_ref UNIQUE (workspace_id,id,connection_id);
CREATE UNIQUE INDEX uq_conversation_identity ON public.conversations(workspace_id,connection_id,identity_id)
  WHERE connection_id IS NOT NULL;

ALTER TABLE public.messages
  ADD COLUMN connection_id uuid,
  ADD COLUMN external_message_id text,
  ADD COLUMN provider text,
  ADD CONSTRAINT fk_message_connection FOREIGN KEY (workspace_id,conversation_id,connection_id)
    REFERENCES public.conversations(workspace_id,id,connection_id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX uq_message_connection_external ON public.messages(workspace_id,connection_id,external_message_id)
  WHERE connection_id IS NOT NULL AND external_message_id IS NOT NULL;
CREATE INDEX idx_messages_connection ON public.messages(workspace_id,connection_id);

-- Connection routing is immutable; reconnect the same record instead of reassigning
-- a history to a different provider/account. Asset transfer requires a separate workflow.
CREATE FUNCTION private.guard_channel_routing() RETURNS trigger LANGUAGE plpgsql
SET search_path = '' AS $$
BEGIN
  IF (NEW.workspace_id,NEW.channel,NEW.provider,NEW.external_account_id,NEW.legacy_integration_id)
    IS DISTINCT FROM
    (OLD.workspace_id,OLD.channel,OLD.provider,OLD.external_account_id,OLD.legacy_integration_id) THEN
    RAISE EXCEPTION 'CHANNEL_ROUTING_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.guard_channel_routing() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_channel_routing_immutable BEFORE UPDATE ON public.channel_connections
  FOR EACH ROW EXECUTE FUNCTION private.guard_channel_routing();

-- The phone may be absent for new social/web contacts, but never for a contact
-- participating in legacy WA. This guard reads all of that tenant's conversations
-- even if an operator's conversation SELECT policy is narrower.
CREATE FUNCTION private.guard_whatsapp_contact_phone() RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.phone IS NULL AND EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.workspace_id = NEW.workspace_id AND c.contact_id = NEW.id AND c.channel = 'whatsapp'
  ) THEN
    RAISE EXCEPTION 'WHATSAPP_PHONE_REQUIRED' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.guard_whatsapp_contact_phone() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_whatsapp_contact_phone BEFORE UPDATE OF phone ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION private.guard_whatsapp_contact_phone();

CREATE FUNCTION private.guard_conversation_channel() RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER SET search_path = '' AS $$
DECLARE contact_phone text;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.connection_id IS NOT NULL AND
    (NEW.workspace_id,NEW.contact_id,NEW.channel,NEW.connection_id,NEW.identity_id) IS DISTINCT FROM
    (OLD.workspace_id,OLD.contact_id,OLD.channel,OLD.connection_id,OLD.identity_id) THEN
    RAISE EXCEPTION 'CONVERSATION_ROUTING_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  IF NEW.channel <> 'whatsapp' THEN
    RAISE EXCEPTION 'CHANNEL_NOT_ENABLED: F1 schema preparation only' USING ERRCODE = '23514';
  END IF;
  SELECT phone INTO contact_phone FROM public.contacts
    WHERE workspace_id = NEW.workspace_id AND id = NEW.contact_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONTACT_WORKSPACE_MISMATCH' USING ERRCODE = '23503';
  END IF;
  IF contact_phone IS NULL THEN
    RAISE EXCEPTION 'WHATSAPP_PHONE_REQUIRED' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.guard_conversation_channel() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_conversation_channel_guard
  BEFORE INSERT OR UPDATE OF channel,contact_id,workspace_id,connection_id,identity_id ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION private.guard_conversation_channel();

-- Current writers do not know connection_id yet. Fill it from an already backfilled
-- conversation; keep legacy conversations with null connection_id fully usable.
CREATE FUNCTION private.bind_message_channel() RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER SET search_path = '' AS $$
DECLARE expected_connection uuid; expected_provider text; legacy_enabled boolean;
BEGIN
  SELECT c.connection_id,cc.provider,i.enabled INTO expected_connection,expected_provider,legacy_enabled
    FROM public.conversations c LEFT JOIN public.channel_connections cc ON cc.id = c.connection_id
    LEFT JOIN public.integrations i ON i.id = cc.legacy_integration_id AND i.workspace_id = cc.workspace_id
    WHERE c.id = NEW.conversation_id AND c.workspace_id = NEW.workspace_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONVERSATION_WORKSPACE_MISMATCH' USING ERRCODE = '23503';
  END IF;
  -- Preserve legacy provider switching. If a mapped historical provider is no longer
  -- active, an old writer's new message stays unmapped rather than being mislabeled
  -- or blocked. F3 will explicitly route by the correct connection.
  IF NEW.connection_id IS NULL AND legacy_enabled IS DISTINCT FROM true THEN
    IF NEW.provider IS NOT NULL OR NEW.external_message_id IS NOT NULL THEN
      RAISE EXCEPTION 'MESSAGE_UNMAPPED_CONTEXT' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.connection_id IS NOT NULL AND NEW.connection_id IS DISTINCT FROM expected_connection THEN
    RAISE EXCEPTION 'MESSAGE_CONNECTION_MISMATCH' USING ERRCODE = '23503';
  END IF;
  IF NEW.provider IS NOT NULL AND NEW.provider IS DISTINCT FROM expected_provider THEN
    RAISE EXCEPTION 'MESSAGE_PROVIDER_MISMATCH' USING ERRCODE = '23514';
  END IF;
  NEW.connection_id := expected_connection;
  NEW.provider := expected_provider;
  IF expected_connection IS NOT NULL THEN
    IF NEW.external_message_id IS NOT NULL AND NEW.external_message_id IS DISTINCT FROM NEW.wamid THEN
      RAISE EXCEPTION 'WHATSAPP_MESSAGE_ID_MISMATCH' USING ERRCODE = '23514';
    END IF;
    NEW.external_message_id := NEW.wamid;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.bind_message_channel() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_messages_bind_channel BEFORE INSERT OR UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION private.bind_message_channel();
