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
      window.__calls = [];
      window.fetch = async (...args) => { window.__calls.push(args); throw new Error("Unexpected request"); };
      const data = { "/api/inbox": window.__records, "/api/drafts": [],
        "/api/drafts/scheduled": { items: [] }, "/api/me": { firstName: "Reader" },
        "/api/profile": { enabledPlatforms: ["linkedin"], defaultPlatform: "linkedin" }, "/api/integrations": [] };
      for (const [key, value] of Object.entries(data)) queryClient.setQueryData([key], value);
      window.__cachedInbox = () => queryClient.getQueryData(["/api/inbox"]);
      createRoot(document.getElementById("root")).render(
        <QueryClientProvider client={queryClient}><CreatePostProvider>
          {window.__surface === "home" ? <Home /> : <Discover />}
        </CreatePostProvider></QueryClientProvider>);
    ` },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"' },
    plugins: [{ name: "mock-auth-and-toasts", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/(auth|dev-auth)$|^@\/hooks\/use-toast$/ }, args => ({ path: args.path, namespace: "mock" }));
      builder.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents: args.path.includes("auth")
        ? 'export const useIsSignedIn = () => true; export const useAuth = () => ({user: {firstName: "Reader"}});'
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

async function mount(surface = "discover", items = records) {
  page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  page.setDefaultTimeout(3000);
  await page.route("**/*", route => route.abort());
  await page.setContent('<div id="root" style="height:100vh"></div>');
  await page.evaluate(({ surface, items }) => Object.assign(window, { __surface: surface, __records: items }), { surface, items });
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: bundle });
}
async function expectUnchanged(items = records) {
  expect(await page.evaluate(() => (window as any).__cachedInbox())).toEqual(items);
  expect(await page.evaluate(() => (window as any).__calls)).toEqual([]);
}

describe("legacy inbox quality UI", () => {
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

  it("Discover counts only usable candidates while saved and dismissed records remain accessible", async () => {
    await mount();
    await browserExpect(page.getByRole("status")).toContainText("2 unavailable or low-quality stories hidden");
    await browserExpect(page.getByRole("status")).toContainText("Saved stories are still accessible in Saved");
    await browserExpect(page.getByText("1 active", { exact: true })).toBeVisible();
    await browserExpect(page.getByText(loginTitle, { exact: true })).toHaveCount(0);
    await page.getByTestId("button-filter-saved").click();
    await browserExpect(page.getByText(loginTitle, { exact: true }).first()).toBeVisible();
    await browserExpect(page.getByRole("status")).toHaveCount(0);
    await page.getByTestId("button-filter-dismissed").click();
    await browserExpect(page.getByText("littleblackbook.com", { exact: true }).first()).toBeVisible();
    await expectUnchanged();
  });

  it("explains an all-hidden active view, including the singular count", async () => {
    const items = [records[0], records[3]];
    await mount("discover", items);
    await browserExpect(page.getByRole("status")).toContainText("1 unavailable or low-quality story hidden");
    await browserExpect(page.getByText("0 active", { exact: true })).toBeVisible();
    await browserExpect(page.getByRole("heading", { name: "No articles yet" })).toBeVisible();
    await expectUnchanged(items);
  });

  it("composer excludes low-quality candidates without blocking an explicitly opened saved record", async () => {
    await mount();
    await page.getByTestId("button-instant-review").click();
    await page.getByLabel("Source type").selectOption("article");
    expect(await page.getByLabel("Story", { exact: true }).locator("option").allTextContents()).toEqual([
      "Choose a story (no generation yet)", "Authentication and DNS research",
    ]);
    await page.keyboard.press("Escape");
    await browserExpect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByTestId("button-filter-saved").click();
    await page.getByTestId("button-generate-saved").click();
    await browserExpect(page.getByLabel("Story", { exact: true })).toHaveValue("saved");
    await browserExpect(page.getByTestId("input-instant-review-url")).toHaveValue("https://news.test/saved");
    await expectUnchanged();
  });
});