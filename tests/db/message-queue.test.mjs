import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createLegacyDatabase, applyOmnichannelMigrations, restoreDatabase } from "./database-harness.mjs";

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const event = (overrides = {}) => ({ schemaVersion: 1, workspaceId: id(1), connectionId: id(51),
  channel: "whatsapp", provider: "ycloud", providerEventId: "event-1", kind: "message",
  externalActorId: "+15555550101", externalMessageId: "message-1", ...overrides });
const request = (n = 61, overrides = {}) => ({ operationId: id(n), channel: "whatsapp",
  recipient: "+15555550101", action: "text", body: "Synthetic queue fixture", ...overrides });
async function scalar(db, sql, args = []) { return (await db.query(sql, args)).rows[0]?.result; }
async function persist(db, value = event(), historical = false) {
  return scalar(db, "select public.persist_channel_event($1,$2) result", [value, historical]);
}
async function enqueue(db, overrides = {}) {
  const job = { workspace: id(1), connection: id(51), conversation: id(31), event: null,
    key: "job-1", actor: "ai", revision: 0, request: request(), ...overrides };
  return scalar(db, "select public.enqueue_channel_job($1,$2,$3,$4,$5,$6,$7,$8) result", Object.values(job));
}
async function claim(db, worker = 71, workspace = 1) {
  return (await db.query("select * from public.claim_channel_job($1,$2)", [id(workspace), id(worker)])).rows[0];
}
async function begin(db, job, overrides = {}) {
  const args = { workspace: job.workspace_id, operation: job.operation_id, worker: job.lease_owner,
    fence: job.fence, evidence: "verified-event", until: new Date(Date.now() + 60000).toISOString(), ...overrides };
  return scalar(db, "select public.begin_channel_send($1,$2,$3,$4,$5,$6) result", Object.values(args));
}
async function finish(db, job, result = { status: "accepted", externalId: "provider-1" }) {
  return scalar(db, "select public.finish_channel_send($1,$2,$3,$4,$5) result",
    [job.workspace_id, job.operation_id, job.lease_owner, job.fence, result]);
}
async function recover(db) { return scalar(db, "select public.recover_channel_jobs($1) result", [id(1)]); }
async function getJob(db, operation = 61) {
  return (await db.query("select * from public.message_jobs where operation_id=$1", [id(operation)])).rows[0];
}
async function expire(db) {
  await db.exec("update public.message_jobs set lease_until=clock_timestamp()-interval '1 second' where lease_until is not null");
}
async function reject(db, run, code = "23514") {
  await db.exec("SAVEPOINT rejected");
  try { await assert.rejects(run, (error) => error.code === code); }
  finally { await db.exec("ROLLBACK TO SAVEPOINT rejected; RELEASE SAVEPOINT rejected"); }
}

