"use client";

import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface WindowBannerProps {
  windowExpiresAt: string | null;
}

export function WindowBanner({ windowExpiresAt }: WindowBannerProps) {
  // No window tracked → treat as open
  if (windowExpiresAt === null) return null;

  // Window still open
  if (new Date(windowExpiresAt) > new Date()) return null;

  return (
    <div
      role="alert"
      className={cn(
        "flex items-center gap-2",
        "bg-warning/10 border border-warning/30 text-warning",
        "rounded-lg py-2 px-3 text-sm font-body",
      )}
    >
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>Ventana 24h expirada — Solo puedes enviar templates aprobados</span>
    </div>
  );
}
