import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mock, test } from "node:test";
import { createLegacyDatabase, applyOmnichannelMigrations } from "./database-harness.mjs";
import { localSqlClient } from "./local-sql-client.mjs";

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const service = (name) => new URL(`../../src/features/inbox/services/${name}.ts`, import.meta.url).href;
const feature = (name) => new URL(`../../src/features/${name}.ts`, import.meta.url).href;
const stub = (path, exports) => mock.module(path, { exports });
const unused = () => { throw new Error("UNEXPECTED_EXTERNAL_EFFECT"); };
const calls = [];
const usage = [];
let client;
let modelGate;
let modelStarted;
let modelCalls = 0;
let networkCalls = 0;

// Never load .env or real credentials; the child process cannot reach fetch.
mock.method(globalThis, "fetch", async () => { networkCalls++; throw new Error("NETWORK_FORBIDDEN"); });
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://synthetic.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic-test-only";
for (const stage of ["AI", "INGRESS", "WORKER"]) process.env[`CHANNEL_${stage}_WORKSPACES`] = id(1);
stub("@supabase/supabase-js", { createClient: () => client });
stub(service("openrouter"), {
  getWorkspaceModel: async () => "synthetic/model",
  generateWithTools: async (opts) => {
    modelCalls++;
    assert.deepEqual(opts.availableTools, []);
    modelStarted.resolve();
    await modelGate.promise;
    return { text: "Respuesta sintética pendiente", inputTokens: 10, outputTokens: 4, toolResults: [] };
  },
});
stub(service("cost-tracker"), {
  reserveLlmTurn: async () => ({ allowed: true, reservationId: id(301) }),
  recordLlmUsage: async (value) => { usage.push(value); },
  checkRateLimits: async () => ({ allowed: true }),
});
stub(feature("tools/services/tool-configs"), { getEnabledTools: async () => [] });
stub(service("dispatch"), { dispatchText: unused, dispatchTemplate: unused });
stub(service("whatsapp-provider"), {
  loadWhatsAppSettings: async () => ({ provider: "ycloud", config: {} }),
  WHATSAPP_NOT_CONNECTED: "WHATSAPP_NOT_CONNECTED",
});
stub(service("cost-enforcer"), {
  enforceCostPolicy: async () => ({ policy: "allow" }),
  buildCostAwareSystemPrompt: async (_workspace, systemPrompt) => ({ systemPrompt }),
});
stub(service("model-policy"), { enforceModelPolicy: async (_db, _workspace, model) => model });
stub(feature("jev-judge/apply"), {
  applyJevToBatch: async () => ({ suppressReply: false, ownsStage: false }),
});
stub(service("kb-service"), {
  searchKb: async () => [], formatKbContext: () => "",
  listKbSourceLinks: async () => [], formatKbReferenceLinks: () => "",
});
stub(service("prompt-resolver"), { resolveSystemPrompt: async () => null });
stub(service("prompt-builder"), { buildSystemPrompt: () => "Synthetic test" });
stub(feature("agents/services/active-agent"), { getActiveAgent: async () => null });
stub(feature("agents/services/auto-tagging"), { maybeAutoProcess: unused });
stub(service("business-info"), {
  getBusinessInfo: async () => null, buildBusinessInfoContext: () => "", buildNowContext: () => "",
});
stub(service("conversation-history"), { getConversationHistory: async () => [] });
stub(service("setter"), { getSetterConfig: unused, evaluateLead: unused });
stub(service("hubspot-client"), { createHubSpotDeal: unused });
stub(service("crm-sync"), { crmStatus: unused });
stub(service("highlevel-client"), { createHLOpportunity: unused, hlConfiguredTimeZone: async () => null });
stub(service("handoff-notifier"), { notifyHandoffPending: unused });

// These collaborators are deliberately real: intake SQL, exact claim, buffer,
// decision/state transitions, queue control, producer, job store and worker.
const { processNextBatch } = await import(service("buffer"));
const { applyTransition } = await import(service("decision-engine"));
const { createMessageJobStore } = await import(feature("channels/services/message-job-store"));
const { drainMessageJobs } = await import(feature("channels/services/message-job-worker"));
const scalar = async (db, sql, args = []) => (await db.query(sql, args)).rows[0]?.result;
const readConversation = async (db, conversation) => (await db.query(
  "select state,ai_enabled,state_revision,assigned_to from public.conversations where id=$1", [conversation])).rows[0];

async function seed(db) {
  await db.exec(await readFile(new URL("./omnichannel-fixture.sql", import.meta.url), "utf8"));
  await applyOmnichannelMigrations(db);
  await db.query("update public.integrations set config=$1 where id=$2", [{ phone_number: "+15555550100" }, id(11)]);
  await db.query(`insert into public.channel_connections(id,workspace_id,channel,provider,external_account_id,status,legacy_integration_id)
    values($1,$2,'whatsapp','ycloud','+15555550100','ready',$3)`, [id(51), id(1), id(11)]);
  const now = Date.now();
  await db.query("update public.channel_connections set capabilities=$1 where id=$2", [{ version: 1, grants: [{
    workspaceId: id(1), connectionId: id(51), capability: "text", evidenceRef: "synthetic-race-only",
    verifiedAt: new Date(now - 1000).toISOString(), validUntil: new Date(now + 600000).toISOString(),
  }] }, id(51)]);
}

