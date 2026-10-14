import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { chromium, expect as browserExpect, type Browser, type Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
import postcss from "postcss";
import tailwindcss from "tailwindcss";

// Real Discover page with in-memory fetch fixtures; no app server or real requests.
const root = path.resolve(import.meta.dirname, "../../..");
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
const story = (id: string, headline: string, extra: Record<string, unknown>) => ({
  id, headline, status: "active", summary: null, source: "Fixture publication", matchedKeywords: [],
  articleUrl: `https://news.test/${id}`, relevanceScore: "0", publishedAt: null, readAt: null, createdAt: hoursAgo(1), ...extra,
});
// Previous visit two days ago: "fresh" is New, "old" predates the visit, "opened" is already read.
const records = [
  story("fresh", "Fresh chip export rules", { createdAt: hoursAgo(1), relevanceScore: "0.2", matchedKeywords: ["chips"], source: "Wire Daily" }),
  story("old", "Older battery supply report", { createdAt: hoursAgo(120), relevanceScore: "0.9", publishedAt: hoursAgo(480), matchedKeywords: ["batteries"] }),
  story("opened", "Opened grid storage analysis", { createdAt: hoursAgo(3), relevanceScore: "0.5", publishedAt: hoursAgo(240), readAt: hoursAgo(2) }),
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
      import Discover from "@/pages/dashboard";
      import { CreatePostProvider } from "@/components/dashboard/create-post-provider";
      window.__calls = [];
      window.fetch = async (url, options = {}) => {
        const method = options.method || "GET";
        window.__calls.push({ url, method });
        let body;
        if (url === "/api/inbox/visit") body = window.__visit;
        else if (url === "/api/inbox?status=active") body = window.__records.filter(item => item.status === "active");
        else if (url === "/api/inbox?limit=200&offset=0") body = window.__records;
        else if (url === "/api/trends") body = [];
        else if (window.__poll && url === "/api/inbox/refresh/" + window.__poll.jobId) {
          body = window.__poll;
          if (window.__poll.status === "completed" && window.__arriving) window.__records = [...window.__arriving, ...window.__records];
        }
        else if (method === "POST" && /^\\/api\\/inbox\\/[^/]+\\/read$/.test(url)) {
          const id = url.split("/")[3];
          const readAt = new Date().toISOString();
          window.__records = window.__records.map(item => item.id === id ? { ...item, readAt: item.readAt || readAt } : item);
          body = { id, readAt };
        } else throw new Error("Unexpected request " + method + " " + url);
        return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
      };
      queryClient.setQueryData(["/api/inbox"], window.__records);
      if (window.__refreshJob) queryClient.setQueryData(["inbox-refresh-job"], window.__refreshJob);
      createRoot(document.getElementById("root")).render(
        <QueryClientProvider client={queryClient}><CreatePostProvider><Discover /></CreatePostProvider></QueryClientProvider>);
    ` },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"' },
    plugins: [{ name: "mock-auth-and-toasts", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/(auth|dev-auth)$|^@\/hooks\/use-toast$/ }, args => ({ path: args.path, namespace: "mock" }));
      builder.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents: args.path.endsWith("dev-auth")
        ? "export const useIsSignedIn = () => true;"
        : args.path.endsWith("/auth")
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

async function mount(state: Record<string, unknown> = {}) {
  page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  page.setDefaultTimeout(4000);
  await page.route("**/*", route => route.abort());
  await page.route("https://discover.test/", route => route.fulfill({ contentType: "text/html", body: '<div id="root" style="height:100vh"></div>' }));
  await page.goto("https://discover.test/");
  await page.evaluate(state => Object.assign(window, {
    __records: state.records, __visit: { previousVisitAt: state.previous, currentVisitAt: new Date().toISOString() },
  }, state.extra), { records, previous: hoursAgo(48), extra: {}, ...state });
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: bundle });
}
const rows = () => page.locator('[data-testid^="row-inbox-"]');
const order = async () => (await rows().evaluateAll(nodes => nodes.map(node => node.getAttribute("data-testid")!.replace("row-inbox-", ""))));
const readCalls = () => page.evaluate(() => (window as any).__calls.filter((call: { url: string }) => call.url.endsWith("/read")));

describe("Discover filters, sort and reading state", () => {
  it("aligns the sort control with the Topics and Filter toolbar controls and wraps on narrow screens", async () => {
    const geometry = () => page.evaluate(() => {
      const box = (selector: string) => { const r = document.querySelector(selector)!.getBoundingClientRect(); return { top: r.top, left: r.left, right: r.right, height: r.height, centre: r.top + r.height / 2 }; };
      const toolbar = document.querySelector('[aria-label="Discover filters"]') as HTMLElement;
      return {
        topics: box('[aria-controls="personal-trends"]'), filter: box('[data-testid="button-discover-filters"]'), sort: box('[data-testid="select-discover-sort"]'),
        fontSizes: ['[aria-controls="personal-trends"]', '[data-testid="select-discover-sort"]'].map(selector => getComputedStyle(document.querySelector(selector)!).fontSize),
        toolbar: { ...box('[aria-label="Discover filters"]'), overflow: toolbar.scrollWidth - toolbar.clientWidth }, documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    await mount();
    await browserExpect(rows()).toHaveCount(3);
    const desktop = await geometry();
    expect(Math.abs(desktop.sort.height - desktop.topics.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(desktop.sort.centre - desktop.topics.centre)).toBeLessThanOrEqual(1);
    expect(Math.abs(desktop.filter.centre - desktop.topics.centre)).toBeLessThanOrEqual(1);
    expect(desktop.sort.left).toBeGreaterThan(desktop.filter.right);
    expect(desktop.fontSizes[1]).toBe(desktop.fontSizes[0]);

    await page.setViewportSize({ width: 375, height: 900 });
    await expect.poll(async () => (await geometry()).sort.top).toBeGreaterThan(desktop.sort.top);
    const narrow = await geometry();
    expect(narrow.toolbar.overflow).toBeLessThanOrEqual(0);
    expect(narrow.documentOverflow).toBeLessThanOrEqual(0);
    for (const control of [narrow.topics, narrow.filter, narrow.sort]) {
      expect(control.left).toBeGreaterThanOrEqual(narrow.toolbar.left);
      expect(control.right).toBeLessThanOrEqual(narrow.toolbar.right);
    }
    expect(Math.abs(narrow.sort.height - narrow.topics.height)).toBeLessThanOrEqual(1);
  });
  it("keeps the filter popover closed, sorts by recently added by default and switches sort", async () => {
    await mount();
    await browserExpect(rows()).toHaveCount(3);
    await browserExpect(page.getByTestId("button-discover-filters")).toHaveAttribute("aria-expanded", "false");
    await browserExpect(page.getByTestId("input-discover-search")).toBeHidden();
    await browserExpect(page.getByTestId("select-discover-sort")).toBeVisible();
    await expect.poll(order).toEqual(["fresh", "opened", "old"]);
    await page.getByTestId("select-discover-sort").selectOption("relevance");
    await expect.poll(order).toEqual(["old", "opened", "fresh"]);
    // Missing publication dates sort last.
    await page.getByTestId("select-discover-sort").selectOption("published");
    await expect.poll(order).toEqual(["opened", "old", "fresh"]);
  });

  it("marks only explicitly opened rows read and removes their New badge", async () => {
    await mount();
    await browserExpect(page.getByTestId("badge-new-fresh")).toBeVisible();
    await browserExpect(page.getByTestId("badge-new-old")).toHaveCount(0);
    await browserExpect(page.getByTestId("badge-new-opened")).toHaveCount(0);
    await browserExpect(page.getByTestId("text-added-fresh")).toHaveText("Added 1h ago");
    // The first row is auto-selected, which must not count as reading it.
    await browserExpect(page.getByTestId("row-inbox-fresh")).toHaveAttribute("aria-current", "true");
    expect(await readCalls()).toEqual([]);
    await page.getByTestId("row-inbox-fresh").click();
    await browserExpect(page.getByTestId("badge-new-fresh")).toHaveCount(0);
    expect(await readCalls()).toEqual([{ url: "/api/inbox/fresh/read", method: "POST" }]);
    await page.getByTestId("row-inbox-fresh").click();
    expect(await readCalls()).toHaveLength(1);
  });

  it("shows no whole-library New on a first visit", async () => {
    await mount({ previous: null });
    await browserExpect(rows()).toHaveCount(3);
    await browserExpect(page.locator('[data-testid^="badge-new-"]')).toHaveCount(0);
  });

  it("filters by search, reading state and source with a matching count and clear action", async () => {
    await mount();
    await page.getByTestId("button-discover-filters").click();
    await page.getByTestId("input-discover-search").fill("battery");
    await expect.poll(order).toEqual(["old"]);
    await browserExpect(page.getByTestId("text-discover-matching")).toHaveText("1 matching article");
    await page.getByTestId("input-discover-search").fill("chips");
    await expect.poll(order).toEqual(["fresh"]);
    await page.getByTestId("button-clear-discover-filters").click();
    await expect.poll(order).toEqual(["fresh", "opened", "old"]);
    // Clear sits outside the popover, so the outside press closes it.
    await page.getByTestId("button-discover-filters").click();
    await page.getByTestId("select-discover-reading").selectOption("read");
    await expect.poll(order).toEqual(["opened"]);
    await page.getByTestId("select-discover-reading").selectOption("all");
    await page.getByTestId("select-discover-source").selectOption("Wire Daily");
    await expect.poll(order).toEqual(["fresh"]);
  });

  it("opens filters in an anchored popover without shifting the page and keeps values when closed", async () => {
    const layout = () => page.evaluate(() => ({
      toolbar: (document.querySelector('[aria-label="Discover filters"]') as HTMLElement).getBoundingClientRect().height,
      list: document.querySelector("[data-discover-panes]")!.getBoundingClientRect().top,
    }));
    const popoverBox = () => page.getByTestId("popover-discover-filters").evaluate(node => {
      const r = node.getBoundingClientRect(); return { top: r.top, left: r.left, right: r.right, bottom: r.bottom, vw: innerWidth, vh: innerHeight };
    });
    await mount();
    await browserExpect(rows()).toHaveCount(3);
    const before = await layout();
    const trigger = page.getByTestId("button-discover-filters");
    await trigger.click();
    await browserExpect(trigger).toHaveAttribute("aria-expanded", "true");
    const popover = page.getByRole("dialog", { name: "Filter articles" });
    await browserExpect(popover).toBeVisible();
    expect(await layout()).toEqual(before);
    // On desktop the popover opens beside the Filter button, inside the viewport.
    const triggerBox = (await trigger.boundingBox())!;
    const desktop = await popoverBox();
    expect(desktop.left).toBeGreaterThanOrEqual(triggerBox.x + triggerBox.width);
    expect(desktop.right).toBeLessThanOrEqual(desktop.vw);
    expect(desktop.bottom).toBeLessThanOrEqual(desktop.vh);

    await page.getByTestId("select-discover-reading").selectOption("unread");
    await page.keyboard.press("Escape");
    await browserExpect(popover).toBeHidden();
    await browserExpect(trigger).toBeFocused();
    await expect.poll(order).toEqual(["fresh", "old"]);
    await browserExpect(page.getByTestId("badge-discover-filter-count")).toHaveText("1");
    await browserExpect(page.getByTestId("text-discover-matching")).toHaveText("2 matching articles");
    await browserExpect(page.getByTestId("button-clear-discover-filters")).toBeVisible();
    // Only the persistent matching row is added to the page; the popover itself never takes space.
    const filtered = await layout();

    await trigger.click();
    await browserExpect(page.getByTestId("select-discover-reading")).toHaveValue("unread");
    expect(await layout()).toEqual(filtered);
    await page.getByText("Library", { exact: true }).click();
    await browserExpect(popover).toBeHidden();
    expect(await layout()).toEqual(filtered);

    await page.setViewportSize({ width: 375, height: 700 });
    await trigger.click();
    await browserExpect(popover).toBeVisible();
    const mobile = await popoverBox();
    expect(mobile.left).toBeGreaterThanOrEqual(0);
    expect(mobile.right).toBeLessThanOrEqual(mobile.vw);
    expect(mobile.top).toBeGreaterThanOrEqual(0);
    expect(mobile.bottom).toBeLessThanOrEqual(mobile.vh);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
   }, 15_000);

  it("keeps a story opened under Unread visible while it is being read", async () => {
    await mount();
    await page.getByTestId("button-discover-filters").click();
    await page.getByTestId("select-discover-reading").selectOption("unread");
    await expect.poll(order).toEqual(["fresh", "old"]);
    await page.getByTestId("row-inbox-old").click();
    await expect.poll(readCalls).toEqual([{ url: "/api/inbox/old/read", method: "POST" }]);
    await expect.poll(order).toEqual(["fresh", "old"]);
    await browserExpect(page.getByTestId("row-inbox-old")).toHaveAttribute("aria-current", "true");
  });

  it("keeps the current story after a refresh and offers the new articles", async () => {
    const arriving = [story("arrived", "Arrived after refresh", { createdAt: new Date().toISOString(), relevanceScore: "0.1" })];
    await mount({ extra: {
      __refreshJob: { status: "active", jobId: "job-1", startedAt: Date.now(), progress: { articlesProcessed: 1, articlesMatched: 1, articlesCreated: 0 } },
      __poll: { jobId: "job-1", status: "completed", progress: { articlesProcessed: 4, articlesMatched: 1, articlesCreated: 1 } },
      __arriving: arriving,
    } });
    await page.getByTestId("row-inbox-old").click();
    await page.getByTestId("select-discover-sort").selectOption("relevance");
    await browserExpect(page.getByTestId("button-show-new-articles")).toBeVisible({ timeout: 6000 });
    await browserExpect(page.getByText("1 new articles added", { exact: false })).toBeVisible();
    await browserExpect(page.getByTestId("row-inbox-arrived")).toBeVisible();
    await browserExpect(page.getByTestId("badge-new-arrived")).toBeVisible();
    // Refresh does not reset the reading selection or sort.
    await browserExpect(page.getByTestId("row-inbox-old")).toHaveAttribute("aria-current", "true");
    await expect.poll(order).toEqual(["old", "opened", "fresh", "arrived"]);
    await page.getByTestId("button-show-new-articles").click();
    await expect.poll(async () => (await order())[0]).toBe("arrived");
    await browserExpect(page.getByTestId("row-inbox-old")).toHaveAttribute("aria-current", "true");
  });
});
