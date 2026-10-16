import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createLegacyDatabase, applyOmnichannelMigrations } from "./database-harness.mjs";
import { managedSendFixtureSql } from "./managed-send-fixture.mjs";
import { probeSql } from "./cloud-managed-send-source.mjs";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("managed send SQL binds credentials and explicit grant without requiring the legacy integration", async (t) => {
  const { db } = await createLegacyDatabase(); t.after(() => db.close());
  await db.exec(await readFile(new URL("./omnichannel-fixture.sql", import.meta.url), "utf8")); await applyOmnichannelMigrations(db);
  const scalar = async (sql, args = []) => (await db.query(sql, args)).rows[0]?.result;
  const enqueue = (operation = id(62)) => scalar("select public.enqueue_human_channel_text($1,$2,$3,$4,'Ficticio managed send') result",
    [id(1), id(31), id(101), operation]);
  const claim = async () => (await db.query("select * from public.claim_channel_job($1,$2)", [id(1), id(71)])).rows[0];
  const begin = (operation = id(62)) => scalar("select public.begin_channel_send($1,$2,$3,1,$4,clock_timestamp()+interval '30 seconds') result",
    [id(1), operation, id(71), id(92)]);
  const renew = async (operation = id(702)) => scalar(`select public.change_whatsapp_account_text_permission($1,$2,$3,$4,'grant',c.updated_at,v.checked_at,$5) result
    from public.channel_connections c join private.whatsapp_account_verifications v on v.connection_id=c.id where c.id=$3`,
    [id(1), id(101), id(51), operation, `https://permissions.example.org/api/webhooks/whatsapp-accounts/${id(1)}/${id(51)}`]);
  const isolated = (name, run, provider = "ycloud") => t.test(name, async () => {
    await db.exec("BEGIN"); try { await db.exec(managedSendFixtureSql(id, provider)); await db.exec("SET LOCAL ROLE service_role"); await run(); }
    finally { await db.exec("ROLLBACK; RESET ROLE"); }
  });
  const reject = async (fn, code = "42501") => {
    await db.exec("SAVEPOINT denied"); try { await assert.rejects(fn, (e) => e.code === code); }
    finally { await db.exec("ROLLBACK TO SAVEPOINT denied; RELEASE SAVEPOINT denied"); }
  };
  for (const provider of ["ycloud", "kapso"]) {
    await isolated(`${provider} human enqueue pins current managed source and permits durable send once`, async () => {
      assert.equal((await enqueue()).duplicate, false); const pin = await scalar("select to_jsonb(s)-'source_fingerprint' result from private.channel_job_sources s where operation_id=$1", [id(62)]);
      assert.equal(pin.connection_id, id(51)); assert.equal(pin.permission_id, id(701));
      assert.equal((await enqueue()).duplicate, true); assert.equal(await scalar("select count(*)::int result from private.channel_job_sources where operation_id=$1", [id(62)]), 1);
      assert.equal((await claim()).operation_id, id(62)); assert.equal(await begin(), true); assert.equal(await begin(), false);
      assert.equal(await scalar("select count(*)::int result from public.message_outbox where operation_id=$1", [id(62)]), 1);
      assert.equal(await scalar("select provider result from public.messages where channel_operation_id=$1", [id(62)]), provider);
      assert.equal(await scalar("select legacy_integration_id result from public.channel_connections where id=$1", [id(51)]), null);
    }, provider);
  }
  await isolated("renewed or revoked permission cannot revive a job already pinned to the prior grant", async () => {
    await enqueue(); await renew(); await claim(); assert.equal(await begin(), false);
    assert.equal(await scalar("select state result from public.message_jobs where operation_id=$1", [id(62)]), "leased");
    assert.equal(await scalar("select count(*)::int result from public.message_outbox where operation_id=$1", [id(62)]), 0);
    assert.equal((await enqueue()).duplicate, true); assert.equal(await begin(), false);
  });
  await isolated("credential rotation followed by fresh proof and grant still rejects the old adapter/job source", async () => {
    await enqueue();
    await db.exec("update private.channel_credentials set encrypted_payload='enc:v1:ZGVm:YWJj'");
    await db.exec(`select public.save_whatsapp_account_verification('${id(1)}','${id(101)}','${id(51)}',
      public.read_whatsapp_account_source('${id(1)}','${id(51)}')->>'sourceRevision',v.input,
      jsonb_set(v.report,'{checkedAt}',to_jsonb(clock_timestamp()-interval '0.1 seconds'))) from private.whatsapp_account_verifications v`);
    await renew(); await claim(); assert.equal(await begin(), false);
  });
  await isolated("jobs missing their original pin are not silently adopted", async () => {
    await db.query(`select public.enqueue_channel_job($1,$2,$3,$4,'unproven','human',state_revision,
      jsonb_build_object('operationId',$5::text,'channel','whatsapp','recipient','+15555550101','action','text','body','Unproven'),$6)
      from public.conversations where id=$3`, [id(1), id(51), id(31), id(92), id(62), id(101)]);
    await db.exec("RESET ROLE; delete from private.channel_job_sources where operation_id='" + id(62) + "'; SET LOCAL ROLE service_role");
    await claim(); assert.equal(await begin(), false);
  });
  await isolated("jobs created before an explicit grant cannot inherit a later grant", async () => {
    await db.query(`select public.change_whatsapp_account_text_permission($1,$2,$3,$4,'revoke',updated_at,null,null) result
      from public.channel_connections where id=$3`, [id(1), id(101), id(51), id(702)]);
    await db.query(`select public.enqueue_channel_job($1,$2,$3,$4,'before-grant','human',state_revision,
      jsonb_build_object('operationId',$5::text,'channel','whatsapp','recipient','+15555550101','action','text','body','Unproven'),$6)
      from public.conversations where id=$3`, [id(1), id(51), id(31), id(92), id(62), id(101)]);
    assert.equal(await scalar("select permission_id result from private.channel_job_sources where operation_id=$1", [id(62)]), null);
    await renew(id(703)); await claim(); assert.equal(await begin(), false);
  });
  await isolated("source pins are private and immutable to service updates; browser cannot read or create them", async () => {
    await enqueue(); await reject(() => db.exec("update private.channel_job_sources set permission_id=null"));
    await reject(() => db.exec("delete from private.channel_job_sources"));
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`SET LOCAL ROLE ${role}`);
      await reject(() => scalar("select count(*) result from private.channel_job_sources"));
      await reject(() => db.exec("delete from private.channel_job_sources")); await db.exec("RESET ROLE");
    }
  });
  for (const [name, sql] of [
    ["consent withdrawal", "update public.contacts set opt_in=false where id='" + id(21) + "'"],
    ["explicit suppression", `insert into public.contact_opt_outs(workspace_id,phone_key,opted_out_at,source) values('${id(1)}','15555550101',now(),'keyword')`],
    ["expired credentials", "update private.channel_credentials set expires_at=now()-interval '1 second'"],
    ["deleted proof", "delete from private.whatsapp_account_verifications"],
    ["inactive human", "update public.memberships set is_active=false where user_id='" + id(101) + "'"],
    ["changed human revision", "update public.conversations set state='paused' where id='" + id(31) + "'"],
    ["unverified identity", "update public.contact_identities set verified_at=null where connection_id='" + id(51) + "'"],
    ["expired inbound window", `update public.inbound_events set envelope=jsonb_set(envelope,'{occurredAt}',to_jsonb(clock_timestamp()-interval '25 hours')) where id='${id(92)}'`],
    ["historical evidence", `update public.inbound_events set historical=true where id='${id(92)}'`],
    ["revoked connection", `update public.channel_connections set status='revoked',revoked_at=clock_timestamp() where id='${id(51)}'`],
  ]) await isolated(`${name} blocks the final managed boundary without outbox or outbound message`, async () => {
    await enqueue(); await claim(); await db.exec(sql); assert.equal(await begin(), false);
    assert.equal(await scalar("select count(*)::int result from public.message_outbox where operation_id=$1", [id(62)]), 0);
    assert.equal(await scalar("select count(*)::int result from public.messages where channel_operation_id=$1", [id(62)]), 0);
  });
  await t.test("same PostgreSQL source/permit/unknown/replay probes run locally for both providers", async () => {
    for (const provider of ["ycloud", "kapso"]) await db.exec(probeSql(provider, id(101)));
    assert.equal(await scalar("select count(*)::int result from public.workspaces"), 2);
  });
});
