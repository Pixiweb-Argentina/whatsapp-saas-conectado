import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createLegacyDatabase, applyOmnichannelMigrations } from "./database-harness.mjs";

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
async function page(db, changes = {}) {
  const args = { workspace: id(1), channel: null, account: null, state: null, search: "",
    before: null, cursor: null, ...changes };
  return (await db.query("select public.read_inbox_page($1,$2,$3,$4,$5,$6,$7) row", Object.values(args))).rows.map((r) => r.row);
}
async function login(db, n) {
  await db.exec("RESET ROLE; SET ROLE authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id(n)]);
}

test("F3 inbox query preserves RLS, previews and cursor boundaries", async (t) => {
  const { db } = await createLegacyDatabase();
  t.after(() => db.close());
  await db.exec(await readFile(new URL("./omnichannel-fixture.sql", import.meta.url), "utf8"));
  await applyOmnichannelMigrations(db);
  await db.exec(`insert into public.channel_connections(id,workspace_id,channel,provider,external_account_id,display_name,status,legacy_integration_id)
    values ('${id(51)}','${id(1)}','whatsapp','ycloud','fixture-inbox','Cuenta de prueba','ready','${id(11)}');
    select private.backfill_whatsapp_workspace('${id(1)}','${id(51)}',100);
    insert into public.messages(workspace_id,conversation_id,direction,type,body,created_at)
    select '${id(1)}','${id(31)}','in','text','historial masivo '||n, now()+n*interval '1 second'
    from generate_series(1,1200) n;`);

  await t.test("one latest preview survives a conversation with 1200 messages", async () => {
    await login(db, 101);
    const rows = await page(db);
    assert.equal(rows.length, 2);
    assert.equal(rows.find((r) => r.id === id(31)).last_message.body, "historial masivo 1200");
    assert.equal(rows.find((r) => r.id === id(33)).last_message.body, "respuesta fixture");
    assert.deepEqual(rows[0].connection, { id: id(51), channel: "whatsapp", display_name: "Cuenta de prueba" });
  });
  await t.test("members cannot substitute another workspace or account; viewers can read", async () => {
    assert.deepEqual(await page(db, { workspace: id(2) }), []);
    assert.deepEqual(await page(db, { account: id(52) }), []);
    await login(db, 102);
    assert.equal((await page(db)).length, 2);
    await login(db, 103);
    assert.deepEqual(await page(db), []);
  });
  await t.test("channel, account, state and literal search apply before the result limit", async () => {
    await login(db, 101);
    assert.equal((await page(db, { channel: "whatsapp", account: id(51), state: "ai_active", search: "FIXTURE 3" })).length, 1);
    assert.equal((await page(db, { search: "+15555550101" })).length, 1);
    assert.deepEqual(await page(db, { channel: "instagram" }), []);
    assert.deepEqual(await page(db, { state: "closed" }), []);
    assert.deepEqual(await page(db, { search: "%" }), []);
  });
  await t.test("invalid filters and half cursors are rejected, anonymous has no RPC access", async () => {
    await assert.rejects(() => page(db, { channel: "tiktok" }), (e) => e.code === "22023");
    await assert.rejects(() => page(db, { search: "x".repeat(81) }), (e) => e.code === "22023");
    await assert.rejects(() => page(db, { cursor: id(31) }), (e) => e.code === "22023");
    await db.exec("RESET ROLE; SET ROLE anon");
    await assert.rejects(() => page(db), (e) => e.code === "42501");
  });
  await t.test("cursor traverses 55 conversations once, including tied and null activity dates", async () => {
    await db.exec("RESET ROLE");
    for (let n = 200; n < 253; n++) {
      await db.query("insert into public.contacts(id,workspace_id,name,phone) values ($1,$2,$3,$4)",
        [id(n), id(1), "Paginado " + n, "+15555550" + n]);
      await db.query("insert into public.conversations(id,workspace_id,contact_id,channel) values ($1,$2,$3,'whatsapp')",
        [id(n + 100), id(1), id(n)]);
    }
    await db.query("update public.conversations set last_message_at=null,created_at='2026-01-01T00:00:00Z' where workspace_id=$1", [id(1)]);
    await login(db, 101);
    const first = await page(db);
    assert.equal(first.length, 51);
    const last = first[49];
    const second = await page(db, { before: last.activity_at, cursor: last.id });
    assert.equal(second.length, 5);
    assert.equal(new Set([...first.slice(0, 50), ...second].map((r) => r.id)).size, 55);
    assert.equal((await page(db, { search: "Fixture 1" })).length, 1);
  });
  await t.test("deactivating membership immediately hides the complete page", async () => {
    await db.exec("RESET ROLE");
    await db.query("update public.memberships set is_active=false where user_id=$1", [id(101)]);
    await login(db, 101);
    assert.deepEqual(await page(db), []);
  });
});
