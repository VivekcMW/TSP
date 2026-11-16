import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { chromium, expect as browserExpect, type Browser, type Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
import postcss from "postcss";
import tailwindcss from "tailwindcss";

// Real Inbox shell + page with in-memory fetch fixtures; no app server or real requests.
const root = path.resolve(import.meta.dirname, "../../..");
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
const story = (id: string, source: string, score: number, extra: Record<string, unknown> = {}) => ({
  id, headline: `${id} headline`, status: "active", summary: `${id} summary`, source, matchedKeywords: [], articleUrl: `https://news.test/${id}`,
  relevanceScore: String(score), rankingScore: String(score), publishedAt: null, readAt: hoursAgo(5), createdAt: hoursAgo(score * 10), ...extra,
});
const records = [
  story("a1", "Wire Daily", 0.9, { readAt: null, matchedKeywords: ["Retail media"], createdAt: hoursAgo(1) }),
  story("a2", "Wire Daily", 0.8),
  story("b1", "Ad Brief", 0.7, { readAt: null }),
  story("c1", "Commerce Report", 0.6),
  story("d1", "Data Desk", 0.5),
  story("e1", "Extra Wire", 0.4),
  story("f1", "Final Note", 0.3),
  story("s1", "Saved Source", 0.5, { status: "saved" }),
  story("x1", "Dismissed Source", 0.5, { status: "dismissed" }),
];
const trend = {
  topic: "incrementality", count: 7, previousCount: 4, delta: 3, velocityPercent: 75, label: "continuing", sourceCount: 5, unknownSourceCount: 0,
  articles: [{ title: "Incrementality explained", source: "Ad Brief", link: "https://news.test/b1" }],
  windowStart: hoursAgo(168), windowEnd: hoursAgo(0), previousWindowStart: hoursAgo(336), timeBasis: "discoveredAt",
  coverage: { basis: "admitted-content", allStatuses: true, partial: false, rowLimit: 5000, rowsExamined: 9 },
};
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
      window.__calls = []; window.__toasts = [];
      const json = body => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
      window.fetch = async (url, options = {}) => {
        const method = options.method || "GET";
        const body = options.body ? JSON.parse(options.body) : undefined;
        window.__calls.push({ url, method, body });
        const byStatus = status => window.__records.filter(item => item.status === status);
        if (url === "/api/me") return json({ id: "user", firstName: "Reader", lastName: "One", email: "reader@test" });
        if (url === "/api/profile") return json({ userId: "user", tenantId: "tenant", focusDescription: "I advise D2C brands on retail media.", keywords: [{ keyword: "Retail media", weight: 0.9 }] });
        if (url === "/api/integrations/linkedin/status") return json({ provider: "linkedin", connected: true, assessment: { canPublish: true, status: "connected" } });
        if (url === "/api/trends") return json([window.__trend]);
        if (url === "/api/inbox/visit") return json({ previousVisitAt: window.__previous, currentVisitAt: new Date().toISOString() });
        if (url === "/api/inbox?status=active") return json(byStatus("active"));
        const page = url.match(/^\\/api\\/inbox\\?status=(saved|dismissed)&limit=200&offset=0$/);
        if (page) return json(byStatus(page[1]));
        const read = url.match(/^\\/api\\/inbox\\/([^/]+)\\/read$/);
        if (method === "POST" && read) {
          window.__records = window.__records.map(item => item.id === read[1] ? { ...item, readAt: item.readAt || new Date().toISOString() } : item);
          return json({ id: read[1], readAt: new Date().toISOString() });
        }
        const patch = url.match(/^\\/api\\/inbox\\/([^/]+)$/);
        if (method === "PATCH" && patch) {
          if (window.__capacityFull && body.status === "active") return new Response(JSON.stringify({ message: "For you is full. Dismiss a story first." }), { status: 409, headers: { "Content-Type": "application/json" } });
          window.__records = window.__records.map(item => item.id === patch[1] ? { ...item, status: body.status } : item);
          return json(window.__records.find(item => item.id === patch[1]));
        }
        throw new Error("Unexpected request " + method + " " + url);
      };
      createRoot(document.getElementById("root")).render(
        <QueryClientProvider client={queryClient}><AppTourProvider scope={null} enabled={false}><HelpProvider><CreatePostProvider>
          <InboxShell><InboxPage /></InboxShell>
        </CreatePostProvider></HelpProvider></AppTourProvider></QueryClientProvider>);
    ` },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"' },
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
}, 60_000);
afterEach(async () => { await page?.close(); });
afterAll(async () => { await browser?.close(); });

async function mount(url = "/dashboard", state: Record<string, unknown> = {}, viewport = { width: 1440, height: 900 }) {
  page = await browser.newPage({ viewport });
  page.setDefaultTimeout(4000);
  await page.route("**/*", route => route.abort());
  await page.route("https://inbox.test/**", route => route.fulfill({ contentType: "text/html", body: '<div id="root" style="height:100vh"></div>' }));
  await page.goto(`https://inbox.test${url}`);
  await page.evaluate(state => Object.assign(window, { __records: state.records, __trend: state.trend, __previous: state.previous }, state.extra),
    { records, trend, previous: hoursAgo(3), extra: {}, ...state });
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: bundle });
}
const rows = () => page.locator('[data-testid^="row-inbox-"]');
const order = () => rows().evaluateAll(nodes => nodes.map(node => node.getAttribute("data-testid")!.replace("row-inbox-", "")));
type Call = { url: string; method: string; body: { status?: string } | undefined };
const calls = (method: string, pattern: RegExp): Promise<Call[]> => page.evaluate(([method, source]) => (window as any).__calls
  .filter((call: Call) => call.method === method && new RegExp(source).test(call.url)), [method, pattern.source] as const);

