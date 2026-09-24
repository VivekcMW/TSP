import { readFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../..");
// The real banner and consent module; a stand-in footer link opens the settings.
const fixture = `
  import React from "react";
  import { createRoot } from "react-dom/client";
  import { CookieConsent } from "@/components/cookie-consent";
  import { openCookieSettings, startAnalyticsIfConsented } from "@/lib/analytics-consent";
  startAnalyticsIfConsented();
  createRoot(document.getElementById("root")).render(React.createElement(React.Fragment, null,
    React.createElement("button", { onClick: openCookieSettings }, "Cookie settings"),
    React.createElement(CookieConsent)));
`;

let browser: Browser;
let script: string;
beforeAll(async () => {
  const bundle = await build({
    stdin: { contents: fixture, resolveDir: root, loader: "tsx" }, absWorkingDir: root,
    alias: { "@": path.join(root, "client/src") }, bundle: true, write: false, format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"' },
  });
  script = bundle.outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });

async function visit(page: Page, tagRequests: string[]) {
  await page.goto("https://consent.test/");
  await page.addScriptTag({ content: script });
  await page.getByRole("button", { name: "Cookie settings" }).waitFor();
  await page.waitForTimeout(200);
  return tagRequests;
}
async function open() {
  const context = await browser.newContext();
  const tagRequests: string[] = [];
  await context.route("https://consent.test/**", route => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
  await context.route("https://www.googletagmanager.com/**", route => { tagRequests.push(route.request().url()); return route.fulfill({ contentType: "text/javascript", body: "" }); });
  await context.route("**/*", route => route.fallback());
  const page = await context.newPage();
  return { context, page, tagRequests };
}
const banner = (page: Page) => page.getByRole("region", { name: "Cookie consent" });

describe("cookie consent", () => {
  it("loads no analytics until the visitor accepts, and remembers the choice", async () => {
    const { context, page, tagRequests } = await open();
    try {
      await visit(page, tagRequests);
      await expect(banner(page).isVisible()).resolves.toBe(true);
      await expect(banner(page).getByRole("link", { name: "Cookie Policy" }).getAttribute("href")).resolves.toBe("/cookies");
      expect(tagRequests).toEqual([]);
      await banner(page).getByRole("button", { name: "Accept analytics" }).click();
      await expect.poll(() => tagRequests.length).toBe(1);
      expect(tagRequests[0]).toContain("gtm.js?id=GTM-P4Z2QFPV");
      await expect(banner(page).count()).resolves.toBe(0);
      await page.reload(); await visit(page, tagRequests);
      await expect(banner(page).count()).resolves.toBe(0);
      await expect.poll(() => tagRequests.length).toBe(2);
    } finally { await context.close(); }
  });

  it("keeps analytics off after Reject, across visits, and clears analytics cookies", async () => {
    const { context, page, tagRequests } = await open();
    try {
      await visit(page, tagRequests);
      await page.evaluate(() => { document.cookie = "_ga=GA1.1.123; path=/"; document.cookie = "_ga_ABC=GS1.1; path=/"; document.cookie = "keep=1; path=/"; });
      await banner(page).getByRole("button", { name: "Reject" }).click();
      await expect(banner(page).count()).resolves.toBe(0);
      await expect(page.evaluate(() => document.cookie)).resolves.toBe("keep=1");
      await page.reload(); await visit(page, tagRequests);
      await expect(banner(page).count()).resolves.toBe(0);
      expect(tagRequests).toEqual([]);
    } finally { await context.close(); }
  });

  it("reopens from Cookie settings so a choice can be changed", async () => {
    const { context, page, tagRequests } = await open();
    try {
      await visit(page, tagRequests);
      await banner(page).getByRole("button", { name: "Reject" }).click();
      await page.getByRole("button", { name: "Cookie settings" }).click();
      await expect(banner(page).isVisible()).resolves.toBe(true);
      await banner(page).getByRole("button", { name: "Accept analytics" }).click();
      await expect.poll(() => tagRequests.length).toBe(1);
    } finally { await context.close(); }
  });

  it("never loads Tag Manager unconditionally from index.html", () => {
    expect(readFileSync(path.join(root, "client/index.html"), "utf8")).not.toMatch(/googletagmanager\.com/);
  });
});
