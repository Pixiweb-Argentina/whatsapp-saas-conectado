"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AppFrame } from "./app-frame";

interface AppShellProps {
  children: ReactNode;
  workspace: ReactNode;
  actions: ReactNode;
  isSuperAdmin: boolean;
}

export function AppShell(props: AppShellProps) {
  return <AppFrame {...props} pathname={usePathname()} />;
}
