import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createLegacyDatabase, applyOmnichannelMigrations } from "./database-harness.mjs";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scalar = async (db, sql, args = []) => (await db.query(sql, args)).rows[0]?.result;
const inbound = (patch = {}) => ({ schemaVersion: 1, workspaceId: id(1), connectionId: id(51), channel: "whatsapp", provider: "kapso",
  providerEventId: "wamid.contact-hello", externalMessageId: "wamid.contact-hello", kind: "message", externalActorId: "+15555550901",
  occurredAt: "2026-10-10T12:00:00Z", receivedAt: "2026-10-10T12:00:01Z", content: { type: "text", text: "Hola", rawType: "text" },
  mediaRefs: [], sourceContext: { channel: "whatsapp", sourceType: "direct_message" }, ...patch });
const sentAt = new Date(Date.now() - 60_000).toISOString();
const echo = (patch = {}) => ({ connectionId: id(51), externalAccountId: "synthetic-phone-id", wamid: "wamid.phone-reply",
  recipient: "+15555550901", occurredAt: sentAt, type: "text", body: "Te respondo yo", ...patch });

test("managed Kapso Business App echoes become human replies that pause the AI, never contacts or sends", async (t) => {
  const { db } = await createLegacyDatabase(); t.after(() => db.close());
  await db.exec(await readFile(new URL("./omnichannel-fixture.sql", import.meta.url), "utf8"));
  await applyOmnichannelMigrations(db);
  const register = (connection = id(51), provider = "kapso", account = "synthetic-phone-id") => scalar(db,
    "select public.register_whatsapp_account($1,$2,$3,$4,$5,'QA','enc:v1:YWJj:ZGVm',1) result", [id(1), id(101), connection, provider, account]);
  const revision = async (connection = id(51)) =>
    (await scalar(db, "select public.read_whatsapp_account_source($1,$2) result", [id(1), connection]))?.sourceRevision;
  const greet = async (value = inbound()) => scalar(db, "select public.materialize_whatsapp_account_inbound($1,$2,$3,$4,'Contacto') result",
    [id(1), value.connectionId, await revision(value.connectionId), value]);
  const persist = async (value = echo(), rev, workspace = id(1), connection = id(51)) =>
    scalar(db, "select public.persist_whatsapp_account_echo($1,$2,$3,$4) result",
      [workspace, connection, rev ?? (await revision(connection)) ?? "missing", value]);
  const count = (table) => scalar(db, `select count(*)::int result from ${table}`);
  const conversation = (conv) => db.query("select * from public.conversations where id=$1", [conv]).then((r) => r.rows[0]);
  const isolated = (name, run) => t.test(name, async () => {
    await db.exec("BEGIN"); try { await register(); await run(); } finally { await db.exec("ROLLBACK; RESET ROLE"); }
  });
  const reject = async (run, code = "23514") => {
    await db.exec("SAVEPOINT denied"); try { await assert.rejects(run, (e) => e.code === code); }
    finally { await db.exec("ROLLBACK TO SAVEPOINT denied; RELEASE SAVEPOINT denied"); }
  };

  await isolated("a phone reply to a contact who wrote in is an outgoing human message and pauses the AI", async () => {
    const first = await greet();
    await db.query("update public.conversations set state='ai_active',ai_enabled=true where id=$1", [first.conversationId]);
    // The AI was turned on just now; the phone reply comes after it, so it pauses the AI again.
    await new Promise((done) => setTimeout(done, 5)); const later = echo({ occurredAt: new Date().toISOString() });
    await db.exec("SET LOCAL ROLE service_role");
    assert.deepEqual(await persist(later), { conversationId: first.conversationId, inserted: true, aiDisabled: true });
    await db.exec("RESET ROLE");
    const row = await conversation(first.conversationId);
    assert.equal(row.state, "human_active"); assert.equal(row.ai_enabled, false);
    const msg = (await db.query("select * from public.messages where wamid='wamid.phone-reply'")).rows[0];
    assert.equal(msg.direction, "out"); assert.equal(msg.status, "sent"); assert.equal(msg.body, "Te respondo yo");
    assert.equal(msg.connection_id, id(51)); assert.equal(msg.conversation_id, first.conversationId);
    assert.deepEqual(msg.meta, { origin: "business_app", channel_actor: "human" });
    assert.equal(await scalar(db, "select payload->>'trigger' result from public.events where conversation_id=$1 and type='state_change'",
      [first.conversationId]), "business_app");
    assert.equal(await scalar(db, "select opt_in result from public.contacts where id=$1", [row.contact_id]), false);
    assert.equal(await count("public.message_outbox"), 0); assert.equal(await count("public.message_jobs"), 0);
  });
  await isolated("replays are stored once and a changed replay is rejected", async () => {
    const first = await greet();
    await persist();
    assert.deepEqual(await persist(), { conversationId: first.conversationId, inserted: false, aiDisabled: false });
    assert.equal(await count("public.messages where wamid='wamid.phone-reply'"), 1);
    await reject(() => persist(echo({ body: "otro texto" })));
  });
  await isolated("a reply to someone who never wrote in is ignored and creates no contact", async () => {
    await greet(); const contacts = await count("public.contacts");
    assert.deepEqual(await persist(echo({ recipient: "+15555550777" })), { conversationId: null, inserted: false, aiDisabled: false });
    assert.equal(await count("public.contacts"), contacts);
    assert.equal(await count("public.messages where wamid='wamid.phone-reply'"), 0);
    assert.equal(await scalar(db, "select reason result from private.business_app_echoes"), "identity_unavailable");
  });
  await isolated("a closed conversation keeps its history but is not reopened", async () => {
    const first = await greet();
    await db.query("update public.conversations set state='closed' where id=$1", [first.conversationId]);
    assert.deepEqual(await persist(), { conversationId: first.conversationId, inserted: true, aiDisabled: false });
    assert.equal((await conversation(first.conversationId)).state, "closed");
  });
  await isolated("other accounts, providers, workspaces and stale revisions are refused", async () => {
    await greet();
    await reject(() => persist(echo({ connectionId: id(52) })), "42501");
    await reject(() => persist(echo({ externalAccountId: "other-phone-id" })), "42501");
    await reject(() => persist(echo(), "stale-revision"));
    await reject(() => persist(echo(), undefined, id(2)));
    await register(id(52), "ycloud", "+15555550800");
    await reject(() => persist(echo({ connectionId: id(52), externalAccountId: "+15555550800" }), undefined, id(1), id(52)), "42501");
    await reject(() => persist(echo({ occurredAt: new Date(Date.now() + 60_000).toISOString() })), "22023");
    await reject(() => persist(echo({ recipient: "15555550901" })), "22023");
    assert.equal(await count("private.business_app_echoes"), 0);
  });
  await isolated("the same contact on another account never receives this account's echo", async () => {
    await greet(); await register(id(52), "kapso", "synthetic-phone-two");
    const other = await greet(inbound({ connectionId: id(52) }));
    await persist();
    assert.equal(await count(`public.messages where conversation_id='${other.conversationId}' and direction='out'`), 0);
  });
  await isolated("browser roles cannot call the echo writer", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`SET LOCAL ROLE ${role}`);
      await reject(() => persist(echo(), "any"), "42501");
      await db.exec("RESET ROLE");
    }
  });
});
