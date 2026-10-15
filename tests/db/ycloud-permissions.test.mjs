import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createLegacyDatabase, applyOmnichannelMigrations } from "./database-harness.mjs";
import { permissionEvidenceSql } from "./ycloud-permission-fixture.mjs";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const callback = `https://permissions.example.org/api/webhooks/ycloud?wsid=${id(1)}`;
test("YCloud text permissions require fresh server evidence and explicit scoped admin action", async (t) => {
  const { db } = await createLegacyDatabase(); t.after(() => db.close());
  await db.exec(await readFile(new URL("./omnichannel-fixture.sql", import.meta.url), "utf8"));
  await applyOmnichannelMigrations(db); await db.exec(permissionEvidenceSql(id));
  const scalar = async (sql, args = []) => (await db.query(sql, args)).rows[0]?.r;
  const review = (actor = id(101), publicCallback = callback, ws = id(1)) => scalar(
    "select public.read_ycloud_permission_review($1,$2,$3) r", [ws, actor, publicCallback]);
  const mutate = async (action = "grant", operation = id(701), patch = {}) => {
    const state = await review(); return scalar("select public.change_ycloud_text_permission($1,$2,$3,$4,$5,$6,$7,$8) r",
      [patch.workspace ?? id(1), patch.actor ?? id(101), patch.connection ?? id(51), operation, action,
        patch.updatedAt ?? state.connectionUpdatedAt, patch.verifiedAt ?? state.verificationCheckedAt, patch.callback === null ? null : patch.callback ?? callback]);
  };
  async function isolated(name, fn) { await t.test(name, async () => {
    await db.exec("BEGIN"); try { await fn(); } finally { await db.exec("ROLLBACK"); }
  }); }
  async function denied(fn, code) {
    await db.exec("SAVEPOINT rejected"); await assert.rejects(fn, (e) => e.code === code); await db.exec("ROLLBACK TO SAVEPOINT rejected");
  }
  await isolated("grant/revoke/replay keeps audit and never changes messages, jobs or opt-in", async () => {
    await db.exec("SET LOCAL ROLE service_role"); const before = await scalar("select jsonb_agg(to_jsonb(c)) r from public.contacts c");
    assert.equal((await review()).canGrant, true); assert.equal(await mutate(), true);
    const current = await review(); assert.equal(current.current, true); assert.equal(current.managed, true); assert.equal(current.canRevoke, true);
    assert.equal(Date.parse(current.validUntil), Date.parse(current.verificationCheckedAt) + 86_400_000);
    assert.equal(await mutate("grant", id(701)), false);
    assert.equal(await mutate("revoke", id(702), { callback: null }), true);
    assert.equal((await review()).current, false); assert.equal((await review()).storedStatus, "needs_permissions");
    assert.equal(await mutate("grant", id(701)), false); assert.equal((await review()).current, false);
    assert.equal(await scalar("select count(*) r from private.ycloud_permission_changes"), 2);
    assert.deepEqual(await scalar("select jsonb_agg(to_jsonb(c)) r from public.contacts c"), before);
    assert.equal(await scalar("select count(*) r from public.message_jobs"), 1);
    assert.equal(await scalar("select count(*) r from public.message_outbox"), 1);
  });
  await isolated("no configured public callback, temporary endpoint, wrong URL or revoked account can grant", async () => {
    assert.ok((await review(id(101), null)).blockers.includes("public_origin_missing"));
    await denied(() => mutate("grant", id(701), { callback: null }), "23514");
    await denied(() => mutate("grant", id(701), { callback: callback.replace("permissions", "other") }), "23514");
    await db.exec("SAVEPOINT missing_destination");
    await db.exec("update private.ycloud_verifications set report=report-'destination'");
    assert.ok((await review()).blockers.includes("stable_callback_required")); await denied(() => mutate(), "23514");
    await db.exec("ROLLBACK TO SAVEPOINT missing_destination");
    await db.exec("update private.ycloud_verifications set report=jsonb_set(report,'{destination}','\"temporary\"')");
    await denied(() => mutate(), "23514");
    await db.exec("update public.channel_connections set status='revoked',revoked_at=now() where id='" + id(51) + "'");
    assert.ok((await review()).blockers.includes("account_revoked"));
  });
  await isolated("read access is manager/admin only and mutations recheck active admin membership", async () => {
    for (const actor of [id(102), id(103)]) { await denied(() => review(actor), "42501"); await denied(() => mutate("grant", id(701), { actor }), "42501"); }
    await db.query("update public.memberships set role='manager' where workspace_id=$1 and user_id=$2", [id(1), id(101)]);
    assert.equal((await review()).canGrant, true); await denied(() => mutate(), "42501");
    const snapshot = await review();
    await db.query("update public.memberships set is_active=false where workspace_id=$1 and user_id=$2", [id(1), id(101)]);
    await denied(() => scalar("select public.change_ycloud_text_permission($1,$2,$3,$4,'grant',$5,$6,$7) r",
      [id(1),id(101),id(51),id(701),snapshot.connectionUpdatedAt,snapshot.verificationCheckedAt,callback]), "42501");
  });
  await isolated("missing/failed/old/conflicting or other-account receipt never proves text delivery", async () => {
    for (const sql of ["update private.channel_delivery_receipts set status='sent'", "update private.channel_delivery_receipts set state='pending'",
      "update private.channel_delivery_receipts set external_account_id='+15555550999'", "update private.channel_delivery_receipts set occurred_at=now()-interval '31 days'",
      "update public.message_jobs set request=jsonb_set(request,'{action}','\"template\"')", "update public.message_outbox set state='unknown',result_external_id=null",
      "update public.messages set meta=meta||'{\"delivery_conflict\":true}' where channel_operation_id is not null"]) {
      await db.exec("SAVEPOINT proof"); await db.exec(sql);
      assert.ok((await review()).blockers.includes("delivery_proof_required")); await denied(() => mutate(), "23514"); await db.exec("ROLLBACK TO SAVEPOINT proof");
    }
  });
  await isolated("stale verification, connection revision, foreign route and idempotency collision reject without audit", async () => {
    await denied(() => mutate("grant", id(701), { updatedAt: "2000-01-01T00:00:00Z" }), "40001");
    await denied(() => mutate("grant", id(701), { verifiedAt: "2000-01-01T00:00:00Z" }), "40001");
    await denied(() => mutate("grant", id(701), { connection: id(999) }), "P0002");
    assert.equal(await scalar("select count(*) r from private.ycloud_permission_changes"), 0);
    await mutate(); await denied(() => mutate("revoke", id(701)), "23514");
    await db.exec("update private.ycloud_verifications set checked_at=now()-interval '25 hours'");
    assert.equal((await review()).current, false); await denied(() => mutate("grant", id(703)), "23514");
  });
  await isolated("credential/config/disabled changes revoke owned grants automatically with audit", async () => {
    for (const sql of ["update public.integrations set credentials='{\"rotated\":true}' where id='" + id(11) + "'",
      "update public.integrations set config=config||'{\"buffer_seconds\":99}' where id='" + id(11) + "'",
      "update public.integrations set enabled=false where id='" + id(11) + "'"]) {
      await db.exec("SAVEPOINT drift"); await mutate(); await db.exec(sql);
      const value = await review(); assert.equal(value.current, false); assert.equal(value.managed, false);
      assert.equal(value.storedStatus, "needs_permissions");
      assert.equal(await scalar("select count(*) r from private.ycloud_permission_changes where action='invalidate'"), 1);
      await db.exec("ROLLBACK TO SAVEPOINT drift");
    }
  });
  await isolated("failed/deleted verification invalidates; successful refresh cannot extend an existing lease", async () => {
    await mutate(); const expires = (await review()).validUntil;
    await db.exec("SAVEPOINT proof"); await db.exec("update private.ycloud_verifications set report=jsonb_set(report,'{checks,webhook_secret}','false')");
    assert.equal((await review()).current, false); await db.exec("ROLLBACK TO SAVEPOINT proof");
    await db.exec("SAVEPOINT proof"); await db.exec("delete from private.ycloud_verifications"); assert.equal((await review()).current, false);
    await db.exec("ROLLBACK TO SAVEPOINT proof");
    await db.exec("update private.ycloud_verifications set checked_at=clock_timestamp()");
    assert.equal((await review()).validUntil, expires); assert.equal((await review()).current, true);
  });
  await isolated("an existing authenticated admin integration update also invalidates its owned permission", async () => {
    await mutate();
    await db.exec("SET LOCAL ROLE authenticated"); await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id(101)]);
    await db.query("update public.integrations set config=config||'{\"changed_by_admin\":true}' where workspace_id=$1 and id=$2", [id(1), id(11)]);
    await db.exec("RESET ROLE"); assert.equal((await review()).current, false); assert.equal((await review()).managed, false);
    assert.equal(await scalar("select count(*) r from private.ycloud_permission_changes where action='invalidate'"), 1);
  });
  await isolated("unmanaged capabilities and legacy accounts are preserved, and timezone does not break ownership", async () => {
    await mutate(); await db.exec("SET LOCAL timezone='America/Argentina/Buenos_Aires'"); assert.equal((await review()).managed, true);
    await mutate("revoke", id(702));
    const external = { version: 1, grants: [{ capability: "template", evidenceRef: "foreign-system" }] };
    await db.query("update public.channel_connections set capabilities=$1 where id=$2", [external, id(51)]);
    assert.ok((await review()).blockers.includes("unmanaged_capabilities")); await denied(() => mutate("revoke", id(703)), "23514");
    await db.query("update public.integrations set config=config||'{\"new\":true}' where id=$1", [id(11)]);
    assert.deepEqual(await scalar("select capabilities r from public.channel_connections where id=$1", [id(51)]), external);
  });
  await isolated("browser roles cannot access audit, issue grants or bypass the server origin", async () => {
    for (const role of ["anon", "authenticated"]) {
      for (const sql of ["select * from private.ycloud_permission_changes", "select public.read_ycloud_permission_review($1,$2,null)",
        "select public.change_ycloud_text_permission($1,$2,$3,$4,'grant',now(),now(),'https://evil.invalid')"]) {
        await db.exec("SAVEPOINT role"); await db.exec(`SET LOCAL ROLE ${role}`);
        await assert.rejects(() => db.query(sql, sql.includes("$4") ? [id(1),id(101),id(51),id(701)] : sql.includes("$1") ? [id(1),id(101)] : []), (e) => e.code === "42501");
        await db.exec("ROLLBACK TO SAVEPOINT role");
      }
    }
  });
  await isolated("retiring queue records preserves audit and allows ordered fixture teardown", async () => {
    await mutate(); await db.query("delete from public.message_outbox where workspace_id=$1", [id(1)]);
    await db.query("delete from public.message_jobs where workspace_id=$1", [id(1)]);
    assert.equal(await scalar("select receipt_id r from private.ycloud_permission_changes"), null);
    assert.ok((await review()).blockers.includes("delivery_proof_required"));
    await db.query("delete from public.workspaces where id=$1", [id(1)]);
    assert.equal(await scalar("select count(*) r from private.ycloud_permission_changes"), 0);
  });
});
