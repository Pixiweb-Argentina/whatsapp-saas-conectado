import { identityScopeSchema, type IdentityScope } from "../types/channel-contracts";

/** Internal comparison key only; never authorization, a public ID or a log value. */
export function identityKey(input: IdentityScope): string {
  const scope = identityScopeSchema.parse(input);
  // A tuple avoids delimiter collisions. Provider IDs stay case-sensitive and opaque.
  return JSON.stringify([scope.workspaceId, scope.connectionId, scope.externalActorId]);
}
