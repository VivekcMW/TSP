import { defineConfig, devices } from "@playwright/test";

const publicBaseURL = "http://127.0.0.1:4303";
const workspaceBaseURL = "http://127.0.0.1:4304";

const browserProjects = [
  ["chromium", devices["Desktop Chrome"]],
  ["firefox", devices["Desktop Firefox"]],
  ["webkit", devices["Desktop Safari"]],
] as const;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "consistency.spec.ts",
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  outputDir: "test-results/consistency-artifacts",
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report/consistency", open: "never" }],
    ["json", { outputFile: "test-results/consistency-results.json" }],
  ],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    reducedMotion: "reduce",
  },
  projects: browserProjects.flatMap(([browser, device]) => [
    {
      name: `public-${browser}`,
      testMatch: "consistency.spec.ts",
      grep: /public consistency/,
      use: { ...device, baseURL: publicBaseURL },
    },
    {
      name: `workspace-${browser}`,
      testMatch: "consistency.spec.ts",
      grep: /workspace consistency/,
      use: { ...device, baseURL: workspaceBaseURL },
    },
    {
      name: `admin-${browser}`,
      testMatch: "consistency.spec.ts",
      grep: /admin consistency/,
      use: { ...device, baseURL: workspaceBaseURL },
    },
  ]),
  webServer: [
    {
      command: `DEV_AUTH_BYPASS= VITE_DEV_AUTH_BYPASS= PORT=4303 APP_URL=${publicBaseURL} BETTER_AUTH_URL=${publicBaseURL} BETTER_AUTH_SECRET=consistency-public-secret-at-least-32-characters pnpm dev`,
      url: `${publicBaseURL}/healthz`,
      reuseExistingServer: false,
      timeout: 45_000,
    },
    {
      command: `DEV_AUTH_BYPASS=true DEV_AUTH_SEED_ONBOARDING_COMPLETED=true VITE_DEV_AUTH_BYPASS=true PORT=4304 APP_URL=${workspaceBaseURL} BETTER_AUTH_URL=${workspaceBaseURL} BETTER_AUTH_SECRET=consistency-workspace-secret-at-least-32-characters pnpm dev`,
      url: `${workspaceBaseURL}/healthz`,
      reuseExistingServer: false,
      timeout: 45_000,
    },
  ],
});
