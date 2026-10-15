-- Filter before the page limit. "mine" always comes from the caller's JWT.
-- A separate RPC name preserves the existing seven-argument API without overloads.
CREATE FUNCTION public.read_inbox_page_assigned(
  p_workspace_id uuid, p_channel text DEFAULT NULL, p_connection_id uuid DEFAULT NULL,
  p_state text DEFAULT NULL, p_search text DEFAULT '',
  p_before_at timestamptz DEFAULT NULL, p_before_id uuid DEFAULT NULL,
  p_assignment text DEFAULT 'all'
) RETURNS SETOF jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF p_workspace_id IS NULL OR p_channel NOT IN ('whatsapp','instagram','messenger','web')
    OR p_state NOT IN ('ai_active','human_active','handoff_pending','waiting_reply','paused','closed')
    OR length(p_search) > 80 OR p_search IS NULL
    OR p_assignment IS NULL OR p_assignment NOT IN ('all','mine','unassigned','assigned')
    OR (p_before_at IS NULL) <> (p_before_id IS NULL) THEN
    RAISE EXCEPTION 'INVALID_INBOX_FILTER' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT to_jsonb(c) || jsonb_build_object('contact',to_jsonb(ct),
    'connection',CASE WHEN cc.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id',cc.id,'channel',cc.channel,'display_name',cc.display_name) END,
    'last_message',preview.value,'activity_at',coalesce(c.last_message_at,c.created_at))
  FROM public.conversations c
  JOIN public.contacts ct ON ct.id=c.contact_id AND ct.workspace_id=c.workspace_id
  LEFT JOIN public.channel_connections cc ON cc.id=c.connection_id AND cc.workspace_id=c.workspace_id
  LEFT JOIN LATERAL (
    SELECT jsonb_build_object('body',m.body,'direction',m.direction,'created_at',m.created_at) value
    FROM public.messages m WHERE m.conversation_id=c.id AND m.workspace_id=c.workspace_id
    ORDER BY m.created_at DESC,m.id DESC LIMIT 1
  ) preview ON true
  WHERE c.workspace_id=p_workspace_id
    AND (p_channel IS NULL OR c.channel::text=p_channel)
    AND (p_connection_id IS NULL OR c.connection_id=p_connection_id)
    AND (p_state IS NULL OR c.state::text=p_state)
    AND (p_assignment='all' OR (p_assignment='mine' AND c.assigned_to=(SELECT auth.uid()))
      OR (p_assignment='unassigned' AND c.assigned_to IS NULL)
      OR (p_assignment='assigned' AND c.assigned_to IS NOT NULL))
    AND (p_search='' OR position(lower(p_search) IN lower(coalesce(ct.name,'') || ' ' ||
      coalesce(ct.phone,'') || ' ' || coalesce(ct.email,''))) > 0)
    AND (p_before_at IS NULL OR (coalesce(c.last_message_at,c.created_at),c.id)<(p_before_at,p_before_id))
  ORDER BY coalesce(c.last_message_at,c.created_at) DESC,c.id DESC LIMIT 51;
END;
$$;
REVOKE ALL ON FUNCTION public.read_inbox_page_assigned(uuid,text,uuid,text,text,timestamptz,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.read_inbox_page_assigned(uuid,text,uuid,text,text,timestamptz,uuid,text) TO authenticated;

-- Keep old callers on the same query and validation, with assignment unrestricted.
CREATE OR REPLACE FUNCTION public.read_inbox_page(
  p_workspace_id uuid, p_channel text DEFAULT NULL, p_connection_id uuid DEFAULT NULL,
  p_state text DEFAULT NULL, p_search text DEFAULT '',
  p_before_at timestamptz DEFAULT NULL, p_before_id uuid DEFAULT NULL
) RETURNS SETOF jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT * FROM public.read_inbox_page_assigned(p_workspace_id,p_channel,p_connection_id,
    p_state,p_search,p_before_at,p_before_id,'all');
$$;
