import type { ReactNode } from "react";
import { AppNavigation } from "./app-navigation";

interface AppFrameProps {
  children: ReactNode;
  workspace: ReactNode;
  actions: ReactNode;
  pathname: string;
  isSuperAdmin: boolean;
}

export function AppFrame({ children, workspace, actions, pathname, isSuperAdmin }: AppFrameProps) {
  return (
    <div className="min-h-dvh lg:pl-[216px]">
      <a href="#app-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-card focus:p-3">
        Ir al contenido
      </a>
      <aside className="pixi-sidebar fixed inset-y-0 left-0 z-40 hidden w-[216px] flex-col px-4 py-7 lg:flex">
        <div className="mb-12 px-3">
          <p className="text-2xl font-extrabold tracking-tight">pixiweb<span className="text-sidebar-active">.</span></p>
          <p className="mt-1 text-xs text-sidebar-muted">Mensajería</p>
        </div>
        <AppNavigation pathname={pathname} isSuperAdmin={isSuperAdmin} />
        <p className="mt-auto px-3 pt-6 text-xs leading-relaxed text-sidebar-muted">Tu espacio de atención.</p>
      </aside>
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b border-border/40 bg-card px-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="shrink-0 text-sm font-extrabold lg:hidden">pixiweb.</span>
          <div className="min-w-0 truncate text-sm font-semibold">{workspace}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1">{actions}</div>
      </header>
      <div id="app-content" tabIndex={-1} className="min-w-0 pb-[calc(3.5rem+env(safe-area-inset-bottom))] lg:pb-0">{children}</div>
      <div className="pixi-sidebar fixed inset-x-0 bottom-0 z-40 px-2 pt-1 pb-[calc(.25rem+env(safe-area-inset-bottom))] lg:hidden">
        <AppNavigation pathname={pathname} isSuperAdmin={isSuperAdmin} mobile />
      </div>
    </div>
  );
}
