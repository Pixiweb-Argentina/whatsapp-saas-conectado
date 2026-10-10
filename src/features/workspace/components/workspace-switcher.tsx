"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { switchWorkspace } from "@/features/workspace/services/actions";
import { cn } from "@/lib/utils";

interface WorkspaceSwitcherProps {
  workspaces: { workspace_id: string; name: string }[];
  activeId: string;
}

export function WorkspaceSwitcher({
  workspaces,
  activeId,
}: WorkspaceSwitcherProps) {
  const [isPending, startTransition] = useTransition();

  const active = workspaces.find((w) => w.workspace_id === activeId);

  function handleSelect(workspaceId: string) {
    if (workspaceId === activeId) return;
    startTransition(async () => {
      const result = await switchWorkspace(workspaceId);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      // Discard the previous conversation, account filters and client state.
      // Refreshing the current detail URL can retain the other workspace's chat.
      window.location.assign("/inbox");
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={isPending}
          className={cn(
            "flex items-center gap-1.5 min-h-11 rounded-md px-2 py-1 transition-colors",
            "font-body text-sm text-muted-foreground hover:text-foreground hover:bg-muted/40",
            "max-w-[160px] sm:max-w-[260px]",
          )}
          aria-label="Cambiar de workspace"
        >
          <span className="truncate" title={active?.name}>
            {active?.name ?? "Workspace"}
          </span>
          {isPending ? (
            <Loader2
              className="h-3 w-3 shrink-0 animate-spin"
              aria-hidden="true"
            />
          ) : (
            <ChevronsUpDown className="h-3 w-3 shrink-0" aria-hidden="true" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Cambiar de workspace</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {workspaces.map((w) => (
          <DropdownMenuItem
            key={w.workspace_id}
            onSelect={() => handleSelect(w.workspace_id)}
            className="gap-2"
          >
            <Check
              className={cn(
                "h-4 w-4 shrink-0",
                w.workspace_id === activeId ? "opacity-100" : "opacity-0",
              )}
              aria-hidden="true"
            />
            <span className="truncate">{w.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
