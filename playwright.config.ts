import { defineConfig, devices } from "@playwright/test";

// Nominal end-to-end journeys against the production build. They share one
// fresh SQLite database created by e2e/serve.mjs, so they run serially.
const port = Number(process.env.E2E_PORT ?? 3210);
export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    locale: "fr-CH",
    timezoneId: "Europe/Zurich",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // A sandbox whose pre-installed Chromium differs from this Playwright
        // version sets PW_CHROMIUM_PATH (see .claude/hooks/session-start.sh)
        // instead of downloading the pinned build.
        ...(process.env.PW_CHROMIUM_PATH
          ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } }
          : {}),
      },
    },
  ],
  webServer: {
    command: "node e2e/serve.mjs",
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { E2E_PORT: String(port) },
  },
});
