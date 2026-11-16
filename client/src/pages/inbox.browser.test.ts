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
        if (url === "/api/profile") return json({ userId: "user", tenantId: "tenant", focusDescription: "I advise D2C brands on retail media.", keywords: [{ keyword: "Retail media", weight: 0.9 }], requirePublishReview: true, defaultTone: "professional" });
        if (url === "/api/integrations/linkedin/status") return json(window.__linkedin ?? { provider: "linkedin", connected: true, assessment: { canPublish: true, status: "connected" } });
        if (method === "POST" && /^\\/api\\/instant-review\\/(manual|selected)$/.test(url)) return json({ posts: { linkedin: { [body.tones[0]]: "Generated LinkedIn post about " + (body.title || body.url) } } });
        const draftId = url.match(/^\\/api\\/drafts\\/([^/?]+)/)?.[1];
        const stamp = () => new Date(Date.now() + (window.__tick = (window.__tick || 0) + 1)).toISOString();
        if (method === "GET" && url.startsWith("/api/drafts?")) return json(window.__drafts ?? []);
        if (method === "GET" && url.startsWith("/api/drafts/scheduled?")) { const items = window.__schedules ?? []; return json({ items, total: items.length }); }
        if (method === "POST" && url === "/api/drafts") { window.__draft = { id: "d" + window.__calls.length, content: body.content, updatedAt: stamp() }; return json(window.__draft); }
        if (method === "PATCH" && draftId) { window.__draft = { ...window.__draft, id: draftId, content: body.content, updatedAt: stamp() }; return json(window.__draft); }
        if (method === "POST" && /\\/approve-publishing$/.test(url)) { window.__draft = { ...window.__draft, updatedAt: stamp() }; return json(window.__draft); }
        if (method === "POST" && /\\/publish-now$/.test(url) && window.__publishStatus) return new Response(JSON.stringify({ message: "Queue unavailable. Scheduled work remains saved." }), { status: window.__publishStatus, headers: { "Content-Type": "application/json" } });
        if (method === "POST" && /\\/publish-now$/.test(url)) return json({ jobIds: [], results: [{ platform: "linkedin", status: "simulated" }], status: "completed" });
        if (/\\/schedule$/.test(url) && (method === "POST" || method === "DELETE")) {
          if (method === "DELETE" && window.__drafts) {
            window.__drafts = window.__drafts.map(item => item.id === draftId ? { ...item, publishStatus: "draft" } : item);
            window.__schedules = window.__schedules.map(item => item.draftId === draftId ? { ...item, status: "cancelled", targets: item.targets.map(target => ({ ...target, status: "cancelled" })) } : item);
          }
          return json({ success: true });
        }
        if (method === "DELETE" && draftId) { window.__drafts = window.__drafts?.filter(item => item.id !== draftId); return json({ success: true }); }
        if (url === "/api/notes" && method === "GET") return json(window.__notes ?? []);
        if (url === "/api/notes" && method === "POST") {
          const note = { id: "n" + window.__calls.length, text: body.text, createdAt: stamp(), updatedAt: stamp() };
          window.__notes = [note, ...(window.__notes ?? [])];
          return json(note);
        }
        const noteId = url.match(/^\\/api\\/notes\\/([^/]+)$/)?.[1];
        if (noteId && method === "PATCH") { window.__notes = window.__notes.map(note => note.id === noteId ? { ...note, text: body.text } : note); return json(window.__notes.find(note => note.id === noteId)); }
        if (noteId && method === "DELETE") { window.__notes = window.__notes.filter(note => note.id !== noteId); return json({ success: true }); }
        if (url === "/api/trends") return json([window.__trend]);
        if (url === "/api/inbox/visit") return json({ previousVisitAt: window.__previous, currentVisitAt: new Date().toISOString() });
        const snoozedNow = item => Boolean(item.snoozedUntil) && new Date(item.snoozedUntil) > new Date();
        if (url === "/api/inbox?status=active") return json(byStatus("active").filter(item => !snoozedNow(item)));
        if (url === "/api/inbox?status=active&snoozed=only") return json(byStatus("active").filter(snoozedNow));
        const page = url.match(/^\\/api\\/inbox\\?status=(saved|dismissed)&limit=200&offset=0$/);
        if (page) return json(byStatus(page[1]));
        const snooze = url.match(/^\\/api\\/inbox\\/([^/]+)\\/snooze$/);
        if (snooze && (method === "POST" || method === "DELETE")) {
          window.__records = window.__records.map(item => item.id === snooze[1] ? { ...item, snoozedUntil: method === "POST" ? body.until : null } : item);
          return json(window.__records.find(item => item.id === snooze[1]));
        }
        const read = url.match(/^\\/api\\/inbox\\/([^/]+)\\/read$/);
        if (method === "DELETE" && read) {
          window.__records = window.__records.map(item => item.id === read[1] ? { ...item, readAt: null } : item);
          return json({ id: read[1], readAt: null });
        }
        if (method === "POST" && read) {
          window.__records = window.__records.map(item => item.id === read[1] ? { ...item, readAt: item.readAt || new Date().toISOString() } : item);
          return json({ id: read[1], readAt: new Date().toISOString() });
        }
        const patch = url.match(/^\\/api\\/inbox\\/([^/]+)$/);
        if (method === "PATCH" && patch) {
          if (window.__capacityFull && body.status === "active") return new Response(JSON.stringify({ message: "For you is full. Dismiss a story first." }), { status: 409, headers: { "Content-Type": "application/json" } });
          window.__records = window.__records.map(item => item.id === patch[1] ? { ...item, status: body.status, snoozedUntil: item.status === body.status ? item.snoozedUntil : null } : item);
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

  it("marks explicit opens and j/k navigation read, and r opens Draft my take beside the story", async () => {
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
    await browserExpect(page.getByTestId("compose-inline")).toBeVisible();
    await page.waitForTimeout(100);
    await browserExpect(page.getByTestId("compose-body")).toBeFocused();
    expect(await page.evaluate(() => location.pathname)).toBe("/dashboard");
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
    // Row tools never cover the row on narrow screens: a read story (widest toolbar) still opens on tap.
    await page.getByTestId("row-inbox-c1").hover();
    await browserExpect(page.getByRole("button", { name: "Draft my take on c1 headline" })).toBeHidden();
    await page.getByTestId("row-inbox-c1").click();
    await browserExpect(page.getByTestId("text-headline-c1")).toBeVisible();
    await page.getByRole("button", { name: "Back to list" }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });
});

