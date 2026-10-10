import assert from "node:assert/strict";
import { test } from "node:test";
import { channelRolloutWorkspaces } from "./channel-rollout.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
test("rollout defaults off and separates capture from actual worker sends", () => {
  assert.deepEqual(channelRolloutWorkspaces("worker", {}), []);
  const env = { CHANNEL_INGRESS_WORKSPACES: ` ${id(1)},${id(1)}, ${id(2)} ` };
  assert.deepEqual(channelRolloutWorkspaces("ingress", env), [id(1), id(2)]);
  assert.deepEqual(channelRolloutWorkspaces("worker", env), []);
});
test("wildcards, partial malformed lists and oversized worker lists fail closed", () => {
  for (const raw of ["*", "true", `${id(1)},bad`, `${id(1)},`, [1, 2, 3, 4].map(id).join(",")]) {
    assert.throws(() => channelRolloutWorkspaces("worker", { CHANNEL_WORKER_WORKSPACES: raw }),
      { message: "CHANNEL_ROLLOUT_INVALID" });
  }
});
