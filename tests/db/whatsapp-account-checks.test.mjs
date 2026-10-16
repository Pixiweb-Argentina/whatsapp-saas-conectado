import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createLegacyDatabase, applyOmnichannelMigrations } from "./database-harness.mjs";
import { accountProofFixtureSql } from "./whatsapp-account-proof-fixture.mjs";
import { probeSql, actor as cloudActor } from "./cloud-whatsapp-account-checks.mjs";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const callback = `https://permissions.example.org/api/webhooks/whatsapp-accounts/${id(1)}/${id(51)}`;
const checks = { api_access: true, connected_number: true, webhook_active: true, webhook_url: true, webhook_events: true, webhook_secret: true };

test("managed account proof and local text permission are separate, scoped and revocable", async (t) => {
  const { db } = await createLegacyDatabase(); t.after(() => db.close());
  await db.exec(await readFile(new URL("./omnichannel-fixture.sql", import.meta.url), "utf8")); await applyOmnichannelMigrations(db);
  const scalar = async (sql, args = []) => (await db.query(sql, args)).rows[0]?.result;
  const source = () => scalar("select public.read_whatsapp_account_source($1,$2) result", [id(1), id(51)]);
  const review = (actor = id(101), cb = callback, connection = id(51)) => scalar(
    "select public.read_whatsapp_account_permission_review($1,$2,$3,$4) result", [id(1), actor, connection, cb]);
  const save = async (patch = {}, revision) => {
    const now = await scalar("select clock_timestamp()-interval '1 second' result");
    return scalar("select public.save_whatsapp_account_verification($1,$2,$3,$4,$5,$6) result", [id(1), id(101), id(51),
      revision ?? (await source())?.sourceRevision, { endpointId: "synthetic-endpoint", callbackUrl: callback },
      { version: 1, checkedAt: now, checks, destination: "https_unconfirmed", providerRead: "complete", sendAuthorization: false, ...patch }]);
  };
  const mutate = async (action = "grant", operation = id(701), patch = {}) => {
    const r = await review(); return scalar("select public.change_whatsapp_account_text_permission($1,$2,$3,$4,$5,$6,$7,$8) result",
      [id(1), patch.actor ?? id(101), patch.connection ?? id(51), operation, action, patch.updatedAt ?? r.connectionUpdatedAt,
        patch.checkedAt ?? r.verificationCheckedAt, Object.hasOwn(patch, "callback") ? patch.callback : callback]);
  };
  const until = () => scalar("select private.channel_text_grant_until(c) result from public.channel_connections c where id=$1", [id(51)]);
  const isolated = (name, fn) => t.test(name, async () => {
    await db.exec("BEGIN");
    try {
      await db.exec(accountProofFixtureSql(id));
      await db.exec("SET LOCAL ROLE service_role");
      await fn();
    } finally { await db.exec("ROLLBACK; RESET ROLE"); }
  });
  const reject = async (fn, code = "23514") => {
    await db.exec("SAVEPOINT rejected"); try { await assert.rejects(fn, (e) => e.code === code); }
    finally { await db.exec("ROLLBACK TO SAVEPOINT rejected; RELEASE SAVEPOINT rejected"); }
  };
  await isolated("provider proof alone leaves account pending, capabilities empty, contacts and jobs unchanged", async () => {
    assert.ok((await review()).blockers.includes("verification_required")); await save(); const r = await review();
    assert.equal(r.canGrant, true); assert.equal(r.current, false); assert.equal(r.storedStatus, "needs_permissions");
    assert.equal(await until(), null); assert.equal(await scalar("select opt_in result from public.contacts where id=$1", [id(21)]), true);
    assert.equal(await scalar("select count(*)::int result from public.message_jobs"), 1);
  });
  await isolated("grant is bounded, status changes do not invalidate identity proof; revoke/replay cannot reactivate", async () => {
    await save(); assert.equal(await mutate(), true); const r = await review();
    assert.equal(r.current, true); assert.ok(await until()); assert.equal(r.canRevoke, true);
    assert.equal(Date.parse(r.validUntil), Date.parse(r.verificationCheckedAt) + 86400000);
    assert.equal(await mutate(), false); assert.equal(await mutate("revoke", id(702), { callback: null }), true);
    assert.equal(await until(), null); assert.equal(await mutate(), false); assert.equal((await review()).storedStatus, "needs_permissions");
    assert.equal(await scalar("select count(*)::int result from private.whatsapp_account_permission_changes"), 2);
  });
  await isolated("missing/stale/incomplete/failed provider evidence never grants", async () => {
    await reject(() => mutate());
    for (const patch of [{ checks: { ...checks, webhook_secret: false } }, { providerRead: "incomplete" }, { destination: "temporary" }]) {
      await save(patch); await reject(() => mutate());
    }
    await save(); await db.exec("update private.whatsapp_account_verifications set checked_at=now()-interval '25 hours'");
    await reject(() => mutate()); assert.equal(await until(), null);
  });
  await isolated("callback must match server review, stable source and account; no origin keeps grant blocked", async () => {
    await save(); assert.ok((await review(id(101), null)).blockers.includes("public_origin_missing"));
    await reject(() => mutate("grant", id(701), { callback: null }));
    await reject(() => mutate("grant", id(701), { callback: callback.replace("permissions", "foreign") }));
    await reject(() => mutate("grant", id(701), { updatedAt: "2000-01-01T00:00:00Z" }));
    await reject(() => mutate("grant", id(701), { checkedAt: "2000-01-01T00:00:00Z" }));
  });
  await isolated("credential rotation or expiry invalidates grants and final send permission immediately", async () => {
    await save(); await mutate();
    await db.exec("update private.channel_credentials set encrypted_payload='enc:v1:ZGVm:YWJj'");
    assert.equal((await review()).storedStatus, "needs_permissions"); assert.equal(await until(), null);
    assert.equal(await scalar("select count(*)::int result from private.whatsapp_account_permission_changes where action='invalidate'"), 1);
    await save(); await mutate("grant", id(703));
    await db.exec("update private.channel_credentials set expires_at=now()-interval '1 second'");
    assert.equal(await until(), null); assert.equal((await review()).current, false);
  });
  await isolated("failed recheck/deleted proof removes owned grant, without affecting legacy permissions", async () => {
    await save(); await mutate(); await save({ checks: { ...checks, webhook_url: false } });
    assert.equal(await until(), null); assert.equal((await review()).storedStatus, "needs_permissions");
    await save(); await mutate("grant", id(703)); await db.exec("delete from private.whatsapp_account_verifications");
    assert.equal(await until(), null); assert.equal((await review()).current, false);
    assert.equal(await scalar("select count(*)::int result from private.ycloud_verifications"), 0);
  });
  await isolated("late network proof, altered source and equal-time overwrite are rejected", async () => {
    const old = (await source()).sourceRevision; await db.exec("update private.channel_credentials set encrypted_payload='enc:v1:ZGVm:YWJj'");
    await reject(() => save({}, old)); await save();
    const stamp = await scalar("select checked_at result from private.whatsapp_account_verifications");
    await reject(() => save({ checkedAt: stamp }));
    await reject(() => save({ checkedAt: "2099-01-01T00:00:00Z" }));
  });
  await isolated("manager reads but cannot decrypt/check or mutate; inactive and foreign actors denied", async () => {
    await save(); await db.query("update public.memberships set role='manager' where user_id=$1", [id(102)]);
    assert.equal((await review(id(102))).canGrant, true);
    await reject(() => mutate("grant", id(701), { actor: id(102) }), "42501");
    await reject(() => scalar("select public.read_whatsapp_account_check_source($1,$2,$3) result", [id(1), id(102), id(51)]), "42501");
    await reject(() => review(id(103)), "42501"); await db.query("update public.memberships set is_active=false where user_id=$1", [id(101)]);
    await reject(() => save(), "42501");
  });
  await isolated("proof and delivery evidence from one account cannot grant another account", async () => {
    await save(); await scalar("select public.register_whatsapp_account($1,$2,$3,'ycloud','+15555550801','Other','enc:v1:YWJj:ZGVm',1)", [id(1), id(101), id(52)]);
    const r = await review(id(101), callback, id(52)); assert.equal(r.canGrant, false);
    assert.ok(r.blockers.includes("delivery_proof_required")); assert.ok(r.blockers.includes("verification_required"));
    await mutate(); await reject(() => mutate("revoke", id(701)));
  });
  await isolated("immutable account routing rejects identity drift; final SQL guard detects missing receipt", async () => {
    await save(); await mutate(); assert.ok(await until());
    await reject(() => db.exec("update public.channel_connections set external_account_id='+15555550999'"));
    await db.exec("delete from private.channel_delivery_receipts"); assert.equal(await until(), null);
  });
  await isolated("browser roles cannot call RPCs or read private verification/permission records", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`SET LOCAL ROLE ${role}`);
      await reject(() => review(), "42501"); await reject(() => save({}, "a".repeat(32)), "42501");
      await reject(() => scalar("select * from private.whatsapp_account_verifications"), "42501"); await db.exec("RESET ROLE");
    }
  });
  await t.test("same Cloud SQL probe passes locally with complete rollback", async () => {
    await db.exec(probeSql().replaceAll(cloudActor, id(101)));
    assert.equal(await scalar("select count(*)::int result from public.workspaces"), 2);
  });
});
