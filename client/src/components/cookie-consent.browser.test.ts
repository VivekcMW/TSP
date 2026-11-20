import { readFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../..");
// The real banner and consent module; a stand-in footer link opens the settings.
const fixture = `
  import React, { lazy, Suspense, useEffect } from "react";
  import { createRoot } from "react-dom/client";
  import { Router, Route, Switch, Link, useLocation, useSearch } from "wouter";
  import { HelmetProvider } from "react-helmet-async";
  import { SEO } from "@/components/seo";
  import { AnalyticsPage } from "@/components/analytics-page";
  import { RouteTransition } from "@/components/route-transition";
  import { CookieConsent } from "@/components/cookie-consent";
  import { openCookieSettings, beginAnalyticsNavigation, startAnalyticsIfConsented, track } from "@/lib/analytics-consent";
  Object.assign(window, { __track: track });
  function Content({path, title}) { return <><SEO title={title} canonical={path}/><h1>{title}</h1></>; }
  const Pricing = lazy(() => new Promise(resolve => setTimeout(() => resolve({ default: () => <Content path="/pricing" title="Pricing"/> }), 1800)));
  function Routes() {
    const [location] = useLocation();
    const search = useSearch();
    useEffect(beginAnalyticsNavigation, [location, search]);
    return <>
      <Link href="/pricing?token=zzz">Pricing route</Link>
      <Link href="/other">Other route</Link>
      <Link href="/same-title">Same title route</Link>
      <RouteTransition transitionKey={path => path}>
        {path => <Suspense fallback={<p>Loading route</p>}>
          <Switch location={path}>
            <Route path="/pricing" component={Pricing}/>
            <Route><Content path={path} title="Test page"/></Route>
          </Switch>
          <AnalyticsPage path={path}/>
        </Suspense>}
      </RouteTransition>
    </>;
  }
  startAnalyticsIfConsented();
  createRoot(document.getElementById("root")).render(
    <Router><HelmetProvider><Routes/><button onClick={openCookieSettings}>Cookie settings</button><CookieConsent/></HelmetProvider></Router>);
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
  const clarityRequests: string[] = [];
  await context.route("https://www.clarity.ms/**", route => { clarityRequests.push(route.request().url()); return route.fulfill({ contentType: "text/javascript", body: "" }); });
  await context.route("https://consent.test/**", route => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
  await context.route("https://www.googletagmanager.com/**", route => { tagRequests.push(route.request().url()); return route.fulfill({ contentType: "text/javascript", body: "" }); });
  await context.route("**/*", route => route.fallback());
  const page = await context.newPage();
  return { context, page, tagRequests, clarityRequests };
}
const clarityCalls = (page: Page) => page.evaluate(() => ((window as unknown as { clarity?: { q?: ArrayLike<unknown>[] } }).clarity?.q ?? []).map(entry => Array.from(entry)));
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
      // The sanitised URL is set at config level too, so GA's automatic events
      // (scroll, session_start, form_start…) never carry the raw URL either.
      const config = (await gtagCalls(page)).find(c => c[0] === "config");
      expect(config?.[2]).toMatchObject({ send_page_view: false, page_location: "https://consent.test/reset-password?utm_source=mail", allow_google_signals: false, allow_ad_personalization_signals: false });
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
      expect(await events()).toEqual([["event", "sign_up", expect.objectContaining({ method: "email", page_location: "https://consent.test/" })]]);
    } finally { await context.close(); }
  });

  it("sends an in-app navigation as a page view once the new title is in place", async () => {
    const { context, page, tagRequests } = await open();
    try {
      await visit(page, tagRequests);
      await banner(page).getByRole("button", { name: "Accept analytics" }).click();
      await expect.poll(() => pageViews(page)).toHaveLength(1);
      await page.getByRole("link", { name: "Pricing route", exact: true }).click();
      await page.waitForTimeout(1600);
      expect(await pageViews(page)).toHaveLength(1);
      await expect.poll(() => pageViews(page), { timeout: 5000 }).toHaveLength(2);
      const [, view] = await pageViews(page);
      expect(view).toEqual({ page_location: "https://consent.test/pricing", page_title: "Pricing | TheSocialPundit", page_referrer: "https://consent.test/" });
      // Subsequent automatic events must use the new page too.
      const sets = (await gtagCalls(page)).filter(c => c[0] === "set").map(c => c[1] as Record<string, string>);
      expect(sets.at(-1)).toEqual({ page_location: "https://consent.test/pricing", page_title: "Pricing | TheSocialPundit", page_referrer: "https://consent.test/" });
    } finally { await context.close(); }
  });

  it("tracks routes with identical titles and ignores superseded lazy navigation", async () => {
    const { context, page, tagRequests } = await open();
    try {
      await visit(page, tagRequests);
      await banner(page).getByRole("button", { name: "Accept analytics" }).click();
      await expect.poll(() => pageViews(page)).toHaveLength(1);
      await page.getByRole("link", { name: "Same title route", exact: true }).click();
      await expect.poll(() => pageViews(page)).toHaveLength(2);
      await page.getByRole("link", { name: "Pricing route", exact: true }).click();
      await page.waitForTimeout(350);
      await page.getByRole("link", { name: "Other route", exact: true }).click();
      await expect.poll(() => pageViews(page)).toHaveLength(3);
      await page.waitForTimeout(2000);
      expect((await pageViews(page)).map(view => new URL(view.page_location).pathname)).toEqual(["/", "/same-title", "/other"]);
    } finally { await context.close(); }
  });

  it("stops tracking on withdrawal and resumes once without reloading scripts", async () => {
    const { context, page, tagRequests } = await open();
    try {
      await visit(page, tagRequests);
      await banner(page).getByRole("button", { name: "Accept analytics" }).click();
      await expect.poll(() => pageViews(page)).toHaveLength(1);
      await page.getByRole("button", { name: "Cookie settings" }).click();
      await banner(page).getByRole("button", { name: "Reject" }).click();
      expect(await page.evaluate(() => (window as unknown as Record<string, unknown>)["ga-disable-G-D5K9DSSFW2"])).toBe(true);
      expect(await gtagCalls(page)).toContainEqual(["consent", "update", { analytics_storage: "denied", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" }]);
      await page.getByRole("link", { name: "Other route", exact: true }).click();
      await page.waitForTimeout(400);
      expect(await pageViews(page)).toHaveLength(1);
      await page.getByRole("button", { name: "Cookie settings" }).click();
      await banner(page).getByRole("button", { name: "Accept analytics" }).click();
      await expect.poll(() => pageViews(page)).toHaveLength(2);
      expect(tagRequests).toHaveLength(2);
      expect(await page.evaluate(() => (window as unknown as Record<string, unknown>)["ga-disable-G-D5K9DSSFW2"])).toBe(false);
    } finally { await context.close(); }
  });

  it("honours the choice when browser storage is blocked", async () => {
    const { context, page, tagRequests } = await open();
    try {
      await context.addInitScript(() => {
        Storage.prototype.getItem = () => { throw new Error("blocked"); };
        Storage.prototype.setItem = () => { throw new Error("blocked"); };
      });
      await visit(page, tagRequests);
      await banner(page).getByRole("button", { name: "Accept analytics" }).click();
      await expect.poll(() => pageViews(page)).toHaveLength(1);
      await page.getByRole("button", { name: "Cookie settings" }).click();
      await banner(page).getByRole("button", { name: "Reject" }).click();
      await page.getByRole("link", { name: "Other route", exact: true }).click();
      await page.waitForTimeout(400);
      expect(await pageViews(page)).toHaveLength(1);
      expect(tagRequests).toHaveLength(2);
    } finally { await context.close(); }
  });

  it("applies withdrawal made in another tab", async () => {
    const { context, page, tagRequests } = await open();
    try {
      await visit(page, tagRequests);
      await banner(page).getByRole("button", { name: "Accept analytics" }).click();
      await expect.poll(() => pageViews(page)).toHaveLength(1);
      const other = await context.newPage();
      await other.goto("https://consent.test/");
      await other.evaluate(() => localStorage.setItem("tsp-analytics-consent", "denied"));
      await expect.poll(() => page.evaluate(() => (window as unknown as Record<string, unknown>)["ga-disable-G-D5K9DSSFW2"])).toBe(true);
      await page.getByRole("link", { name: "Other route", exact: true }).click();
      await page.waitForTimeout(400);
      expect(await pageViews(page)).toHaveLength(1);
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
      await page.evaluate(() => { document.cookie = "_ga=GA1.1.123; path=/"; document.cookie = "_ga_ABC=GS1.1; path=/"; document.cookie = "_clck=abc; path=/"; document.cookie = "_clsk=def; path=/"; document.cookie = "keep=1; path=/"; });
      await banner(page).getByRole("button", { name: "Reject" }).click();
      await expect(banner(page).count()).resolves.toBe(0);
      await expect(page.evaluate(() => document.cookie)).resolves.toBe("keep=1");
      await page.reload(); await visit(page, tagRequests);
      await expect(banner(page).count()).resolves.toBe(0);
      expect(tagRequests).toEqual([]);
    } finally { await context.close(); }
  });

  it("loads Microsoft Clarity only with consent and tells it when consent is withdrawn", async () => {
    const { context, page, tagRequests, clarityRequests } = await open();
    try {
      await visit(page, tagRequests);
      expect(clarityRequests).toEqual([]);
      await expect(page.evaluate(() => typeof (window as unknown as { clarity?: unknown }).clarity)).resolves.toBe("undefined");
      await banner(page).getByRole("button", { name: "Accept analytics" }).click();
      await expect.poll(() => clarityRequests).toEqual(["https://www.clarity.ms/tag/z1pelaa8ib?ref=bwt"]);
      expect(await clarityCalls(page)).toEqual([["consentv2", { ad_Storage: "denied", analytics_Storage: "granted" }]]);
      await page.getByRole("button", { name: "Cookie settings" }).click();
      await banner(page).getByRole("button", { name: "Reject" }).click();
      await expect.poll(() => clarityCalls(page)).toContainEqual(["consentv2", { ad_Storage: "denied", analytics_Storage: "denied" }]);
      expect(clarityRequests).toHaveLength(1);
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

  it("never loads Tag Manager or Clarity unconditionally from index.html", () => {
    expect(readFileSync(path.join(root, "client/index.html"), "utf8")).not.toMatch(/googletagmanager\.com|clarity\.ms/);
  });
});
