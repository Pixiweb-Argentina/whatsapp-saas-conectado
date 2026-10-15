import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createLegacyDatabase, applyOmnichannelMigrations } from "./database-harness.mjs";

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const input = { endpointId: "endpoint-1", callbackUrl: `https://example.org/api/webhooks/ycloud?wsid=${id(1)}` };
const report = (checkedAt = new Date(Date.now() - 1000).toISOString()) => ({ version: 1, checkedAt,
  checks: { api_access: true, connected_number: true, webhook_active: true, webhook_url: true, webhook_events: true, webhook_secret: true },
  destination: "https_unconfirmed", providerRead: "complete", sendAuthorization: false });
test("private YCloud evidence has scoped authority, staleness and no send side effects", async (t) => {
  const { db } = await createLegacyDatabase(); t.after(() => db.close());
  await db.exec(await readFile(new URL("./omnichannel-fixture.sql", import.meta.url), "utf8"));
  await applyOmnichannelMigrations(db);
  const source = async () => (await db.query("select private.ycloud_verification_source(i) s from public.integrations i where id=$1", [id(11)])).rows[0].s;
  const read = async (actor = id(101), ws = id(1)) => (await db.query("select public.read_ycloud_verification($1,$2) r", [ws, actor])).rows[0].r;
  const save = async (actor = id(101), snapshot, value = report(), ws = id(1)) => db.query(
    "select public.save_ycloud_verification($1,$2,$3,$4,$5)", [ws, actor, snapshot ?? await source(), input, value]);
  async function isolated(name, fn) {
    await t.test(name, async () => { await db.exec("BEGIN"); try { await fn(); } finally { await db.exec("ROLLBACK"); } });
  }
  await isolated("service writes sanitized evidence without mutating data or granting send", async () => {
    const before = (await db.query("select row_to_json(i) r from public.integrations i where id=$1", [id(11)])).rows;
    assert.equal(await read(), null); await db.exec("SET LOCAL ROLE service_role"); await save();
    const value = await read(); assert.equal(value.current, true); assert.deepEqual(value.input, input);
    assert.equal(value.report.sendAuthorization, false); assert.equal(JSON.stringify(value).includes("fingerprint"), false);
    assert.deepEqual((await db.query("select row_to_json(i) r from public.integrations i where id=$1", [id(11)])).rows, before);
    assert.equal((await db.query("select count(*) n from public.message_jobs")).rows[0].n, 0);
  });
  await isolated("anonymous/authenticated cannot read/write storage or invoke server RPCs", async () => {
    for (const role of ["anon", "authenticated"]) {
      for (const sql of ["select * from private.ycloud_verifications", "select public.read_ycloud_verification($1,$2)",
        "select public.save_ycloud_verification($1,$2,'{}','{}','{}')"]) {
        await db.exec("SAVEPOINT denied"); await db.exec(`SET LOCAL ROLE ${role}`);
        await assert.rejects(() => db.query(sql, sql.includes("$1") ? [id(1), id(101)] : []), (e) => e.code === "42501");
        await db.exec("ROLLBACK TO SAVEPOINT denied");
      }
    }
  });
  await isolated("cross tenant, viewer, inactive member and manager mutation are denied", async () => {
    for (const actor of [id(102), id(103)]) {
      await db.exec("SAVEPOINT denied"); await assert.rejects(() => save(actor), (e) => e.code === "42501");
      await db.exec("ROLLBACK TO SAVEPOINT denied");
      await db.exec("SAVEPOINT denied"); await assert.rejects(() => read(actor), (e) => e.code === "42501");
      await db.exec("ROLLBACK TO SAVEPOINT denied");
    }
    await save(); await db.query("update public.memberships set role='manager' where workspace_id=$1 and user_id=$2", [id(1), id(101)]);
    assert.equal((await read()).current, true);
    await db.exec("SAVEPOINT denied"); await assert.rejects(() => save(), (e) => e.code === "42501"); await db.exec("ROLLBACK TO SAVEPOINT denied");
    await db.query("update public.memberships set is_active=false where workspace_id=$1 and user_id=$2", [id(1), id(101)]);
    await db.exec("SAVEPOINT denied"); await assert.rejects(() => read(), (e) => e.code === "42501"); await db.exec("ROLLBACK TO SAVEPOINT denied");
  });
  await isolated("credential/config/enabled drift invalidates earlier proof and races reject stale writes", async () => {
    await save(); const snapshot = await source();
    for (const [column, value] of [["config", { phone_number: "+15555550999" }], ["credentials", { encrypted: "new-key" }]]) {
      await db.exec("SAVEPOINT drift"); await db.query(`update public.integrations set ${column}=$1 where id=$2`, [value, id(11)]);
      assert.equal((await read()).current, false);
      await db.exec("SAVEPOINT rejected"); await assert.rejects(() => save(id(101), snapshot), (e) => e.code === "40001");
      await db.exec("ROLLBACK TO SAVEPOINT drift");
    }
    await db.query("update public.integrations set enabled=false where id=$1", [id(11)]); assert.equal((await read()).current, false);
  });
  await isolated("expired evidence is advisory only and old network results cannot overwrite a newer check", async () => {
    await save(); await db.exec("SAVEPOINT rejected");
    await assert.rejects(() => save(id(101), undefined, report(new Date(Date.now() - 90_000).toISOString())), (e) => e.code === "40001");
    await db.exec("ROLLBACK TO SAVEPOINT rejected");
    await db.exec("update private.ycloud_verifications set checked_at=now()-interval '25 hours'"); assert.equal((await read()).current, false);
  });
});
