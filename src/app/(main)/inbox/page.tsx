import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  getActiveWorkspace,
  ACTIVE_WORKSPACE_COOKIE,
} from "@/features/workspace/services/active-workspace";
import { InboxLayout } from "@/features/inbox/components/inbox-layout";
import { readInboxPage } from "@/features/inbox/services/inbox-query";
import { parseInboxFilters, type InboxSearchParams } from "@/features/inbox/lib/inbox-filters";

export default async function InboxPage({ searchParams }: { searchParams: Promise<InboxSearchParams> }) {
  const supabase = await createClient();

  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: userRow } = await supabase
    .from("users")
    .select("is_super_admin")
    .eq("id", user.id)
    .maybeSingle();

  // Agency super admins land in the agency panel by default. They only see a
  // specific inbox after explicitly entering a client (which sets the cookie
  // via "Gestionar" / "Inbox"); otherwise the first-membership fallback would
  // drop them into an arbitrary client's inbox on login.
  const activeCookie = (await cookies()).get(ACTIVE_WORKSPACE_COOKIE)?.value;
  if (userRow?.is_super_admin && !activeCookie) {
    redirect("/workspaces");
  }

  // 2. Resolve active workspace (cookie-selected or first membership)
  const membership = await getActiveWorkspace(supabase, user.id);

  if (!membership) {
    // Super admins without a personal workspace go to the agency panel, not onboarding
    if (userRow?.is_super_admin) {
      redirect("/workspaces");
    }
    redirect("/onboarding");
  }

  const filters = parseInboxFilters(await searchParams);
  const page = await readInboxPage(supabase, membership.workspace_id, filters);

  return (
    <InboxLayout key={filters.q} conversations={page.conversations} workspaceId={membership.workspace_id}
      filters={filters} accounts={page.accounts} nextPage={page.next} loadError={page.error}>
      <div className="flex flex-col items-center justify-center h-full text-center px-8">
        <p className="text-sm font-medium text-foreground">
          Selecciona una conversación
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Elige un contacto de la lista para ver el historial
        </p>
      </div>
    </InboxLayout>
  );
}
