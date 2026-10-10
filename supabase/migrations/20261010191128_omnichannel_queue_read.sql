-- Only a bounded operator projection is exposed; jobs remain service-only.
CREATE INDEX idx_jobs_inbox_pending ON public.message_jobs
  (workspace_id,conversation_id,created_at DESC,operation_id DESC)
  WHERE state IN ('pending','leased','cancelled','dead_letter');

CREATE FUNCTION private.read_conversation_queue(p_workspace_id uuid,p_conversation_id uuid)
RETURNS SETOF jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('operationId',j.operation_id,'state',j.state,
    'actor',j.actor,'body',j.request->>'body','createdAt',j.created_at)
  FROM public.message_jobs j
  JOIN public.conversations c ON c.id=j.conversation_id AND c.workspace_id=j.workspace_id
  WHERE j.workspace_id=p_workspace_id AND j.conversation_id=p_conversation_id
    AND auth.uid() IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.memberships m WHERE m.workspace_id=c.workspace_id
      AND m.user_id=auth.uid() AND m.is_active)
    AND j.state IN ('pending','leased','cancelled','dead_letter') AND j.request->>'action'='text'
    AND NOT EXISTS (SELECT 1 FROM public.messages msg WHERE msg.workspace_id=j.workspace_id
      AND msg.channel_operation_id=j.operation_id)
  ORDER BY j.created_at DESC,j.operation_id DESC LIMIT 51;
$$;
REVOKE ALL ON FUNCTION private.read_conversation_queue(uuid,uuid) FROM PUBLIC,anon;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.read_conversation_queue(uuid,uuid) TO authenticated;

CREATE FUNCTION public.read_conversation_queue(p_workspace_id uuid,p_conversation_id uuid)
RETURNS SETOF jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT * FROM private.read_conversation_queue(p_workspace_id,p_conversation_id);
$$;
REVOKE ALL ON FUNCTION public.read_conversation_queue(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.read_conversation_queue(uuid,uuid) TO authenticated;
