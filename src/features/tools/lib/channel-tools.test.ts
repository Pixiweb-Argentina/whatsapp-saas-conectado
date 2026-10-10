import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { toolsForChannel } from "./channel-tools.ts";
import { registry } from "../registry.ts";
import type { Tool, ToolContext } from "../core/tool.ts";

const context: ToolContext = { workspaceId: "test-workspace", conversationId: "test-conversation",
  contactId: "test-contact", channel: "instagram", channelCapabilities: ["text"] };

function makeTool(overrides: Partial<Tool> = {}): Tool {
  return { name: "fixture_tool", description: "test", sensitivity: "write", schema: z.object({}),
    enabledFor: () => true, run: async () => ({ ok: true, output: null }), ...overrides };
}

test("existing tools stay on WhatsApp until reviewed for other channels", () => {
  const tool = makeTool();
  assert.deepEqual(toolsForChannel([tool], {}), [tool]);
  assert.deepEqual(toolsForChannel([tool], { channel: "whatsapp" }), [tool]);
  for (const channel of ["instagram", "messenger", "web"] as const) {
    assert.deepEqual(toolsForChannel([tool], { channel }), []);
  }
});

test("an explicit channel requires every declared capability without mutating the tool list", () => {
  const tool = makeTool({ supportedChannels: ["instagram"], requiredChannelCapabilities: ["text", "private_reply"] });
  const tools = [tool];
  assert.deepEqual(toolsForChannel(tools, context), []);
  assert.deepEqual(toolsForChannel(tools, { ...context, channelCapabilities: ["text", "private_reply"] }), tools);
  assert.equal(tools.length, 1);
});

test("direct registry execution cannot bypass channel filtering or call write hooks", async () => {
  let calls = 0;
  const tool = makeTool({ run: async () => { calls++; return { ok: true, output: null }; } });
  registry.register(tool);
  const options = { onStart: () => { calls++; }, onExecuted: () => { calls++; } };
  const result = await registry.run(tool.name, {}, context, options);
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /canal/);
  assert.equal(calls, 0);
});

test("dynamic tools are gated at the same execution boundary", async () => {
  let ran = false;
  const tool = makeTool({ supportedChannels: ["instagram"], requiredChannelCapabilities: ["private_reply"],
    run: async () => { ran = true; return { ok: true, output: null }; } });
  const result = await registry.runTool(tool, {}, context);
  assert.equal(result.ok, false);
  assert.equal(ran, false);
});
