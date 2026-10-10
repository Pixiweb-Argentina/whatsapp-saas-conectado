import { readFile } from "node:fs/promises";
import ts from "typescript";

// Test-only Node loader: compile JSX with React, outside Playwright's CT transform.
export async function load(url, context, nextLoad) {
  if (!url.endsWith(".tsx")) return nextLoad(url, context);
  const source = await readFile(new URL(url), "utf8");
  return {
    format: "module", shortCircuit: true,
    source: ts.transpileModule(source, { compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022,
    } }).outputText,
  };
}
