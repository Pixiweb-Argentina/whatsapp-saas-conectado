import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createLegacyDatabase, applyOmnichannelMigrations, restoreDatabase } from "./database-harness.mjs";

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
async function rejectSql(db, sql, code) {
  await db.exec("SAVEPOINT rejected_statement");
  try {
    await assert.rejects(db.exec(sql), (error) => error.code === code);
  } finally {
    await db.exec("ROLLBACK TO SAVEPOINT rejected_statement; RELEASE SAVEPOINT rejected_statement");
  }
}
async function asRole(db, role, userId = "") {
  assert.ok(["authenticated","anon","service_role"].includes(role));
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [userId]);
  await db.exec("SET ROLE " + role);
}
async function rows(db, sql) { return (await db.query(sql)).rows; }
async function legacyRows(db) {
  return {
    contacts: await rows(db,"select * from public.contacts order by id"),
    conversations: await rows(db,"select id,workspace_id,contact_id,channel,state,ai_enabled,window_expires_at,created_at from public.conversations order by id"),
    messages: await rows(db,"select id,workspace_id,conversation_id,direction,type,body,wamid,status,meta,created_at from public.messages order by id"),
  };
}
async function registerConnections(db) {
  await db.exec(`INSERT INTO public.channel_connections(id,workspace_id,channel,provider,external_account_id,legacy_integration_id)
    VALUES ('${id(51)}','${id(1)}','whatsapp','ycloud','+15555550100','${id(11)}'),
           ('${id(52)}','${id(2)}','whatsapp','kapso','fixture-phone-b','${id(12)}')`);
}
async function backfill(db, workspace=1, connection=51, limit=500) {
  return (await db.query("select private.backfill_whatsapp_workspace($1,$2,$3) as result",
    [id(workspace),id(connection),limit])).rows[0].result;
}