async function intake(db, key, enabled) {
  const time = new Date(Date.now() - 10000).toISOString();
  const event = { schemaVersion: 1, workspaceId: id(1), connectionId: id(51), channel: "whatsapp", provider: "ycloud",
    providerEventId: `wamid.race.${key}`, externalMessageId: `wamid.race.${key}`, kind: "message",
    externalActorId: "+15555550901", occurredAt: time, receivedAt: time,
    content: { type: "text", text: "Hola prueba sintética", rawType: "text" }, mediaRefs: [],
    sourceContext: { channel: "whatsapp", sourceType: "direct_message" } };
  return scalar(db, "select public.materialize_ycloud_pipeline($1,$2,$3,'Synthetic', $4,30000) result",
    [id(1), id(11), event, enabled]);
}

async function prepareScenario(db) {
  const first = await intake(db, "bootstrap", false);
  await applyTransition(first.conversationId, "ai_active", { workspaceId: id(1), userId: id(101), trigger: "manual" });
  await db.query("update public.contacts set opt_in=true where phone='+15555550901'");
  const next = await intake(db, "active", true);
  assert.ok(next.batchId);
  await db.query("update public.message_batches set flush_at=clock_timestamp()-interval '1 second' where id=$1", [next.batchId]);
  calls.length = 0; usage.length = 0; modelCalls = 0;
  modelGate = Promise.withResolvers(); modelStarted = Promise.withResolvers();
  return next;
}

async function assertEmptyDrain(db) {
  const effects = [];
  const results = await drainMessageJobs(id(1), id(71), {
    store: createMessageJobStore(client),
    loadContext: async () => { effects.push("context"); return unused(); },
    resolveAdapter: async () => { effects.push("adapter"); return unused(); },
  });
  assert.deepEqual(results, []); assert.deepEqual(effects, []);
  for (const table of ["message_jobs", "message_outbox"]) {
    assert.equal(await scalar(db, `select count(*)::int result from public.${table}`), 0);
  }
}

async function runScenario(db, scenario) {
  const started = await prepareScenario(db);
  const target = { workspaceId: id(1), batchId: started.batchId };
  let settled = false;
  const processing = processNextBatch(target).finally(() => { settled = true; });
  try {
    await Promise.race([modelStarted.promise, processing.then(() => { throw new Error("MODEL_NOT_REACHED"); })]);
    assert.equal(settled, false);
    const before = await readConversation(db, started.conversationId);
    assert.equal(await scalar(db, "select count(*)::int result from public.message_jobs"), 0);
    assert.equal(await scalar(db, "select reply result from private.ai_reply_preparations where batch_id=$1", [started.batchId]), null);
    if (scenario !== "unchanged") {
      await applyTransition(started.conversationId, "human_active", { workspaceId: id(1), userId: id(101), trigger: "manual" });
      if (scenario === "resume") await applyTransition(started.conversationId, "ai_active", { workspaceId: id(1), userId: id(101), trigger: "manual" });
    }
    const controlled = await readConversation(db, started.conversationId);
    if (scenario !== "unchanged") {
      assert.ok(controlled.state_revision > before.state_revision);
      assert.equal(controlled.assigned_to, id(101));
    }
    const audit = (await db.query("select * from public.events where conversation_id=$1 order by id", [started.conversationId])).rows;
    modelGate.resolve();
    assert.deepEqual(await processing, { processed: true, conversationId: started.conversationId, batchId: started.batchId });
    await assertOutcome(db, scenario, started, target, controlled, audit);
  } finally { modelGate.resolve(); await processing; }
}

async function assertOutcome(db, scenario, started, target, controlled, audit) {
    assert.deepEqual(await readConversation(db, started.conversationId), controlled);
    assert.equal(modelCalls, 1); assert.equal(usage.length, 1);
    assert.equal(await scalar(db, "select reply result from private.ai_reply_preparations where batch_id=$1", [started.batchId]), "Respuesta sintética pendiente");
    assert.equal(await scalar(db, "select status result from public.message_batches where id=$1", [started.batchId]), "processed");
    if (scenario === "unchanged") {
      const jobs = (await db.query("select * from public.message_jobs")).rows;
      assert.equal(jobs.length, 1); assert.equal(jobs[0].state, "pending");
      assert.equal(jobs[0].request.body, "Respuesta sintética pendiente");
    } else {
      assert.ok(calls.includes("enqueue_ai_channel_reply"));
      assert.ok(calls.includes("handoff_ai_channel_reply"));
      assert.deepEqual((await db.query("select * from public.events where conversation_id=$1 order by id", [started.conversationId])).rows, audit);
      assert.equal(await scalar(db, "select count(*)::int result from public.messages where conversation_id=$1 and direction='out'", [started.conversationId]), 0);
      assert.deepEqual(await processNextBatch(target), { processed: false });
      await assertEmptyDrain(db);
    }
    assert.equal(networkCalls, 0);
}

test("pending model result respects real human transitions and durable revision guards", { timeout: 90000 }, async (t) => {
  const { db } = await createLegacyDatabase(); t.after(() => db.close());
  await seed(db); await db.exec("SET ROLE service_role");
  client = localSqlClient(db, calls);
  for (const scenario of ["unchanged", "takeover", "resume"]) {
    await t.test(scenario, async () => {
      await db.exec("BEGIN");
      try { await runScenario(db, scenario); } finally { await db.exec("ROLLBACK"); }
    });
  }
  await t.test("all scenario writes rolled back and no network attempted", async () => {
    assert.equal(await scalar(db, "select count(*)::int result from public.message_batches"), 0);
    await assertEmptyDrain(db); assert.equal(networkCalls, 0);
  });
});
