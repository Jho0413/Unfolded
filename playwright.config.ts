import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  // The demo runs on a desktop browser (ARCHITECTURE §1), so one desktop project is enough.
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Test the production build, as the app is run for real. CI builds in its own step first.
    command: isCI
      ? `npm run start -- -p ${PORT}`
      : `npm run build && npm run start -- -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    // Never reuse a server: with several worktrees, one on this port may be running other code.
    reuseExistingServer: false,
    timeout: 180_000,
    // e2e never calls paid APIs (ARCHITECTURE §10), locally as in CI.
    env: { FAKE_APIS: "1", NEXT_PUBLIC_FAKE_APIS: "1" },
  },
});
