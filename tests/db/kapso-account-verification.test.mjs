import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createLegacyDatabase, applyOmnichannelMigrations } from "./database-harness.mjs";
import { kapsoProofFixtureSql, kapsoAccount } from "./kapso-account-proof-fixture.mjs";
import { probeSql, actor as cloudActor } from "./cloud-kapso-account-checks.mjs";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const callback = `https://permissions.example.org/api/webhooks/whatsapp-accounts/${id(1)}/${id(51)}`;
const checks = { api_access: true, connected_number: true, webhook_active: true, webhook_url: true, webhook_events: true, webhook_secret: true };

test("managed Kapso proof, renewal and permission preserve exact account and fail closed", async (t) => {
  const { db } = await createLegacyDatabase(); t.after(() => db.close());
  await db.exec(await readFile(new URL("./omnichannel-fixture.sql", import.meta.url), "utf8")); await applyOmnichannelMigrations(db);
  const scalar = async (sql, args = []) => (await db.query(sql, args)).rows[0]?.result;
  const source = () => scalar("select public.read_whatsapp_account_source($1,$2) result", [id(1), id(51)]);
  const review = (actor = id(101), cb = callback, connection = id(51)) => scalar(
    "select public.read_whatsapp_account_permission_review($1,$2,$3,$4) result", [id(1), actor, connection, cb]);
  const save = async (patch = {}, age = "1 second", revision) => scalar(
    "select public.save_whatsapp_account_verification($1,$2,$3,$4,$5,$6) result", [id(1), id(101), id(51),
      revision ?? (await source())?.sourceRevision, { endpointId: id(901), callbackUrl: callback },
      { version: 1, checkedAt: await scalar("select clock_timestamp()-$1::interval result", [age]), checks,
        destination: "https_unconfirmed", providerRead: "complete", sendAuthorization: false, ...patch }]);
  const mutate = async (action = "grant", operation = id(701), actor = id(101)) => {
    const r = await review(); return scalar("select public.change_whatsapp_account_text_permission($1,$2,$3,$4,$5,$6,$7,$8) result",
      [id(1), actor, id(51), operation, action, r.connectionUpdatedAt, r.verificationCheckedAt, callback]);
  };
  const until = () => scalar("select private.channel_text_grant_until(c) result from public.channel_connections c where id=$1", [id(51)]);
  const isolated = (name, fn) => t.test(name, async () => {
    await db.exec("BEGIN"); try { await db.exec(kapsoProofFixtureSql(id)); await db.exec("SET LOCAL ROLE service_role"); await fn(); }
    finally { await db.exec("ROLLBACK; RESET ROLE"); }
  });
  const reject = async (fn, code = "23514") => {
    await db.exec("SAVEPOINT rejected"); try { await assert.rejects(fn, (e) => e.code === code); }
    finally { await db.exec("ROLLBACK TO SAVEPOINT rejected; RELEASE SAVEPOINT rejected"); }
  };
  await isolated("proof alone never authorizes; grant/revoke/replay have same bounded ledger contract as YCloud", async () => {
    await save(); const pending = await review(); assert.equal(pending.canGrant, true); assert.equal(pending.current, false);
    assert.equal(pending.blockers.includes("unsupported_provider"), false); assert.equal(await until(), null);
    assert.equal(await mutate(), true); const granted = await review(); assert.equal(granted.current, true); assert.ok(await until());
    assert.equal(Date.parse(granted.validUntil), Date.parse(granted.verificationCheckedAt) + 86400000);
    assert.equal(await mutate(), false); assert.equal(await mutate("revoke", id(702)), true);
    assert.equal(await until(), null); assert.equal(await mutate(), false); assert.equal((await review()).current, false);
    assert.equal(await scalar("select count(*)::int result from public.message_jobs"), 1);
    assert.equal(await scalar("select count(*)::int result from public.message_outbox"), 1);
    assert.equal(await scalar("select opt_in result from public.contacts where id=$1", [id(21)]), true);
  });
  await isolated("a fresh verification does not extend old grant until explicit renewal; stale UUID cannot reactivate", async () => {
    await save();
    await db.exec("update private.whatsapp_account_verifications set checked_at=clock_timestamp()-interval '1 hour',report=jsonb_set(report,'{checkedAt}',to_jsonb(clock_timestamp()-interval '1 hour'))");
    await mutate(); const old = await review();
    await save(); assert.equal((await review()).validUntil, old.validUntil);
    await mutate("grant", id(703)); const renewed = await review(); assert.ok(Date.parse(renewed.validUntil) > Date.parse(old.validUntil));
    assert.equal(await mutate(), false); assert.equal((await review()).validUntil, renewed.validUntil);
    await mutate("revoke", id(704)); assert.equal(await mutate("grant", id(703)), false); assert.equal(await until(), null);
  });
  await isolated("receipt, message, recipient, fence and provider evidence must all match", async () => {
    await save();
    for (const mutation of ["update private.channel_delivery_receipts set provider='ycloud'",
      "update private.channel_delivery_receipts set recipient='+15555550999'", "update private.channel_delivery_receipts set wamid='wrong'",
      "update private.channel_delivery_receipts set external_account_id='other-account'", "update private.channel_delivery_receipts set occurred_at=now()-interval '31 days'",
      "update private.channel_delivery_receipts set status='sent'", "update public.messages set status='sent' where channel_operation_id is not null",
      "update public.message_outbox set fence=2", "update public.message_jobs set state='unknown',result_external_id=null,result_wamid=null,result_provider_message_id=null",
      "update public.messages set meta='{" + '"delivery_conflict":true' + "}' where channel_operation_id is not null"]) {
      await db.exec("SAVEPOINT mismatch"); await db.exec(mutation);
      assert.ok((await review()).blockers.includes("delivery_proof_required")); await reject(() => mutate());
      await db.exec("ROLLBACK TO SAVEPOINT mismatch; RELEASE SAVEPOINT mismatch");
    }
  });
  await isolated("missing or failed proof, temporary destination and absent server origin never grant", async () => {
    await reject(() => mutate());
    for (const patch of [{ checks: { ...checks, webhook_events: false } }, { checks: { ...checks, webhook_secret: false } },
      { providerRead: "incomplete" }, { destination: "temporary" }]) { await save(patch); await reject(() => mutate()); }
    await save(); assert.ok((await review(id(101), null)).blockers.includes("public_origin_missing"));
    assert.ok((await review(id(101), callback.replace("permissions", "foreign"))).blockers.includes("stable_callback_required"));
    await db.exec("update private.whatsapp_account_verifications set checked_at=now()-interval '25 hours'");
    await reject(() => mutate()); assert.equal(await until(), null);
  });
  await isolated("credential expiry caps renewal; rotation/failed recheck invalidates final SQL send permission", async () => {
    await db.exec("update private.channel_credentials set expires_at=now()+interval '30 minutes'");
    await save(); await mutate(); const expires = await scalar("select expires_at result from private.channel_credentials");
    assert.equal(Date.parse((await review()).validUntil), new Date(expires).getTime());
    await save({ checks: { ...checks, webhook_active: false } }); assert.equal(await until(), null);
    assert.equal((await review()).storedStatus, "needs_permissions"); await save(); await mutate("grant", id(703));
    await db.exec("update private.channel_credentials set encrypted_payload='enc:v1:ZGVm:YWJj'");
    assert.equal(await until(), null); assert.equal((await review()).current, false);
  });
  await isolated("another Kapso account cannot borrow proof or receipt even with the same provider", async () => {
    await save(); await scalar("select public.register_whatsapp_account($1,$2,$3,'kapso',$4,'Otra','enc:v1:YWJj:ZGVm',1) result",
      [id(1), id(101), id(52), String(Number(kapsoAccount) + 1)]);
    const other = await review(id(101), callback, id(52)); assert.equal(other.canGrant, false);
    assert.ok(other.blockers.includes("delivery_proof_required")); assert.ok(other.blockers.includes("verification_required"));
  });
  await isolated("manager reads but cannot check or grant; foreign/inactive actors and browser RPC calls denied", async () => {
    await save(); await db.query("update public.memberships set role='manager' where user_id=$1", [id(102)]);
    assert.equal((await review(id(102))).canGrant, true); await reject(() => mutate("grant", id(701), id(102)), "42501");
    await reject(() => review(id(103)), "42501");
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`SET LOCAL ROLE ${role}`); await reject(() => review(), "42501");
      await reject(() => scalar("select private.whatsapp_account_text_receipt(c) result from public.channel_connections c where id=$1", [id(51)]), "42501");
      await db.exec("RESET ROLE");
    }
    await db.query("update public.memberships set is_active=false where user_id=$1", [id(101)]); await reject(() => save(), "42501");
  });
  await isolated("late or foreign-source proof and credential revocation cannot remain current", async () => {
    await reject(() => save({}, "3 minutes")); await reject(() => save({}, "1 second", "wrong-revision"));
    await save(); await mutate(); await db.exec("delete from private.whatsapp_account_verifications"); assert.equal(await until(), null);
    await save(); await mutate("grant", id(703));
    await db.exec("update public.channel_connections set status='revoked',revoked_at=clock_timestamp() where legacy_integration_id is null");
    assert.equal(await until(), null); assert.equal((await review()).canGrant, false);
  });
  await t.test("same Cloud SQL probe passes locally and rolls back all synthetic artifacts", async () => {
    await db.exec(probeSql().replaceAll(cloudActor, id(101)));
    assert.equal(await scalar("select count(*)::int result from public.workspaces"), 2);
  });
});
