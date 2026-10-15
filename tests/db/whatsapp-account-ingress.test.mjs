import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createLegacyDatabase, applyOmnichannelMigrations } from "./database-harness.mjs";
import { probeSql } from "./cloud-whatsapp-account-ingress.mjs";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scalar = async (db, sql, args = []) => (await db.query(sql, args)).rows[0]?.result;

test("managed account signed intake preserves source scope and atomic replay without enabling sends", async (t) => {
  const { db } = await createLegacyDatabase(); t.after(() => db.close());
  await db.exec(await readFile(new URL("./omnichannel-fixture.sql", import.meta.url), "utf8"));
  await applyOmnichannelMigrations(db);
  const source = (workspace = id(1), connection = id(51)) => scalar(db,
    "select public.read_whatsapp_account_source($1,$2) result", [workspace, connection]);
  const register = (connection = id(51), account = "+15555550800") => scalar(db,
    "select public.register_whatsapp_account($1,$2,$3,'ycloud',$4,'QA','enc:v1:YWJj:ZGVm',1) result", [id(1), id(101), connection, account]);
  const event = (connection = id(51), patch = {}) => ({ schemaVersion: 1, workspaceId: id(1), connectionId: connection,
    channel: "whatsapp", provider: "ycloud", providerEventId: "wamid.intake", kind: "message",
    occurredAt: "2026-10-10T12:00:00Z", receivedAt: "2026-10-10T12:00:01Z", externalActorId: "+15555550101",
    externalMessageId: "wamid.intake", content: { type: "text", text: "hola", rawType: "text" }, mediaRefs: [],
    sourceContext: { channel: "whatsapp", sourceType: "direct_message" }, ...patch });
  const receipt = (patch = {}) => ({ connectionId: id(51), provider: "ycloud", externalAccountId: "+15555550800",
    providerEventId: "receipt.intake", status: "delivered", wamid: "wamid.intake", providerMessageId: "provider.intake",
    operationId: null, recipient: "+15555550101", occurredAt: "2026-10-10T12:00:00Z", ...patch });
  const persist = async (delivery = event(), kind = "message", revision, workspace = id(1), connection = id(51)) =>
    scalar(db, "select public.persist_whatsapp_account_delivery($1,$2,$3,$4,$5) result",
      [workspace, connection, revision ?? (await source(workspace, connection))?.sourceRevision, kind, delivery]);
  const isolated = (name, run) => t.test(name, async () => {
    await db.exec("BEGIN"); try { await register(); await run(); } finally { await db.exec("ROLLBACK; RESET ROLE"); }
  });
  const reject = async (run, code = "23514") => {
    await db.exec("SAVEPOINT rejected"); try { await assert.rejects(run, (e) => e.code === code); }
    finally { await db.exec("ROLLBACK TO SAVEPOINT rejected; RELEASE SAVEPOINT rejected"); }
  };
  await isolated("source is exact and returns only that encrypted account, never the active legacy integration", async () => {
    await db.exec("SET LOCAL ROLE service_role"); const result = await source();
    assert.equal(result.connectionId, id(51)); assert.equal(result.encryptedPayload, "enc:v1:YWJj:ZGVm");
    assert.equal(result.status, "needs_permissions"); assert.match(result.sourceRevision, /^[a-f0-9]{32}$/);
    assert.equal(await source(id(2)), null); assert.equal(await source(id(1), id(52)), null);
    await db.query(`insert into public.channel_connections(id,workspace_id,channel,provider,external_account_id,legacy_integration_id)
      values($1,$2,'whatsapp','ycloud','+15555550900',$3)`, [id(53), id(1), id(11)]);
    assert.equal(await source(id(1), id(53)), null);
  });
  await isolated("retries deduplicate per connection, ignore receive-time drift, and reject changed content", async () => {
    const first = await persist(); assert.equal(await persist(event(id(51), { receivedAt: "2026-10-10T12:00:05Z" })), first);
    await reject(() => persist(event(id(51), { content: { type: "text", text: "altered", rawType: "text" } })));
    await register(id(52), "+15555550801"); assert.notEqual(await persist(event(id(52)), "message", undefined, id(1), id(52)), first);
    assert.equal(await scalar(db, "select count(*)::int result from public.inbound_events"), 2);
  });
  await isolated("wrong workspace, connection, provider, kind and future events cannot write", async () => {
    for (const patch of [{ workspaceId: id(2) }, { connectionId: id(52) }, { provider: "kapso" },
      { kind: "outbound_echo" }, { channel: "instagram" }, { occurredAt: "2099-01-01T00:00:00Z" }]) {
      await reject(() => persist(event(id(51), patch)));
    }
    await reject(() => persist(event(), "unknown"), "22023");
    await reject(() => persist(event(), "message", "invalid"));
    assert.equal(await scalar(db, "select count(*)::int result from public.inbound_events"), 0);
  });
  await isolated("credential replacement, expiry, status change or revocation invalidates in-flight proof", async () => {
    const revision = (await source()).sourceRevision;
    await db.query("update private.channel_credentials set encrypted_payload='enc:v1:ZGVm:YWJj' where connection_id=$1", [id(51)]);
    await reject(() => persist(event(), "message", revision));
    const rotated = (await source()).sourceRevision; assert.notEqual(rotated, revision);
    await db.query("update private.channel_credentials set expires_at=now()-interval '1 second' where connection_id=$1", [id(51)]);
    assert.equal(await source(), null); await reject(() => persist(event(), "message", rotated));
    await db.query("update private.channel_credentials set expires_at=null where connection_id=$1", [id(51)]);
    await db.query("update public.channel_connections set status='degraded' where id=$1", [id(51)]);
    await reject(() => persist(event(), "message", rotated));
    await db.query("update public.channel_connections set status='revoked',revoked_at=now() where id=$1", [id(51)]);
    assert.equal(await source(), null); await reject(() => persist(event(), "message", rotated));
  });
  await isolated("receipts have a separate ledger, idempotence and collision detection; no new event or job", async () => {
    const result = await persist(receipt(), "receipt"); assert.equal(await persist(receipt(), "receipt"), result);
    await reject(() => persist(receipt({ status: "failed" }), "receipt"));
    await reject(() => persist(receipt({ externalAccountId: "+15555550999" }), "receipt"));
    await reject(() => persist(receipt({ occurredAt: "2099-01-01T00:00:00Z" }), "receipt"));
    assert.equal(await scalar(db, "select count(*)::int result from private.channel_delivery_receipts"), 1);
    assert.equal(await scalar(db, "select count(*)::int result from public.inbound_events"), 0);
  });
  await isolated("anonymous and authenticated users cannot read secrets or forge intake RPCs", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`SET LOCAL ROLE ${role}`);
      await reject(() => source(), "42501");
      await reject(() => persist(event(), "message", "a".repeat(32)), "42501");
      await db.exec("RESET ROLE");
    }
  });
  await isolated("intake changes no contacts, conversations, messages, legacy configuration, capabilities or consent", async () => {
    const snapshot = async () => (await db.query(`select jsonb_build_array(
      (select jsonb_agg(to_jsonb(t) order by id) from public.messages t),
      (select jsonb_agg(to_jsonb(t) order by id) from public.contacts t),
      (select jsonb_agg(to_jsonb(t) order by id) from public.conversations t),
      (select jsonb_agg(to_jsonb(t) order by id) from public.integrations t)) result`)).rows[0].result;
    const before = await snapshot(); await persist(); await persist(receipt(), "receipt"); assert.deepEqual(await snapshot(), before);
    assert.equal(await scalar(db, "select count(*)::int result from public.message_jobs"), 0);
    assert.equal(await scalar(db, "select count(*)::int result from public.message_outbox"), 0);
    assert.equal(await scalar(db, "select capabilities result from public.channel_connections where id=$1", [id(51)]).then(JSON.stringify), "{}");
  });
  await t.test("same PostgreSQL probe runs locally and removes its entire fixture", async () => {
    await db.exec(probeSql(id(101)));
    assert.equal(await scalar(db, "select count(*)::int result from public.workspaces"), 2);
  });
});