describe("Gmail-style LinkedIn Inbox", () => {
  it("shows folders, unread counts, the posting status and source-diverse Top picks without marking anything read", async () => {
    await mount();
    await browserExpect(rows()).toHaveCount(5);
    expect(await order()).toEqual(["a1", "b1", "c1", "d1", "e1"]);
    await browserExpect(page.getByTestId("nav-folder-for-you")).toContainText("2");
    await browserExpect(page.getByTestId("nav-folder-shortlist")).toContainText("1");
    await browserExpect(page.getByTestId("button-linkedin-status")).toHaveText("Posting to LinkedIn");
    await browserExpect(page.getByTestId("text-headline-a1")).toBeVisible();
    await browserExpect(page.locator('[data-testid="row-inbox-a1"]')).toHaveAttribute("aria-current", "true");
    expect(await calls("POST", /\/read$/)).toEqual([]);
    await browserExpect(page.getByRole("link", { name: "Retail media" })).toBeVisible();
  });

  it("marks explicit opens and j/k navigation read, and r opens Create for the selected story", async () => {
    await mount();
    await page.getByTestId("row-inbox-b1").click();
    await browserExpect(page.getByTestId("text-headline-b1")).toBeVisible();
    await page.keyboard.press("k");
    await browserExpect(page.getByTestId("text-headline-a1")).toBeVisible();
    await browserExpect(page.getByTestId("row-inbox-a1")).toBeFocused();
    await page.keyboard.press("j");
    await page.keyboard.press("j");
    await browserExpect(page.getByTestId("text-headline-c1")).toBeVisible();
    // c1 was already read: navigation never repeats a read for it.
    expect((await calls("POST", /\/read$/)).map(call => call.url)).toEqual(["/api/inbox/b1/read", "/api/inbox/a1/read"]);
    await page.keyboard.press("r");
    await expect.poll(() => page.evaluate(() => location.pathname)).toBe("/dashboard/create");
  });

  it("saves, dismisses and undoes from the keyboard and bulk selection", async () => {
    await mount("/dashboard?tab=stories");
    await browserExpect(rows()).toHaveCount(7);
    await page.getByTestId("row-inbox-b1").click();
    await page.keyboard.press("s");
    await browserExpect(page.getByTestId("row-inbox-b1")).toHaveCount(0);
    await browserExpect(page.getByTestId("nav-folder-shortlist")).toContainText("2");
    const toast = await page.evaluate(() => (window as any).__toasts.at(-1).title);
    expect(toast).toBe("Saved to Shortlist");
    await page.evaluate(() => (window as any).__toasts.at(-1).action.props.onClick());
    await browserExpect(page.getByTestId("row-inbox-b1")).toHaveCount(1);
    expect((await calls("PATCH", /\/api\/inbox\/b1$/)).map(call => call.body?.status)).toEqual(["saved", "active"]);

    await page.getByRole("checkbox", { name: "Select c1 headline" }).click();
    await page.getByRole("checkbox", { name: "Select d1 headline" }).click();
    await page.getByRole("button", { name: "Mark selected not relevant" }).click();
    await browserExpect(rows()).toHaveCount(5);
    expect(await page.evaluate(() => (window as any).__toasts.at(-1).title)).toBe("Marked not relevant: 2 stories");
  });

  it("filters by label and search, and restores from Not relevant with a clear capacity error", async () => {
    await mount("/dashboard?tab=stories");
    await page.getByRole("link", { name: "Retail media" }).click();
    expect(await order()).toEqual(["a1"]);
    await page.getByRole("button", { name: "Clear label filter" }).click();
    await page.getByTestId("input-inbox-search").fill("Commerce");
    expect(await order()).toEqual(["c1"]);
    await page.getByTestId("input-inbox-search").fill("");

    await page.evaluate(() => { (window as any).__capacityFull = true; });
    await page.getByTestId("nav-folder-not-relevant").click();
    await expect.poll(order).toEqual(["x1"]);
    await page.getByTestId("row-inbox-x1").click();
    await page.getByRole("button", { name: "Move to For you" }).last().click();
    await expect.poll(() => page.evaluate(() => (window as any).__toasts.at(-1)?.description)).toBe("For you is full. Dismiss a story first.");
    expect(await order()).toEqual(["x1"]);
  });

  it("keeps Undo for stories that moved when a later move in a bulk action fails", async () => {
    await mount("/dashboard?folder=dismissed", { records: [...records, story("x2", "Second Dismissed", 0.4, { status: "dismissed" })] });
    await expect.poll(order).toEqual(["x2", "x1"]);
    await page.evaluate(() => {
      const original = window.fetch;
      let moves = 0;
      window.fetch = async (url, options = {}) => options.method === "PATCH" && ++moves === 2
        ? new Response(JSON.stringify({ message: "For you is full. Dismiss a story first." }), { status: 409, headers: { "Content-Type": "application/json" } })
        : original(url, options);
    });
    await page.getByRole("checkbox", { name: "Select all" }).click();
    await page.getByRole("button", { name: "Move selected to For you" }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__toasts.at(-1)?.title)).toBe("Moved 1 of 2");
    expect(await page.evaluate(() => Boolean((window as any).__toasts.at(-1).action))).toBe(true);
  });

  it("opens the Inbox shortcut list on ? instead of the Help panel", async () => {
    await mount();
    await browserExpect(rows()).toHaveCount(5);
    await page.getByRole("tab", { name: "Stories" }).click();
    await page.keyboard.press("?");
    await browserExpect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
    await browserExpect(page.getByTestId("help-panel")).toHaveCount(0);
  });

  it("explains Signals as counts from the user's sources, not LinkedIn trends", async () => {
    await mount("/dashboard?tab=signals");
    await browserExpect(page.getByTestId("row-signal-incrementality")).toBeVisible();
    await browserExpect(page.getByRole("heading", { name: "incrementality" })).toBeVisible();
    await browserExpect(page.getByText("This is not a LinkedIn trend or engagement measure.", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Show matching stories" }).click();
    await expect.poll(() => page.evaluate(() => location.search)).toBe("?tab=stories&label=incrementality");
  });

  it("uses list-then-reading navigation on narrow screens", async () => {
    await mount("/dashboard", {}, { width: 390, height: 844 });
    await browserExpect(page.getByLabel("Reading pane")).toBeHidden();
    await page.getByTestId("row-inbox-a1").click();
    await browserExpect(page.getByTestId("text-headline-a1")).toBeVisible();
    await browserExpect(rows().first()).toBeHidden();
    await page.getByRole("button", { name: "Back to list" }).click();
    await browserExpect(rows().first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });
});