describe("LinkedIn composer and one-click posting", () => {
  const drafted = async (text = "My view: compare definitions before results.") => {
    await page.getByTestId("button-generate-a1").click();
    await page.getByTestId("compose-body").fill(text);
  };
  const posts = () => calls("POST", /\/publish-now$/);

  it("posts in one click after an undo window, and Undo sends nothing", async () => {
    await mount();
    await drafted();
    await page.getByTestId("button-compose-post").click();
    await browserExpect(page.getByTestId("pending-post")).toContainText("Posting to LinkedIn in 10s");
    await browserExpect(page.getByTestId("compose-inline")).toHaveCount(0);
    expect((await calls("POST", /^\/api\/drafts$/)).length).toBe(1);
    await page.getByTestId("pending-post").getByRole("button", { name: "Undo" }).click();
    await browserExpect(page.getByTestId("compose-body")).toHaveValue("My view: compare definitions before results.");
    expect(await posts()).toEqual([]);
    expect(await calls("POST", /approve-publishing$/)).toEqual([]);

    await page.getByTestId("button-compose-post").click();
    await page.getByTestId("pending-post").getByRole("button", { name: "Post now" }).click();
    await expect.poll(async () => (await posts()).length).toBe(1);
    const [approve] = await calls("POST", /approve-publishing$/);
    expect(approve.body).toMatchObject({ content: "My view: compare definitions before results." });
    expect((await posts())[0].body).toMatchObject({ consent: { expectedContent: "My view: compare definitions before results.", expectedSchedule: null } });
    await expect.poll(() => page.evaluate(() => (window as any).__toasts.at(-1)?.title)).toBe("Simulated — nothing was posted");
  });

  it("sends automatically when the undo window ends", async () => {
    await mount("/dashboard", { extra: {} });
    await page.evaluate(() => localStorage.setItem("tsp:post-undo-seconds", "5"));
    await page.reload();
    await page.evaluate(state => Object.assign(window, state), { __records: records, __trend: trend, __previous: hoursAgo(3) });
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: bundle });
    await drafted();
    await page.getByTestId("button-compose-post").click();
    await browserExpect(page.getByTestId("pending-post")).toContainText("in 5s");
    await expect.poll(async () => (await posts()).length, { timeout: 8000 }).toBe(1);
    await browserExpect(page.getByTestId("pending-post")).toHaveCount(0);
  }, 20_000);

  it("schedules for LinkedIn only and can undo the schedule", async () => {
    await mount();
    await drafted();
    await page.getByRole("button", { name: "Schedule options" }).click();
    await page.getByRole("menuitem", { name: /Tomorrow morning/ }).click();
    await expect.poll(async () => (await calls("POST", /\/schedule$/)).length).toBe(1);
    const [scheduled] = await calls("POST", /\/schedule$/);
    expect(scheduled.body).toMatchObject({ platforms: ["linkedin"], consent: { expectedSchedule: null } });
    expect(new Date((scheduled.body as unknown as { publishAt: string }).publishAt).getHours()).toBe(9);
    await page.evaluate(() => (window as any).__toasts.at(-1).action.props.onClick());
    await expect.poll(async () => (await calls("DELETE", /\/schedule$/)).length).toBe(1);
    expect(await posts()).toEqual([]);
  });

  it("asks to connect LinkedIn instead of posting, keeping the draft", async () => {
    await mount("/dashboard", { extra: { __linkedin: { provider: "linkedin", connected: false } } });
    await drafted();
    await browserExpect(page.getByTestId("button-compose-post")).toHaveText("Connect LinkedIn");
    await page.getByTestId("button-compose-post").click();
    await browserExpect(page.getByTestId("panel-connector-linkedin")).toBeVisible();
    await expect.poll(async () => (await calls("POST", /^\/api\/drafts$/)).length).toBe(1);
    expect(await posts()).toEqual([]);
    await browserExpect(page.getByTestId("pending-post")).toHaveCount(0);
  });

  it("composes from an idea with Help me write, blocking blank and over-limit posts", async () => {
    await mount();
    await page.getByTestId("button-inbox-compose").click();
    const window_ = page.getByTestId("compose-float");
    await browserExpect(window_).toBeVisible();
    await browserExpect(window_.getByTestId("button-compose-post")).toBeDisabled();
    await window_.getByTestId("button-help-me-write").click();
    await browserExpect(window_.getByText("Describe your idea in at least 20 characters", { exact: false })).toBeVisible();
    await window_.getByRole("textbox", { name: "Your take" }).fill("Most dashboards compare different definitions of success.");
    await window_.getByTestId("button-help-me-write").click();
    await browserExpect(window_.getByTestId("compose-body")).toHaveValue(/^Generated LinkedIn post/);
    const [generation] = await calls("POST", /instant-review\/manual$/);
    expect(generation.body).toMatchObject({ selectedPlatforms: ["linkedin"], format: "short-post", tones: ["thoughtLeader"] });
    await window_.getByTestId("compose-body").fill("x".repeat(3001));
    await browserExpect(window_.getByTestId("button-compose-post")).toBeDisabled();
    await window_.getByRole("button", { name: "Restore previous text" }).count();
  });
});