test("F1 migration rehearsal on a local PostgreSQL schema copy", async (t) => {
  const { db, applied, skipped } = await createLegacyDatabase();
  t.after(() => db.close());
  await db.exec(await readFile(new URL("./omnichannel-fixture.sql",import.meta.url),"utf8"));
  const before = await legacyRows(db);
  const backup = await db.dumpDataDir();
  const restored = restoreDatabase(backup);
  try { assert.deepEqual(await legacyRows(restored),before); } finally { await restored.close(); }
  await applyOmnichannelMigrations(db);
  assert.equal(applied.length,65);
  assert.equal(skipped.length,1);
  assert.deepEqual(await legacyRows(db),before);
  await registerConnections(db);

  async function isolated(name, run) {
    await t.test(name, async () => {
      await db.exec("BEGIN");
      try { await run(); } finally { await db.exec("ROLLBACK; RESET ROLE"); }
    });
  }

  await isolated("nullable phone works without inventing identity; WA still requires phone", async () => {
    await asRole(db,"authenticated",id(101));
    await db.exec(`insert into public.contacts(id,workspace_id,name,phone) values ('${id(24)}','${id(1)}','IG fixture',null)`);
    assert.equal((await rows(db,`select phone from public.contacts where id='${id(24)}'`))[0].phone,null);
    await rejectSql(db,`insert into public.conversations(workspace_id,contact_id) values ('${id(1)}','${id(24)}')`,"23514");
    await rejectSql(db,`update public.contacts set phone=null where id='${id(21)}'`,"23514");
  });
  await isolated("RLS scopes connections and identities to membership", async () => {
    await backfill(db);
    await backfill(db,2,52);
    for (const actor of [101,102]) {
      await asRole(db,"authenticated",id(actor));
      assert.deepEqual((await rows(db,"select workspace_id from public.channel_connections")).map(r=>r.workspace_id),[id(1)]);
      assert.equal((await rows(db,"select count(*)::int n from public.contact_identities"))[0].n,2);
    }
    await asRole(db,"authenticated",id(103));
    assert.deepEqual((await rows(db,"select workspace_id from public.channel_connections")).map(r=>r.workspace_id),[id(2)]);
  });
  await isolated("anon cannot read new public tables and sessions cannot mutate routing", async () => {
    await asRole(db,"anon");
    await rejectSql(db,"select * from public.channel_connections","42501");
    await rejectSql(db,"select * from public.contact_identities","42501");
    await asRole(db,"authenticated",id(101));
    await rejectSql(db,`update public.channel_connections set status='ready' where id='${id(51)}'`,"42501");
    await rejectSql(db,`insert into public.contact_identities(workspace_id,contact_id,connection_id,external_user_id)
      values ('${id(1)}','${id(21)}','${id(51)}','other')`,"42501");
  });
  await isolated("encrypted credentials remain private even for a workspace admin", async () => {
    await db.exec(`insert into private.channel_credentials(connection_id,workspace_id,encrypted_payload,key_version)
      values ('${id(51)}','${id(1)}','synthetic-ciphertext',1)`);
    await asRole(db,"authenticated",id(101));
    await rejectSql(db,"select * from private.channel_credentials","42501");
    await rejectSql(db,`select private.backfill_whatsapp_workspace('${id(1)}','${id(51)}',5)`,"42501");
    await asRole(db,"service_role");
    assert.equal((await rows(db,"select count(*)::int n from private.channel_credentials"))[0].n,1);
  });
  await isolated("composite foreign keys reject cross-tenant references even for service role", async () => {
    await asRole(db,"service_role");
    await rejectSql(db,`insert into public.contact_identities(workspace_id,contact_id,connection_id,external_user_id)
      values ('${id(1)}','${id(22)}','${id(51)}','other')`,"23503");
    await rejectSql(db,`insert into private.channel_credentials(connection_id,workspace_id,encrypted_payload,key_version)
      values ('${id(51)}','${id(2)}','fixture',1)`,"23503");
    await rejectSql(db,`insert into public.messages(workspace_id,conversation_id,direction,type,body)
      values ('${id(1)}','${id(32)}','in','text','fixture')`,"23503");
  });
  await isolated("active assets cannot be connected to two workspaces", async () => {
    await rejectSql(db,`insert into public.channel_connections(workspace_id,channel,provider,external_account_id)
      values ('${id(2)}','whatsapp','ycloud','+15555550100')`,"23505");
    await rejectSql(db,`update public.channel_connections set external_account_id='different' where id='${id(51)}'`,"23514");
  });
  await isolated("backfill resumes in bounded batches and retries preserve IDs/history", async () => {
    await asRole(db,"service_role");
    const first=await backfill(db,1,51,1);
    assert.equal(first.conversations_updated,1);
    assert.equal(first.remaining_conversations,1);
    assert.equal(first.messages_updated,1);
    const second=await backfill(db,1,51,1);
    assert.equal(second.remaining_conversations,0);
    assert.equal(second.remaining_messages,0);
    const identities=await rows(db,"select id from public.contact_identities order by id");
    assert.deepEqual(await backfill(db),{
      conversations_updated:0,messages_updated:0,remaining_conversations:0,remaining_messages:0,
    });
    assert.deepEqual(await rows(db,"select id from public.contact_identities order by id"),identities);
    assert.deepEqual(await legacyRows(db),before);
  });
  await isolated("a conflicting identity aborts the whole batch without partial updates", async () => {
    await db.exec(`insert into public.contact_identities(workspace_id,contact_id,connection_id,external_user_id)
      values ('${id(1)}','${id(23)}','${id(51)}','+15555550101')`);
    await rejectSql(db,`select private.backfill_whatsapp_workspace('${id(1)}','${id(51)}',500)`,"23505");
    assert.equal((await rows(db,"select count(*)::int n from public.conversations where connection_id is not null"))[0].n,0);
    assert.deepEqual(await legacyRows(db),before);
  });
  await isolated("legacy upserts and receipt updates still work after backfill", async () => {
    await backfill(db);
    await db.query("update public.integrations set config=$1 where id=$2", [{ phone_number: "+15555550100" }, id(11)]);
    const result = (await db.query("select public.upsert_legacy_whatsapp_inbound($1,$2,$3,$4) value",
      [id(1), "+15555550101", "Fixture 1", { integrationId: id(11), provider: "ycloud", accountId: "+15555550100" }])).rows[0].value;
    assert.equal(result.conversation.id, id(31));
    await db.exec(`insert into public.messages(id,workspace_id,conversation_id,direction,type,body,wamid,status)
      values ('${id(44)}','${id(1)}','${id(31)}','out','text','legacy writer','wamid.fixture-new','sent')`);
    assert.equal((await rows(db,`select connection_id from public.messages where id='${id(44)}'`))[0].connection_id,id(51));
    await db.exec(`update public.messages set status='delivered' where id='${id(44)}'`);
    await rejectSql(db,`update public.conversations set connection_id=null,identity_id=null where id='${id(31)}'`,"23514");
  });
  await isolated("provider switch keeps legacy sends usable without assigning the wrong provider", async () => {
    await backfill(db);
    await db.exec(`update public.integrations set enabled=false where id='${id(11)}';
      insert into public.integrations(workspace_id,provider,enabled) values ('${id(1)}','kapso',true);
      insert into public.messages(id,workspace_id,conversation_id,direction,type,body,wamid,status)
      values ('${id(44)}','${id(1)}','${id(31)}','out','text','new provider','wamid.fixture-switch','sent')`);
    assert.deepEqual((await rows(db,`select connection_id,provider from public.messages where id='${id(44)}'`))[0],
      { connection_id:null,provider:null });
    await rejectSql(db,`select private.backfill_whatsapp_workspace('${id(1)}','${id(51)}',500)`,"23514");
  });
  await isolated("new transports remain unavailable until policy and workers exist", async () => {
    await rejectSql(db,`insert into public.conversations(workspace_id,contact_id,channel)
      values ('${id(1)}','${id(21)}','instagram')`,"23514");
  });
  await isolated("existing expired-window protection remains effective", async () => {
    await db.exec(`update public.conversations set window_expires_at=now()-interval '1 hour' where id='${id(31)}'`);
    await rejectSql(db,`insert into public.messages(workspace_id,conversation_id,direction,type,body)
      values ('${id(1)}','${id(31)}','out','text','must block')`,"P0001");
    await db.exec(`insert into public.messages(workspace_id,conversation_id,direction,type,body,meta)
      values ('${id(1)}','${id(31)}','out','system','internal note','{"internal":true}')`);
  });
  await isolated("revoking a prepared channel keeps history and legacy WhatsApp available", async () => {
    await backfill(db);
    await db.exec(`update public.channel_connections set status='revoked',revoked_at=now() where id='${id(51)}'`);
    assert.deepEqual(await legacyRows(db),before);
    await db.exec(`insert into public.messages(workspace_id,conversation_id,direction,type,body)
      values ('${id(1)}','${id(31)}','out','text','legacy remains available')`);
  });
});
