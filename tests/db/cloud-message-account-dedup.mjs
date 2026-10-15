// Synthetic-only SQL for the new project. Does not invoke a transport or model.
const id = (n) => `00000000-0000-4000-9000-${String(2900 + n).padStart(12, "0")}`;
export const fixtureWorkspace = id(1);
const route = JSON.stringify({ integrationId: id(3), provider: "ycloud", accountId: "+15555550290" });
export const probe = `BEGIN;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.workspaces WHERE id='${id(1)}' OR slug='f3-dedup29-synthetic') THEN
    RAISE EXCEPTION 'FIXTURE_EXISTS_RECONCILE_FIRST'; END IF;
END $$;
INSERT INTO public.workspaces(id,name,slug) VALUES('${id(1)}','F3 Dedup · synthetic','f3-dedup29-synthetic');
INSERT INTO public.contacts(id,workspace_id,phone,name,opt_in)
  VALUES('${id(2)}','${id(1)}','+15555550929','Synthetic contact',false);
INSERT INTO public.integrations(id,workspace_id,provider,enabled,config)
  VALUES('${id(3)}','${id(1)}','ycloud',true,'{"phone_number":"+15555550290"}');
INSERT INTO public.channel_connections(id,workspace_id,channel,provider,external_account_id,status,legacy_integration_id)
  VALUES('${id(4)}','${id(1)}','whatsapp','ycloud','+15555550290','needs_permissions','${id(3)}'),
    ('${id(5)}','${id(1)}','whatsapp','ycloud','+15555550291','needs_permissions',NULL);
INSERT INTO public.contact_identities(id,workspace_id,connection_id,contact_id,external_user_id)
  VALUES('${id(6)}','${id(1)}','${id(4)}','${id(2)}','+15555550929'),
    ('${id(7)}','${id(1)}','${id(5)}','${id(2)}','+15555550929');
INSERT INTO public.conversations(id,workspace_id,contact_id,channel,connection_id,identity_id,state,ai_enabled,window_expires_at)
  VALUES('${id(8)}','${id(1)}','${id(2)}','whatsapp','${id(4)}','${id(6)}','human_active',false,now()+interval '1 hour');
INSERT INTO public.messages(id,workspace_id,conversation_id,connection_id,direction,type,body,wamid,status,meta)
  VALUES('${id(10)}','${id(1)}','${id(8)}','${id(4)}','out','text','Synthetic A','wamid.dedup29','sent','{"ycloud_id":"provider.dedup29"}');
DO $$ BEGIN
  IF (SELECT id FROM public.read_legacy_whatsapp_message('${id(1)}','wamid.dedup29','provider.dedup29','${route}'))
    IS DISTINCT FROM '${id(10)}'::uuid THEN RAISE EXCEPTION 'LEGACY_SINGLE_ACCOUNT_FAILED'; END IF;
  BEGIN
    PERFORM public.read_legacy_whatsapp_message('${id(1)}','wamid.dedup29','provider.wrong','${route}');
    RAISE EXCEPTION 'ID_CONFLICT_ACCEPTED';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
INSERT INTO public.conversations(id,workspace_id,contact_id,channel,connection_id,identity_id,state,ai_enabled)
  VALUES('${id(9)}','${id(1)}','${id(2)}','whatsapp','${id(5)}','${id(7)}','human_active',false);
INSERT INTO public.messages(id,workspace_id,conversation_id,connection_id,direction,type,body,wamid,status,message_account_scope)
  VALUES('${id(11)}','${id(1)}','${id(9)}','${id(5)}','in','text','Synthetic B','wamid.dedup29','delivered','forged');
DO $$ DECLARE replay uuid; BEGIN
  IF (SELECT count(*) FROM public.messages WHERE workspace_id='${id(1)}' AND wamid='wamid.dedup29')<>2
    THEN RAISE EXCEPTION 'ACCOUNTS_NOT_SEPARATED'; END IF;
  IF EXISTS(SELECT 1 FROM public.messages WHERE workspace_id='${id(1)}'
    AND message_account_scope<>connection_id::text) THEN RAISE EXCEPTION 'SCOPE_SPOOFED'; END IF;
  INSERT INTO public.messages(workspace_id,conversation_id,connection_id,direction,type,body,wamid,status)
    VALUES('${id(1)}','${id(9)}','${id(5)}','in','text','Changed replay','wamid.dedup29','delivered')
    ON CONFLICT(workspace_id,message_account_scope,wamid) DO NOTHING RETURNING id INTO replay;
  IF replay IS NOT NULL THEN RAISE EXCEPTION 'REPLAY_INSERTED'; END IF;
  IF (SELECT body FROM public.messages WHERE id='${id(11)}')<>'Synthetic B' THEN RAISE EXCEPTION 'REPLAY_CHANGED_BODY'; END IF;
  BEGIN
    PERFORM public.read_legacy_whatsapp_message('${id(1)}','wamid.dedup29',NULL,'${route}');
    RAISE EXCEPTION 'AMBIGUOUS_STATUS_ACCEPTED';
  EXCEPTION WHEN check_violation THEN NULL; END;
  IF EXISTS(SELECT 1 FROM public.message_jobs WHERE workspace_id='${id(1)}')
    OR EXISTS(SELECT 1 FROM public.message_outbox WHERE workspace_id='${id(1)}')
    OR EXISTS(SELECT 1 FROM public.contacts WHERE workspace_id='${id(1)}' AND opt_in)
    OR EXISTS(SELECT 1 FROM public.channel_connections WHERE workspace_id='${id(1)}' AND status<>'needs_permissions')
    THEN RAISE EXCEPTION 'AUTHORITY_CHANGED'; END IF;
END $$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM public.read_legacy_whatsapp_message('${id(1)}','wamid.dedup29',NULL,'${route}');
    RAISE EXCEPTION 'BROWSER_READER_ALLOWED';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
SELECT NOT EXISTS(SELECT 1 FROM public.workspaces WHERE id='${id(1)}') AS fixture_removed,
  NOT EXISTS(SELECT 1 FROM public.messages WHERE workspace_id='${id(1)}') AS fixture_messages_removed;
`;