describe("Composer safety regressions", () => {
  const posts = () => calls("POST", /\/publish-now$/);

  it("never lets two Post clicks become pending at once", async () => {
    await mount();
    await page.getByTestId("button-generate-a1").click();
    await page.getByTestId("compose-inline").getByTestId("compose-body").fill("Inline post text");
    await page.getByTestId("button-inbox-compose").click();
    await page.getByTestId("compose-float").getByTestId("compose-body").fill("Float post text");
    await page.evaluate(() => document.querySelectorAll<HTMLButtonElement>('[data-testid="button-compose-post"]').forEach(button => button.click()));
    await browserExpect(page.getByTestId("pending-post")).toHaveCount(1);
    await browserExpect(page.getByText("Another post is waiting to send.", { exact: false })).toBeVisible();
    await page.getByTestId("pending-post").getByRole("button", { name: "Post now" }).click();
    await expect.poll(async () => (await posts()).length).toBe(1);
    await page.waitForTimeout(1500);
    expect((await posts()).length).toBe(1);
  });

  it("reports an ambiguous publish failure as unconfirmed and does not reopen an editable draft", async () => {
    await mount("/dashboard", { extra: { __publishStatus: 503 } });
    await page.getByTestId("button-generate-a1").click();
    await page.getByTestId("compose-body").fill("Ambiguous delivery text");
    await page.getByTestId("button-compose-post").click();
    await page.getByTestId("pending-post").getByRole("button", { name: "Post now" }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__toasts.at(-1)?.title)).toBe("Delivery not confirmed");
    await browserExpect(page.locator('[data-testid^="compose-"]').filter({ has: page.getByTestId("compose-body") })).toHaveCount(0);
  });

  it("opens the LinkedIn connection from an empty composer", async () => {
    await mount("/dashboard", { extra: { __linkedin: { provider: "linkedin", connected: false } } });
    await page.getByTestId("button-inbox-compose").click();
    await page.getByTestId("compose-float").getByTestId("button-compose-post").click();
    await browserExpect(page.getByTestId("panel-connector-linkedin")).toBeVisible();
    expect(await calls("POST", /^\/api\/drafts$/)).toEqual([]);
  });

  it("keeps j/k navigation out of an existing inline draft and Esc in a menu leaves the window open", async () => {
    await mount();
    await page.getByTestId("button-generate-a1").click();
    await page.getByTestId("compose-body").fill("Existing draft");
    await page.getByTestId("row-inbox-b1").click();
    await page.keyboard.press("k");
    await browserExpect(page.getByTestId("compose-body")).toHaveValue("Existing draft");
    await page.keyboard.press("j");
    await browserExpect(page.getByTestId("text-headline-b1")).toBeVisible();
    await page.keyboard.press("k");
    await browserExpect(page.getByTestId("compose-body")).toHaveValue("Existing draft");

    await page.getByTestId("button-inbox-compose").click();
    const window_ = page.getByTestId("compose-float");
    await window_.getByRole("button", { name: "Thought Leader" }).click();
    await page.keyboard.press("Escape");
    await browserExpect(window_.getByTestId("compose-body")).toBeVisible();
  });
});

