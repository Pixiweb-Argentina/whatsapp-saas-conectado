import assert from "node:assert/strict";
import { runCommentReservationChecks } from "./comment-reservation-checks.mjs";
import { runSendLimitsChecks } from "./send-limits-checks.mjs";
import { runReceiptDatabaseChecks } from "./receipt-checks.mjs";
import { runAiReplyDatabaseChecks } from "./ai-reply-checks.mjs";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createLegacyDatabase, applyOmnichannelMigrations, restoreDatabase } from "./database-harness.mjs";

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const timestamp = new Date(Date.now() - 60000).toISOString();
const event = (overrides = {}) => ({ schemaVersion: 1, workspaceId: id(1), connectionId: id(51),
  channel: "whatsapp", provider: "ycloud", providerEventId: "event-1", kind: "message",
  externalActorId: "+15555550101", externalMessageId: "message-1", occurredAt: timestamp, receivedAt: timestamp,
  content: { type: "text", text: "fixture", rawType: "text" }, mediaRefs: [],
  sourceContext: { channel: "whatsapp", sourceType: "direct_message" }, ...overrides });
const request = (n = 61, overrides = {}) => ({ operationId: id(n), channel: "whatsapp",
  recipient: "+15555550101", action: "text", body: "Synthetic queue fixture", ...overrides });
