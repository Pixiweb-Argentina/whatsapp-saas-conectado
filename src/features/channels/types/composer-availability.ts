export interface ComposerAvailability {
  allowed: boolean;
  reason: "legacy_whatsapp" | "connection_not_ready" | "permission_missing" | "revoked"
    | "transport_unavailable" | "context_unavailable";
  message: string | null;
}
