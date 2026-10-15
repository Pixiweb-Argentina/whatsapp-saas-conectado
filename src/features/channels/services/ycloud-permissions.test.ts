import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { changeYCloudTextPermission, readYCloudPermissionReview } from "./ycloud-permissions";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const mutation = { action: "grant", connectionId: id(51), operationId: id(701), connectionUpdatedAt: "2026-10-15T12:00:00Z",
  verificationCheckedAt: "2026-10-15T12:00:00Z", acknowledgeTextPermission: true };
const review = { connectionId: id(51), connectionUpdatedAt: mutation.connectionUpdatedAt, storedStatus: "needs_permissions",
  managed: false, current: false, validUntil: null, canGrant: false, canRevoke: false,
  verificationCheckedAt: mutation.verificationCheckedAt, blockers: ["public_origin_missing"] };
function fixture(change: unknown = true, read: unknown = review, error: unknown = null) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const db = { rpc: async (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args }); return { data: fn === "change_ycloud_text_permission" ? change : read, error };
  } } as unknown as SupabaseClient;
  return { db, calls };
}

test("server configuration and authenticated actor determine scope, never client assertions", async () => {
  const f = fixture(); await changeYCloudTextPermission(f.db, id(1), id(101), mutation, "https://app.example.org");
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].args.p_actor, id(101)); assert.equal(f.calls[0].args.p_workspace, id(1));
  assert.equal(f.calls[0].args.p_connection, id(51)); assert.equal(f.calls[0].args.p_operation, id(701));
  assert.equal(f.calls[0].args.p_callback, `https://app.example.org/api/webhooks/ycloud?wsid=${id(1)}`);
  const g = fixture(); await readYCloudPermissionReview(g.db, id(1), id(101), ""); assert.equal(g.calls[0].args.p_callback, null);
  await assert.rejects(() => changeYCloudTextPermission(f.db, id(1), id(101), { ...mutation, p_callback: "https://evil.invalid" }));
  assert.equal(f.calls.length, 2);
});
test("grant replay returns the current revoked state instead of reactivating the old permission", async () => {
  const f = fixture(false); const result = await changeYCloudTextPermission(f.db, id(1), id(101), mutation, "");
  assert.equal(result.applied, false); assert.equal(result.review?.current, false); assert.equal(result.review?.canRevoke, false);
});
test("database errors and malformed proofs stay unavailable and raw details never escape", async () => {
  for (const f of [fixture(null, review, { message: "raw-key" }), fixture("true"), fixture(true, { secret: "raw-key" })]) {
    await assert.rejects(() => changeYCloudTextPermission(f.db, id(1), id(101), mutation, ""), (e: Error) => !e.message.includes("raw-key"));
  }
  assert.equal(await readYCloudPermissionReview(fixture(true, null).db, id(1), id(101), ""), null);
});
