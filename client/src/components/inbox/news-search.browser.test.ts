import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { chromium, expect as browserExpect, type Browser, type Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
import postcss from "postcss";
import tailwindcss from "tailwindcss";

// Real Inbox shell, search bar and news results with in-memory fetch fixtures; no app server or real requests.
const root = path.resolve(import.meta.dirname, "../../../..");
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
const story = (id: string, headline: string, status = "active") => ({
  id, headline, status, summary: `${headline} summary`, source: "Wire Daily", matchedKeywords: [], articleUrl: `https://news.test/${id}`,
  relevanceScore: "0.5", rankingScore: "0.5", publishedAt: null, readAt: hoursAgo(5), createdAt: hoursAgo(2),
});
const records = [story("a1", "Retail media budgets climb"), story("b1", "Cloud costs in focus"), story("s1", "Saved earlier", "saved")];
const hit = (id: string, title: string, source: string, extra: Record<string, unknown> = {}) => ({
  id, title, url: `https://${source.toLowerCase().replace(/\s+/g, "")}.test/${id}`, source, publishedAt: hoursAgo(3), snippet: `${title}: what changed and why.`,
  matchedTerms: ["retail", "media"], alsoCoveredBy: [], inInbox: null, ...extra,
});
const results = [
  hit("n1", "Retail media networks raise prices", "Ad Brief", { alsoCoveredBy: [{ source: "Commerce Report", url: "https://commerce.test/n1" }] }),
  hit("n2", "Retail media jobs grow in India", "Data Desk"),
  hit("n3", "What retail media means for brands", "Wire Daily", { inInbox: { id: "a1", status: "active", url: "https://wiredaily.test/n3" } }),
];
let browser: Browser;
let page: Page;
let bundle: string;
let css: string;

beforeAll(async () => {
  const result = await build({
    absWorkingDir: root,
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { QueryClientProvider } from "@tanstack/react-query";
      import { queryClient } from "@/lib/queryClient";
      import { AppTourProvider } from "@/components/app-tour";
      import { HelpProvider } from "@/components/help-panel";
      import { CreatePostProvider } from "@/components/dashboard/create-post-provider";
      import { InboxShell } from "@/components/inbox/inbox-shell";
      import InboxPage from "@/pages/inbox";
      window.__calls = []; window.__toasts = []; window.__unexpected = [];
      const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
      window.fetch = async (url, options = {}) => {
        const method = options.method || "GET";
        const body = options.body ? JSON.parse(options.body) : undefined;
        window.__calls.push({ url, method, body });
        const byStatus = status => window.__records.filter(item => item.status === status);
        if (url === "/api/me") return json({ id: "user", firstName: "Reader", lastName: "One", email: "reader@test" });
        if (url === "/api/profile") return json({ userId: "user", tenantId: "tenant", focusDescription: "Retail media.", keywords: [], requirePublishReview: true, defaultTone: "professional" });
        if (url === "/api/integrations/linkedin/status") return json({ provider: "linkedin", connected: false });
        if (method === "GET" && url.startsWith("/api/drafts?")) return json([]);
        if (method === "GET" && url.startsWith("/api/drafts/scheduled?")) return json({ items: [], total: 0 });
        if (url === "/api/inbox/visit") return json({ previousVisitAt: null, currentVisitAt: new Date().toISOString() });
        if (url === "/api/inbox?status=active") return json(byStatus("active"));
        if (url === "/api/inbox?status=active&snoozed=only") return json([]);
        const page = url.match(/^\\/api\\/inbox\\?status=(saved|dismissed)&limit=200&offset=0$/);
        if (page) return json(byStatus(page[1]));
        if (method === "GET" && url.startsWith("/api/search/news?")) {
          if (window.__searchFails) return json({ message: "Too many searches. Please wait a minute and try again." }, 429);
          const q = new URL(url, location.origin).searchParams.get("q");
          return json({ query: { normalized: q, warnings: [] }, providers: { pool: "ok", google: "failed", bing: "ok" }, results: window.__results });
        }
        if (method === "POST" && url === "/api/search/news/save") {
          const existing = window.__records.find(item => item.articleUrl === body.url);
          if (existing && existing.status === "dismissed") {
            window.__records = window.__records.map(item => item === existing ? { ...item, status: "saved" } : item);
            return json({ ...existing, status: "saved" });
          }
          if (existing) return json(existing);
          const item = { ...body, id: "saved-" + window.__records.length, headline: body.title, articleUrl: body.url, status: "saved", matchedKeywords: [], createdAt: new Date().toISOString(), readAt: null };
          window.__records = [...window.__records, item];
          return json(item, 201);
        }
        if (url === "/api/searches" && method === "GET") return json(window.__searches);
        if (url === "/api/searches" && method === "POST") {
          const search = { id: "fs" + window.__calls.length, query: body.query, name: body.name ?? body.query, createdAt: new Date().toISOString(), lastViewedAt: null };
          window.__searches = [...window.__searches, search];
          return json(search, 201);
        }
        const searchId = url.match(/^\\/api\\/searches\\/([^/]+)(\\/viewed)?$/);
        if (searchId && method === "DELETE") { window.__searches = window.__searches.filter(search => search.id !== searchId[1]); return json({ success: true }); }
        if (searchId && searchId[2] && method === "POST") return json({ ...window.__searches.find(search => search.id === searchId[1]), lastViewedAt: new Date().toISOString() });
        // Other phases may add shell requests; they must never be search requests.
        window.__unexpected.push(method + " " + url);
        return json({ message: "Not found" }, 404);
      };
      createRoot(document.getElementById("root")).render(
        <QueryClientProvider client={queryClient}><AppTourProvider scope={null} enabled={false}><HelpProvider><CreatePostProvider>
          <InboxShell><InboxPage /></InboxShell>
        </CreatePostProvider></HelpProvider></AppTourProvider></QueryClientProvider>);
    ` },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"' },
    logLevel: "silent",
    plugins: [{ name: "mock-auth-and-toasts", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/(auth|dev-auth)$|^@\/hooks\/use-toast$/ }, args => ({ path: args.path, namespace: "mock" }));
      builder.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents: args.path.endsWith("dev-auth")
        ? "export const useIsSignedIn = () => true; export const devAuthEnabled = false;"
        : args.path.endsWith("/auth")
        ? 'export const useIsSignedIn = () => true; export const signOut = () => {}; export const useAuth = () => ({ user: { id: "user", firstName: "Reader" } });'
        : "export const useToast = () => ({ toast: toast => { window.__toasts.push(toast); return { id: String(window.__toasts.length), dismiss() {}, update() {} }; } });", loader: "js" }));
    } }],
  });
  bundle = result.outputFiles[0].text;
  css = (await postcss([tailwindcss({ content: [path.join(root, "client/src/**/*.tsx")] })])
    .process("@tailwind base; @tailwind utilities;", { from: undefined })).css;
  browser = await chromium.launch({ headless: true });
}, 90_000);
afterEach(async () => { await page?.close(); });
afterAll(async () => { await browser?.close(); });

async function mount(url = "/dashboard", state: Record<string, unknown> = {}, viewport = { width: 1440, height: 900 }) {
  page = await browser.newPage({ viewport });
  page.setDefaultTimeout(5000);
  await page.route("**/*", route => route.abort());
  await page.route("https://inbox.test/**", route => route.fulfill({ contentType: "text/html", body: '<div id="root" style="height:100vh"></div>' }));
  await page.goto(`https://inbox.test${url}`);
  await page.evaluate(state => Object.assign(window, state), { __records: records, __results: results, __searches: [], ...state });
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: bundle });
}
type Call = { url: string; method: string; body: Record<string, unknown> | undefined };
const calls = (method: string, pattern: RegExp): Promise<Call[]> => page.evaluate(([method, source]) => (window as any).__calls
  .filter((call: Call) => call.method === method && new RegExp(source).test(call.url)), [method, pattern.source] as const);
const lastToast = () => page.evaluate(() => { const toast = (window as any).__toasts.at(-1); return toast && { title: toast.title, description: toast.description }; });
const searchUnexpected = () => page.evaluate(() => (window as any).__unexpected.filter((entry: string) => /\/api\/search/.test(entry)));
const newsRows = () => page.locator('[data-testid^="row-news-"]');

describe("keyword news search in the Inbox", () => {
  it("searches news from the bar, follows the search, saves a story and drafts a take", async () => {
    await mount();
    const input = page.getByTestId("input-inbox-search");
    await browserExpect(page.getByTestId("row-inbox-a1")).toBeVisible();
    await browserExpect(page.getByTestId("nav-saved-searches")).toHaveCount(0);

    // Inbox scope still filters the list as you type, and offers a news search.
    await input.fill("retail media");
    await browserExpect(input).toHaveAttribute("aria-label", "Search your Inbox");
    await browserExpect(page.getByTestId("row-inbox-b1")).toHaveCount(0);
    await browserExpect(page.getByTestId("row-inbox-a1")).toBeVisible();
    await browserExpect(page.getByTestId("button-search-news")).toContainText("Search news for \u201cretail media\u201d");

    await page.getByTestId("button-search-scope-news").click();
    await browserExpect(input).toHaveAttribute("aria-label", "Search news");
    await browserExpect(input).toHaveValue("retail media");
    await browserExpect(page.getByTestId("button-search-scope-news")).toHaveAttribute("aria-pressed", "true");
    await input.press("Enter");
    await expect.poll(() => page.evaluate(() => location.search)).toBe("?news=retail+media");
    await browserExpect(newsRows()).toHaveCount(3);
    expect((await calls("GET", /^\/api\/search\/news\?/)).map(call => call.url)).toEqual(["/api/search/news?q=retail%20media&limit=50"]);
    await browserExpect(page.getByRole("heading", { name: "News: retail media" })).toBeVisible();
    await browserExpect(page.getByTestId("text-provider-note")).toContainText("Google News didn\u2019t answer in time");
    await browserExpect(page.getByTestId("text-news-headline-n1")).toBeVisible();
    await browserExpect(page.getByRole("region", { name: "Also covered by" })).toContainText("Commerce Report");
    await browserExpect(page.getByTestId("row-news-n3")).toContainText("In For you");
    await browserExpect(input).toHaveValue("retail media");

    // Follow this search: it appears under Searches in the folder nav.
    await page.getByTestId("button-follow-search").click();
    await browserExpect(page.getByTestId("button-follow-search")).toHaveText("Following");
    await browserExpect(page.getByTestId("button-follow-search")).toHaveAttribute("aria-pressed", "true");
    expect((await calls("POST", /^\/api\/searches$/)).map(call => call.body)).toEqual([{ query: "retail media" }]);
    const navSearch = page.getByRole("navigation", { name: "Folders" }).getByRole("link", { name: "retail media" });
    await browserExpect(navSearch).toBeVisible();

    // Save to Shortlist keeps the story out of For you (no capacity) and shows where it is.
    await page.getByTestId("row-news-n2").click();
    await page.getByTestId("button-news-save-n2").click();
    await browserExpect(page.getByTestId("text-news-state-n2")).toHaveText("In your Shortlist");
    expect((await calls("POST", /^\/api\/search\/news\/save$/)).map(call => call.body)).toEqual([
      { url: "https://datadesk.test/n2", title: "Retail media jobs grow in India", source: "Data Desk", publishedAt: results[1].publishedAt, snippet: "Retail media jobs grow in India: what changed and why." },
    ]);
    await browserExpect(page.getByTestId("nav-folder-shortlist")).toContainText("2");
    expect(await lastToast()).toMatchObject({ title: "Saved to Shortlist" });

    // Draft my take saves first, then opens the composer on that story.
    await page.getByTestId("row-news-n1").click();
    await page.getByTestId("button-news-draft-n1").click();
    await browserExpect(page.getByTestId("compose-float")).toBeVisible();
    await browserExpect(page.getByRole("dialog", { name: /Retail media networks raise prices/ })).toBeVisible();
    expect((await calls("POST", /^\/api\/search\/news\/save$/)).at(-1)!.body).toMatchObject({ url: "https://adbrief.test/n1" });
    await browserExpect(page.getByTestId("text-news-state-n1")).toHaveText("In your Shortlist");

    // Opening the followed search marks it viewed and highlights it.
    await navSearch.click();
    await expect.poll(() => page.evaluate(() => location.search)).toMatch(/^\?news=retail\+media&saved=fs\d+$/);
    await browserExpect(navSearch).toHaveAttribute("aria-current", "page");
    await expect.poll(async () => (await calls("POST", /^\/api\/searches\/fs\d+\/viewed$/)).length).toBe(1);

    // Remove from the nav, then Undo.
    await page.getByRole("button", { name: "Stop following retail media" }).click();
    await browserExpect(page.getByTestId("nav-saved-searches")).toHaveCount(0);
    expect(await lastToast()).toMatchObject({ title: "Stopped following \u201cretail media\u201d" });
    await page.evaluate(() => (window as any).__toasts.at(-1).action.props.onClick());
    await browserExpect(page.getByRole("navigation", { name: "Folders" }).getByRole("link", { name: "retail media" })).toBeVisible();
    expect(await searchUnexpected()).toEqual([]);
  }, 30_000);

  it("reads results with j/k/o/u, unfollows from the header with Undo, and shows operator chips and tips", async () => {
    await mount(`/dashboard?news=${encodeURIComponent("retail -crypto source:Reuters after:2026-02-30")}`, { __searches: [{ id: "fs1", query: "retail -crypto source:Reuters", name: "Retail", createdAt: hoursAgo(1), lastViewedAt: null }] });
    await browserExpect(newsRows()).toHaveCount(3);
    await browserExpect(page.getByTestId("button-follow-search")).toHaveText("Following");
    await browserExpect(page.getByRole("list", { name: "Search operators used" })).toContainText("Without crypto");
    await browserExpect(page.getByRole("list", { name: "Search operators used" })).toContainText("Source: Reuters");
    await browserExpect(page.getByText("\u201cafter:2026-02-30\u201d isn\u2019t a valid date. Use YYYY-MM-DD.")).toBeVisible();
    await browserExpect(page.getByTestId("input-inbox-search")).toHaveAttribute("aria-label", "Search news");

    await page.getByTestId("row-news-n1").focus();
    await page.keyboard.press("j");
    await browserExpect(page.getByTestId("text-news-headline-n2")).toBeVisible();
    await browserExpect(page.getByTestId("row-news-n2")).toBeFocused();
    await page.keyboard.press("j");
    await browserExpect(page.getByTestId("text-news-headline-n3")).toBeVisible();
    await page.keyboard.press("k");
    await browserExpect(page.getByTestId("row-news-n2")).toHaveAttribute("aria-current", "true");

    await page.getByTestId("button-follow-search").click();
    await browserExpect(page.getByTestId("button-follow-search")).toHaveText("Follow this search");
    expect((await calls("DELETE", /^\/api\/searches\/fs1$/))).toHaveLength(1);
    await page.evaluate(() => (window as any).__toasts.at(-1).action.props.onClick());
    await browserExpect(page.getByTestId("button-follow-search")).toHaveText("Following");

    await page.evaluate(() => { (window as any).__results = []; });
    await page.getByTestId("input-inbox-search").fill("nothing matches");
    await page.getByTestId("input-inbox-search").press("Enter");
    await browserExpect(page.getByRole("heading", { name: "No stories match \u201cnothing matches\u201d" })).toBeVisible();
    await browserExpect(page.getByText("Search tips")).toBeVisible();
    await page.getByTestId("button-search-operators").click();
    await browserExpect(page.getByRole("dialog", { name: "Search operators" })).toContainText("newer_than:7d");

    await page.keyboard.press("Escape");
    await page.getByTestId("nav-folder-for-you").click();
    await browserExpect(page.getByTestId("input-inbox-search")).toHaveAttribute("aria-label", "Search your Inbox");
    await browserExpect(page.getByTestId("input-inbox-search")).toHaveValue("");
    expect(await searchUnexpected()).toEqual([]);
  }, 30_000);

  it("works at 390px: list, then reading pane and back, without horizontal scroll", async () => {
    await mount("/dashboard?news=retail", {}, { width: 390, height: 844 });
    await browserExpect(newsRows()).toHaveCount(3);
    await browserExpect(page.getByRole("region", { name: "Reading pane" })).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.getByTestId("row-news-n2").click();
    await browserExpect(page.getByTestId("text-news-headline-n2")).toBeVisible();
    await browserExpect(page.getByRole("region", { name: "News results" })).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.getByRole("button", { name: "Back to results" }).click();
    await browserExpect(newsRows()).toHaveCount(3);

    // The scope switch sits in the suggestions on small screens.
    await page.getByTestId("input-inbox-search").fill("ai chips");
    await browserExpect(page.getByTestId("search-suggestions").getByRole("group", { name: "Search in" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.getByTestId("button-search-news").click();
    await expect.poll(() => page.evaluate(() => location.search)).toBe("?news=ai+chips");
  }, 30_000);

  it("keeps the suggestion clickable when a click does not focus the button (Safari, macOS Firefox)", async () => {
    await mount();
    // Those browsers blur the input to nothing on mousedown instead of focusing the clicked button.
    await page.evaluate(() => window.addEventListener("mousedown", event => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur();
    }));
    const input = page.getByTestId("input-inbox-search");
    await input.fill("ai chips");
    await page.getByTestId("button-search-scope-news").click();
    await browserExpect(input).toBeFocused();
    await browserExpect(page.getByTestId("search-suggestions")).toBeVisible();
    await page.getByTestId("button-search-news").click();
    await expect.poll(() => page.evaluate(() => location.search)).toBe("?news=ai+chips");
  }, 30_000);

  it("acts on the copy already in your Inbox: drafts it without saving again, and moves a dismissed copy to the Shortlist", async () => {
    const dismissed = { ...story("x1", "Retail media pricing explained", "dismissed"), source: "Dismissed Source" };
    const copies = [
      hit("m1", "Retail media budgets climb at retailers", "Ad Brief", {
        alsoCoveredBy: [{ source: "Wire Daily", url: "https://news.test/a1" }], inInbox: { id: "a1", status: "active", url: "https://news.test/a1" },
      }),
      hit("m2", "Retail media pricing, explained", "Data Desk", {
        alsoCoveredBy: [{ source: "Dismissed Source", url: "https://news.test/x1" }], inInbox: { id: "x1", status: "dismissed", url: "https://news.test/x1" },
      }),
    ];
    await mount("/dashboard?news=retail", { __records: [...records, dismissed], __results: copies });
    await browserExpect(newsRows()).toHaveCount(2);

    await page.getByTestId("row-news-m2").click();
    await browserExpect(page.getByText("You marked this story not relevant earlier.")).toBeVisible();
    await page.getByTestId("button-news-save-m2").click();
    await browserExpect(page.getByTestId("text-news-state-m2")).toHaveText("In your Shortlist");
    expect((await calls("POST", /^\/api\/search\/news\/save$/)).map(call => call.body)).toEqual([
      expect.objectContaining({ url: "https://news.test/x1", source: "Dismissed Source", title: "Retail media pricing, explained" }),
    ]);

    await page.getByTestId("row-news-m1").click();
    await browserExpect(page.getByTestId("text-news-state-m1")).toHaveText("In For you");
    await page.getByTestId("button-news-draft-m1").click();
    await browserExpect(page.getByRole("dialog", { name: /Retail media budgets climb at retailers/ })).toBeVisible();
    expect(await calls("POST", /^\/api\/search\/news\/save$/)).toHaveLength(1);
    const stored = await page.evaluate(() => (window as any).__records.map((item: { id: string; status: string }) => `${item.id}:${item.status}`));
    expect(stored).toEqual(["a1:active", "b1:active", "s1:saved", "x1:saved"]);
  }, 30_000);

  it("shows a calm error with a retry when search fails, and keeps Inbox filtering with Esc to clear", async () => {
    await mount("/dashboard?news=retail", { __searchFails: true });
    await browserExpect(page.getByRole("alert")).toContainText("Too many searches. Please wait a minute and try again.");
    await page.evaluate(() => { (window as any).__searchFails = false; });
    await page.getByRole("button", { name: "Try again" }).click();
    await browserExpect(newsRows()).toHaveCount(3);

    await page.getByTestId("button-search-scope-inbox").click();
    const input = page.getByTestId("input-inbox-search");
    await browserExpect(input).toHaveAttribute("aria-label", "Search your Inbox");
    await input.fill("cloud");
    await input.press("Enter");
    await expect.poll(() => page.evaluate(() => location.search)).toBe("");
    await browserExpect(page.getByTestId("row-inbox-b1")).toBeVisible();
    await browserExpect(page.getByTestId("row-inbox-a1")).toHaveCount(0);
    await input.press("Escape");
    await browserExpect(input).toHaveValue("");
    await browserExpect(page.getByTestId("row-inbox-a1")).toBeVisible();
  }, 30_000);
});
