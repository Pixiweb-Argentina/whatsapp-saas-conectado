import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createLegacyDatabase, applyOmnichannelMigrations } from "./database-harness.mjs";
import { probeSql } from "./cloud-whatsapp-accounts.mjs";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scalar = async (db, sql, args = []) => (await db.query(sql, args)).rows[0]?.result;
const ciphertext = "enc:v1:YWJj:ZGVm"; // Synthetic marker; encryption is exercised by the AES unit/HTTP tests.

test("additional WhatsApp accounts register atomically with private credentials and no legacy cutover", async (t) => {
  const { db } = await createLegacyDatabase(); t.after(() => db.close());
  await db.exec(await readFile(new URL("./omnichannel-fixture.sql", import.meta.url), "utf8"));
  await applyOmnichannelMigrations(db);
  const register = (patch = {}) => {
    const p = { workspace: id(1), actor: id(101), connection: id(51), provider: "ycloud", account: "+15555550800",
      label: "Ventas", payload: ciphertext, version: 1, ...patch };
    return scalar(db, "select public.register_whatsapp_account($1,$2,$3,$4,$5,$6,$7,$8) result", Object.values(p));
  };
  const list = (actor = id(101)) => scalar(db, "select public.read_whatsapp_accounts($1,$2) result", [id(1), actor]);
  const revoke = (connection = id(51), timestamp = null, actor = id(101)) => scalar(db,
    "select public.revoke_whatsapp_account($1,$2,$3,$4) result", [id(1), actor, connection, timestamp]);
  const updated = () => scalar(db, "select updated_at result from public.channel_connections where id=$1", [id(51)]);
  const isolated = (name, run) => t.test(name, async () => {
    await db.exec("BEGIN"); try { await run(); } finally { await db.exec("ROLLBACK; RESET ROLE"); }
  });
  const reject = async (run, code) => {
    await db.exec("SAVEPOINT denied"); try { await assert.rejects(run, (e) => e.code === code); }
    finally { await db.exec("ROLLBACK TO SAVEPOINT denied; RELEASE SAVEPOINT denied"); }
  };
  await isolated("two accounts of the same provider preserve integrations, contacts, messages and lack all send authority", async () => {
    const before = (await db.query("select to_jsonb(i) value from public.integrations i order by id")).rows;
    await db.exec("SET LOCAL ROLE service_role");
    assert.equal(await register(), id(51));
    assert.equal(await register({ connection: id(52), account: "+15555550801", label: "Soporte" }), id(52));
    const rows = await list(); assert.equal(rows.length, 2);
    assert.equal(rows.every((r) => r.managed && r.credentialsStored && r.status === "needs_permissions"), true);
    assert.equal(JSON.stringify(rows).includes(ciphertext), false);
    assert.deepEqual((await db.query("select to_jsonb(i) value from public.integrations i order by id")).rows, before);
    assert.equal(await scalar(db, "select count(*)::int result from public.channel_connections where legacy_integration_id is not null or capabilities<>'{}'"), 0);
    assert.equal(await scalar(db, "select count(*)::int result from public.messages"), 3);
    assert.equal(await scalar(db, "select count(*)::int result from public.message_jobs"), 0);
    assert.equal(await scalar(db, "select count(*)::int result from public.message_outbox"), 0);
  });
  await isolated("same encrypted mutation is idempotent; changing credentials or identity under its ID is rejected", async () => {
    await register(); assert.equal(await register(), id(51));
    assert.equal(await scalar(db, "select count(*)::int result from public.events where type='channel_account_registered'"), 1);
    for (const patch of [{ payload: "enc:v1:YWJj:YWJj" }, { account: "+15555550801" }, { label: "Changed" }]) {
      await reject(() => register(patch), "23514");
    }
  });
  await isolated("duplicate physical accounts and cross-workspace adoption fail without replacing credentials", async () => {
    await register();
    await reject(() => register({ connection: id(52) }), "23505");
    await reject(() => register({ workspace: id(2), actor: id(103), connection: id(53) }), "23505");
    await reject(() => register({ workspace: id(2), actor: id(103) }), "23514");
    assert.equal(await scalar(db, "select encrypted_payload result from private.channel_credentials where connection_id=$1", [id(51)]), ciphertext);
  });
  await isolated("credential insert failure rolls back registration and audit; retry starts cleanly", async () => {
    await db.exec("create function private.account_test_abort() returns trigger language plpgsql as $$ begin raise exception 'SYNTHETIC_ABORT' using errcode='23514'; end $$; create trigger account_abort before insert on private.channel_credentials for each row execute function private.account_test_abort()");
    await reject(() => register(), "23514");
    assert.equal(await scalar(db, "select count(*)::int result from public.channel_connections"), 0);
    assert.equal(await scalar(db, "select count(*)::int result from public.events where type='channel_account_registered'"), 0);
    await db.exec("drop trigger account_abort on private.channel_credentials"); assert.equal(await register(), id(51));
  });
  await isolated("manager reads metadata but cannot create or revoke; viewer and inactive admin are denied", async () => {
    await register(); await db.query("update public.memberships set role='manager' where user_id=$1", [id(102)]);
    assert.equal((await list(id(102))).length, 1);
    await reject(() => register({ actor: id(102), connection: id(52), account: "+15555550801" }), "42501");
    await reject(async () => revoke(id(51), await updated(), id(102)), "42501");
    await db.query("update public.memberships set role='viewer' where user_id=$1", [id(102)]);
    await reject(() => list(id(102)), "42501"); await reject(() => list(id(103)), "42501");
    await db.query("update public.memberships set is_active=false where user_id=$1", [id(101)]);
    await reject(() => register(), "42501"); await reject(() => list(), "42501");
  });
  await isolated("browser roles cannot call service RPCs or read private ciphertext", async () => {
    await register();
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`SET LOCAL ROLE ${role}`);
      await reject(() => list(), "42501"); await reject(() => register(), "42501");
      await reject(() => revoke(), "42501");
      await reject(() => db.query("select * from private.channel_credentials"), "42501"); await db.exec("RESET ROLE");
    }
  });
  await isolated("plaintext, malformed ciphertext, invalid account IDs and version mismatch never persist", async () => {
    for (const patch of [{ payload: "plaintext" }, { payload: "enc:v1:invalid" }, { version: 2 }, { account: "15555550800" },
      { provider: "meta" }, { label: "" }, { provider: "kapso", account: "with space" }]) {
      await reject(() => register(patch), "22023");
    }
    assert.equal(await scalar(db, "select count(*)::int result from private.channel_credentials"), 0);
    await register({ provider: "kapso", account: "synthetic-phone-id" });
  });
  await isolated("revoke checks freshness, keeps history and ciphertext, and cannot be replayed into reactivation", async () => {
    await register(); await reject(() => revoke(id(51), "2000-01-01T00:00:00Z"), "23514");
    assert.equal(await revoke(id(51), await updated()), true); assert.equal(await revoke(), true);
    assert.equal((await list())[0].status, "revoked");
    assert.equal(await scalar(db, "select count(*)::int result from public.events where type='channel_account_revoked'"), 1);
    assert.equal(await scalar(db, "select count(*)::int result from private.channel_credentials"), 1);
    await reject(() => register(), "23514");
    assert.equal(await scalar(db, "select count(*)::int result from public.messages"), 3);
  });
  await isolated("legacy connection cannot be overwritten or revoked through the additional-account flow", async () => {
    await db.query(`insert into public.channel_connections(id,workspace_id,channel,provider,external_account_id,status,legacy_integration_id)
      values($1,$2,'whatsapp','ycloud','+15555550800','needs_permissions',$3)`, [id(51), id(1), id(11)]);
    await reject(() => register(), "23514"); await reject(async () => revoke(id(51), await updated()), "23514");
    assert.equal((await list())[0].managed, false);
  });
  await t.test("same Cloud probe runs locally with rollback", async () => {
    await db.exec(probeSql(id(101)));
  });
});