async function scalar(db, sql, args = []) { return (await db.query(sql, args)).rows[0]?.result; }
async function persist(db, value = event(), historical = false) {
  return scalar(db, "select public.persist_channel_event($1,$2) result", [value, historical]);
}
async function enqueue(db, overrides = {}) {
  const job = { workspace: id(1), connection: id(51), conversation: id(31), event: overrides.event === undefined ? await persist(db) : overrides.event,
    key: "job-1", actor: "ai", revision: 0, request: request(), sender: null, ...overrides };
  return scalar(db, "select public.enqueue_channel_job($1,$2,$3,$4,$5,$6,$7,$8,$9) result", Object.values(job));
}
async function claim(db, worker = 71, workspace = 1) {
  return (await db.query("select * from public.claim_channel_job($1,$2)", [id(workspace), id(worker)])).rows[0];
}
async function begin(db, job, overrides = {}) {
  const args = { workspace: job.workspace_id, operation: job.operation_id, worker: job.lease_owner,
    fence: job.fence, evidence: job.event_id, until: new Date(Date.now() + 60000).toISOString(), ...overrides };
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
  await db.exec(`update public.contact_identities set verified_at=now()-interval '1 minute';
    update public.integrations set config='{"phone_number":"+15555550100"}' where id='${id(11)}';
    update public.channel_connections set capabilities=jsonb_build_object('version',1,'grants',jsonb_build_array(
      jsonb_build_object('workspaceId',workspace_id,'connectionId',id,'capability','text','evidenceRef','fixture-verification',
        'verifiedAt',now()-interval '1 minute',
        'validUntil',now()+interval '1 hour')));`);

  async function isolated(name, run) {
    await t.test(name, async () => {
      await db.exec("BEGIN");
      try { await run(); } finally { await db.exec("ROLLBACK; RESET ROLE"); }
    });
  }

  async function human(overrides = {}) {
    const args = { workspace: id(1), conversation: id(31), sender: id(101), operation: id(91), body: "Respuesta humana", ...overrides };
    return scalar(db, "select public.enqueue_human_channel_text($1,$2,$3,$4,$5) result", Object.values(args));
  }
  await runSendLimitsChecks({db,id,scalar,enqueue,claim,begin,finish,isolated,reject});
  await runCommentReservationChecks({db,id,scalar,enqueue,claim,begin,isolated,reject});
  await runAiReplyDatabaseChecks({db,id,scalar,persist,claim,begin,finish,reject,isolated});
  await runReceiptDatabaseChecks({db,id,scalar,enqueue,claim,begin,finish,reject,isolated});
  async function queueAs(user = 101, workspace = 1, conversation = 31) {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id(user)]);
    await db.exec("SET ROLE authenticated");
    try { return (await db.query("select * from public.read_conversation_queue($1,$2)",
      [id(workspace),id(conversation)])).rows.map((row) => row.read_conversation_queue); }
    finally { await db.exec("RESET ROLE"); }
  }
  await isolated("queue projection exposes only text/status for current members, including viewers", async () => {
    await enqueue(db);
    for (const user of [101,102]) {
      const rows = await queueAs(user);
      assert.equal(rows.length,1); assert.equal(rows[0].body,"Synthetic queue fixture");
      assert.deepEqual(Object.keys(rows[0]).sort(),["actor","body","createdAt","operationId","state"]);
    }
    assert.equal((await queueAs(103)).length,0);
    assert.equal((await queueAs(101,2,31)).length,0);
    assert.equal((await queueAs(101,1,32)).length,0);
    await db.exec(`update public.memberships set is_active=false where user_id='${id(101)}'`);
    assert.equal((await queueAs()).length,0);
    await db.exec("SET ROLE anon");
    await reject(db,()=>db.query("select * from public.read_conversation_queue($1,$2)",[id(1),id(31)]),"42501");
  });
  await isolated("queue projects cancelled/dead jobs but switches to message on permit", async () => {
    await enqueue(db); const job = await claim(db);
    assert.equal((await queueAs())[0].state,"leased");
    await db.exec("SET ROLE service_role");
    assert.equal(await begin(db,job),true);
    await db.exec("RESET ROLE");
    assert.equal((await queueAs()).length,0);
    await enqueue(db,{key:"dead",request:request(62)});
    await enqueue(db,{key:"cancelled",request:request(63)});
    await db.exec(`update public.message_jobs set state='dead_letter' where operation_id='${id(62)}';
      update public.message_jobs set state='cancelled' where operation_id='${id(63)}'`);
    assert.deepEqual((await queueAs()).map(row=>row.state).sort(),["cancelled","dead_letter"]);
  });
  await isolated("queue pagination is bounded to 51 newest operations", async () => {
    const eventId=await persist(db);
    for(let n=200;n<252;n++) await enqueue(db,{event:eventId,key:`page-${n}`,request:request(n)});
    assert.equal((await queueAs()).length,51);
  });
  await isolated("human takeover and job enqueue are atomic and cancel pending AI", async () => {
    await enqueue(db);
    await db.exec("SET ROLE service_role");
    const result = await human();
    assert.deepEqual(result, { operationId: id(91), state: "pending", duplicate: false });
    const conv = (await db.query("select state,ai_enabled,assigned_to,state_revision from public.conversations where id=$1", [id(31)])).rows[0];
    assert.equal(conv.state, "human_active"); assert.equal(conv.ai_enabled, false); assert.equal(conv.assigned_to, id(101));
    assert.equal((await getJob(db)).state, "cancelled");
    assert.equal(await scalar(db,"select count(*)::int result from public.events where type='state_change'"),1);
    assert.equal((await getJob(db,91)).expected_state_revision, conv.state_revision);
    assert.equal(await scalar(db,"select count(*)::int result from public.message_outbox"),0);
  });
  await isolated("human retry preserves job even after evidence and conversation change", async () => {
    await persist(db); await human();
    await db.exec("update public.conversations set state='ai_active',ai_enabled=true where id='"+id(31)+"'");
    await db.exec("update public.channel_connections set capabilities='{}'");
    const before = (await db.query("select state_revision from public.conversations where id=$1",[id(31)])).rows[0].state_revision;
    const retry = await human();
    assert.equal(retry.duplicate,true); assert.equal(retry.operationId,id(91));
    assert.equal(await scalar(db,"select count(*)::int result from public.message_jobs"),1);
    assert.equal((await db.query("select state_revision from public.conversations where id=$1",[id(31)])).rows[0].state_revision,before);
  });
  await isolated("human ID cannot be reused for other text, conversation or operator", async () => {
    await persist(db); await human();
    await reject(db,()=>human({body:"Different body"}));
    await reject(db,()=>human({conversation:id(33)}));
    await db.exec("update public.memberships set role='agent' where user_id='"+id(102)+"'");
    await reject(db,()=>human({sender:id(102)}));
  });
  await isolated("human producer rejects foreign tenant, viewer and inactive membership", async () => {
    await persist(db);
    await reject(db,()=>human({sender:id(102)}),"42501");
    await reject(db,()=>human({workspace:id(2)}),"42501");
    await reject(db,()=>human({sender:id(103)}),"42501");
    await db.exec("update public.memberships set is_active=false where user_id='"+id(101)+"'");
    await reject(db,()=>human(),"42501");
  });
  await isolated("failed human context rolls back takeover and all jobs", async () => {
    await persist(db);
    await db.exec("update public.channel_connections set capabilities='{}'");
    await reject(db,()=>human());
    assert.equal((await db.query("select state from public.conversations where id=$1",[id(31)])).rows[0].state,"ai_active");
    assert.equal(await scalar(db,"select count(*)::int result from public.message_jobs"),0);
  });
  await isolated("human cannot enqueue without an inbound or with unverified identity", async () => {
    await reject(db,()=>human()); await persist(db);
    await db.exec("update public.contact_identities set verified_at=null");
    await reject(db,()=>human());
  });
  await isolated("human suppression and expired event fail before takeover", async () => {
    await persist(db,event({occurredAt:new Date(Date.now()-25*3600000).toISOString()}));
    await reject(db,()=>human());
    await db.exec("delete from public.inbound_events"); await persist(db);
    await db.exec("insert into public.contact_opt_outs(workspace_id,phone_key,opted_out_at,source) values ('"+id(1)+"','15555550101',now(),'keyword')");
    await reject(db,()=>human());
  });
  await isolated("human RPC is denied to browser roles and invalid bodies create no job", async () => {
    await persist(db);
    for(const role of ["anon","authenticated"]) {
      await db.exec("SET ROLE "+role); await reject(db,()=>human(),"42501"); await db.exec("RESET ROLE");
    }
    for(const body of [null," ","x".repeat(4097)]) await reject(db,()=>human({body}),"22023");
  });
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
  await isolated("provider unknown and permanent rejection are terminal, with no automatic re-POST", async () => {
    for (const [index, result] of [{ status: "unknown", operationId: id(61) },
      { status: "rejected", errorCode: "permanent", retryable: false }].entries()) {
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
  const invalidContexts = [
    ["missing grants", "update public.channel_connections set capabilities='{}'"],
    ["expired grant", `update public.channel_connections set capabilities=jsonb_set(capabilities,'{grants,0,validUntil}','"2000-01-01T00:00:00Z"')`],
    ["malformed grant date", `update public.channel_connections set capabilities=jsonb_set(capabilities,'{grants,0,validUntil}','"infinity"')`],
    ["wrong grant workspace", `update public.channel_connections set capabilities=jsonb_set(capabilities,'{grants,0,workspaceId}','"${id(2)}"')`],
    ["future verification", "update public.contact_identities set verified_at=now()+interval '1 hour'"],
    ["unverified identity", "update public.contact_identities set verified_at=null"],
    ["changed recipient", "update public.contact_identities set external_user_id='another-' || id::text"],
    ["disabled integration", "update public.integrations set enabled=false"],
    ["different sender account", "update public.integrations set config='{}'"],
    ["contact opt-out", "update public.contacts set opt_in=false"],
    ["recipient suppression", `insert into public.contact_opt_outs(workspace_id,phone_key,opted_out_at,source) values('${id(1)}','15555550101',now(),'keyword')`],
    ["historical event", "update public.inbound_events set historical=true"],
    ["event sender mismatch", `update public.inbound_events set envelope=jsonb_set(envelope,'{externalActorId}','"other"')`],
    ["expired inbound event", `update public.inbound_events set envelope=jsonb_set(envelope,'{occurredAt}','"2000-01-01T00:00:00Z"')`],
    ["future received event", `update public.inbound_events set envelope=jsonb_set(envelope,'{receivedAt}','"2999-01-01T00:00:00Z"')`],
    ["invalid event time", `update public.inbound_events set envelope=jsonb_set(envelope,'{occurredAt}','"not-a-date"')`],
  ];
  for (const [label, mutation] of invalidContexts) {
    await isolated(`permit revalidates ${label} after enqueue`, async () => {
      await enqueue(db); const job = await claim(db);
      await db.exec(mutation);
      assert.equal(await begin(db, job), false);
      assert.equal(await scalar(db, "select count(*)::int result from public.message_outbox"), 0);
      assert.equal(await scalar(db, "select count(*)::int result from public.messages where channel_operation_id is not null"), 0);
    });
  }
  await isolated("caller cannot substitute evidence or extend its lifetime", async () => {
    await enqueue(db); const job = await claim(db);
    assert.equal(await begin(db, job, { evidence: id(999) }), false);
    assert.equal(await begin(db, job, { until: new Date(Date.now() + 2 * 3600000).toISOString() }), false);
    assert.equal(await begin(db, job), true);
  });
  await isolated("permit inserts one visible message; accepted YCloud ID is not a fabricated wamid", async () => {
    await enqueue(db); const job = await claim(db);
    await db.exec("SET ROLE service_role");
    assert.equal(await begin(db, job), true);
    assert.equal(await begin(db, job), false);
    const message = (await db.query("select * from public.messages where channel_operation_id=$1", [id(61)])).rows[0];
    assert.equal(message.status, "queued"); assert.equal(message.connection_id, id(51));
    assert.equal(message.body, request().body); assert.equal(message.meta.channel_actor, "ai");
    assert.equal(await finish(db, job, { status: "accepted", externalId: "ycloud-1", providerMessageId: "ycloud-1" }), true);
    const sent = (await db.query("select * from public.messages where id=$1", [message.id])).rows[0];
    assert.equal(sent.status, "sent"); assert.equal(sent.wamid, null); assert.equal(sent.external_message_id, null);
    assert.equal(sent.meta.ycloud_id, "ycloud-1"); assert.equal(sent.meta.send_outcome, "accepted");
    assert.equal(await finish(db, job), false);
  });
  await isolated("provider rejection and timeout have different visible results", async () => {
    for (const [index, result] of [{ status: "rejected", errorCode: "synthetic", retryable: false },
      { status: "unknown", operationId: id(62) }].entries()) {
      await enqueue(db, { key: "j" + index, request: request(61 + index) });
      const job = await claim(db); assert.equal(await begin(db, job), true);
      assert.equal(await finish(db, job, result), true);
      const message = (await db.query("select * from public.messages where channel_operation_id=$1", [id(61 + index)])).rows[0];
      assert.equal(message.status, "failed"); assert.equal(message.meta.send_outcome, result.status);
      assert.match(message.error_message, index === 0 ? /rechazó/ : /No lo reenvíes/);
    }
  });
  await isolated("post-permit recovery marks the visible message unknown without retry", async () => {
    await enqueue(db); const job = await claim(db);
    assert.equal(await begin(db, job), true); await expire(db); await recover(db);
    const message = (await db.query("select * from public.messages where channel_operation_id=$1", [id(61)])).rows[0];
    assert.equal(message.status, "failed"); assert.equal(message.meta.send_outcome, "unknown");
    assert.equal(await claim(db), undefined);
  });
  await isolated("failed message persistence rolls back the permit before any provider call", async () => {
    await enqueue(db); const job = await claim(db);
    await db.exec(`update public.conversations set window_expires_at=now()-interval '1 hour' where id='${id(31)}'`);
    await reject(db, () => begin(db, job), "P0001");
    assert.equal((await getJob(db)).state, "leased");
    assert.equal(await scalar(db, "select count(*)::int result from public.message_outbox"), 0);
  });
  await isolated("a browser cannot forge, change or remove a job-backed message", async () => {
    await enqueue(db); const job = await claim(db); assert.equal(await begin(db, job), true);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id(101)]);
    await db.exec("SET ROLE authenticated");
    assert.equal((await db.query(`update public.messages set status='sent' where channel_operation_id='${id(61)}' returning id`)).rows.length, 0);
    assert.equal((await db.query(`delete from public.messages where channel_operation_id='${id(61)}' returning id`)).rows.length, 0);
    await reject(db, () => db.exec(`insert into public.messages(workspace_id,conversation_id,connection_id,channel_operation_id,direction,type,body)
      values('${id(1)}','${id(31)}','${id(51)}','${id(61)}','out','text','forged')`), "42501");
  });
  await isolated("human attribution requires an active workspace operator and survives enqueue dedup", async () => {
    await reject(db, () => enqueue(db, { actor: "human" }));
    await reject(db, () => enqueue(db, { actor: "human", sender: id(102) }), "42501");
    await reject(db, () => enqueue(db, { actor: "human", sender: id(103) }), "42501");
    await enqueue(db, { actor: "human", sender: id(101) });
    assert.equal(await enqueue(db, { actor: "human", sender: id(101), request: request(62) }), id(61));
    const job = await claim(db); assert.equal(await begin(db, job), true);
    assert.equal(await scalar(db, "select sender_user_id result from public.messages where channel_operation_id=$1", [id(61)]), id(101));
  });
  await isolated("operator deactivation after enqueue refuses the human send", async () => {
    await enqueue(db, { actor: "human", sender: id(101) }); const job = await claim(db);
    await db.exec(`update public.memberships set is_active=false where user_id='${id(101)}'`);
    assert.equal(await begin(db, job), false);
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
