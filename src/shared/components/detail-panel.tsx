"use client";

import { useRef, useSyncExternalStore, type ReactNode } from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

const QUERY = "(min-width: 1440px)";
function subscribe(callback: () => void) {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}
const desktopSnapshot = () => window.matchMedia(QUERY).matches;
const serverSnapshot = () => false;

interface DetailPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
}

export function DetailPanel({ open, onOpenChange, title, children }: DetailPanelProps) {
  const desktop = useSyncExternalStore(subscribe, desktopSnapshot, serverSnapshot);
  const returnFocus = useRef<HTMLElement | null>(null);
  if (desktop) return open ? <section aria-label={title} className="h-full w-80 shrink-0 overflow-y-auto border-l border-border/40 bg-card">{children}</section> : null;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-4 bg-card px-3 pb-3 pt-6 sm:max-w-sm" aria-describedby={undefined}
        onOpenAutoFocus={() => { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
        onCloseAutoFocus={(event) => { event.preventDefault(); returnFocus.current?.focus(); }}>
        <SheetTitle className="px-3 pr-12">{title}</SheetTitle>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
