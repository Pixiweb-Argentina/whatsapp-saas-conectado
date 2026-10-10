import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const calls: Array<{ workspaceId: string; workerId: string; limit: number }> = [];
let clients = 0;
let status = "accepted";
let throwFirst = false;
mock.module("@supabase/supabase-js", { exports: { createClient: () => { clients++; return {}; } } });
mock.module("@/features/channels/services/message-pipeline.ts", { exports: {
  createMessagePipeline: () => ({ async drain(workspaceId: string, workerId: string, limit: number) {
    calls.push({ workspaceId, workerId, limit });
    if (throwFirst && workspaceId === id(1)) throw new Error("sensitive database details");
    return [{ status, operationId: id(9) }];
  } }),
} });
const { GET } = await import("./route.ts");
const saved = { secret: process.env.CRON_SECRET, flag: process.env.CHANNEL_WORKER_WORKSPACES };
afterEach(() => {
  for (const [key, value] of [["CRON_SECRET", saved.secret], ["CHANNEL_WORKER_WORKSPACES", saved.flag]]) {
    if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
  }
  calls.length = 0; clients = 0; status = "accepted"; throwFirst = false;
});
function request(auth: string | null = "Bearer fixture-secret", query = "") {
  return new Request(`http://localhost/api/cron/channel-jobs${query}`, { headers: auth ? { Authorization: auth } : {} });
}
test("unauthorized and missing-secret calls never create a service client or claim jobs", async () => {
  process.env.CHANNEL_WORKER_WORKSPACES = id(1);
  process.env.CRON_SECRET = "fixture-secret";
  for (const auth of [null, "Bearer wrong", "fixture-secret"]) assert.equal((await GET(request(auth))).status, 401);
  delete process.env.CRON_SECRET;
  assert.equal((await GET(request("Bearer undefined"))).status, 401);
  assert.equal(clients, 0); assert.deepEqual(calls, []);
});
test("authenticated worker stays off without its explicit flag", async () => {
  process.env.CRON_SECRET = "fixture-secret";
  delete process.env.CHANNEL_WORKER_WORKSPACES;
  const res = await GET(request());
  assert.equal(res.status, 200); assert.deepEqual(await res.json(), { enabled: false, processed: 0 });
  assert.equal(clients, 0);
});
test("malformed rollout fails closed before any DB access", async () => {
  process.env.CRON_SECRET = "fixture-secret"; process.env.CHANNEL_WORKER_WORKSPACES = "*";
  const res = await GET(request());
  assert.equal(res.status, 503); assert.equal(clients, 0);
});
test("only configured tenants are drained, at most one job each, with distinct lease owners", async () => {
  process.env.CRON_SECRET = "fixture-secret"; process.env.CHANNEL_WORKER_WORKSPACES = `${id(1)},${id(2)}`;
  const res = await GET(request("Bearer fixture-secret", `?workspaceId=${id(9)}&limit=100`));
  assert.equal(res.status, 200); assert.deepEqual(calls.map((c) => c.workspaceId), [id(1), id(2)]);
  assert.ok(calls.every((c) => c.limit === 1)); assert.notEqual(calls[0].workerId, calls[1].workerId);
  assert.deepEqual(await res.json(), { enabled: true, outcomes: { accepted: 2 } });
});
test("one failing workspace does not hide the failure or prevent the next bounded drain", async () => {
  process.env.CRON_SECRET = "fixture-secret"; process.env.CHANNEL_WORKER_WORKSPACES = `${id(1)},${id(2)}`;
  throwFirst = true;
  const res = await GET(request());
  assert.equal(res.status, 503); assert.equal(calls.length, 2);
  assert.deepEqual(await res.json(), { enabled: true, outcomes: { accepted: 1 }, error: "CHANNEL_DRAIN_INCOMPLETE" });
});
test("uncertain provider outcomes are reported without retrying inside the request", async () => {
  process.env.CRON_SECRET = "fixture-secret"; process.env.CHANNEL_WORKER_WORKSPACES = id(1);
  status = "unknown";
  const res = await GET(request());
  assert.equal(res.status, 200); assert.equal(calls.length, 1);
  assert.deepEqual(await res.json(), { enabled: true, outcomes: { unknown: 1 } });
});
test("lost lease and unfinished persistence signal a degraded drain", async () => {
  process.env.CRON_SECRET = "fixture-secret"; process.env.CHANNEL_WORKER_WORKSPACES = id(1);
  for (const value of ["lost_lease", "recovery_pending"]) {
    status = value;
    assert.equal((await GET(request())).status, 503);
  }
});
test("worker stops before claiming when less than a full lease remains", async () => {
  process.env.CRON_SECRET = "fixture-secret"; process.env.CHANNEL_WORKER_WORKSPACES = id(1);
  let reads = 0;
  const clock = mock.method(Date, "now", () => reads++ === 0 ? 0 : 211_000);
  try {
    assert.equal((await GET(request())).status, 503);
    assert.deepEqual(calls, []);
  } finally { clock.mock.restore(); }
});
