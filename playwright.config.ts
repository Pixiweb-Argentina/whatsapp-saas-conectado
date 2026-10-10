import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT ?? "3100");
if (!Number.isInteger(port) || port < 1024 || port > 65535 || [3300, 3301].includes(port)) {
  throw new Error("PLAYWRIGHT_PORT must be an unreserved local port (never 3300/3301)");
}
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  // Playwright clears this directory at startup; preserve Cloud QA ledgers and logs outside it.
  outputDir: "./test-results/playwright",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } },
  ],
  webServer: {
    command: `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
    url: `${baseURL}/login`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      NEXT_TELEMETRY_DISABLED: "1",
      NEXT_PUBLIC_SUPABASE_URL: "https://supabase.example.invalid",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-test-placeholder",
      SUPABASE_SERVICE_ROLE_KEY: "server-test-placeholder",
    },
  },
});