describe("Snooze, mark unread and Notes", () => {
  const lastToast = () => page.evaluate(() => (window as any).__toasts.at(-1)?.title);

  it("snoozes from the reading pane or b with Undo, then unsnoozes from Snoozed", async () => {
    await mount("/dashboard?tab=stories");
    await page.getByTestId("row-inbox-b1").click();
    await page.getByLabel("Story actions").getByRole("button", { name: "Snooze" }).click();
    await page.getByTestId("snooze-tomorrow").click();
    await browserExpect(page.getByTestId("row-inbox-b1")).toHaveCount(0);
    const [snoozed] = await calls("POST", /\/api\/inbox\/b1\/snooze$/);
    const until = new Date((snoozed.body as unknown as { until: string }).until);
    expect([until.getHours(), until.getMinutes()]).toEqual([8, 0]);
    expect(await lastToast()).toBe("Snoozed until Tomorrow, 8:00 AM");
    await page.evaluate(() => (window as any).__toasts.at(-1).action.props.onClick());
    await browserExpect(page.getByTestId("row-inbox-b1")).toHaveCount(1);
    expect((await calls("DELETE", /\/api\/inbox\/b1\/snooze$/)).length).toBe(1);

    await page.getByTestId("row-inbox-c1").click();
    await page.keyboard.press("b");
    await page.getByTestId("snooze-tomorrow").click();
    await browserExpect(page.getByTestId("row-inbox-c1")).toHaveCount(0);

    await page.getByTestId("nav-folder-snoozed").click();
    await expect.poll(order).toEqual(["c1"]);
    await browserExpect(page.getByTestId("row-inbox-c1")).toContainText("Tomorrow, 8:00 AM");
    await page.getByTestId("row-inbox-c1").click();
    await page.getByTestId("button-unsnooze").click();
    await browserExpect(page.getByTestId("row-inbox-c1")).toHaveCount(0);
    expect(await lastToast()).toBe("Moved to For you");
  });

  it("marks stories unread from the pane, Shift+U and bulk selection", async () => {
    await mount("/dashboard?tab=stories");
    await page.getByTestId("row-inbox-c1").click();
    await page.getByLabel("Story actions").getByRole("button", { name: "Mark as unread" }).click();
    await expect.poll(async () => (await calls("DELETE", /\/read$/)).map(call => call.url)).toEqual(["/api/inbox/c1/read"]);
    await browserExpect(page.getByLabel("Story actions").getByRole("button", { name: "Mark as unread" })).toHaveCount(0);
    await browserExpect(page.getByTestId("nav-folder-for-you")).toContainText("3");

    await page.getByTestId("row-inbox-d1").click();
    await page.keyboard.press("Shift+U");
    await expect.poll(async () => (await calls("DELETE", /\/read$/)).length).toBe(2);

    await page.getByRole("checkbox", { name: "Select e1 headline" }).click();
    await page.getByRole("checkbox", { name: "Select f1 headline" }).click();
    await page.getByRole("button", { name: "Mark selected as unread" }).click();
    await expect.poll(async () => (await calls("DELETE", /\/read$/)).length).toBe(4);
    expect(await lastToast()).toBe("Marked 2 stories as unread");
    // Marking unread never re-reads: only the explicit open of c1 and d1 were already read.
    expect(await calls("POST", /\/read$/)).toEqual([]);
  });

  it("saves notes and adds them to the open draft or Your take, with Undo on delete", async () => {
    await mount("/dashboard", { extra: { __notes: [{ id: "n0", text: "We cut CAC 18% by pausing broad match.", createdAt: hoursAgo(2), updatedAt: hoursAgo(2) }] } });
    await page.getByTestId("button-inbox-compose").click();
    const window_ = page.getByTestId("compose-float");
    await window_.getByTestId("compose-body").fill("Intro line");
    await page.getByTestId("button-connector-notes").click();
    await page.getByTestId("button-insert-note-n0").click();
    await browserExpect(window_.getByTestId("compose-body")).toHaveValue("Intro line\n\nWe cut CAC 18% by pausing broad match.");
    expect(await lastToast()).toBe("Added to your draft");
    await page.getByTestId("note-n0").getByRole("button", { name: "Use as take" }).click();
    await browserExpect(window_.getByRole("textbox", { name: "Your take" })).toHaveValue("We cut CAC 18% by pausing broad match.");

    await page.getByTestId("input-new-note").fill("Clients ask for incrementality first.");
    await page.getByTestId("button-save-note").click();
    await browserExpect(page.getByLabel("Your notes").getByText("Clients ask for incrementality first.")).toBeVisible();
    expect((await calls("POST", /^\/api\/notes$/))[0].body).toEqual({ text: "Clients ask for incrementality first." });

    await page.getByTestId("note-n0").getByRole("button", { name: "Delete note" }).click();
    await browserExpect(page.getByTestId("note-n0")).toHaveCount(0);
    expect(await lastToast()).toBe("Note deleted");
    await page.evaluate(() => (window as any).__toasts.at(-1).action.props.onClick());
    await browserExpect(page.getByLabel("Your notes").getByText("We cut CAC 18% by pausing broad match.")).toBeVisible();
  });
});

