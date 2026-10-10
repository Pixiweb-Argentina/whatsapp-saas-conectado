import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { InboxLayout } from "@/features/inbox/components/inbox-layout";
import { ChatThread } from "@/features/inbox/components/chat-thread";
import type {
  ConversationWithContact,
  ConversationRow,
  ContactRow,
  MessageRow,
} from "@/features/inbox/types";
import type { WorkspaceRole } from "@/features/inbox/hooks/use-role";

import { readInboxPage } from "@/features/inbox/services/inbox-query";
import { inboxQuery, parseInboxFilters, type InboxSearchParams } from "@/features/inbox/lib/inbox-filters";
import { readComposerAvailability } from "@/features/channels/services/composer-availability";

interface PageProps {
  searchParams: Promise<InboxSearchParams>;
  params: Promise<{ id: string }>;
}

export default async function InboxDetailPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const supabase = await createClient();

  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // 2. Fetch the conversation + contact (RLS: only visible to its members)
  const { data: convData } = await supabase
    .from("conversations")
    .select("*, contact:contacts(*)")
    .eq("id", id)
    .single();

  if (!convData) notFound();

  const convWithContact = convData as ConversationRow & { contact: ContactRow };

  // 3. Role in THIS conversation's workspace — not the user's first
  // membership, which may belong to another workspace. With no membership
  // here (e.g. a super admin browsing), the UI falls back to read-only; the
  // server enforces the same rule on every send.
  const { data: membership } = await supabase
    .from("memberships")
    .select("role")
    .eq("user_id", user.id)
    .eq("workspace_id", convWithContact.workspace_id)
    .eq("is_active", true)
    .maybeSingle();

  const role = (membership?.role ?? "viewer") as WorkspaceRole;
  const availability = await readComposerAvailability(supabase, convWithContact);

  // 4. Fetch messages: los ÚLTIMOS 100, no los primeros.
  //
  // Iba `ascending: true` + `.limit(100)`, que devuelve los 100 mensajes MÁS
  // VIEJOS: pasada esa marca el hilo quedaba congelado para siempre en el
  // mensaje 100 y el operador no volvía a ver nada nuevo — ni lo que escribía
  // el cliente ni lo que respondía el agente. Se veía como si los mensajes se
  // borraran.
  //
  // Se piden descendentes (los 100 más nuevos) y se invierten acá, porque
  // ChatThread los renderiza en orden cronológico.
  const { data: messagesData } = await supabase
    .from("messages")
    .select("*, sender:users!sender_user_id(full_name, avatar_url)")
    .eq("conversation_id", id)
    .eq("workspace_id", convWithContact.workspace_id)
    .order("created_at", { ascending: false })
    .limit(100);

  const messages = ((messagesData ?? []) as MessageRow[]).reverse();

  // 5. Fetch sidebar conversations (the conversation's workspace, for InboxLayout)
  const workspaceId = convWithContact.workspace_id;
  const filters = parseInboxFilters(await searchParams);
  const page = await readInboxPage(supabase, workspaceId, filters);

  const conversation: ConversationWithContact = {
    ...convWithContact,
    last_message:
      messages.length > 0
        ? {
            body: messages[messages.length - 1].body,
            direction: messages[messages.length - 1].direction,
            created_at: messages[messages.length - 1].created_at,
          }
        : null,
  };

  return (
    <InboxLayout
      key={filters.q}
      conversations={page.conversations}
      filters={filters} accounts={page.accounts} nextPage={page.next} loadError={page.error}
      workspaceId={workspaceId ?? null}
    >
      <ChatThread
        backHref={`/inbox${inboxQuery(filters)}`}
        conversation={conversation}
        initialMessages={messages}
        currentUserId={user.id}
        role={role}
        availability={availability}
      />
    </InboxLayout>
  );
}
