-- Bind new managed jobs to their original credential source and explicit permission.
-- No historical adoption, grants, activation, credential migration or legacy changes.
BEGIN;
CREATE TABLE private.channel_job_sources (
  operation_id uuid PRIMARY KEY, workspace_id uuid NOT NULL, connection_id uuid NOT NULL,
  source_fingerprint bytea NOT NULL, permission_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(workspace_id,operation_id) REFERENCES public.message_jobs(workspace_id,operation_id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id,connection_id) REFERENCES public.channel_connections(workspace_id,id) ON DELETE CASCADE
);
CREATE INDEX channel_job_sources_scope ON private.channel_job_sources(workspace_id,connection_id);
ALTER TABLE private.channel_job_sources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.channel_job_sources FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON private.channel_job_sources TO service_role;

CREATE FUNCTION private.pin_managed_channel_job_source() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c public.channel_connections; fingerprint bytea;
BEGIN
  SELECT * INTO c FROM public.channel_connections WHERE workspace_id=NEW.workspace_id AND id=NEW.connection_id FOR SHARE;
  IF c.channel IS DISTINCT FROM 'whatsapp' OR c.legacy_integration_id IS NOT NULL
    OR (c.provider IN ('ycloud','kapso')) IS NOT TRUE THEN RETURN NULL; END IF;
  PERFORM 1 FROM private.channel_credentials WHERE workspace_id=c.workspace_id AND connection_id=c.id FOR SHARE;
  fingerprint:=private.whatsapp_account_fingerprint(c.workspace_id,c.id);
  IF fingerprint IS NOT NULL THEN
    INSERT INTO private.channel_job_sources(operation_id,workspace_id,connection_id,source_fingerprint,permission_id)
      VALUES(NEW.operation_id,c.workspace_id,c.id,fingerprint,private.whatsapp_account_owned_permission(c));
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.pin_managed_channel_job_source() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER pin_managed_channel_job_source AFTER INSERT ON public.message_jobs
  FOR EACH ROW EXECUTE FUNCTION private.pin_managed_channel_job_source();

CREATE FUNCTION private.managed_channel_job_source_current(job public.message_jobs,c public.channel_connections)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  PERFORM 1 FROM private.channel_credentials WHERE workspace_id=c.workspace_id AND connection_id=c.id FOR SHARE NOWAIT;
  IF NOT FOUND OR NOT coalesce(private.whatsapp_account_permission_current(c),false) THEN RETURN false; END IF;
  -- Human enqueue builds a transient row before inserting. The real send always has a persisted PK.
  IF job.operation_id IS NULL THEN RETURN true; END IF;
  RETURN EXISTS(SELECT 1 FROM private.channel_job_sources s WHERE s.operation_id=job.operation_id
    AND s.workspace_id=job.workspace_id AND s.connection_id=job.connection_id
    AND s.source_fingerprint=private.whatsapp_account_fingerprint(c.workspace_id,c.id)
    AND s.permission_id=private.whatsapp_account_owned_permission(c));
END;
$$;

CREATE OR REPLACE FUNCTION private.channel_permit_until(job public.message_jobs,conv public.conversations)
RETURNS timestamptz LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE connection public.channel_connections; integration public.integrations; grant_until timestamptz; event_until timestamptz;
BEGIN
  IF job.conversation_id IS NULL OR job.request->>'channel' IS DISTINCT FROM 'whatsapp'
    OR job.request->>'action' IS DISTINCT FROM 'text' OR nullif(btrim(job.request->>'body'),'') IS NULL
    OR conv.connection_id IS DISTINCT FROM job.connection_id OR conv.channel<>'whatsapp' THEN RETURN NULL; END IF;
  SELECT * INTO connection FROM public.channel_connections WHERE workspace_id=job.workspace_id
    AND id=job.connection_id FOR SHARE NOWAIT;
  IF NOT FOUND OR connection.channel<>'whatsapp' OR connection.status<>'ready' OR connection.revoked_at IS NOT NULL THEN RETURN NULL; END IF;
  IF connection.legacy_integration_id IS NULL THEN
    IF NOT private.managed_channel_job_source_current(job,connection) THEN RETURN NULL; END IF;
  ELSE
    SELECT * INTO integration FROM public.integrations WHERE workspace_id=job.workspace_id
      AND id=connection.legacy_integration_id FOR SHARE NOWAIT;
    IF NOT FOUND OR NOT integration.enabled OR integration.provider::text IS DISTINCT FROM connection.provider
      OR (CASE connection.provider WHEN 'ycloud' THEN integration.config->>'phone_number'
        WHEN 'kapso' THEN integration.config->>'phone_number_id' END) IS DISTINCT FROM connection.external_account_id THEN RETURN NULL; END IF;
  END IF;
  IF NOT private.channel_recipient_allowed(job,conv) THEN RETURN NULL; END IF;
  grant_until:=private.channel_text_grant_until(connection); event_until:=private.channel_event_until(job,connection);
  IF grant_until IS NULL OR event_until IS NULL THEN RETURN NULL; END IF;
  RETURN least(grant_until,event_until);
END;
$$;
REVOKE ALL ON FUNCTION private.managed_channel_job_source_current(public.message_jobs,public.channel_connections) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.managed_channel_job_source_current(public.message_jobs,public.channel_connections) TO service_role;
COMMIT;
