import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { chromium, expect as browserExpect, type Browser, type Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
import postcss from "postcss";
import tailwindcss from "tailwindcss";

// Real views and composer, in-memory query fixtures; no app server or real requests.
const root = path.resolve(import.meta.dirname, "../../..");
const loginTitle = "Log in to Zoho Learn and access your knowledge source.";
const story = (id: string, headline: string, status = "active", summary: string | null = null) => ({
  id, headline, status, summary, source: "Fixture publication", matchedKeywords: [], createdAt: null,
  articleUrl: headline === "littleblackbook.com" ? "https://littleblackbook.com/" : `https://news.test/${id}`,
});
const records = [story("login", loginTitle), story("domain", "littleblackbook.com"),
  story("good", "Authentication and DNS research"), story("saved", loginTitle, "saved"),
  story("dismissed", "littleblackbook.com", "dismissed")];
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
      import Home from "@/pages/overview";
      import Discover from "@/pages/dashboard";
      import { CreatePostProvider } from "@/components/dashboard/create-post-provider";
      import CreatePostPage from "@/pages/create-post";
      import { Route } from "wouter";
      window.__calls = [];
      window.fetch = async (url, options = {}) => {
        window.__calls.push({ url, method: options.method || "GET" });
        let body;
        if (url === "/api/inbox?status=active") body = window.__records.filter(item => item.status === "active").slice(0, 500);
        else if (url === "/api/inbox") body = window.__records.slice(0, 500);
        else if (window.__refreshJob && String(url) === "/api/inbox/refresh/" + window.__refreshJob.jobId) body = window.__refreshJob;
        else if (url === "/api/trends") {
          if (window.__trendError) return new Response("Unavailable", { status: 503 });
          body = window.__trends || [];
        }
        else if (options.method === "PATCH" && String(url).startsWith("/api/inbox/")) {
          const id = String(url).split("/").pop();
          window.__records = window.__records.map(item => item.id === id ? { ...item, ...JSON.parse(options.body) } : item);
          body = window.__records.find(item => item.id === id);
        } else throw new Error("Unexpected request");
        return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
      };
      const data = { "/api/inbox": window.__records.slice(0, 500), "/api/drafts": [],
        "/api/drafts/scheduled": { items: [] }, "/api/me": { firstName: "Reader" },
        "/api/profile": { enabledPlatforms: ["linkedin"], defaultPlatform: "linkedin" }, "/api/integrations": [] };
      for (const [key, value] of Object.entries(data)) queryClient.setQueryData([key], value);
      if (window.__refreshJob) queryClient.setQueryData(["inbox-refresh-job"], window.__refreshJob);
      window.__cachedInbox = () => queryClient.getQueryData(["/api/inbox"]);
      createRoot(document.getElementById("root")).render(
        <QueryClientProvider client={queryClient}><CreatePostProvider>
          {window.__surface === "home" ? <Home /> : <Discover />}
          <Route path="/dashboard/create" component={CreatePostPage} />
        </CreatePostProvider></QueryClientProvider>);
    ` },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"' },
    plugins: [{ name: "mock-auth-and-toasts", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/(auth|dev-auth)$|^@\/hooks\/use-toast$/ }, args => ({ path: args.path, namespace: "mock" }));
      builder.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents: args.path.includes("auth")
        ? 'export const useIsSignedIn = () => window.__signedIn !== false; export const useAuth = () => ({user: {firstName: "Reader"}});'
        : "export const useToast = () => ({toast: () => {}});", loader: "js" }));
    } }],
  });
  bundle = result.outputFiles[0].text;
  css = (await postcss([tailwindcss({ content: [path.join(root, "client/src/**/*.tsx")] })])
    .process("@tailwind base; @tailwind utilities;", { from: undefined })).css;
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterEach(async () => { await page?.close(); });
afterAll(async () => { await browser?.close(); });

async function mount(surface = "discover", items = records, state: Record<string, unknown> = {}) {
  page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  page.setDefaultTimeout(3000);
  await page.route("**/*", route => route.abort());
  // A real origin lets the router navigate to /dashboard/create (about:blank cannot pushState).
  await page.route("https://discover.test/", route => route.fulfill({ contentType: "text/html", body: '<div id="root" style="height:100vh"></div>' }));
  await page.goto("https://discover.test/");
  await page.evaluate(({ surface, items, state }) => Object.assign(window, { __surface: surface, __records: items }, state), { surface, items, state });
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: bundle });
}
const storyRows = () => page.locator('[data-testid^="row-inbox-"]');
async function expectUnchanged(items = records) {
  expect(await page.evaluate(() => (window as any).__cachedInbox())).toEqual(items.slice(0, 500));
  expect(await page.evaluate(() => (window as any).__calls)).toEqual(
    await page.evaluate(() => (window as any).__surface) === "home" ? [] : [{ url: "/api/inbox?status=active", method: "GET" }]);
}

describe("legacy inbox quality UI", () => {
  it("loads trends only when opened and describes admitted-content limitations", async () => {
    await mount("discover", records, { __trends: [{ topic: "ai", count: 3, velocityPercent: null, sourceCount: 1, unknownSourceCount: 2,
      articles: [], coverage: { partial: true, rowLimit: 5000 } }] });
    await browserExpect(storyRows()).toHaveCount(3);
    await expectUnchanged();
    await page.getByRole("button", { name: "Topics in your recent articles" }).click();
    await browserExpect(page.getByText(/New in this window/)).toBeVisible();
    await browserExpect(page.getByText(/Partial coverage: first 5000/)).toBeVisible();
    await browserExpect(page.getByText(/not market trends/)).toBeVisible();
    await browserExpect(page.getByText(/2 unknown origins/)).toBeVisible();
  });

  it("shows empty and signed-out trend states without automatic fetch", async () => {
    await mount();
    await page.getByRole("button", { name: "Topics in your recent articles" }).click();
    await browserExpect(page.getByText("No topics with at least two newly discovered articles yet.")).toBeVisible();
    await page.close();
    await mount("discover", records, { __signedIn: false });
    await browserExpect(page.getByRole("button", { name: "Topics in your recent articles" })).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__calls)).toEqual([]);
  });

  it("shows a recoverable trend failure instead of treating it as no trends", async () => {
    await mount("discover", records, { __trendError: true });
    await page.getByRole("button", { name: "Topics in your recent articles" }).click();
    await browserExpect(page.getByRole("button", { name: "Retry topics" })).toBeVisible();
  });

  it("Home skips bad active entries and recommends the first usable story", async () => {
    await mount("home");
    await browserExpect(page.getByTestId("card-personalized-briefing")).toContainText("Authentication and DNS research");
    await browserExpect(page.getByText(loginTitle, { exact: true })).toHaveCount(0);
    await expectUnchanged();
  });

  it("Home keeps its create fallback when all active entries are hidden", async () => {
    const items = records.filter(item => item.id !== "good");
    await mount("home", items);
    await browserExpect(page.getByTestId("card-personalized-briefing")).toContainText("Start with your own idea or article");
    await expectUnchanged(items);
  });

  it("Discover shows all active legacy rows while saved and dismissed records remain accessible", async () => {
    await mount();
    await browserExpect(page.getByRole("status")).toHaveCount(0);
    await browserExpect(storyRows()).toHaveCount(3);
    await browserExpect(page.getByText(loginTitle, { exact: true }).first()).toBeVisible();
    await page.getByTestId("button-filter-saved").click();
    await browserExpect(page.getByText(loginTitle, { exact: true }).first()).toBeVisible();
    await browserExpect(page.getByRole("status")).toHaveCount(0);
    await page.getByTestId("button-filter-dismissed").click();
    await browserExpect(page.getByText("littleblackbook.com", { exact: true }).first()).toBeVisible();
    await expectUnchanged();
  });

  it("says it is finding stories, not 'click Refresh', while the first refresh runs", async () => {
    await mount("discover", [], { __refreshJob: { status: "active", jobId: "first-refresh", startedAt: Date.now(), progress: { articlesProcessed: 12, articlesMatched: 3, articlesCreated: 0 } } });
    await browserExpect(page.getByRole("heading", { name: "Finding your stories" })).toBeVisible();
    await browserExpect(page.getByRole("heading", { name: "No articles yet" })).toHaveCount(0);
    await browserExpect(page.getByText("Click 'Refresh Articles'", { exact: false })).toHaveCount(0);
  });

  it("keeps a legacy-only active inbox visible with save and dismiss actions", async () => {
    const items = [records[0], records[3]];
    await mount("discover", items);
    await browserExpect(storyRows()).toHaveCount(1);
    await browserExpect(page.getByRole("heading", { name: "No articles yet" })).toHaveCount(0);
    await browserExpect(page.getByRole("button", { name: "Save story", exact: true })).toBeVisible();
    await browserExpect(page.getByRole("button", { name: "Dismiss", exact: true })).toBeVisible();
    await expectUnchanged(items);
  });

  it("fetches active rows beyond 620 historical rows and lets the user dismiss legacy capacity occupants", async () => {
    const items = [...Array.from({ length: 620 }, (_, index) => story(`history-${index}`, `Historical ${index}`, "dismissed")), records[0], records[2]];
    await mount("discover", items);
    await browserExpect(storyRows()).toHaveCount(2);
    await browserExpect(page.getByText(loginTitle, { exact: true }).first()).toBeVisible();
    await expectUnchanged(items);
    await page.getByRole("button", { name: "Dismiss", exact: true }).click();
    await browserExpect(storyRows()).toHaveCount(1);
    await browserExpect(page.getByText(loginTitle, { exact: true })).toHaveCount(0);
    await browserExpect(page.getByText("Authentication and DNS research", { exact: true }).first()).toBeVisible();
    expect(await page.evaluate(() => (window as any).__calls.filter((call: any) => call.method === "PATCH")))
      .toEqual([{ url: "/api/inbox/login", method: "PATCH" }]);
  });

  it("composer excludes low-quality candidates without blocking an explicitly opened saved record", async () => {
    await mount();
    await page.getByTestId("button-filter-saved").click();
    await page.getByTestId("button-generate-saved").click();
    await browserExpect(page.getByLabel("Story", { exact: true })).toHaveValue("saved");
    await browserExpect(page.getByTestId("input-instant-review-url")).toHaveValue("https://news.test/saved");
    expect(await page.getByLabel("Story", { exact: true }).locator("option").allTextContents()).toEqual([
      "Choose a story (no generation yet)", loginTitle, "Authentication and DNS research",
    ]);
    await expectUnchanged();
  });
});