test("F3 durable message queue on PostgreSQL", async (t) => {
  const { db } = await createLegacyDatabase();
  t.after(() => db.close());
  await db.exec(await readFile(new URL("./omnichannel-fixture.sql", import.meta.url), "utf8"));
  await applyOmnichannelMigrations(db);
  await db.exec(`insert into public.channel_connections(id,workspace_id,channel,provider,external_account_id,status,legacy_integration_id)
    values ('${id(51)}','${id(1)}','whatsapp','ycloud','+15555550100','ready','${id(11)}'),
    ('${id(52)}','${id(2)}','whatsapp','kapso','fixture-b','ready','${id(12)}');
    select private.backfill_whatsapp_workspace('${id(1)}','${id(51)}',100);
    select private.backfill_whatsapp_workspace('${id(2)}','${id(52)}',100);`);

  async function isolated(name, run) {
    await t.test(name, async () => {
      await db.exec("BEGIN");
      try { await run(); } finally { await db.exec("ROLLBACK; RESET ROLE"); }
    });
  }

  await isolated("duplicate webhooks preserve the first envelope and event ID", async () => {
    const first = await persist(db);
    assert.equal(await persist(db, event({ content: { text: "replacement" } })), first);
    const rows = (await db.query("select * from public.inbound_events")).rows;
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].envelope, event());
  });
  await isolated("echoes, receipts and imported history never schedule automation", async () => {
    for (const [index, kind] of ["message", "outbound_echo", "delivery_receipt"].entries()) {
      const eventId = await persist(db, event({ kind, providerEventId: "e" + index }), index === 0);
      await reject(db, () => enqueue(db, { event: eventId }));
    }
    assert.equal(await scalar(db, "select count(*)::int result from public.inbound_events where state='ignored'"), 3);
  });
  await isolated("event connection/channel/provider and tenant cannot be substituted", async () => {
    await reject(db, () => persist(db, event({ provider: "kapso" })));
    await reject(db, () => persist(db, event({ workspaceId: id(2) })), "P0002");
    await reject(db, () => enqueue(db, { conversation: id(32) }), "P0002");
    await reject(db, () => enqueue(db, { request: request(61, { recipient: "+15555550201" }) }));
  });
  await isolated("enqueue deduplicates an operation and rejects key reuse for another payload", async () => {
    const first = await enqueue(db);
    assert.equal(await enqueue(db, { request: request(62) }), first);
    await reject(db, () => enqueue(db, { request: request(62, { body: "changed" }) }));
    assert.equal(await scalar(db, "select count(*)::int result from public.message_jobs"), 1);
  });
  await isolated("event actor and comment ID are bound to the operation", async () => {
    const wrong = await persist(db, event({ externalActorId: "other" }));
    await reject(db, () => enqueue(db, { event: wrong }));
    await reject(db, () => enqueue(db, { conversation: null, revision: null, event: wrong,
      request: request(61, { recipient: "other", action: "private_reply", commentId: "c" }) }));
  });
  await isolated("jobs, outbox and privileged RPCs are unavailable to browser roles", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec("SET ROLE " + role);
      for (const table of ["inbound_events", "message_jobs", "message_outbox"]) {
        await reject(db, () => db.exec("select * from public." + table), "42501");
      }
      await reject(db, () => claim(db), "42501");
      await reject(db, () => enqueue(db), "42501");
      await reject(db, () => persist(db), "42501");
      await db.exec("RESET ROLE");
    }
  });
  await isolated("service role can use the queue but foreign keys still enforce tenants", async () => {
    await db.exec("SET ROLE service_role");
    await enqueue(db);
    assert.equal((await claim(db)).workspace_id, id(1));
    assert.equal(await claim(db, 72, 2), undefined);
    await reject(db, () => db.exec(`update public.message_jobs set connection_id='${id(52)}'`), "23503");
  });
  await isolated("only one live lease is returned; wrong owner/fence cannot permit or finalize", async () => {
    await enqueue(db);
    const job = await claim(db);
    assert.equal(await claim(db, 72), undefined);
    assert.equal(await begin(db, job, { worker: id(72) }), false);
    assert.equal(await begin(db, job, { fence: job.fence + 1 }), false);
    assert.equal(await finish(db, job), false);
    assert.equal(await begin(db, job), true);
    assert.equal(await begin(db, job), false);
    assert.equal(await finish(db, { ...job, lease_owner: id(72) }), false);
    assert.equal(await finish(db, job), true);
    assert.equal((await getJob(db)).state, "accepted");
    assert.equal(await finish(db, job), false);
  });
  await isolated("pre-send crashes recover with a new fence and old workers stay fenced out", async () => {
    await enqueue(db);
    const stale = await claim(db);
    await expire(db);
    assert.equal(await recover(db), 1);
    const fresh = await claim(db, 72);
    assert.equal(fresh.fence, stale.fence + 1);
    assert.equal(await begin(db, stale), false);
    assert.equal(await begin(db, fresh), true);
    assert.equal(await finish(db, stale), false);
  });
  await isolated("a crash after the permit becomes unknown and is never reclaimed", async () => {
    await enqueue(db);
    const job = await claim(db);
    await begin(db, job);
    await expire(db);
    assert.equal(await recover(db), 1);
    assert.equal((await getJob(db)).state, "unknown");
    assert.equal(await scalar(db, "select state result from public.message_outbox"), "unknown");
    assert.equal(await claim(db, 72), undefined);
    assert.equal(await finish(db, job), false);
  });
  await isolated("provider unknown and rejection are terminal, with no automatic re-POST", async () => {
    for (const [index, result] of [{ status: "unknown", operationId: id(61) },
      { status: "rejected", errorCode: "rate_limited", retryable: true }].entries()) {
      await enqueue(db, { key: "j" + index, request: request(61 + index) });
      const job = await claim(db);
      await begin(db, job);
      assert.equal(await finish(db, job, result), true);
      assert.equal((await getJob(db, 61 + index)).state, result.status);
    }
    assert.equal(await claim(db, 72), undefined);
  });
  await isolated("human takeover atomically increments revision and cancels pending/leased AI", async () => {
    await enqueue(db);
    await enqueue(db, { key: "second", request: request(62) });
    const job = await claim(db);
    await db.exec(`update public.conversations set state='human_active',ai_enabled=false where id='${id(31)}'`);
    assert.equal(await scalar(db, `select state_revision result from public.conversations where id='${id(31)}'`), 1);
    assert.equal(await scalar(db, "select count(*)::int result from public.message_jobs where state='cancelled'"), 2);
    assert.equal(await begin(db, job), false);
    await reject(db, () => enqueue(db, { key: "late", request: request(63) }));
  });
  await isolated("authenticated operator takeover triggers invalidation without granting queue access", async () => {
    await enqueue(db);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id(101)]);
    await db.exec(`SET ROLE authenticated; update public.conversations set ai_enabled=false where id='${id(31)}'; RESET ROLE`);
    assert.equal((await getJob(db)).state, "cancelled");
  });
  await isolated("human resume does not resurrect old AI and arbitrary revision writes are ignored", async () => {
    await enqueue(db);
    await db.exec(`update public.conversations set ai_enabled=false where id='${id(31)}';
      update public.conversations set ai_enabled=true where id='${id(31)}';
      update public.conversations set state_revision=0 where id='${id(31)}'`);
    assert.equal(await scalar(db, `select state_revision result from public.conversations where id='${id(31)}'`), 2);
    assert.equal((await getJob(db)).state, "cancelled");
    await reject(db, () => enqueue(db, { key: "late", request: request(62) }));
  });
  await isolated("takeover after a send permit preserves the in-flight result for reconciliation", async () => {
    await enqueue(db);
    const job = await claim(db);
    await begin(db, job);
    await db.exec(`update public.conversations set state='human_active' where id='${id(31)}'`);
    assert.equal((await getJob(db)).state, "sending");
    assert.equal(await finish(db, job), true);
  });
  await isolated("connection revocation and expired policy prevent a send permit", async () => {
    await enqueue(db);
    const job = await claim(db);
    assert.equal(await begin(db, job, { until: "2000-01-01T00:00:00Z" }), false);
    await db.exec(`update public.channel_connections set status='revoked',revoked_at=now() where id='${id(51)}'`);
    assert.equal(await begin(db, job), false);
    assert.equal(await scalar(db, "select count(*)::int result from public.message_outbox"), 0);
  });
  await isolated("attempt and age limits park jobs without provider calls", async () => {
    await enqueue(db);
    for (let attempt = 0; attempt < 5; attempt++) {
      assert.ok(await claim(db));
      await expire(db);
      await recover(db);
    }
    assert.equal((await getJob(db)).state, "dead_letter");
    await enqueue(db, { key: "old", request: request(62) });
    await db.exec(`update public.message_jobs set created_at=now()-interval '25 hours' where operation_id='${id(62)}'`);
    assert.equal(await claim(db), undefined);
    await recover(db);
    assert.equal((await getJob(db, 62)).state, "dead_letter");
  });
  await t.test("committed job/outbox survive a database snapshot restore", async () => {
    await enqueue(db);
    const job = await claim(db);
    await begin(db, job);
    const restored = restoreDatabase(await db.dumpDataDir());
    try {
      assert.equal((await getJob(restored)).state, "sending");
      await expire(restored);
      await recover(restored);
      assert.equal((await getJob(restored)).state, "unknown");
      assert.equal(await claim(restored, 72), undefined);
    } finally { await restored.close(); }
  });
});
