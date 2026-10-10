import assert from "node:assert/strict";
import { test } from "node:test";
import { conversationRuntimeSettings, legacyBufferSupports } from "./conversation-runtime.ts";

test("neutral runtime preserves legacy history defaults, coercion and bounds", () => {
  for (const [value, expected] of [[undefined, 10], ["20", 20], [80, 50], [-3, 5],
    [null, 5], ["invalid", 10], [Infinity, 10], [{}, 10]] as const) {
    assert.equal(conversationRuntimeSettings({ message_history_window: value }).historyWindow, expected);
  }
  assert.deepEqual(conversationRuntimeSettings(null), { historyWindow: 10, costCutHandoff: false });
});

test("cost handoff requires the explicit existing boolean opt-in", () => {
  for (const value of [undefined, null, "true", 1, false]) {
    assert.equal(conversationRuntimeSettings({ cost_cut_handoff: value }).costCutHandoff, false);
  }
  assert.equal(conversationRuntimeSettings({ cost_cut_handoff: true }).costCutHandoff, true);
});

test("the legacy pipeline cannot pick up a new channel before its worker exists", () => {
  assert.equal(legacyBufferSupports("whatsapp"), true);
  for (const channel of ["instagram", "messenger", "web", "email", null, undefined]) {
    assert.equal(legacyBufferSupports(channel), false);
  }
});
