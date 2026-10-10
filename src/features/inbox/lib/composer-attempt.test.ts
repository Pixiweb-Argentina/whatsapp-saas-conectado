import assert from "node:assert/strict";
import { test } from "node:test";
import { composerAttempt } from "./composer-attempt.ts";

test("uncertain retry preserves the operation and original circuit despite changed flags", () => {
  const first = composerAttempt(null, "conv-1", "hola", "queue", () => "op-1");
  assert.equal(composerAttempt(first, "conv-1", "hola", "legacy", () => "op-2"), first);
});
test("new content or another conversation creates an independent operation", () => {
  const first = composerAttempt(null, "conv-1", "hola", "queue", () => "op-1");
  assert.equal(composerAttempt(first, "conv-2", "hola", "queue", () => "op-2").operationId, "op-2");
  assert.equal(composerAttempt(first, "conv-1", "otro mensaje", "queue", () => "op-3").operationId, "op-3");
});
test("after acknowledgement a new intentional identical message gets a new ID", () => {
  assert.equal(composerAttempt(null, "conv-1", "hola", "queue", () => "op-2").operationId, "op-2");
});
