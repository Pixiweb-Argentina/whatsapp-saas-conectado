import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";

// Browser rendering of the actual component with synthetic props, not authenticated inbox E2E.
test("phone-less conversation renders readable labels with app styles", async ({ page }, testInfo) => {
  await page.goto("/login");
  const styles = await page.locator('link[rel="stylesheet"]').evaluateAll(
    (links) => links.map((link) => link.outerHTML).join(""),
  );
  const component = execFileSync(process.execPath, [
    "--import", "./scripts/register-alias-hook.mjs",
    "--import", "./tests/e2e/fixtures/register-renderer.mjs",
    "./tests/e2e/fixtures/render-contact.ts",
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  await page.setContent(`<!doctype html><html class="dark"><head>${styles}</head>
    <body><main style="max-width:320px;margin:24px auto">${component}</main></body></html>`);
  await expect(page.getByRole("button", { name: /Contacto sin nombre/ })).toBeVisible();
  await expect(page.getByText("Instagram · Cuenta sin vincular", { exact: true })).toBeVisible();
  await expect(page.getByText("Consulta de prueba")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("phone-less-contact.png") });
});