describe("Drafts, Scheduled, Posted and Outbox folders", () => {
  const draft = (id: string, publishStatus: string, content: string, platform = "linkedin") =>
    ({ id, publishStatus, content, platform, tone: "professional", status: "draft", createdAt: hoursAgo(30), updatedAt: hoursAgo(id.length) });
  const schedule = (draftId: string, status: string, extra: Record<string, unknown> = {}) => ({
    id: `s-${draftId}`, draftId, status, scheduledPublishAt: new Date(Date.now() + 86_400_000).toISOString(),
    targets: [{ id: `t-${draftId}`, platform: "linkedin", status }], ...extra,
  });
  const extra = {
    __drafts: [
      draft("ready", "draft", "Ready draft first line\nMore detail"), draft("x-draft", "draft", "Thread for X", "twitter"),
      draft("sched", "scheduled", "Scheduled post text"), draft("pub", "published", "Published post text"), draft("fail", "failed", "Failed post text"),
    ],
    __schedules: [schedule("sched", "scheduled"), schedule("pub", "published"), schedule("fail", "failed", { lastError: "LinkedIn token expired." })],
  };
  const postRows = () => page.locator('[data-testid^="row-post-"]');

  it("files posts like Gmail, continues a LinkedIn draft in the composer with revision checks, and cancels a schedule", async () => {
    await mount("/dashboard", { extra });
    await browserExpect(page.getByTestId("nav-folder-drafts")).toContainText("2");
    await browserExpect(page.getByTestId("nav-folder-scheduled")).toContainText("1");
    await browserExpect(page.getByTestId("nav-folder-outbox")).toContainText("1");

    await page.getByTestId("nav-folder-drafts").click();
    await browserExpect(postRows()).toHaveCount(2);
    await page.getByTestId("row-post-x-draft").click();
    await browserExpect(page.getByRole("link", { name: "Edit in Content" })).toHaveAttribute("href", "/dashboard/content?draft=x-draft");
    await browserExpect(page.getByTestId("button-continue-draft")).toHaveCount(0);
    await page.getByTestId("row-post-ready").click();
    await page.getByTestId("button-continue-draft").click();
    const window_ = page.getByTestId("compose-float");
    await browserExpect(window_.getByTestId("compose-body")).toHaveValue("Ready draft first line\nMore detail");
    await window_.getByTestId("compose-body").fill("Ready draft, edited");
    await expect.poll(async () => (await calls("PATCH", /^\/api\/drafts\/ready$/)).length, { timeout: 4000 }).toBe(1);
    const [patch] = await calls("PATCH", /^\/api\/drafts\/ready$/);
    expect(patch.body).toMatchObject({ content: "Ready draft, edited", expectedContent: "Ready draft first line\nMore detail", expectedUpdatedAt: extra.__drafts[0].updatedAt });
    expect(await calls("POST", /^\/api\/drafts$/)).toEqual([]);

    await page.getByTestId("nav-folder-scheduled").click();
    await page.getByTestId("row-post-sched").click();
    await page.getByTestId("button-cancel-schedule").click();
    await expect.poll(async () => (await calls("DELETE", /\/api\/drafts\/sched\/schedule$/)).length).toBe(1);
    await expect.poll(() => page.evaluate(() => (window as any).__toasts.at(-1)?.title)).toBe("Schedule cancelled");
    await browserExpect(postRows()).toHaveCount(0);
    await browserExpect(page.getByTestId("nav-folder-drafts")).toContainText("3");
  });

  it("keeps failed deliveries in Outbox with recovery in Content, never offering to post again", async () => {
    await mount("/dashboard?folder=outbox", { extra });
    await browserExpect(postRows()).toHaveCount(1);
    await browserExpect(page.getByRole("alert").filter({ hasText: "LinkedIn token expired." })).toBeVisible();
    await browserExpect(page.getByRole("link", { name: "Review in Content" })).toHaveAttribute("href", "/dashboard/content?draft=fail");
    await browserExpect(page.getByLabel("Reading pane").getByRole("button", { name: /^Post|Continue in composer/ })).toHaveCount(0);

    await page.getByTestId("nav-folder-posted").click();
    await browserExpect(postRows()).toHaveCount(1);
    await browserExpect(page.getByTestId("row-post-pub")).toContainText("Published");
  });
});

