import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createLegacyDatabase, applyOmnichannelMigrations } from "./database-harness.mjs";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scalar = async (db, sql, args = []) => (await db.query(sql, args)).rows[0]?.result;
function event(key = "one", patch = {}) {
  const time = new Date(Date.now() - 10000).toISOString();
  return { schemaVersion: 1, workspaceId: id(1), connectionId: id(51), channel: "whatsapp", provider: "ycloud",
    providerEventId: `wamid.pipeline.${key}`, externalMessageId: `wamid.pipeline.${key}`, kind: "message",
    externalActorId: "+15555550901", occurredAt: time, receivedAt: time,
    content: { type: "text", text: `Synthetic ${key}`, rawType: "text" }, mediaRefs: [],
    sourceContext: { channel: "whatsapp", sourceType: "direct_message" }, ...patch };
}

test("durable YCloud intake pins a queue before buffering and preserves human control", async (t) => {
  const { db } = await createLegacyDatabase(); t.after(() => db.close());
  await db.exec(await readFile(new URL("./omnichannel-fixture.sql", import.meta.url), "utf8"));
  await applyOmnichannelMigrations(db);
  await db.query("update public.integrations set config=$1 where id=$2", [{ phone_number: "+15555550100" }, id(11)]);
  await db.query(`insert into public.channel_connections(id,workspace_id,channel,provider,external_account_id,status,legacy_integration_id)
    values($1,$2,'whatsapp','ycloud','+15555550100','needs_permissions',$3)`, [id(51), id(1), id(11)]);
  const persist = (value = event(), enabled = true, workspace = id(1), integration = id(11), silence = 30000) =>
    scalar(db, "select public.materialize_ycloud_pipeline($1,$2,$3,$4,$5,$6) result", [workspace, integration, value, "Synthetic", enabled, silence]);
  const isolated = (name, run) => t.test(name, async () => {
    await db.exec("BEGIN"); try { await run(); } finally { await db.exec("ROLLBACK; RESET ROLE"); }
  });
  const reject = async (run, code = "23514") => {
    await db.exec("SAVEPOINT rejected");
    try { await assert.rejects(run, (e) => e.code === code); }
    finally { await db.exec("ROLLBACK TO SAVEPOINT rejected; RELEASE SAVEPOINT rejected"); }
  };
  const activate = async () => {
    const first = await persist(event("bootstrap"), false);
    await db.query("update public.conversations set ai_enabled=true,state='ai_active' where id=$1", [first.conversationId]);
    await db.query("update public.contacts set opt_in=true where phone='+15555550901'");
    const now = Date.now();
    await db.query("update public.channel_connections set status='ready',capabilities=$1 where id=$2", [{ version: 1, grants: [{
      workspaceId: id(1), connectionId: id(51), capability: "text", evidenceRef: "synthetic-only",
      verifiedAt: new Date(now - 1000).toISOString(), validUntil: new Date(now + 600000).toISOString() }] }, id(51)]);
    return first;
  };
  await isolated("new reception is human-only and never grants consent, capabilities or a model job", async () => {
    await db.exec("SET LOCAL ROLE service_role");
    const value = event(), first = await persist(value);
    assert.equal(first.inserted, true); assert.equal(first.batchId, null);
    const conv = (await db.query("select * from public.conversations where id=$1", [first.conversationId])).rows[0];
    assert.equal(conv.state, "human_active"); assert.equal(conv.ai_enabled, false);
    assert.equal(await scalar(db, "select opt_in result from public.contacts where id=$1", [conv.contact_id]), false);
    assert.equal((await persist(value)).inserted, false);
    assert.equal(await scalar(db, "select unread_count result from public.conversations where id=$1", [conv.id]), 1);
    assert.equal(await scalar(db, "select count(*)::int result from public.message_batches"), 0);
    assert.equal(await scalar(db, "select count(*)::int result from public.message_jobs"), 0);
    assert.equal(await scalar(db, "select count(*)::int result from public.message_outbox"), 0);
  });
  await isolated("eligible burst shares an isolated queue batch, and replay never inflates its counts", async () => {
    await activate(); const value = event("active");
    const first = await persist(value); assert.ok(first.batchId);
    const next = await persist(event("burst")); assert.equal(next.batchId, first.batchId);
    assert.equal((await persist(value)).batchId, first.batchId);
    const batch = (await db.query("select * from public.message_batches where id=$1", [first.batchId])).rows[0];
    assert.equal(batch.status, "buffering"); assert.equal(batch.message_count, 2);
    assert.equal(batch.meta.isolated, true); assert.equal(batch.meta.queue_intake, true);
    assert.equal(await scalar(db, "select count(*)::int result from public.messages where batch_id=$1", [first.batchId]), 2);
    assert.equal(await scalar(db, "select mode result from private.ai_reply_preparations where batch_id=$1", [first.batchId]), "queue");
    await db.query("update public.message_batches set status='processing' where id=$1", [first.batchId]);
    const prepared = await scalar(db, "select public.prepare_ai_channel_reply($1,$2,'legacy') result", [id(1), first.batchId]);
    assert.equal(prepared.mode, "queue"); assert.equal(prepared.eligible, true);
  });
  await isolated("a human hold followed by resume invalidates the prior revision without retroactively queuing duplicates", async () => {
    await activate(); const firstEvent = event("active"), first = await persist(firstEvent);
    await db.query("update public.conversations set ai_enabled=false,state='human_active' where id=$1", [first.conversationId]);
    const heldEvent = event("held"); assert.equal((await persist(heldEvent)).batchId, null);
    await db.query("update public.conversations set ai_enabled=true,state='ai_active' where id=$1", [first.conversationId]);
    assert.equal((await persist(heldEvent)).batchId, null);
    const next = await persist(event("resumed")); assert.notEqual(next.batchId, first.batchId);
    await db.query("update public.message_batches set status='processing' where id=$1", [first.batchId]);
    const old = await scalar(db, "select public.prepare_ai_channel_reply($1,$2,'queue') result", [id(1), first.batchId]);
    assert.equal(old.eligible, false);
  });
  await isolated("disabled AI flag, missing consent/grant and durable suppression never buffer a reply", async () => {
    await activate(); assert.equal((await persist(event("disabled"), false)).batchId, null);
    await db.query("update public.contacts set opt_in=false where phone='+15555550901'");
    assert.equal((await persist(event("no-consent"))).batchId, null);
    await db.query("update public.contacts set opt_in=true where phone='+15555550901'");
    const grants = await scalar(db, "select capabilities result from public.channel_connections where id=$1", [id(51)]);
    await db.query("update public.channel_connections set capabilities='{}' where id=$1", [id(51)]);
    assert.equal((await persist(event("no-grant"))).batchId, null);
    await db.query("update public.channel_connections set capabilities=$1 where id=$2", [grants, id(51)]);
    await db.query("insert into public.contact_opt_outs(workspace_id,phone_key,source) values($1,'15555550901','manual')", [id(1)]);
    assert.equal((await persist(event("suppressed"))).batchId, null);
    assert.equal(await scalar(db, "select count(*)::int result from public.message_batches"), 0);
  });
  await isolated("legacy batches are never adopted and historical inbox replay cannot be promoted", async () => {
    const first = await activate();
    await db.query("insert into public.message_batches(id,workspace_id,conversation_id,status,meta) values($1,$2,$3,'buffering','{}')", [id(991), id(1), first.conversationId]);
    const next = await persist(event("isolated")); assert.notEqual(next.batchId, id(991));
    assert.equal(await scalar(db, "select message_count result from public.message_batches where id=$1", [id(991)]), 0);
    const old = event("historical", { externalActorId: "+15555550902" });
    const imported = await scalar(db, "select public.materialize_ycloud_inbound($1,$2,$3,null,true) result", [id(1), id(11), old]);
    await db.query("update public.conversations set ai_enabled=true,state='ai_active' where id=$1", [imported.conversationId]);
    await db.query("update public.contacts set opt_in=true where phone='+15555550902'");
    const replay = await persist(old);
    assert.equal(replay.inserted, false); assert.equal(replay.batchId, null);
    assert.equal(await scalar(db, "select historical result from public.inbound_events where id=$1", [imported.eventId]), true);
  });
  await isolated("intake-created queue recovers immutable text, enqueues once and stops on human takeover", async () => {
    await activate(); const first = await persist(event("recover"));
    await db.query("update public.message_batches set status='processing' where id=$1", [first.batchId]);
    const prepare = () => scalar(db, "select public.prepare_ai_channel_reply($1,$2,'legacy') result", [id(1), first.batchId]);
    assert.equal((await prepare()).mode, "queue");
    const reply = "Synthetic recovery; never send";
    assert.equal(await scalar(db, "select public.checkpoint_ai_channel_reply($1,$2,$3) result", [id(1), first.batchId, reply]), true);
    assert.equal((await prepare()).reply, reply);
    const enqueue = () => scalar(db, "select public.enqueue_ai_channel_reply($1,$2,$3) result", [id(1), first.batchId, reply]);
    assert.equal((await enqueue()).queued, true); assert.equal((await enqueue()).duplicate, true);
    assert.equal(await scalar(db, "select count(*)::int result from public.message_jobs"), 1);
    await db.query("update public.conversations set ai_enabled=false,state='human_active' where id=$1", [first.conversationId]);
    assert.equal((await prepare()).eligible, false);
    assert.equal(await scalar(db, "select count(*)::int result from public.message_outbox"), 0);
  });
  await isolated("intake-created handoff is atomic and idempotent without an outbound operation", async () => {
    await activate(); const first = await persist(event("handoff"));
    await db.query("update public.message_batches set status='processing' where id=$1", [first.batchId]);
    const handoff = () => scalar(db, "select public.handoff_ai_channel_reply($1,$2,'keyword') result", [id(1), first.batchId]);
    assert.deepEqual(await handoff(), { settled: true, changed: true });
    assert.deepEqual(await handoff(), { settled: true, changed: false });
    assert.equal(await scalar(db, "select state::text result from public.conversations where id=$1", [first.conversationId]), "handoff_pending");
    assert.equal(await scalar(db, "select count(*)::int result from public.messages where meta->>'reason'='ai_queue_handoff'"), 1);
    assert.equal(await scalar(db, "select count(*)::int result from public.message_jobs"), 0);
    assert.equal(await scalar(db, "select count(*)::int result from public.message_outbox"), 0);
  });
  await isolated("failure while pinning a batch rolls back event, message and unread atomically", async () => {
    const baseline = await activate();
    const before = await scalar(db, "select unread_count result from public.conversations where id=$1", [baseline.conversationId]);
    await db.exec("create function private.abort_pipeline_test() returns trigger language plpgsql as $$ begin raise exception 'SYNTHETIC_ABORT' using errcode='23514'; end $$; create trigger abort_pipeline before insert on private.ai_reply_preparations for each row execute function private.abort_pipeline_test()");
    const value = event("rollback"); await reject(() => persist(value));
    assert.equal(await scalar(db, "select count(*)::int result from public.messages where external_message_id=$1", [value.externalMessageId]), 0);
    assert.equal(await scalar(db, "select unread_count result from public.conversations where id=$1", [baseline.conversationId]), before);
    assert.equal(await scalar(db, "select count(*)::int result from public.message_batches"), 0);
    await db.exec("drop trigger abort_pipeline on private.ai_reply_preparations");
    assert.equal((await persist(value)).inserted, true);
  });
  await isolated("tenant/account/legacy collisions, malformed settings and browser roles fail closed", async () => {
    await reject(() => persist(event(), true, id(2)), "P0002");
    await reject(() => persist(event(), true, id(1), id(12)), "P0002");
    await reject(() => persist(event("legacy", { externalActorId: "+15555550101" })));
    await reject(() => persist(event(), null), "22023");
    await reject(() => persist(event(), true, id(1), id(11), 120001), "22023");
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`SET LOCAL ROLE ${role}`); await reject(() => persist(), "42501"); await db.exec("RESET ROLE");
    }
  });
});
