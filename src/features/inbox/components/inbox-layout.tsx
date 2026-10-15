"use client";

import { useMemo, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ConversationItem } from "./conversation-item";
import { ChannelFilters } from "./channel-filters";
import { inboxQuery, type InboxFilters } from "../lib/inbox-filters";
import type { InboxAccount } from "../services/inbox-query";
import { useRealtimeConversations } from "@/features/inbox/hooks/use-realtime-conversations";
import { useHandoffAlerts } from "@/features/inbox/hooks/use-handoff-alerts";
import { contactMatchesSearch } from "@/features/contacts/lib/contact-display";
import type {
  ConversationWithContact,
  ConversationState,
} from "@/features/inbox/types";

type FilterTab = "all" | ConversationState;

const TABS: { id: FilterTab; label: string }[] = [
  { id: "all", label: "Todos" },
  { id: "ai_active", label: "IA activa" },
  { id: "human_active", label: "Humano" },
  { id: "handoff_pending", label: "Handoff" },
  { id: "waiting_reply", label: "Esperando" },
  { id: "paused", label: "Pausadas" },
  { id: "closed", label: "Cerradas" },
];

interface InboxLayoutProps {
  conversations: ConversationWithContact[];
  workspaceId: string | null;
  children: React.ReactNode;
  filters?: InboxFilters;
  accounts?: InboxAccount[];
  nextPage?: Pick<InboxFilters, "before" | "cursor"> | null;
  loadError?: boolean;
}

export function InboxLayout({
  conversations,
  workspaceId,
  children,
  filters, accounts = [], nextPage = null, loadError = false,
}: InboxLayoutProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [search, setSearch] = useState(filters?.q ?? "");
  const [localTab, setLocalTab] = useState<FilterTab>("all");
  const [isPending, startTransition] = useTransition();
  const activeTab = filters ? filters.state ?? "all" : localTab;
  const suffix = filters ? inboxQuery(filters) : "";
  function changeFilters(changes: Partial<InboxFilters>) {
    if (filters) startTransition(() => router.push(`${pathname}${inboxQuery(filters, { ...changes, before: undefined, cursor: undefined })}`));
  }

  // Contador en el título de la pestaña + notificación nativa cuando una
  // conversación entra a handoff_pending (ver use-handoff-alerts.ts).
  const { permission, requestPermission, handleConversationChange } =
    useHandoffAlerts(conversations, workspaceId ?? undefined);

  // Live-update the list when chats arrive/change (new conversation, new
  // message, state/handoff change) — re-runs the server component.
  useRealtimeConversations(workspaceId, handleConversationChange);

  const filtered = useMemo(() => {
    if (filters) return conversations;
    const q = search.trim().toLowerCase();
    return conversations.filter((c) => {
      const matchesSearch = contactMatchesSearch(c.contact, q);

      const matchesTab =
        activeTab === "all" ||
        (c.state as ConversationState) === (activeTab as ConversationState);

      return matchesSearch && matchesTab;
    });
  }, [conversations, search, activeTab, filters]);

  return (
    <div className="app-inbox flex overflow-hidden">
      {/* Left panel — conversation list */}
      <aside
        className={cn(
          "w-full md:w-80 shrink-0 border-r border-border/50 flex flex-col overflow-hidden bg-card",
          pathname !== "/inbox" && "hidden md:flex",
        )}
        aria-label="Conversaciones"
        aria-busy={isPending}
      >
        {/* Header */}
        <div className="shrink-0 px-4 pt-3 pb-2 border-b border-border/50 space-y-2">
          <div className="flex items-baseline justify-between">
            <h1 className="font-display text-sm font-semibold text-foreground">
              Inbox
            </h1>
            <p className="text-xs text-muted-foreground">
              {isPending ? "Cargando…" : `${filtered.length} ${filtered.length === 1 ? "conversación" : "conversaciones"}`}
            </p>
          </div>

          {permission === "default" && (
            <button
              type="button"
              onClick={requestPermission}
              className="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2"
            >
              Avisarme cuando alguien pida hablar con una persona
            </button>
          )}

          {/* Search input */}
          <form className="relative flex gap-1" onSubmit={(event) => { event.preventDefault(); changeFilters({ q: search }); }}>
            <Search
              className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none"
              aria-hidden="true"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Nombre, teléfono o email..."
              maxLength={80}
              className="pl-8 h-11 text-sm bg-card border-input placeholder:text-muted-foreground"
              aria-label="Buscar conversaciones"
            />
            {filters && <Button disabled={isPending} type="submit" variant="outline" size="sm" className="min-h-11">Buscar</Button>}
          </form>

          {filters && <ChannelFilters disabled={isPending} filters={filters} accounts={accounts} onChange={changeFilters} />}

          {/* Status filter tabs */}
          <div
            role="tablist"
            aria-label="Filtrar por estado"
            className="flex gap-1 flex-wrap"
          >
            {TABS.map((tab) => (
              <Button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                disabled={isPending}
                variant="ghost"
                size="sm"
                onClick={() => filters ? changeFilters({ state: tab.id === "all" ? undefined : tab.id }) : setLocalTab(tab.id)}
                className={cn(
                  "min-h-11 px-2 text-xs rounded-md transition-colors",
                  activeTab === tab.id
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/40",
                )}
              >
                {tab.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loadError ? <div role="alert" className="p-4 text-sm">
            <p>No pudimos cargar las conversaciones.</p>
            <Button variant="outline" className="mt-2" onClick={() => router.refresh()}>Reintentar</Button>
          </div> : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
              <p className="text-sm text-muted-foreground">
                {search || activeTab !== "all" || filters?.channel || filters?.account || filters?.assignment || filters?.cursor
                  ? "Sin resultados"
                  : "No hay conversaciones"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {search || activeTab !== "all" || filters?.channel || filters?.account || filters?.assignment || filters?.cursor
                  ? "Intenta con otro filtro o búsqueda"
                  : "Los mensajes de tus canales conectados aparecerán aquí"}
              </p>
            </div>
          ) : (
            <ul role="list">
              {filtered.map((conversation) => {
                const isActive = pathname.includes(conversation.id);
                return (
                  <li key={conversation.id}>
                    <ConversationItem
                      conversation={conversation}
                      isActive={isActive}
                      onClick={() => router.push(`/inbox/${conversation.id}${suffix}`)}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {filters && !loadError && (filters.cursor || nextPage) && <nav aria-label="Páginas de conversaciones"
          className="shrink-0 flex justify-between gap-2 border-t border-border p-3">
          {filters.cursor && <Button disabled={isPending} variant="outline" size="sm" onClick={() => changeFilters({})}>Volver al inicio</Button>}
          {nextPage && <Button disabled={isPending} variant="outline" size="sm"
            onClick={() => startTransition(() => router.push(`${pathname}${inboxQuery(filters, nextPage)}`))}>Siguientes</Button>}
        </nav>}
      </aside>

      {/* Right panel — thread / detail */}
      <main className={cn("min-w-0 flex-1 overflow-hidden", pathname === "/inbox" && "hidden md:block")}>{children}</main>
    </div>
  );
}
