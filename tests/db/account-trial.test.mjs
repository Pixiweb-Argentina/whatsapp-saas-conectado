import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createLegacyDatabase, applyOmnichannelMigrations } from "./database-harness.mjs";
import { accountTrialFixtureSql } from "./account-trial-fixture.mjs";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const callback = `https://permissions.example.org/api/webhooks/whatsapp-accounts/${id(1)}/${id(51)}`;
test("initial managed trial owns one operation without delivery seed, persistent consent or account grants", async (t) => {
  const { db } = await createLegacyDatabase(); t.after(() => db.close());
  await db.exec(await readFile(new URL("./omnichannel-fixture.sql", import.meta.url), "utf8")); await applyOmnichannelMigrations(db);
  const scalar = async (sql, args = []) => (await db.query(sql, args)).rows[0]?.result;
  const authorize = (op = id(62), actor = id(101), recipient = "+15555550101") => scalar(`select public.authorize_whatsapp_account_trial(
    $1,$2,$3,$4,$5,$6,c.updated_at,v.checked_at,$7,true) result from public.channel_connections c
    join private.whatsapp_account_verifications v on v.connection_id=c.id where c.id=$3`, [id(1), actor, id(51), id(31), op, recipient, callback]);
  const claim = async (op = id(62), actor = id(101)) => scalar(`select public.claim_whatsapp_account_trial($1,$2,$3,$4,$5,$6,
    public.read_whatsapp_account_source($1,$3)->>'sourceRevision') result`, [id(1), actor, id(51), op, id(71), callback]);
  const begin = (claimed, op = id(62)) => scalar("select public.begin_channel_send($1,$2,$3,$4,$5,$6) result",
    [id(1), op, id(71), claimed.job.fence, id(92), claimed.validUntil]);
  const isolated = (name, run, provider = "ycloud") => t.test(name, async () => {
    await db.exec("BEGIN"); try { await db.exec(accountTrialFixtureSql(id, provider)); await db.exec("SET LOCAL ROLE service_role"); await run(); }
    finally { await db.exec("ROLLBACK; RESET ROLE"); }
  });
  const reject = async (run, code = "23514") => {
    await db.exec("SAVEPOINT denied"); try { await assert.rejects(run, (error) => error.code === code); }
    finally { await db.exec("ROLLBACK TO SAVEPOINT denied; RELEASE SAVEPOINT denied"); }
  };
  for (const provider of ["ycloud", "kapso"]) await isolated(`${provider}: explicit trial sends once while account and global consent remain pending`, async () => {
    assert.equal(await scalar("select private.whatsapp_account_text_receipt(c) result from public.channel_connections c where id=$1", [id(51)]), null);
    assert.equal((await authorize()).duplicate, false); assert.equal((await authorize()).duplicate, true);
    assert.equal(await scalar("select count(*)::int result from public.claim_channel_job($1,$2)", [id(1), id(72)]), 0);
    const claimed = await claim(); assert.equal(claimed.job.operation_id, id(62)); assert.equal(await claim(), null);
    assert.equal(await begin(claimed), true); assert.equal(await begin(claimed), false);
    assert.equal(await scalar("select public.finish_channel_send($1,$2,$3,1,$4) result", [id(1), id(62), id(71), { status: "unknown", operationId: id(62) }]), true);
    await scalar("select public.recover_channel_jobs($1) result", [id(1)]); assert.equal(await claim(), null);
    await reject(() => authorize(id(63)));
    assert.equal(await scalar("select opt_in result from public.contacts where id=$1", [id(21)]), false);
    assert.deepEqual(await scalar("select jsonb_build_array(status,capabilities) result from public.channel_connections where id=$1", [id(51)]), ["needs_permissions", {}]);
    assert.equal(await scalar("select count(*)::int result from private.whatsapp_account_permission_changes"), 0);
    assert.equal(await scalar("select count(*)::int result from public.message_outbox where operation_id=$1", [id(62)]), 1);
  }, provider);
  await isolated("a provider retryable rejection remains final and cannot be claimed again", async () => {
    await authorize(); const claimed = await claim(); assert.equal(await begin(claimed), true);
    await scalar("select public.finish_channel_send($1,$2,$3,1,$4) result", [id(1), id(62), id(71), { status: "rejected", errorCode: "429", retryable: true }]);
    assert.equal(await scalar("select state result from public.message_jobs where operation_id=$1", [id(62)]), "rejected");
    assert.equal(await claim(), null); assert.equal((await authorize(id(63))).duplicate, false);
  });
  await isolated("revoke cancels unsent trial and replay cannot reactivate it", async () => {
    await authorize(); const claimed = await claim();
    assert.equal(await scalar("select public.revoke_whatsapp_account_trial($1,$2,$3,$4) result", [id(1), id(101), id(51), id(62)]), true);
    assert.equal((await authorize()).duplicate, true); assert.equal(await claim(), null); assert.equal(await begin(claimed), false);
    assert.equal(await scalar("select count(*)::int result from public.message_outbox"), 0);
  });
  await isolated("same UUID cannot change recipient; arbitrary captured-only event cannot authorize a trial", async () => {
    await reject(() => authorize(id(62), id(101), "+15555550102"));
    await db.exec("delete from public.messages where id='" + id(93) + "'"); await reject(() => authorize());
    assert.equal(await scalar("select count(*)::int result from private.whatsapp_account_trials"), 0);
  });
  for (const [name, sql] of [
    ["revoked trial", `update private.whatsapp_account_trials set revoked_at=clock_timestamp()`],
    ["expired trial", `RESET ROLE; update private.whatsapp_account_trials set created_at=now()-interval '11 minutes',valid_until=now()-interval '1 minute'; SET LOCAL ROLE service_role`],
    ["credential rotation", "update private.channel_credentials set encrypted_payload='enc:v1:ZGVm:YWJj'"],
    ["proof deletion", "delete from private.whatsapp_account_verifications"],
    ["failed proof", "update private.whatsapp_account_verifications set report=jsonb_set(report,'{checks,api_access}','false')"],
    ["suppression", `insert into public.contact_opt_outs(workspace_id,phone_key,opted_out_at,source) values('${id(1)}','15555550101',now(),'keyword')`],
    ["inactive admin", `update public.memberships set is_active=false where user_id='${id(101)}'`],
    ["downgraded admin", `update public.memberships set role='manager' where user_id='${id(101)}'`],
    ["identity changed", `update public.contact_identities set verified_at=null where id='${id(81)}'`],
    ["conversation revision changed", `update public.conversations set state='paused' where id='${id(31)}'`],
    ["expired inbound", `update public.inbound_events set envelope=jsonb_set(envelope,'{occurredAt}',to_jsonb(clock_timestamp()-interval '25 hours')) where id='${id(92)}'`],
    ["invalid inbound timestamp", `update public.inbound_events set envelope=jsonb_set(envelope,'{occurredAt}','"invalid"') where id='${id(92)}'`],
    ["historical evidence", `update public.inbound_events set historical=true where id='${id(92)}'`],
    ["revoked account", `update public.channel_connections set status='revoked',revoked_at=clock_timestamp() where id='${id(51)}'`],
  ]) await isolated(`${name} blocks the final boundary after claim without outbox`, async () => {
    await authorize(); const claimed = await claim(); assert.ok(claimed); await db.exec(sql);
    assert.equal(await begin(claimed), false); assert.equal(await scalar("select count(*)::int result from public.message_outbox"), 0);
  });
  await isolated("manager cannot authorize or claim; browser cannot read or mutate private trial authority", async () => {
    await reject(() => authorize(id(62), id(102)), "42501");
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`SET LOCAL ROLE ${role}`);
      await reject(() => scalar("select count(*) result from private.whatsapp_account_trials"), "42501");
      await reject(() => claim(), "42501"); await db.exec("RESET ROLE");
    }
  });
});
