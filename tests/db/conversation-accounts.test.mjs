import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createLegacyDatabase, applyOmnichannelMigrations } from "./database-harness.mjs";

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scalar = async (db, sql, args = []) => (await db.query(sql, args)).rows[0]?.result;
const routing = { integrationId: id(11), provider: "ycloud", accountId: "+15555550800" };
const legacy = (db, phone = "+15555550101", route = routing) => scalar(db,
  "select public.upsert_legacy_whatsapp_inbound($1,$2,'Legacy name',$3) result", [id(1), phone, route]);
const lookup = (db, contact = id(21), route = null) => db.query(
  "select id from public.read_legacy_whatsapp_conversation($1,$2,$3)", [id(1), contact, route]);

export async function seedAccounts(db) {
  await db.query("update public.integrations set config=$1 where id=$2", [{ phone_number: routing.accountId }, id(11)]);
  await db.query(`insert into public.channel_connections(id,workspace_id,channel,provider,external_account_id,display_name,status,legacy_integration_id)
    values($1,$2,'whatsapp','ycloud',$3,'Cuenta A','ready',$4)`, [id(51), id(1), routing.accountId, id(11)]);
  await db.query("select private.backfill_whatsapp_workspace($1,$2,100)", [id(1), id(51)]);
  await db.query(`insert into public.channel_connections(id,workspace_id,channel,provider,external_account_id,display_name,status)
    values($1,$2,'whatsapp','ycloud','+15555550801','Cuenta B','needs_permissions')`, [id(52), id(1)]);
  await db.query(`insert into public.contact_identities(id,workspace_id,contact_id,connection_id,external_user_id)
    values($1,$2,$3,$4,'+15555550101')`, [id(82), id(1), id(21), id(52)]);
}
export async function addSecondThread(db) {
  return scalar(db, "select to_jsonb(private.ycloud_account_conversation($1,$2,$3,$4)) result",
    [id(1), id(52), id(21), id(82)]);
}

