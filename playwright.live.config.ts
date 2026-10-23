import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL;
if (!baseURL || !URL.canParse(baseURL) || new URL(baseURL).protocol !== "https:") {
  throw new Error("E2E_BASE_URL must be an explicit HTTPS deployment origin");
}

export default defineConfig({
  testDir: "./e2e",
  testIgnore: ["consistency.spec.ts", "deployment-smoke.spec.ts"],
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { outputFolder: "playwright-report/live-acceptance", open: "never" }]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "live-chromium", use: { ...devices["Desktop Chrome"] } }],
});
