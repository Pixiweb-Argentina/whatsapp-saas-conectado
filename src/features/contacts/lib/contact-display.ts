export interface ContactDisplayFields {
  name: string | null;
  phone: string | null;
  email: string | null;
}

export function contactLabel(contact: ContactDisplayFields): string {
  return contact.name?.trim() || contact.phone || contact.email || "Contacto sin nombre";
}

export function contactInitials(contact: ContactDisplayFields): string {
  const name = contact.name?.trim();
  if (name) {
    const parts = name.split(/\s+/);
    return parts.length > 1 ? (parts[0][0] + parts[1][0]).toUpperCase()
      : name.slice(0, 2).toUpperCase();
  }
  return contact.phone?.slice(-4) || contact.email?.slice(0, 2).toUpperCase() || "?";
}

export function contactMatchesSearch(contact: ContactDisplayFields, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  return normalized === "" || [contact.name, contact.phone, contact.email]
    .some((value) => value?.toLowerCase().includes(normalized));
}
