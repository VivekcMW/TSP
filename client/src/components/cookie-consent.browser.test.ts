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
  import { openCookieSettings, schedulePageView, startAnalyticsIfConsented, track } from "@/lib/analytics-consent";
  Object.assign(window, { __track: track, __schedulePageView: schedulePageView });
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
// Every gtag() call, as plain arrays. gtag.js is stubbed, so the queue is the full record.
const gtagCalls = (page: Page) => page.evaluate(() => ((window as unknown as { dataLayer?: unknown[] }).dataLayer ?? [])
  .filter(entry => Object.prototype.toString.call(entry) === "[object Arguments]")
  .map(entry => Array.from(entry as ArrayLike<unknown>)) as unknown[][]);
const pageViews = async (page: Page) => (await gtagCalls(page)).filter(c => c[0] === "event" && c[1] === "page_view").map(c => c[2] as Record<string, string>);

describe("analytics page views and events", () => {
  it("sends page views itself, with tokens removed from the URL", async () => {
    const { context, page, tagRequests } = await open();
    try {
      await page.goto("https://consent.test/reset-password?token=abc123&utm_source=mail");
      await page.addScriptTag({ content: script });
      await banner(page).getByRole("button", { name: "Accept analytics" }).click();
      await expect.poll(() => tagRequests.length).toBe(2);
      expect(await gtagCalls(page)).toContainEqual(["config", "G-D5K9DSSFW2", { send_page_view: false }]);
      await expect.poll(() => pageViews(page)).toHaveLength(1);
      const [view] = await pageViews(page);
      expect(view.page_location).toBe("https://consent.test/reset-password?utm_source=mail");
      expect(view.page_title).toBe(await page.title());
    } finally { await context.close(); }
  });

  it("tracks custom events only with consent, and never with an email address in them", async () => {
    const { context, page, tagRequests } = await open();
    try {
      await visit(page, tagRequests);
      const events = () => gtagCalls(page).then(calls => calls.filter(c => c[0] === "event" && c[1] !== "page_view"));
      await page.evaluate(() => (window as unknown as { __track: (n: string, p?: object) => void }).__track("sign_up", { method: "email" }));
      expect(await events()).toEqual([]);
      await banner(page).getByRole("button", { name: "Accept analytics" }).click();
      await expect.poll(() => tagRequests.length).toBe(2);
      await page.evaluate(() => {
        const track = (window as unknown as { __track: (n: string, p?: object) => void }).__track;
        track("sign_up", { method: "email" });
        track("newsletter_subscribe", { email: "someone@example.com" });
      });
      expect(await events()).toEqual([["event", "sign_up", { method: "email" }]]);
    } finally { await context.close(); }
  });

  it("sends an in-app navigation as a page view once the new title is in place", async () => {
    const { context, page, tagRequests } = await open();
    try {
      await visit(page, tagRequests);
      await banner(page).getByRole("button", { name: "Accept analytics" }).click();
      await expect.poll(() => pageViews(page)).toHaveLength(1);
      await page.evaluate(() => {
        history.pushState(null, "", "/pricing?token=zzz");
        // Helmet applies the new title a frame later; the page view must wait for it.
        requestAnimationFrame(() => { document.title = "Pricing | TheSocialPundit"; });
        (window as unknown as { __schedulePageView: () => void }).__schedulePageView();
      });
      await expect.poll(() => pageViews(page)).toHaveLength(2);
      const [, view] = await pageViews(page);
      expect(view).toEqual({ page_location: "https://consent.test/pricing", page_title: "Pricing | TheSocialPundit", page_referrer: "https://consent.test/" });
    } finally { await context.close(); }
  });
});

describe("cookie consent", () => {
  it("loads no analytics until the visitor accepts, and remembers the choice", async () => {
    const { context, page, tagRequests } = await open();
    try {
      await visit(page, tagRequests);
      await expect(banner(page).isVisible()).resolves.toBe(true);
      await expect(banner(page).getByRole("link", { name: "Cookie Policy" }).getAttribute("href")).resolves.toBe("/cookies");
      expect(tagRequests).toEqual([]);
      await banner(page).getByRole("button", { name: "Accept analytics" }).click();
      await expect.poll(() => tagRequests.length).toBe(2);
      expect(tagRequests.some(url => url.includes("gtag/js?id=G-D5K9DSSFW2"))).toBe(true);
      expect(tagRequests.some(url => url.includes("gtm.js?id=GTM-P4Z2QFPV"))).toBe(true);
      // gtag.js only reads Arguments objects, so the config must be queued as one.
      const config = await page.evaluate(() => ((window as unknown as { dataLayer: unknown[] }).dataLayer)
        .filter(entry => Object.prototype.toString.call(entry) === "[object Arguments]")
        .map(entry => Array.from(entry as ArrayLike<unknown>).filter(value => typeof value === "string")));
      expect(config).toContainEqual(["config", "G-D5K9DSSFW2"]);
      await expect(banner(page).count()).resolves.toBe(0);
      await page.reload(); await visit(page, tagRequests);
      await expect(banner(page).count()).resolves.toBe(0);
      await expect.poll(() => tagRequests.length).toBe(4);
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
      await expect.poll(() => tagRequests.length).toBe(2);
      // Accepting again must not load either script a second time.
      await page.getByRole("button", { name: "Cookie settings" }).click();
      await banner(page).getByRole("button", { name: "Accept analytics" }).click();
      await page.waitForTimeout(200);
      expect(tagRequests).toHaveLength(2);
    } finally { await context.close(); }
  });

  it("leaves room under the page so its last buttons can scroll clear of the banner", async () => {
    const { context, page, tagRequests } = await open();
    try {
      await page.setViewportSize({ width: 390, height: 844 });
      await visit(page, tagRequests);
      const room = () => page.evaluate(() => ({
        state: document.body.dataset.cookieBanner ?? null,
        padding: parseFloat(getComputedStyle(document.body).paddingBottom),
        banner: document.querySelector('[aria-label="Cookie consent"]')?.getBoundingClientRect().height ?? 0,
      }));
      const open = await room();
      expect(open.state).toBe("open");
      expect(open.padding).toBeGreaterThanOrEqual(open.banner);
      await banner(page).getByRole("button", { name: "Reject" }).click();
      await expect.poll(room).toEqual({ state: null, padding: 0, banner: 0 });
    } finally { await context.close(); }
  });

  it("never loads Tag Manager unconditionally from index.html", () => {
    expect(readFileSync(path.join(root, "client/index.html"), "utf8")).not.toMatch(/googletagmanager\.com/);
  });
});
