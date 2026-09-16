import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:4302";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "PORT=4302 APP_URL=http://127.0.0.1:4302 BETTER_AUTH_URL=http://127.0.0.1:4302 BETTER_AUTH_SECRET=e2e-only-better-auth-secret-at-least-32-characters npm run dev",
    url: `${baseURL}/healthz`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
