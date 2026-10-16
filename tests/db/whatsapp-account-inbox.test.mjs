import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createLegacyDatabase, applyOmnichannelMigrations } from "./database-harness.mjs";
import { probeSql } from "./cloud-whatsapp-account-inbox.mjs";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scalar = async (db, sql, args = []) => (await db.query(sql, args)).rows[0]?.result;
const event = (patch = {}) => ({ schemaVersion: 1, workspaceId: id(1), connectionId: id(51), channel: "whatsapp", provider: "ycloud",
  providerEventId: "wamid.account-inbox", externalMessageId: "wamid.account-inbox", kind: "message", externalActorId: "+15555550901",
  occurredAt: "2026-10-10T12:00:00Z", receivedAt: "2026-10-10T12:00:01Z", content: { type: "text", text: "Hola cuenta", rawType: "text" },
  mediaRefs: [], sourceContext: { channel: "whatsapp", sourceType: "direct_message" }, ...patch });

test("managed receive-only inbox binds identities and history to the account atomically", async (t) => {
  const { db } = await createLegacyDatabase(); t.after(() => db.close());
  await db.exec(await readFile(new URL("./omnichannel-fixture.sql", import.meta.url), "utf8"));
  await applyOmnichannelMigrations(db);
  const register = (connection = id(51), provider = "ycloud", account = "+15555550800") => scalar(db,
    "select public.register_whatsapp_account($1,$2,$3,$4,$5,'QA','enc:v1:YWJj:ZGVm',1) result", [id(1), id(101), connection, provider, account]);
  const source = () => scalar(db, "select public.read_whatsapp_account_source($1,$2) result", [id(1), id(51)]);
  const save = async (value = event(), revision, workspace = id(1), connection = value.connectionId) => {
    const src = await scalar(db, "select public.read_whatsapp_account_source($1,$2) result", [workspace, connection]);
    return scalar(db, "select public.materialize_whatsapp_account_inbound($1,$2,$3,$4,'Contacto') result",
      [workspace, connection, revision ?? src?.sourceRevision ?? "missing", value]);
  };
  const count = (table) => scalar(db, `select count(*)::int result from public.${table}`);
  const isolated = (name, run) => t.test(name, async () => {
    await db.exec("BEGIN"); try { await register(); await run(); } finally { await db.exec("ROLLBACK; RESET ROLE"); }
  });
  const reject = async (run, code = "23514") => {
    await db.exec("SAVEPOINT denied"); try { await assert.rejects(run, (e) => e.code === code); }
    finally { await db.exec("ROLLBACK TO SAVEPOINT denied; RELEASE SAVEPOINT denied"); }
  };
  await isolated("service role creates one human thread and verified identity without consent or send authority", async () => {
    await db.exec("SET LOCAL ROLE service_role"); const first = await save();
    assert.equal(first.inserted, true);
    const row = (await db.query("select * from public.conversations where id=$1", [first.conversationId])).rows[0];
    assert.equal(row.connection_id, id(51)); assert.equal(row.state, "human_active"); assert.equal(row.ai_enabled, false);
    assert.equal(row.unread_count, 1); assert.equal(new Date(row.window_expires_at).toISOString(), "2026-10-11T12:00:00.000Z");
    assert.equal(await scalar(db, "select opt_in result from public.contacts where id=$1", [row.contact_id]), false);
    assert.ok(await scalar(db, "select verified_at result from public.contact_identities where id=$1", [row.identity_id]));
    assert.equal(await scalar(db, "select state result from public.inbound_events where id=$1", [first.eventId]), "planned");
    assert.equal(await count("message_jobs"), 0); assert.equal(await count("message_outbox"), 0);
    assert.deepEqual(await scalar(db, "select capabilities result from public.channel_connections where id=$1", [id(51)]), {});
    assert.equal(await scalar(db, "select status result from public.channel_connections where id=$1", [id(51)]), "needs_permissions");
  });
  await isolated("retries preserve IDs, unread and operator state while collisions fail", async () => {
    const first = await save();
    await db.query("update public.conversations set ai_enabled=true,state='ai_active',unread_count=0 where id=$1", [first.conversationId]);
    const before = (await db.query("select * from public.conversations where id=$1", [first.conversationId])).rows[0];
    assert.deepEqual(await save(event({ receivedAt: new Date().toISOString() })), { ...first, inserted: false });
    assert.deepEqual((await db.query("select * from public.conversations where id=$1", [first.conversationId])).rows[0], before);
    await reject(() => save(event({ content: { type: "text", text: "changed", rawType: "text" } })));
    await reject(() => save(event({ providerEventId: "new", externalMessageId: "new" })));
    assert.equal(await count("inbound_events"), 1);
  });
  await isolated("same WhatsApp actor and message ID across accounts share contact but never history", async () => {
    const first = await save(); await register(id(52), "ycloud", "+15555550801");
    const second = await save(event({ connectionId: id(52) }));
    assert.notEqual(first.messageId, second.messageId); assert.notEqual(first.conversationId, second.conversationId);
    const rows = (await db.query("select contact_id,connection_id,identity_id from public.conversations where id=any($1::uuid[])",
      [[first.conversationId, second.conversationId]])).rows;
    assert.equal(new Set(rows.map((r) => r.contact_id)).size, 1);
    assert.equal(new Set(rows.map((r) => r.identity_id)).size, 2);
    assert.equal(await count("inbound_events"), 2);
  });
  await isolated("Kapso retains its provider and account even with a duplicate YCloud message ID", async () => {
    await save(); await register(id(52), "kapso", "synthetic-phone-id");
    const result = await save(event({ connectionId: id(52), provider: "kapso" }));
    const row = (await db.query("select provider,connection_id from public.messages where id=$1", [result.messageId])).rows[0];
    assert.deepEqual(row, { provider: "kapso", connection_id: id(52) });
  });
  await isolated("known identity remains attached after the contact phone is edited", async () => {
    const first = await save();
    const contact = await scalar(db, "select contact_id result from public.conversations where id=$1", [first.conversationId]);
    await db.query("update public.contacts set phone='+15555550999',name='Editado' where id=$1", [contact]);
    const next = await save(event({ providerEventId: "next", externalMessageId: "next" }));
    assert.equal(next.conversationId, first.conversationId);
    assert.equal(await scalar(db, "select count(*)::int result from public.contacts where phone='+15555550901'"), 0);
    assert.equal(await scalar(db, "select name result from public.contacts where id=$1", [contact]), "Editado");
  });
  await isolated("existing consent and profile survive receipt of a new message", async () => {
    await db.query("insert into public.contacts(workspace_id,phone,name,opt_in) values($1,'+15555550901','Original',true)", [id(1)]);
    const before = (await db.query("select * from public.contacts where phone='+15555550901'")).rows[0]; await save();
    assert.deepEqual((await db.query("select * from public.contacts where id=$1", [before.id])).rows[0], before);
  });
  await isolated("legacy NULL account conversation cannot be implicitly adopted", async () => {
    await reject(() => save(event({ externalActorId: "+15555550101" })));
    assert.equal(await count("inbound_events"), 0); assert.equal(await count("contact_identities"), 0);
  });
  await isolated("late insert failure rolls back event, contact, identity and thread, then permits retry", async () => {
    const baseline = await count("conversations");
    await db.exec("create function private.account_inbox_abort() returns trigger language plpgsql as $$ begin raise exception 'SYNTHETIC_ABORT' using errcode='23514'; end $$; create trigger account_inbox_abort before insert on public.messages for each row execute function private.account_inbox_abort()");
    await reject(() => save());
    assert.equal(await count("inbound_events"), 0); assert.equal(await count("contact_identities"), 0);
    assert.equal(await count("conversations"), baseline);
    assert.equal(await scalar(db, "select count(*)::int result from public.contacts where phone='+15555550901'"), 0);
    await db.exec("drop trigger account_inbox_abort on public.messages"); assert.equal((await save()).inserted, true);
  });
  await isolated("invalid scope, actor, provider, clocks, kind or text never materialize", async () => {
    for (const patch of [{ workspaceId: id(2) }, { connectionId: id(52) }, { provider: "kapso" }, { schemaVersion: 2 },
      { channel: "instagram" }, { kind: "receipt" }, { externalActorId: "bad" }, { externalMessageId: "different" },
      { occurredAt: "2099-01-01T00:00:00Z" }, { receivedAt: "2099-01-01T00:00:00Z" },
      { content: { type: "text", rawType: "image", text: "placeholder" } },
      { content: { type: "text", rawType: "text", text: "" } }, { content: { type: "text", rawType: "text", text: "x".repeat(16001) } }]) {
      await reject(() => save(event(patch), undefined, id(1), id(51)));
    }
    await reject(() => save(event(), undefined, id(2), id(51)));
    assert.equal(await count("inbound_events"), 0);
  });
  await isolated("rotation, expiry and revocation invalidate even previously captured messages", async () => {
    const revision = (await source()).sourceRevision;
    await scalar(db, "select public.persist_whatsapp_account_delivery($1,$2,$3,'message',$4) result", [id(1), id(51), revision, event()]);
    await db.query("update private.channel_credentials set encrypted_payload='enc:v1:ZGVm:YWJj' where connection_id=$1", [id(51)]);
    await reject(() => save(event(), revision));
    await db.query("update private.channel_credentials set expires_at=clock_timestamp()-interval '1 second' where connection_id=$1", [id(51)]);
    await reject(() => save());
    await db.query("update private.channel_credentials set expires_at=null where connection_id=$1", [id(51)]);
    await db.query("update public.channel_connections set status='revoked',revoked_at=clock_timestamp() where id=$1", [id(51)]);
    await reject(() => save()); assert.equal(await count("contact_identities"), 0);
  });
  await isolated("historical shadow evidence cannot become a live inbox identity", async () => {
    await scalar(db, "select public.persist_channel_event($1,true) result", [event()]);
    await reject(() => save()); assert.equal(await count("contact_identities"), 0);
  });
  await isolated("browser roles cannot impersonate the receive-only transaction", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`SET LOCAL ROLE ${role}`);
      await reject(() => scalar(db, "select public.materialize_whatsapp_account_inbound($1,$2,$3,$4,null) result",
        [id(1), id(51), "a".repeat(32), event()]), "42501");
      await db.exec("RESET ROLE");
    }
  });
  await t.test("same PostgreSQL probe executes locally and removes all fixtures", async () => {
    await db.exec(probeSql(id(101))); assert.equal(await count("workspaces"), 2);
  });
});
