import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createLegacyDatabase, applyOmnichannelMigrations } from "./database-harness.mjs";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scalar = async (db, sql, args = []) => (await db.query(sql, args)).rows[0]?.result;
function event(patch = {}) {
  const timestamp = new Date(Date.now() - 60000).toISOString();
  return { schemaVersion: 1, workspaceId: id(1), connectionId: id(51), channel: "whatsapp", provider: "ycloud",
    providerEventId: "wamid.inbox", externalMessageId: "wamid.inbox", kind: "message", externalActorId: "+15555550901",
    occurredAt: timestamp, receivedAt: timestamp, content: { type: "text", text: "Hola prueba", rawType: "text" },
    mediaRefs: [], sourceContext: { channel: "whatsapp", sourceType: "direct_message" }, ...patch };
}
test("YCloud receive-only inbox is atomic, idempotent and scoped without send authority", async (t) => {
  const { db } = await createLegacyDatabase(); t.after(() => db.close());
  await db.exec(await readFile(new URL("./omnichannel-fixture.sql", import.meta.url), "utf8"));
  await applyOmnichannelMigrations(db);
  await db.query("update public.integrations set config=$1 where id=$2", [{ phone_number: "+15555550100" }, id(11)]);
  await db.query(`insert into public.channel_connections(id,workspace_id,channel,provider,external_account_id,status,legacy_integration_id)
    values($1,$2,'whatsapp','ycloud','+15555550100','needs_permissions',$3)`, [id(51), id(1), id(11)]);
  const persist = (value = event(), historical = false, workspace = id(1), integration = id(11)) =>
    scalar(db, "select public.materialize_ycloud_inbound($1,$2,$3,$4,$5) result", [workspace, integration, value, "Contacto", historical]);
  const isolated = (name, run) => t.test(name, async () => {
    await db.exec("BEGIN"); try { await run(); } finally { await db.exec("ROLLBACK; RESET ROLE"); }
  });
  const reject = async (run, code = "23514") => {
    await db.exec("SAVEPOINT denied"); try { await assert.rejects(run, (e) => e.code === code); }
    finally { await db.exec("ROLLBACK TO SAVEPOINT denied; RELEASE SAVEPOINT denied"); }
  };
  await isolated("one transaction persists the message and human conversation; retry does not inflate unread or consent", async () => {
    await db.exec("SET LOCAL ROLE service_role");
    const value = event(), first = await persist(value);
    assert.equal(first.inserted, true);
    const row = (await db.query("select * from public.conversations where id=$1", [first.conversationId])).rows[0];
    assert.equal(row.ai_enabled, false); assert.equal(row.state, "human_active"); assert.equal(row.unread_count, 1);
    assert.equal(await scalar(db, "select opt_in result from public.contacts where id=$1", [row.contact_id]), false);
    assert.equal((await persist({ ...value, receivedAt: new Date().toISOString() })).inserted, false);
    assert.equal(await scalar(db, "select unread_count result from public.conversations where id=$1", [row.id]), 1);
    assert.equal(await scalar(db, "select count(*)::int result from public.message_jobs"), 0);
    assert.equal(await scalar(db, "select count(*)::int result from public.message_outbox"), 0);
    assert.equal(await scalar(db, "select status result from public.channel_connections where id=$1", [id(51)]), "needs_permissions");
    await reject(() => persist({ ...value, content: { ...value.content, text: "changed" } }));
  });
  await isolated("a receive-only receipt is durable and deduplicated without granting send or mutating an inbound message", async () => {
    await db.exec("SET LOCAL ROLE service_role");
    const first = await persist();
    const before = (await db.query("select * from public.conversations where id=$1", [first.conversationId])).rows[0];
    const receipt = { connectionId: id(51), provider: "ycloud", externalAccountId: "+15555550100",
      providerEventId: "evt.inbox-receipt", status: "read", wamid: "wamid.external-outbound",
      providerMessageId: "provider.external-outbound", operationId: null, recipient: "+15555550901",
      occurredAt: new Date(Date.now() - 1000).toISOString() };
    const save = () => scalar(db, "select public.persist_channel_receipt($1,$2,$3) result", [id(1), id(11), receipt]);
    const receiptId = await save(); assert.equal(await save(), receiptId);
    assert.equal(await scalar(db, "select count(*)::int result from private.channel_delivery_receipts"), 1);
    assert.equal(await scalar(db, "select state result from private.channel_delivery_receipts where id=$1", [receiptId]), "pending");
    assert.deepEqual((await db.query("select * from public.conversations where id=$1", [first.conversationId])).rows[0], before);
    assert.equal(await scalar(db, "select count(*)::int result from public.messages where conversation_id=$1", [first.conversationId]), 1);
    assert.equal(await scalar(db, "select count(*)::int result from public.message_jobs"), 0);
    assert.equal(await scalar(db, "select count(*)::int result from public.message_outbox"), 0);
    assert.equal(await scalar(db, "select opt_in result from public.contacts where id=$1", [before.contact_id]), false);
    assert.equal(await scalar(db, "select status result from public.channel_connections where id=$1", [id(51)]), "needs_permissions");
  });
  await isolated("historical import cannot become live evidence on retry; a distinct live message verifies the identity", async () => {
    const value = event(), first = await persist(value, true);
    assert.equal(await scalar(db, "select state result from public.inbound_events where id=$1", [first.eventId]), "ignored");
    assert.equal(await scalar(db, "select verified_at result from public.contact_identities where connection_id=$1", [id(51)]), null);
    assert.equal((await persist(value, false)).inserted, false);
    assert.equal(await scalar(db, "select historical result from public.inbound_events where id=$1", [first.eventId]), true);
    await persist({ ...event(), providerEventId: "wamid.live", externalMessageId: "wamid.live" });
    assert.ok(await scalar(db, "select verified_at result from public.contact_identities where connection_id=$1", [id(51)]));
  });
  await isolated("bounded local receipt skew is clamped to database time without admitting future provider events", async () => {
    await db.exec("SET LOCAL ROLE service_role");
    const value = event({ receivedAt: new Date(Date.now() + 2000).toISOString() });
    const first = await persist(value);
    const stored = await scalar(db, "select envelope result from public.inbound_events where id=$1", [first.eventId]);
    assert.ok(Date.parse(stored.receivedAt) <= Date.now());
    assert.equal(stored.occurredAt, value.occurredAt);
    assert.equal((await persist(value)).inserted, false);
    await reject(() => persist(event({ providerEventId: "future-receipt", externalMessageId: "future-receipt", receivedAt: new Date(Date.now() + 60000).toISOString() })));
    await reject(() => persist(event({ providerEventId: "future-provider", externalMessageId: "future-provider", occurredAt: new Date(Date.now() + 2000).toISOString(), receivedAt: new Date(Date.now() + 2000).toISOString() })));
  });
  await isolated("failure late in materialization rolls back every artifact and permits a clean retry", async () => {
    await db.exec("create function private.inbox_test_abort() returns trigger language plpgsql as $$ begin raise exception 'SYNTHETIC_ABORT' using errcode='23514'; end $$; create trigger inbox_abort before insert on public.messages for each row execute function private.inbox_test_abort()");
    const value = event(); await reject(() => persist(value));
    assert.equal(await scalar(db, "select count(*)::int result from public.inbound_events"), 0);
    assert.equal(await scalar(db, "select count(*)::int result from public.contact_identities"), 0);
    assert.equal(await scalar(db, "select count(*)::int result from public.contacts where phone='+15555550901'"), 0);
    await db.exec("drop trigger inbox_abort on public.messages"); assert.equal((await persist(value)).inserted, true);
  });
  await isolated("foreign tenant, integration, destination and future timestamps are rejected", async () => {
    await reject(() => persist(event(), false, id(2)), "P0002");
    await reject(() => persist(event(), false, id(1), id(12)), "P0002");
    await reject(() => persist(event({ workspaceId: id(2) })));
    await reject(() => persist(event({ occurredAt: "2099-01-01T00:00:00Z" })));
    await db.query("update public.integrations set enabled=false where id=$1", [id(11)]);
    await reject(() => persist(), "P0002");
    assert.equal(await scalar(db, "select count(*)::int result from public.inbound_events"), 0);
  });
  await isolated("legacy conversation and active AI cannot be silently adopted", async () => {
    await reject(() => persist(event({ externalActorId: "+15555550101" })));
    assert.equal(await scalar(db, "select count(*)::int result from public.inbound_events"), 0);
    const first = await persist();
    await db.query("update public.conversations set ai_enabled=true,state='ai_active' where id=$1", [first.conversationId]);
    await reject(() => persist(event({ providerEventId: "new", externalMessageId: "new" })));
  });
  await isolated("existing opt-out is preserved and browser roles cannot impersonate reception", async () => {
    await db.query("insert into public.contacts(workspace_id,phone,name,opt_in) values($1,'+15555550901','Original',false)", [id(1)]);
    await persist();
    assert.equal(await scalar(db, "select opt_in result from public.contacts where phone='+15555550901'"), false);
    assert.equal(await scalar(db, "select name result from public.contacts where phone='+15555550901'"), "Original");
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`SET LOCAL ROLE ${role}`); await reject(() => persist(), "42501"); await db.exec("RESET ROLE");
    }
  });
});
