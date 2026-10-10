import { test, expect, request } from "@playwright/test";
import { Parser } from "htmlparser2";

/**
 * Read-only, anonymous HTTP smoke only. This does NOT verify authenticated
 * features, browser rendering, load capacity, or the deployed release SHA.
 * Opt in with --config=playwright.deployment.config.ts and explicitly supplied
 * E2E_BASE_URL / E2E_API_BASE_URL. No dotenv, app imports, or browser navigation.
 */
const checks = [
  { target: "backend", path: "/healthz", kind: "health" },
  { target: "backend", path: "/readyz", kind: "ready" },
  { target: "frontend", path: "/sign-in", kind: "html" },
  { target: "frontend", path: "/healthz", kind: "health" },
  { target: "frontend", path: "/readyz", kind: "ready" },
  ...(["backend", "frontend"] as const).flatMap((target) =>
    ["/api/drafts", "/api/integrations"].map((path) => ({ target, path, kind: "private" })),
  ),
] as const;

test.describe("Read-only deployment HTTP smoke", () => {
  test.describe.configure({ retries: 0, timeout: 10_000 });

  for (const check of checks) {
    test(`${check.target} GET ${check.path}`, async ({}, info) => {
      // Default discovery genuinely skips before creating a request context;
      // only the dedicated config validates and supplies the opt-in origins.
      test.skip(!info.config.metadata.deploymentSmoke,
        "Opt in with playwright.deployment.config.ts and both explicit origins");
      const origins = info.config.metadata.deploymentSmoke as Record<string, string>;
      // Not the browser/request fixture: never inherit storageState, credentials
      // or cookies from a different check (even if a health probe sets a cookie).
      const context = await request.newContext({
        storageState: { cookies: [], origins: [] },
        ignoreHTTPSErrors: false,
        timeout: 5_000,
      });
      try {
        const response = await context.get(`${origins[check.target]}${check.path}`, {
          maxRedirects: 0,
          maxRetries: 0,
          timeout: 5_000,
        });
        if (check.kind === "private") {
          expect([401, 403]).toContain(response.status());
        } else {
          expect(response.status()).toBe(200);
          if (check.kind === "html") {
            expect(response.headers()["content-type"]).toMatch(/^text\/html(?:\s*;|$)/i);
            let hasAppRoot = false;
            const parser = new Parser({ onopentag(name, attributes) {
              if (name === "div" && attributes.id === "root") hasAppRoot = true;
            } });
            parser.end(await response.text());
            expect(hasAppRoot, "HTML must contain the app's div#root").toBe(true);
          } else {
            expect(response.headers()["content-type"]).toMatch(/^application\/json(?:\s*;|$)/i);
            const body = await response.json();
            if (check.kind === "health") {
              expect(body).toEqual({ status: "ok" });
            } else {
              // Readiness also exposes queue/jobsRequired; do not assume their
              // values or equate this narrow status check with job verification.
              expect(body).toMatchObject({ status: "ok", database: "ok" });
            }
          }
        }
      } finally {
        await context.dispose();
      }
    });
  }
});