describe("Review regressions", () => {
  const lastToast = () => page.evaluate(() => (window as any).__toasts.at(-1));

  it("undoes a snooze with DELETE when the story's previous snooze has already ended", async () => {
    const ended = new Date(Date.now() - 86_400_000).toISOString();
    await mount("/dashboard?tab=stories", { records: records.map(item => item.id === "b1" ? { ...item, snoozedUntil: ended } : item) });
    await page.getByTestId("row-inbox-b1").click();
    await page.keyboard.press("b");
    await page.getByTestId("snooze-tomorrow").click();
    await browserExpect(page.getByTestId("row-inbox-b1")).toHaveCount(0);
    await page.evaluate(() => (window as any).__toasts.at(-1).action.props.onClick());
    await browserExpect(page.getByTestId("row-inbox-b1")).toHaveCount(1);
    expect((await calls("POST", /\/api\/inbox\/b1\/snooze$/)).length).toBe(1);
    expect((await calls("DELETE", /\/api\/inbox\/b1\/snooze$/)).length).toBe(1);
  });

  it("restores the snooze when a move out of Snoozed is undone", async () => {
    const until = new Date(Date.now() + 3 * 86_400_000);
    until.setSeconds(0, 0);
    await mount("/dashboard?folder=snoozed", { records: records.map(item => item.id === "c1" ? { ...item, snoozedUntil: until.toISOString() } : item) });
    await page.getByTestId("row-inbox-c1").click();
    await page.getByLabel("Story actions").getByRole("button", { name: "Mark not relevant" }).click();
    await browserExpect(page.getByTestId("row-inbox-c1")).toHaveCount(0);
    await page.evaluate(() => (window as any).__toasts.at(-1).action.props.onClick());
    await browserExpect(page.getByTestId("row-inbox-c1")).toHaveCount(1);
    expect((await calls("PATCH", /\/api\/inbox\/c1$/)).map(call => call.body?.status)).toEqual(["dismissed", "active"]);
    const [resnooze] = await calls("POST", /\/api\/inbox\/c1\/snooze$/);
    expect((resnooze.body as unknown as { until: string }).until).toBe(until.toISOString());
  });

  it("keeps a half-typed note when a deleted note is restored with Undo", async () => {
    await mount("/dashboard", { extra: { __notes: [{ id: "n0", text: "Old note", createdAt: hoursAgo(2), updatedAt: hoursAgo(2) }] } });
    await page.getByTestId("button-connector-notes").click();
    await page.getByTestId("note-n0").getByRole("button", { name: "Delete note" }).click();
    await browserExpect(page.getByTestId("note-n0")).toHaveCount(0);
    await page.getByTestId("input-new-note").fill("Half-typed thought");
    await page.evaluate(() => (window as any).__toasts.at(-1).action.props.onClick());
    await browserExpect(page.getByLabel("Your notes").getByText("Old note")).toBeVisible();
    await browserExpect(page.getByTestId("input-new-note")).toHaveValue("Half-typed thought");
  });

  it("adds a note to a new visible compose when the inline draft is hidden behind the list", async () => {
    await mount("/dashboard", { extra: { __notes: [{ id: "n0", text: "Note text", createdAt: hoursAgo(2), updatedAt: hoursAgo(2) }] } }, { width: 900, height: 900 });
    await page.getByTestId("row-inbox-a1").click();
    await page.getByTestId("button-generate-a1").click();
    await page.getByTestId("compose-inline").getByTestId("compose-body").fill("Inline draft");
    await page.getByRole("button", { name: "Back to list" }).first().click();
    await browserExpect(page.getByTestId("compose-inline")).toBeHidden();
    await page.getByTestId("button-connector-notes").click();
    await page.getByTestId("button-insert-note-n0").click();
    await browserExpect(page.getByTestId("compose-float").getByTestId("compose-body")).toHaveValue("Note text");
    await browserExpect(page.getByTestId("compose-inline").getByTestId("compose-body")).toHaveValue("Inline draft");
    expect((await lastToast()).title).toBe("Started a new post with this note");
  });
});
