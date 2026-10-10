import { cn } from "@/lib/utils";
import type {
  ConversationWithContact,
  ConversationState,
} from "@/features/inbox/types";
import { StateBadge } from "./state-badge";
import { contactInitials, contactLabel } from "@/features/contacts/lib/contact-display";
import { INBOX_CHANNEL_LABELS } from "../lib/inbox-filters";

interface ConversationItemProps {
  conversation: ConversationWithContact;
  isActive: boolean;
  onClick: () => void;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "ahora";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(dateStr).toLocaleDateString("es", {
    day: "numeric",
    month: "short",
  });
}

function truncate(text: string | null, max: number): string {
  if (!text) return "";
  return text.length > max ? text.slice(0, max) + "…" : text;
}

export function ConversationItem({
  conversation,
  isActive,
  onClick,
}: ConversationItemProps) {
  const { contact, last_message, unread_count, last_message_at } = conversation;
  const displayName = contactLabel(contact);
  const initials = contactInitials(contact);
  const preview = truncate(last_message?.body ?? null, 60);
  const time = timeAgo(last_message_at);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full flex items-start gap-3 px-4 py-3 text-left transition-colors duration-150",
        "hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        isActive && "bg-primary/10 border-l-2 border-primary",
      )}
      aria-current={isActive ? "page" : undefined}
    >
      {/* Avatar */}
      <div
        className={cn(
          "h-10 w-10 shrink-0 rounded-full flex items-center justify-center",
          "bg-primary/10 text-primary font-mono text-xs font-semibold select-none",
        )}
        aria-hidden="true"
      >
        {initials}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-foreground truncate">
            {displayName}
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            <StateBadge state={conversation.state as ConversationState} />
            <span
              className="text-xs text-muted-foreground"
              suppressHydrationWarning
            >
              {time}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground truncate">{preview}</p>
          {unread_count > 0 && (
            <span
              className={cn(
                "shrink-0 h-4 min-w-4 px-1 rounded-full text-[10px] font-semibold",
                "bg-primary text-primary-foreground flex items-center justify-center",
              )}
              aria-label={`${unread_count} mensajes sin leer`}
            >
              {unread_count > 99 ? "99+" : unread_count}
            </span>
          )}
        </div>

        <p className="text-[11px] text-muted-foreground truncate">
          {INBOX_CHANNEL_LABELS[conversation.channel] ?? "Canal desconocido"}
          {conversation.connection?.display_name && ` · ${conversation.connection.display_name}`}
          {contact.phone && ` · ${contact.phone}`}
        </p>
      </div>
    </button>
  );
}