test("conversations separate explicit accounts while preserving unambiguous legacy WhatsApp", async (t) => {
  const { db } = await createLegacyDatabase(); t.after(() => db.close());
  await db.exec(await readFile(new URL("./omnichannel-fixture.sql", import.meta.url), "utf8"));
  await applyOmnichannelMigrations(db);
  await seedAccounts(db);
  async function isolated(name, check) {
    await t.test(name, async () => { await db.exec("BEGIN"); try { await check(); } finally { await db.exec("ROLLBACK"); } });
  }
  await isolated("same contact and external user keep different IDs, histories, states and account filters", async () => {
    const before = (await db.query("select * from public.conversations where id=$1", [id(31)])).rows[0];
    const second = await addSecondThread(db);
    assert.notEqual(second.id, id(31)); assert.equal(second.state, "human_active");
    assert.equal(second.ai_enabled, false); assert.equal(second.connection_id, id(52));
    assert.equal((await addSecondThread(db)).id, second.id);
    await db.query(`insert into public.messages(workspace_id,conversation_id,connection_id,provider,direction,type,body,wamid)
      values($1,$2,$3,'ycloud','in','text','Only account B','wamid.account-b')`, [id(1), second.id, id(52)]);
    assert.deepEqual((await db.query("select * from public.conversations where id=$1", [id(31)])).rows[0], before);
    await db.exec("SET LOCAL ROLE authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id(101)]);
    for (const [account, expected] of [[51, id(31)], [52, second.id]]) {
      const rows = (await db.query("select public.read_inbox_page_assigned($1,p_connection_id=>$2,p_search=>'Fixture 1') value",
        [id(1), id(account)])).rows.map((r) => r.value);
      assert.equal(rows.length, 1); assert.equal(rows[0].id, expected);
    }
    const previews = (await db.query("select public.read_inbox_page_assigned($1) value", [id(1)])).rows.map((r) => r.value);
    assert.equal(previews.find((r) => r.id === second.id).last_message.body, "Only account B");
    assert.notEqual(previews.find((r) => r.id === id(31)).last_message.body, "Only account B");
  });
  await isolated("legacy uses the mapped single-account ID and cannot change its routing or human control", async () => {
    await db.query("update public.conversations set state='human_active',ai_enabled=false where id=$1", [id(31)]);
    const result = await legacy(db);
    assert.equal(result.conversation.id, id(31)); assert.equal(result.conversation.connection_id, id(51));
    assert.equal(result.conversation.state, "human_active"); assert.equal(result.conversation.ai_enabled, false);
    assert.equal(result.conversation.unread_count, 1);
    assert.deepEqual((await lookup(db)).rows, [{ id: id(31) }]);
  });
  await isolated("legacy still creates one unmapped conversation and preserves STOP suppression", async () => {
    const first = await legacy(db, "+15555550944");
    assert.equal(first.conversation.connection_id, null);
    assert.equal((await legacy(db, "+15555550944")).conversation.id, first.conversation.id);
    await db.query(`insert into public.contact_opt_outs(workspace_id,phone_key,source)
      values($1,public.contact_phone_key('+15555550944'),'keyword')`, [id(1)]);
    assert.equal((await legacy(db, "+15555550944")).contact.opt_in, false);
  });
  await isolated("multiple accounts make legacy intake/echo/contact-level rules fail closed with no profile changes", async () => {
    await addSecondThread(db);
    const before = (await db.query("select * from public.contacts where id=$1", [id(21)])).rows[0];
    assert.equal((await lookup(db)).rows.length, 0);
    assert.equal((await lookup(db, id(21), routing)).rows.length, 0);
    await db.exec("SAVEPOINT rejected");
    await assert.rejects(() => legacy(db), (e) => e.code === "23514");
    await db.exec("ROLLBACK TO SAVEPOINT rejected");
    assert.deepEqual((await db.query("select * from public.contacts where id=$1", [id(21)])).rows[0], before);
  });
  await isolated("wrong account, disabled integration, queue-owned thread and cross-tenant routing are rejected", async () => {
    for (const route of [{ ...routing, accountId: "+15555550801" }, { ...routing, integrationId: id(12) }]) {
      await db.exec("SAVEPOINT rejected"); await assert.rejects(() => legacy(db, undefined, route));
      await db.exec("ROLLBACK TO SAVEPOINT rejected");
    }
    await db.query("update public.conversations set source_context=$1 where id=$2", [{ sourceType: "direct_message" }, id(31)]);
    await db.exec("SAVEPOINT rejected"); await assert.rejects(() => legacy(db), (e) => e.code === "23514");
    await db.exec("ROLLBACK TO SAVEPOINT rejected");
    assert.equal((await lookup(db)).rows.length, 0);
    await db.query("update public.integrations set enabled=false where id=$1", [id(11)]);
    await db.exec("SAVEPOINT rejected"); await assert.rejects(() => legacy(db), (e) => e.code === "P0002");
    await db.exec("ROLLBACK TO SAVEPOINT rejected");
  });
  await isolated("NULL routing remains unique and cannot coexist with an explicit account", async () => {
    const identityId = (await db.query("select identity_id from public.conversations where id=$1", [id(31)])).rows[0].identity_id;
    for (const sql of [
      "insert into public.conversations(workspace_id,contact_id,channel) values($1,$2,'whatsapp')",
      "insert into public.conversations(workspace_id,contact_id,channel,connection_id,identity_id) values($1,$2,'whatsapp',$3,$4)",
    ]) {
      await db.exec("SAVEPOINT rejected");
      await assert.rejects(() => db.query(sql, sql.includes("identity_id")
        ? [id(1), id(21), id(51), identityId] : [id(1), id(21)]));
      await db.exec("ROLLBACK TO SAVEPOINT rejected");
    }
    const legacyThread = await legacy(db, "+15555550944");
    await db.exec("SAVEPOINT rejected");
    await assert.rejects(() => db.query("insert into public.conversations(workspace_id,contact_id,channel) values($1,$2,'whatsapp')",
      [id(1), legacyThread.contact.id]), (e) => e.code === "23505");
    await db.exec("ROLLBACK TO SAVEPOINT rejected");
    await db.query(`insert into public.contact_identities(id,workspace_id,contact_id,connection_id,external_user_id)
      values($1,$2,$3,$4,'+15555550944')`, [id(83), id(1), legacyThread.contact.id, id(52)]);
    await db.exec("SAVEPOINT rejected");
    await assert.rejects(() => db.query("select private.ycloud_account_conversation($1,$2,$3,$4)",
      [id(1), id(52), legacyThread.contact.id, id(83)]), (e) => e.code === "23514");
    await db.exec("ROLLBACK TO SAVEPOINT rejected");
  });
  await isolated("browser roles cannot invoke legacy writers or readers; foreign tenant rows stay hidden", async () => {
    await addSecondThread(db);
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`SET LOCAL ROLE ${role}; SAVEPOINT rejected`);
      await assert.rejects(() => legacy(db), (e) => e.code === "42501");
      await db.exec("ROLLBACK TO SAVEPOINT rejected");
      await assert.rejects(() => lookup(db), (e) => e.code === "42501");
      await db.exec("ROLLBACK TO SAVEPOINT rejected; RESET ROLE");
    }
    await db.exec("SET LOCAL ROLE authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id(103)]);
    assert.equal((await db.query("select public.read_inbox_page_assigned($1) value", [id(1)])).rows.length, 0);
  });
});
