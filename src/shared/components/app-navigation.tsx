"use client";

import Link from "next/link";
import { BarChart3, Building2, LayoutDashboard, MessageCircle, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

interface AppNavigationProps {
  pathname: string;
  isSuperAdmin: boolean;
  mobile?: boolean;
}

const NAV_ITEMS = [
  { href: "/inbox", label: "Inbox", icon: MessageCircle },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/analisis", label: "Análisis", icon: BarChart3 },
  { href: "/settings", label: "Ajustes", icon: Settings },
];

export function AppNavigation({ pathname, isSuperAdmin, mobile = false }: AppNavigationProps) {
  const items = isSuperAdmin
    ? [...NAV_ITEMS, { href: "/workspaces", label: "Agency", icon: Building2 }]
    : NAV_ITEMS;
  return (
    <nav aria-label={mobile ? "Navegación móvil" : "Navegación principal"}
      className={cn(mobile ? "flex justify-around" : "space-y-2")}>
      {items.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link key={href} href={href} aria-current={active ? "page" : undefined}
            className={cn("flex min-h-11 items-center rounded-md transition-colors duration-150",
              mobile ? "min-w-12 flex-col justify-center gap-1 px-1 text-[11px]" : "gap-3 px-4 py-3 text-sm",
              active ? "bg-sidebar-active text-sidebar font-semibold" :
                "text-sidebar-muted hover:bg-sidebar-foreground/10 hover:text-sidebar-foreground")}>
            <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
