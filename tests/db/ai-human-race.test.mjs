import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("buffer generation and human control integrate with real local SQL", { timeout: 120000 }, async () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const args = ["--experimental-test-module-mocks", "--import", "./scripts/register-alias-hook.mjs",
    "--import", "./scripts/mock-module-compat.mjs", "--test", "--test-reporter=tap", "./tests/db/ai-human-race-runner.mjs"];
  // An isolated runner must not inherit node:test's recursive-run marker.
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, args, { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const timer = setTimeout(() => child.kill(), 110000);
  try {
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject); child.once("close", resolve);
    });
    assert.equal(code, 0, output);
    assert.match(output, /# pass 5\b/);
  } finally { clearTimeout(timer); }
});
