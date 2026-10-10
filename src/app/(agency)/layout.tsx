import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/shared/components/app-shell";
import { ThemeToggle } from "@/components/theme-toggle";
import { LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { logout } from "@/features/auth/services/actions";


export default async function AgencyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: userRow } = await supabase
    .from("users")
    .select("is_super_admin")
    .eq("id", user.id)
    .single();

  if (!userRow?.is_super_admin) redirect("/inbox");

  return (
    <AppShell isSuperAdmin workspace="Administración de espacios" actions={<>
      <ThemeToggle />
      <form action={logout}><Button type="submit" variant="ghost" size="icon" aria-label="Salir"><LogOut aria-hidden="true" /></Button></form>
    </>}>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">{children}</main>
    </AppShell>
  );
}
