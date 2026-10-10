import { AlertCircle, Check, CheckCheck, Clock } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { MessageStatus } from "@/features/inbox/types";
import { GENERIC_SEND_ERROR } from "@/features/inbox/services/whatsapp-errors";
import { cn } from "@/lib/utils";

interface StatusIconProps {
  status: MessageStatus | null;
  /**
   * Spanish text ready to show (`messages.error_message`). Never pass anything
   * from `message_errors` here: the code, fbtrace_id and English detail stay on
   * the server.
   */
  errorMessage?: string | null;
  sendOutcome?: unknown;
}

export function StatusIcon({ status, errorMessage, sendOutcome }: StatusIconProps) {
  if (!status) return null;

  switch (status) {
    case "queued":
      return (
        <Clock
          className={cn("h-3 w-3 shrink-0 opacity-50")}
          aria-label="En cola"
        />
      );
    case "sent":
      return (
        <Check
          className={cn("h-3 w-3 shrink-0 opacity-60")}
          aria-label="Enviado"
        />
      );
    case "delivered":
      return (
        <CheckCheck
          className={cn("h-3 w-3 shrink-0 opacity-60")}
          aria-label="Entregado"
        />
      );
    case "read":
      return (
        <CheckCheck
          className={cn("h-3 w-3 shrink-0 text-primary")}
          aria-label="Leído"
        />
      );
    case "failed": {
      // Failures stored before the reason existed have no text.
      const reason = errorMessage?.trim() || GENERIC_SEND_ERROR;
      // A popover, not a tooltip: it opens on tap on a phone.
      return (
        <Popover>
          <PopoverTrigger
            className="inline-flex shrink-0 items-center gap-1 rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-destructive"
            aria-label={`${sendOutcome === "unknown" ? "Envío sin confirmar" : "Fallido"}: ${reason}`}
          >
            <AlertCircle
              className={cn("h-3 w-3", sendOutcome === "unknown" ? "text-warning" : "text-destructive")}
              aria-hidden="true"
            />
            {sendOutcome === "unknown" && <span className="text-[10px] text-warning">Sin confirmar</span>}
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-64 p-3 text-xs leading-relaxed"
          >
            {reason}
          </PopoverContent>
        </Popover>
      );
    }
    default:
      return null;
  }
}
