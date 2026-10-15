import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import { createLegacyDatabase } from "./database-harness.mjs";
import { probe, fixtureWorkspace } from "./cloud-message-account-dedup.mjs";

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const migration = "20261015212823_omnichannel_message_account_dedup.sql";
const migrations = new URL("../../supabase/migrations/", import.meta.url);
const scalar = async (db, sql, args = []) => (await db.query(sql, args)).rows[0]?.result;
const routing = { integrationId: id(11), provider: "ycloud", accountId: "+15555550800" };

test("message IDs are scoped by verified account without changing legacy history or send authority", async (t) => {
  const { db } = await createLegacyDatabase(); t.after(() => db.close());
  await db.exec(await readFile(new URL("./omnichannel-fixture.sql", import.meta.url), "utf8"));
  for (const name of (await readdir(migrations)).sort().filter((n) => /_omnichannel_.*\.sql$/.test(n) && n < migration)) {
    await db.exec(await readFile(new URL(name, migrations), "utf8"));
  }
  await db.query("update public.integrations set config=$1 where id=$2", [{ phone_number: routing.accountId }, id(11)]);
  await db.query(`insert into public.channel_connections(id,workspace_id,channel,provider,external_account_id,status,legacy_integration_id)
    values($1,$2,'whatsapp','ycloud',$3,'needs_permissions',$4)`, [id(51), id(1), routing.accountId, id(11)]);
  await db.query("select private.backfill_whatsapp_workspace($1,$2,100)", [id(1), id(51)]);
  const before = (await db.query("select to_jsonb(m) value from public.messages m order by id")).rows;
  await db.exec(await readFile(new URL(migration, migrations), "utf8"));
  const isolated = (name, run) => t.test(name, async () => {
    await db.exec("BEGIN"); try { await run(); } finally { await db.exec("ROLLBACK; RESET ROLE"); }
  });
  const reject = async (run, code) => {
    await db.exec("SAVEPOINT denied");
    try { await assert.rejects(run, (e) => e.code === code); }
    finally { await db.exec("ROLLBACK TO SAVEPOINT denied; RELEASE SAVEPOINT denied"); }
  };
  const insert = (conversation, connection, wamid, body = "Synthetic", scope = "forged") => scalar(db,
    `insert into public.messages(workspace_id,conversation_id,connection_id,direction,type,body,wamid,status,message_account_scope)
      values($1,$2,$3,'in','text',$4,$5,'delivered',$6)
      on conflict(workspace_id,message_account_scope,wamid) do nothing returning id result`,
    [id(1), id(conversation), connection === null ? null : id(connection), body, wamid, scope]);
  const readStatus = (wamid, providerId = null, route = routing) => db.query(
    "select * from public.read_legacy_whatsapp_message($1,$2,$3,$4)", [id(1), wamid, providerId, route]);
  const seedSecond = async (contact = 23) => {
    await db.query(`insert into public.channel_connections(id,workspace_id,channel,provider,external_account_id,status)
      values($1,$2,'whatsapp','ycloud','+15555550801','needs_permissions')`, [id(52), id(1)]);
    await db.query(`insert into public.contact_identities(id,workspace_id,contact_id,connection_id,external_user_id,verified_at)
      select $1,$2,id,$3,phone,clock_timestamp() from public.contacts where id=$4`, [id(82), id(1), id(52), id(contact)]);
    return scalar(db, "select to_jsonb(private.ycloud_account_conversation($1,$2,$3,$4)) result",
      [id(1), id(52), id(contact), id(82)]);
  };
  await isolated("upgrade preserves every existing field, RLS and FULL replica identity", async () => {
    assert.deepEqual((await db.query("select to_jsonb(m)-'message_account_scope' value from public.messages m order by id")).rows, before);
    assert.equal(await scalar(db, "select message_account_scope result from public.messages where id=$1", [id(41)]), id(51));
    assert.equal(await scalar(db, "select message_account_scope result from public.messages where id=$1", [id(42)]), "legacy");
    assert.deepEqual((await db.query("select relreplident,relrowsecurity from pg_class where oid='public.messages'::regclass")).rows,
      [{ relreplident: "f", relrowsecurity: true }]);
    assert.equal(await scalar(db, "select count(*)::int result from public.message_jobs"), 0);
  });
  await isolated("same contact and wamid in two accounts keeps two histories and independent replays", async () => {
    const second = await seedSecond(21);
    const firstMessage = await insert(31, 51, "wamid.same", "Account A");
    const secondMessage = await scalar(db, `insert into public.messages(workspace_id,conversation_id,connection_id,
      direction,type,body,wamid,status,message_account_scope) values($1,$2,$3,'in','text','Account B','wamid.same','delivered','legacy')
      on conflict(workspace_id,message_account_scope,wamid) do nothing returning id result`, [id(1), second.id, id(52)]);
    assert.ok(firstMessage); assert.ok(secondMessage); assert.notEqual(firstMessage, secondMessage);
    assert.equal(await insert(31, 51, "wamid.same", "Changed replay"), undefined);
    assert.equal((await db.query("select body,message_account_scope from public.messages where wamid='wamid.same' order by body")).rows.length, 2);
    assert.equal(await scalar(db, "select body result from public.messages where id=$1", [firstMessage]), "Account A");
    assert.equal(await scalar(db, "select message_account_scope result from public.messages where id=$1", [secondMessage]), id(52));
    await reject(() => readStatus("wamid.same"), "23514");
    assert.equal(await scalar(db, "select count(*)::int result from public.message_jobs"), 0);
    assert.equal(await scalar(db, "select count(*)::int result from public.message_outbox"), 0);
  });
  await isolated("one account cannot store the same ID on another contact or forge another dedup scope", async () => {
    const implicit = await insert(31, null, "wamid.implicit");
    assert.equal(await scalar(db, "select message_account_scope result from public.messages where id=$1", [implicit]), id(51));
    assert.equal(await insert(31, null, "wamid.implicit"), undefined);
    await insert(31, 51, "wamid.own");
    assert.equal(await insert(33, 51, "wamid.own", "Wrong contact", id(52)), undefined);
    await db.query("update public.messages set message_account_scope='forged' where wamid='wamid.own'");
    assert.equal(await scalar(db, "select message_account_scope result from public.messages where wamid='wamid.own'"), id(51));
    await seedSecond();
    await reject(() => insert(31, 52, "wamid.wrong-account"), "23503");
  });
  await isolated("NULL wamid stays repeatable and an unmapped legacy ID still deduplicates", async () => {
    assert.ok(await insert(31, null, null)); assert.ok(await insert(31, null, null));
    const context = await scalar(db, "select public.upsert_legacy_whatsapp_inbound($1,'+15555550999',null,$2) result", [id(1), routing]);
    const save = () => scalar(db, `insert into public.messages(workspace_id,conversation_id,direction,type,body,wamid,status)
      values($1,$2,'in','text','Legacy','wamid.legacy','delivered')
      on conflict(workspace_id,message_account_scope,wamid) do nothing returning id result`, [id(1), context.conversation.id]);
    const message = await save(); assert.ok(message); assert.equal(await save(), undefined);
    assert.equal(await scalar(db, "select message_account_scope result from public.messages where id=$1", [message]), "legacy");
  });
  await isolated("late IDs in two accounts remain independent, but duplicate updates inside an account fail", async () => {
    const second = await seedSecond();
    const first = await insert(31, 51, null);
    const other = await scalar(db, `insert into public.messages(workspace_id,conversation_id,connection_id,direction,type,body,status)
      values($1,$2,$3,'in','text','Late B','delivered') returning id result`, [id(1), second.id, id(52)]);
    await db.query("update public.messages set wamid='wamid.late' where id=any($1::uuid[])", [[first, other]]);
    assert.equal(await scalar(db, "select count(*)::int result from public.messages where wamid='wamid.late'"), 2);
    const third = await insert(31, 51, null);
    await reject(() => db.query("update public.messages set wamid='wamid.late' where id=$1", [third]), "23505");
  });
  await isolated("legacy status resolves its own single account and rejects wrong account, direction or provider-ID contradictions", async () => {
    await db.query("update public.messages set wamid='wamid.status',status='sent',meta='{\"ycloud_id\":\"provider.status\"}' where id=$1", [id(43)]);
    assert.equal((await readStatus("wamid.status", "provider.status")).rows[0].id, id(43));
    assert.equal((await readStatus(null, "provider.status")).rows[0].id, id(43));
    await reject(() => readStatus("wamid.status", null, { ...routing, accountId: "+15555550801" }), "22023");
    await reject(() => readStatus("wamid.status", "provider.wrong"), "23514");
    await reject(() => readStatus("wamid.wrong", "provider.status"), "23514");
    assert.equal((await readStatus("wamid.fixture-1")).rows.length, 0);
    await db.query("update public.conversations set source_context='{\"sourceType\":\"direct_message\"}' where id=$1", [id(33)]);
    assert.equal((await readStatus("wamid.status")).rows.length, 0);
  });
  await isolated("a sole match in another account is never selected by the legacy reader", async () => {
    const second = await seedSecond();
    await db.query(`insert into public.messages(workspace_id,conversation_id,connection_id,direction,type,body,wamid,status)
      values($1,$2,$3,'out','text','Other account','wamid.other','sent')`, [id(1), second.id, id(52)]);
    assert.equal((await readStatus("wamid.other")).rows.length, 0);
  });
  await isolated("echo materialization scopes its conflict and lookup to the exact account", async () => {
    const second = await seedSecond();
    await db.query("update public.contact_identities set verified_at=clock_timestamp() where connection_id=$1", [id(51)]);
    await db.query(`insert into public.messages(workspace_id,conversation_id,connection_id,direction,type,body,wamid,status)
      values($1,$2,$3,'in','text','Other account inbound','wamid.echo-shared','delivered')`, [id(1), second.id, id(52)]);
    const echo = { workspace_id: id(1), connection_id: id(51), recipient: "+15555550101", type: "text",
      body: "Human echo", wamid: "wamid.echo-shared", occurred_at: new Date().toISOString() };
    const apply = () => scalar(db, `select private.apply_business_app_echo(
      jsonb_populate_record(null::private.business_app_echoes,$1)) result`, [echo]);
    assert.equal((await apply()).inserted, true); assert.equal((await apply()).inserted, false);
    assert.equal(await scalar(db, "select count(*)::int result from public.messages where wamid='wamid.echo-shared'"), 2);
    assert.equal(await scalar(db, "select body result from public.messages where connection_id=$1 and wamid='wamid.echo-shared'", [id(52)]), "Other account inbound");
  });
  await isolated("service-only reader is denied to browsers and foreign tenant history stays hidden", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`SET LOCAL ROLE ${role}`); await reject(() => readStatus("wamid.fixture-1"), "42501");
      await db.exec("RESET ROLE");
    }
    await db.exec("SET LOCAL ROLE authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id(103)]);
    assert.equal(await scalar(db, "select count(*)::int result from public.messages where workspace_id=$1", [id(1)]), 0);
  });
  await t.test("the exact Cloud probe also passes locally and leaves no fixture behind", async () => {
    await db.exec(probe);
    assert.equal(await scalar(db, "select count(*)::int result from public.workspaces where id=$1", [fixtureWorkspace]), 0);
  });
});
