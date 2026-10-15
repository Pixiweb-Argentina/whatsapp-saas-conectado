import { INBOX_CHANNEL_LABELS, type InboxFilters } from "../lib/inbox-filters";
import type { InboxAccount } from "../services/inbox-query";

interface Props {
  filters: InboxFilters;
  accounts: InboxAccount[];
  disabled?: boolean;
  onChange(changes: Partial<InboxFilters>): void;
}

export function ChannelFilters({ filters, accounts, onChange, disabled }: Props) {
  const visible = accounts.filter((account) => !filters.channel || account.channel === filters.channel);
  const classes = "w-full min-w-0 h-11 rounded-md border border-input bg-card px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return <div className="grid grid-cols-2 gap-2">
    <label className="min-w-0 text-xs text-muted-foreground">
      Canal
      <select disabled={disabled} aria-label="Filtrar por canal" className={classes} value={filters.channel ?? ""}
        onChange={(event) => onChange({ channel: event.target.value as InboxFilters["channel"] || undefined, account: undefined })}>
        <option value="">Todos los canales</option>
        {Object.entries(INBOX_CHANNEL_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </label>
    <label className="min-w-0 text-xs text-muted-foreground">
      Cuenta
      <select disabled={disabled} aria-label="Filtrar por cuenta" className={classes} value={filters.account ?? ""}
        onChange={(event) => onChange({ account: event.target.value || undefined })}>
        <option value="">Todas las cuentas</option>
        {visible.map((account) => <option key={account.id} value={account.id}>
          {account.display_name || `${INBOX_CHANNEL_LABELS[account.channel]} · ${account.id.slice(0, 8)}`}
        </option>)}
      </select>
    </label>
    <label className="col-span-2 min-w-0 text-xs text-muted-foreground">
      Asignación
      <select disabled={disabled} aria-label="Filtrar por asignación" className={classes}
        value={filters.assignment ?? ""}
        onChange={(event) => onChange({ assignment: event.target.value as InboxFilters["assignment"] || undefined })}>
        <option value="">Todas las asignaciones</option>
        <option value="mine">Asignadas a mí</option>
        <option value="unassigned">Sin asignar</option>
        <option value="assigned">Asignadas</option>
      </select>
    </label>
  </div>;
}
