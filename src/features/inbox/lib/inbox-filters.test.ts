import { test } from "node:test";
import assert from "node:assert/strict";
import { inboxQuery, parseInboxFilters } from "./inbox-filters";

test("inbox ignores unsupported filters and never accepts a half cursor", () => {
  const filters = parseInboxFilters({ channel: "tiktok", account: "bad", state: ["closed"],
    q: "  hola  ", cursor: "00000000-0000-4000-8000-000000000001" });
  assert.deepEqual(filters, { channel: undefined, account: undefined, state: undefined,
    q: "hola", before: undefined, cursor: undefined });
});
test("inbox query preserves encoded search and account through navigation", () => {
  const filters = parseInboxFilters({ channel: "instagram", q: "guía & hola" });
  const query = inboxQuery(filters);
  assert.equal(new URLSearchParams(query).get("q"), "guía & hola");
  assert.equal(new URLSearchParams(query).get("channel"), "instagram");
  assert.equal(inboxQuery(filters, { channel: undefined, q: "" }), "");
});
