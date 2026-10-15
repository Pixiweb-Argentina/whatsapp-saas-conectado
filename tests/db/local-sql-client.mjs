import assert from "node:assert/strict";

// Test-only transport bridge. Queries and RPCs execute the repository's actual
// migrations; it does not emulate policies, revision guards or queue results.
const identifier = (value) => {
  assert.match(value, /^[a-z_][a-z0-9_]*$/i); return `"${value}"`;
};
const setFunctions = new Set(["claim_ai_channel_batch", "claim_channel_job"]);
const allowedFunctions = new Set([...setFunctions, "prepare_ai_channel_reply", "checkpoint_ai_channel_reply",
  "enqueue_ai_channel_reply", "handoff_ai_channel_reply", "recover_channel_jobs", "reconcile_channel_receipts"]);

export function localSqlClient(db, calls) {
  async function rpc(name, args) {
    assert.ok(allowedFunctions.has(name), `Unexpected RPC: ${name}`);
    calls.push(name);
    const pairs = Object.entries(args);
    const named = pairs.map(([key], i) => `${identifier(key)} => $${i + 1}`).join(",");
    const fn = `public.${identifier(name)}(${named})`;
    const sql = setFunctions.has(name) ? `select * from ${fn}` : `select ${fn} result`;
    const { rows } = await db.query(sql, pairs.map(([, value]) => value));
    return { data: setFunctions.has(name) ? rows : rows[0]?.result, error: null };
  }
  return { rpc, from: (table) => {
    assert.ok(["message_batches", "messages", "conversations", "events"].includes(table));
    return {
      select: (columns) => query(db, table, columns),
      update: (patch) => query(db, table, "*", patch),
      insert: async (row) => {
        const pairs = Object.entries(row);
        await db.query(`insert into public.${identifier(table)}(${pairs.map(([key]) => identifier(key)).join(",")})
          values(${pairs.map((_, i) => `$${i + 1}`).join(",")})`, pairs.map(([, value]) => value));
        return { data: null, error: null };
      },
    };
  } };
}

function query(db, table, columns, patch) {
    const filters = [], orders = [];
    const run = async () => {
      const values = patch ? Object.values(patch) : [];
      const where = filters.map(([key, value]) => {
        values.push(value); return `${identifier(key)}=$${values.length}`;
      }).join(" and ");
      const fields = columns === "*" ? "*" : columns.split(",").map((key) => identifier(key.trim())).join(",");
      const order = orders.length ? ` order by ${orders.join(",")}` : "";
      const prefix = patch
        ? `update public.${identifier(table)} set ${Object.keys(patch).map((key, i) => `${identifier(key)}=$${i + 1}`).join(",")}`
        : `select ${fields} from public.${identifier(table)}`;
      const sql = `${prefix}${where ? ` where ${where}` : ""}${patch ? ` returning ${fields}` : order}`;
      return { data: (await db.query(sql, values)).rows, error: null };
    };
    const builder = {
      eq: (key, value) => { filters.push([key, value]); return builder; },
      select: (value) => { columns = value; return builder; },
      order: (key, opts) => { orders.push(`${identifier(key)} ${opts.ascending ? "asc" : "desc"}`); return builder; },
      single: async () => { const result = await run(); assert.equal(result.data.length, 1); return { ...result, data: result.data[0] }; },
      maybeSingle: async () => { const result = await run(); assert.ok(result.data.length <= 1); return { ...result, data: result.data[0] ?? null }; },
      then: (resolve, reject) => run().then(resolve, reject),
    };
    return builder;
}
