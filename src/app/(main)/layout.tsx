import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/features/auth/services/actions";
import {
  getActiveWorkspace,
  listMemberships,
} from "@/features/workspace/services/active-workspace";
import { WorkspaceSwitcher } from "@/features/workspace/components/workspace-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { AppShell } from "@/shared/components/app-shell";
import { LogOut } from "lucide-react";


export default async function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Super admin flag + active workspace context + membership list (for switcher)
  const [{ data: userRow }, active, memberships] = await Promise.all([
    supabase
      .from("users")
      .select("is_super_admin")
      .eq("id", user.id)
      .maybeSingle(),
    getActiveWorkspace(supabase, user.id),
    listMemberships(supabase, user.id),
  ]);

  const isSuperAdmin = userRow?.is_super_admin ?? false;
  const activeId = active?.workspace_id ?? null;
  const workspaceName =
    memberships.find((m) => m.workspace_id === activeId)?.name ?? null;

  return (
    <AppShell isSuperAdmin={isSuperAdmin}
      workspace={memberships.length > 1 && activeId ? (
        <WorkspaceSwitcher workspaces={memberships.map((m) => ({ workspace_id: m.workspace_id, name: m.name }))} activeId={activeId} />
      ) : <span title={workspaceName ?? undefined}>{workspaceName ?? "Tu espacio"}</span>}
      actions={<><ThemeToggle /><form action={logout}>
        <Button type="submit" variant="ghost" size="icon" aria-label="Salir">
          <LogOut className="h-4 w-4" aria-hidden="true" />
        </Button>
      </form></>}>
      {children}
    </AppShell>
  );
}
