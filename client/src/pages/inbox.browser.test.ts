import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { chromium, expect as browserExpect, type Browser, type Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import { axeViolations } from "../../../test/axe";

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
        if (url === "/api/profile" && method === "PATCH") {
          if (window.__failProfile) return new Response(JSON.stringify({ message: "Profile could not be saved." }), { status: 503, headers: { "Content-Type": "application/json" } });
          window.__profile = { ...window.__profile, ...body };
        }
        if (url === "/api/profile") return json({ userId: "user", tenantId: "tenant", focusDescription: "I advise D2C brands on retail media.", keywords: [{ keyword: "Retail media", weight: 0.9 }], requirePublishReview: true, defaultTone: "professional", ...window.__profile });
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
        if (url === "/api/searches" && method === "GET") return json(window.__searches ?? []);
        if (url === "/api/watch-alerts" && method === "GET") return json(window.__watchAlerts ?? []);
        if (url === "/api/watch-alerts/seen" && method === "POST") {
          window.__watchAlerts = (window.__watchAlerts ?? []).map(alert => body.all || body.ids?.includes(alert.id) ? { ...alert, seenAt: new Date().toISOString() } : alert);
          return json({ updated: 1 });
        }
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
        // Phase 4: feedback, calibration, feed preferences and quick settings.
        const prefs = () => window.__prefs ?? (window.__prefs = { mutedSources: [], keywordAdjustments: {}, revision: 0, updatedAt: null });
        // Same compare-and-set undo contract as the server: { before, after } per key, reverted only while it still holds after.
        const learn = (lessAbout, moreAbout, mute) => {
          const current = prefs(), undo = { keywords: {}, sources: {} };
          for (const [list, step] of [[lessAbout, -0.2], [moreAbout, 0.1]]) for (const keyword of list) {
            const before = current.keywordAdjustments[keyword] ?? null;
            current.keywordAdjustments[keyword] = Math.round(((before ?? 0) + step) * 1000) / 1000;
            undo.keywords[keyword] = { before, after: current.keywordAdjustments[keyword] };
          }
          for (const source of mute) if (!current.mutedSources.includes(source)) { undo.sources[source] = { before: false, after: true }; current.mutedSources = [...current.mutedSources, source]; }
          current.revision++;
          return { feedbackIds: ["fb" + window.__calls.length], learned: { moreAbout, lessAbout, muted: Object.keys(undo.sources) }, undo, preferences: current };
        };
        const feedback = url.match(/^\\/api\\/inbox\\/([^/]+)\\/feedback$/);
        if (method === "POST" && feedback) return json(learn(body.lessAbout, [], body.muteSource ? [window.__records.find(item => item.id === feedback[1]).source] : []));
        if (method === "POST" && url === "/api/inbox/calibration") return json(learn(body.apply.lessAbout, body.apply.moreAbout, body.apply.mute));
        if (url === "/api/feed-preferences" && method === "GET") return json(prefs());
        if (url === "/api/feed-preferences" && method === "DELETE") {
          const { mutedSources, keywordAdjustments, revision } = prefs();
          window.__prefs = { mutedSources: [], keywordAdjustments: {}, revision: revision + 1, updatedAt: null };
          const undo = { keywords: Object.fromEntries(Object.entries(keywordAdjustments).map(([keyword, before]) => [keyword, { before, after: null }])),
            sources: Object.fromEntries(mutedSources.map(source => [source, { before: true, after: false }])) };
          return json({ preferences: window.__prefs, previous: { mutedSources, keywordAdjustments }, undo });
        }
        if (url === "/api/feed-preferences" && method === "PATCH") {
          const current = prefs(), skipped = { keywords: [], sources: [] };
          const restore = body.restore ?? (body.unmuteSource ? { keywords: {}, sources: { [body.unmuteSource]: { before: false, after: true } } }
            : { keywords: { [body.resetKeyword]: { before: null, after: current.keywordAdjustments[body.resetKeyword] ?? null } }, sources: {} });
          for (const [keyword, { before, after }] of Object.entries(restore.keywords)) {
            if ((current.keywordAdjustments[keyword] ?? null) !== after) { skipped.keywords.push(keyword); continue; }
            if (before === null) delete current.keywordAdjustments[keyword]; else current.keywordAdjustments[keyword] = before;
          }
          for (const [source, { before, after }] of Object.entries(restore.sources)) {
            if (current.mutedSources.includes(source) !== after) { skipped.sources.push(source); continue; }
            current.mutedSources = before ? [...current.mutedSources, source] : current.mutedSources.filter(item => item !== source);
          }
          current.revision++;
          return json({ preferences: current, skipped });
        }
        if (url === "/api/email-preferences") {
          if (method === "PATCH") window.__email = { ...window.__email, ...body };
          return json({ dailyDigest: true, ...window.__email });
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

describe("Triage feedback, Tune your feed and Quick settings", () => {
  type Toast = { title?: string; description?: string; action?: { props: { onClick: () => void; extra?: { label: string; onClick: () => void } } } };
  const lastToast = (): Promise<Toast> => page.evaluate(() => {
    const toast = (window as any).__toasts.at(-1);
    return { title: toast?.title, description: toast?.description, action: toast?.action && { props: { onClick: null, extra: toast.action.props.extra && { label: toast.action.props.extra.label } } } };
  });
  const clickToast = (which: "undo" | "extra") => page.evaluate(which => {
    const props = (window as any).__toasts.at(-1).action.props;
    (which === "undo" ? props.onClick : props.extra.onClick)();
  }, which);
  const why = () => page.getByRole("dialog", { name: "Why isn’t this relevant?" });
  const tagged = records.map(item => item.id === "b1" ? { ...item, matchedKeywords: ["CTV"] } : item.id === "c1" ? { ...item, matchedKeywords: ["Crypto"] } : item);

  it("asks Why? after a single Not relevant, learns less about the topic and Undo reverts only that", async () => {
    await mount("/dashboard?tab=stories");
    await page.getByTestId("row-inbox-a1").click();
    await page.keyboard.press("e");
    await browserExpect(page.getByTestId("row-inbox-a1")).toHaveCount(0);
    expect(await lastToast()).toMatchObject({ title: "Marked not relevant", action: { props: { extra: { label: "Why?" } } } });
    await clickToast("extra");
    await browserExpect(why()).toBeVisible();
    await browserExpect(why().getByRole("button", { name: "Send" })).toBeDisabled();
    await why().getByRole("radio", { name: "Not my topic" }).check();
    await browserExpect(why().getByRole("checkbox", { name: "Less about Retail media" })).toBeChecked();
    await browserExpect(why().getByRole("checkbox", { name: "Mute Wire Daily" })).not.toBeChecked();
    await why().getByRole("button", { name: "Send" }).click();
    await browserExpect(why()).toHaveCount(0);
    const [sent] = await calls("POST", /\/api\/inbox\/a1\/feedback$/);
    expect(sent.body).toEqual({ reason: "not_my_topic", muteSource: false, lessAbout: ["Retail media"] });
    expect((await lastToast()).title).toBe("Got it: less about Retail media");

    await clickToast("undo");
    await expect.poll(async () => (await calls("PATCH", /^\/api\/feed-preferences$/)).length).toBe(1);
    const [undo] = await calls("PATCH", /^\/api\/feed-preferences$/);
    expect(undo.body).toEqual({ restore: { keywords: { "Retail media": { before: null, after: -0.2 } }, sources: {} }, feedbackId: expect.stringMatching(/^fb/) });
    await expect.poll(async () => (await lastToast()).title).toBe("Change undone");
    expect((await lastToast()).description).toBeUndefined();
    // Undo reverts what was learned; the story stays in Not relevant.
    expect((await calls("PATCH", /\/api\/inbox\/a1$/)).map(call => call.body?.status)).toEqual(["dismissed"]);

    await page.getByRole("checkbox", { name: "Select c1 headline" }).click();
    await page.getByRole("checkbox", { name: "Select d1 headline" }).click();
    await page.getByRole("button", { name: "Mark selected not relevant" }).click();
    await expect.poll(async () => (await lastToast()).title).toBe("Marked not relevant: 2 stories");
    expect((await lastToast()).action?.props.extra).toBeUndefined();
  });

  it("Undo keeps a newer value for the same topic set in another tab, and says so", async () => {
    await mount("/dashboard?tab=stories");
    await page.getByTestId("row-inbox-a1").click();
    await page.keyboard.press("e");
    await clickToast("extra");
    await why().getByRole("radio", { name: "Not my topic" }).check();
    await why().getByRole("button", { name: "Send" }).click();
    await expect.poll(async () => (await lastToast()).title).toBe("Got it: less about Retail media");
    // Another tab lowers the same topic again before this tab's Undo.
    await page.evaluate(() => { (window as any).__prefs.keywordAdjustments["Retail media"] = -0.4; });
    await clickToast("undo");
    await expect.poll(async () => (await lastToast()).description).toBe("Some changes were kept because they were updated elsewhere.");
    expect(await page.evaluate(() => (window as any).__prefs.keywordAdjustments)).toEqual({ "Retail media": -0.4 });
  });

  it("mutes a source from Why? and offers to move its other For you stories, with Undo", async () => {
    await mount("/dashboard?tab=stories");
    await page.getByTestId("row-inbox-a2").click();
    await page.getByLabel("Story actions").getByRole("button", { name: "Mark not relevant" }).click();
    await browserExpect(page.getByTestId("row-inbox-a2")).toHaveCount(0);
    await clickToast("extra");
    await why().getByRole("radio", { name: "Don't trust this source" }).check();
    await browserExpect(why().getByRole("checkbox", { name: "Mute Wire Daily" })).toBeChecked();
    await why().getByRole("button", { name: "Send" }).click();
    await expect.poll(async () => (await lastToast()).title).toBe("Got it: Wire Daily muted");
    expect((await calls("POST", /\/api\/inbox\/a2\/feedback$/))[0].body).toEqual({ reason: "untrusted_source", muteSource: true, lessAbout: [] });
    expect(await lastToast()).toMatchObject({ description: "1 more story from Wire Daily in For you.", action: { props: { extra: { label: "Move them" } } } });

    await clickToast("extra");
    await browserExpect(page.getByTestId("row-inbox-a1")).toHaveCount(0);
    await expect.poll(async () => (await lastToast()).title).toBe("Moved 1 story to Not relevant");
    await clickToast("undo");
    await browserExpect(page.getByTestId("row-inbox-a1")).toHaveCount(1);
    expect((await calls("PATCH", /\/api\/inbox\/a1$/)).map(call => call.body?.status)).toEqual(["dismissed", "active"]);
  });

  it("tunes the feed from the For you banner with the keyboard, changing nothing until Apply", async () => {
    await mount("/dashboard", { records: tagged });
    await page.getByTestId("button-start-tuning").click();
    const dialog = page.getByRole("dialog", { name: "Tune your feed" });
    await browserExpect(dialog.getByTestId("calibration-story")).toContainText("a1 headline");
    await browserExpect(dialog.getByText("1 of 7")).toBeVisible();
    await browserExpect(dialog.getByRole("progressbar", { name: "Stories rated" })).toHaveAttribute("aria-valuenow", "0");
    for (const key of ["ArrowRight", "ArrowLeft", "2", "Space", "1", "Space"]) await page.keyboard.press(key);
    await browserExpect(dialog.getByTestId("calibration-story")).toContainText("a2 headline");
    await dialog.getByRole("button", { name: "Skip" }).click();

    await browserExpect(dialog.getByRole("checkbox", { name: "More about Retail media" })).toBeChecked();
    await browserExpect(dialog.getByRole("checkbox", { name: "Less about CTV" })).toBeChecked();
    await browserExpect(dialog.getByRole("checkbox", { name: "Mute Ad Brief?" })).not.toBeChecked();
    // A repeated Space after the last story must not apply anything.
    await page.keyboard.press("Space");
    await browserExpect(dialog.getByRole("checkbox", { name: "More about Retail media" })).toBeChecked();
    expect(await calls("POST", /calibration$/)).toEqual([]);
    await dialog.getByRole("checkbox", { name: "Less about Crypto" }).click();
    await dialog.getByRole("checkbox", { name: "Mute Ad Brief?" }).click();
    await dialog.getByRole("button", { name: "Apply" }).click();
    await browserExpect(dialog).toHaveCount(0);

    const [applied] = await calls("POST", /^\/api\/inbox\/calibration$/);
    expect(applied.body).toEqual({
      votes: [{ id: "a1", vote: "relevant" }, { id: "b1", vote: "not_relevant" }, { id: "c1", vote: "not_relevant" }, { id: "d1", vote: "skip" },
        { id: "e1", vote: "relevant" }, { id: "f1", vote: "skip" }, { id: "a2", vote: "skip" }],
      apply: { moreAbout: ["Retail media"], lessAbout: ["CTV"], mute: ["Ad Brief"] },
    });
    expect(await lastToast()).toMatchObject({ title: "Got it: more about Retail media; less about CTV; Ad Brief muted", description: "1 more story from Ad Brief in For you." });
    await browserExpect(page.getByTestId("banner-tune-feed")).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem("tsp:feed-calibration"))).toBe("done");
  });

  it("hides the banner when dismissed or with fewer than five stories", async () => {
    await mount("/dashboard", { records: records.filter(item => ["a1", "b1", "c1", "d1"].includes(item.id)) });
    await browserExpect(rows()).toHaveCount(4);
    await browserExpect(page.getByTestId("banner-tune-feed")).toHaveCount(0);
    await page.close();
    await mount();
    await page.getByRole("button", { name: "Dismiss Tune your feed" }).click();
    await browserExpect(page.getByTestId("banner-tune-feed")).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem("tsp:feed-calibration"))).toBe("dismissed");
  });

  it("applies density, reading pane and the post undo window from Quick settings immediately", async () => {
    await mount("/dashboard?tab=stories");
    await page.getByTestId("button-quick-settings").click();
    const settings = page.getByTestId("quick-settings");
    await settings.getByRole("group", { name: "Density" }).getByRole("button", { name: "Compact" }).click();
    await browserExpect(page.locator('ul[data-density="compact"]')).toBeVisible();
    await browserExpect(page.getByText("c1 summary")).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem("tsp:inbox-density"))).toBe("compact");

    await settings.getByRole("group", { name: "Reading pane" }).getByRole("button", { name: "Off" }).click();
    await browserExpect(page.getByRole("region", { name: "Reading pane" })).toBeHidden();
    await page.getByTestId("row-inbox-c1").click();
    await browserExpect(page.getByTestId("text-headline-c1")).toBeVisible();
    await browserExpect(rows().first()).toBeHidden();
    await page.getByRole("button", { name: "Back to list" }).click();
    await browserExpect(rows().first()).toBeVisible();
    await settings.getByRole("group", { name: "Reading pane" }).getByRole("button", { name: "Right of list" }).click();
    await browserExpect(page.getByTestId("text-headline-c1")).toBeVisible();

    await settings.getByRole("group", { name: "Undo window for posts" }).getByRole("button", { name: "30s" }).click();
    expect(await page.evaluate(() => localStorage.getItem("tsp:post-undo-seconds"))).toBe("30");
    await page.getByTestId("button-inbox-compose").click();
    const window_ = page.getByTestId("compose-float");
    await window_.getByTestId("compose-body").fill("A post to check the undo window.");
    await window_.getByTestId("button-compose-post").click();
    await browserExpect(page.getByTestId("pending-post")).toContainText("in 30s");
    await page.getByTestId("pending-post").getByRole("button", { name: "Undo" }).click();
    expect(await calls("POST", /\/publish-now$/)).toEqual([]);
  }, 15_000);

  it("saves tone, review and digest settings at once, and manages what the feed has learned", async () => {
    await mount("/dashboard", { extra: { __prefs: { mutedSources: ["Wire Daily"], keywordAdjustments: { Crypto: -0.2 }, revision: 3, updatedAt: null } } });
    await page.getByTestId("button-quick-settings").click();
    const settings = page.getByTestId("quick-settings");
    await settings.getByLabel("Default tone").selectOption({ label: "Provocateur" });
    await expect.poll(async () => (await calls("PATCH", /^\/api\/profile$/)).map(call => call.body)).toEqual([{ defaultTone: "contrarian" }]);
    await settings.getByRole("switch", { name: "Review before posting" }).click();
    await expect.poll(async () => (await calls("PATCH", /^\/api\/profile$/)).length).toBe(2);
    expect((await calls("PATCH", /^\/api\/profile$/))[1].body).toEqual({ requirePublishReview: false });
    await browserExpect(settings.getByRole("switch", { name: "Review before posting" })).toHaveAttribute("aria-checked", "false");
    await settings.getByRole("switch", { name: "Daily digest email" }).click();
    await expect.poll(async () => (await calls("PATCH", /^\/api\/email-preferences$/)).map(call => call.body)).toEqual([{ dailyDigest: false }]);

    await page.evaluate(() => { (window as any).__failProfile = true; });
    await settings.getByLabel("Default tone").selectOption({ label: "Data-Driven" });
    await expect.poll(async () => (await lastToast()).title).toBe("Couldn't save the setting");
    await browserExpect(settings.getByLabel("Default tone")).toHaveValue("contrarian");

    const learned = page.getByTestId("learned-list");
    await browserExpect(learned.getByText("Muted Wire Daily")).toBeVisible();
    await browserExpect(learned.getByText("Less about Crypto")).toBeVisible();
    await learned.getByRole("button", { name: "Unmute Wire Daily" }).click();
    await browserExpect(learned.getByText("Muted Wire Daily")).toHaveCount(0);
    expect((await calls("PATCH", /^\/api\/feed-preferences$/))[0].body).toEqual({ unmuteSource: "Wire Daily" });
    // Another tab mutes a source this panel has not seen: Undo must restore it from the server's reset response, not this cache.
    await page.evaluate(() => { (window as any).__prefs.mutedSources = ["Ad Brief"]; });
    await learned.getByRole("button", { name: "Reset all" }).click();
    await browserExpect(learned.getByText("Nothing yet.", { exact: false })).toBeVisible();
    expect((await calls("DELETE", /^\/api\/feed-preferences$/)).length).toBe(1);
    await expect.poll(async () => (await lastToast()).title).toBe("Your feed preferences were reset");
    // Learned after the reset; Undo must keep it.
    await page.evaluate(() => { (window as any).__prefs.keywordAdjustments = { Crypto: -0.4 }; });
    await clickToast("undo");
    await expect.poll(async () => (await lastToast()).title).toBe("Reset undone");
    expect((await lastToast()).description).toBe("Some changes were kept because they were updated elsewhere.");
    expect((await calls("PATCH", /^\/api\/feed-preferences$/)).at(-1)!.body).toEqual({ restore: {
      keywords: { Crypto: { before: -0.2, after: null } }, sources: { "Ad Brief": { before: true, after: false } } } });
    expect(await page.evaluate(() => (window as any).__prefs)).toMatchObject({ mutedSources: ["Ad Brief"], keywordAdjustments: { Crypto: -0.4 } });
    await browserExpect(learned.getByText("Muted Ad Brief")).toBeVisible();
    await browserExpect(page.getByRole("link", { name: "See all settings" })).toHaveAttribute("href", "/dashboard/settings");
  });
});

describe("Watchlist alerts", () => {
  it("shows unseen alerts on the rail and opens the alerted story in For you", async () => {
    const alert = { id: "w1", inboxItemId: "d1", term: "Data Desk", kind: "company", headline: "d1 headline", source: "Data Desk", articleUrl: "https://news.test/d1", createdAt: hoursAgo(1), seenAt: null };
    await mount("/dashboard", { extra: { __watchAlerts: [alert] } });
    await browserExpect(page.getByTestId("button-connector-watchlist")).toHaveAccessibleName("Watchlist alerts, 1 new");
    await page.getByTestId("button-connector-watchlist").click();
    await page.getByTestId("panel-connector-watchlist").getByRole("button", { name: /d1 headline/ }).click();
    await expect.poll(() => page.evaluate(() => location.search)).toBe("?tab=stories&story=d1");
    await browserExpect(page.getByTestId("text-headline-d1")).toBeVisible();
    await expect.poll(async () => (await calls("POST", /\/api\/watch-alerts\/seen$/)).length).toBe(1);
    await browserExpect(page.getByTestId("button-connector-watchlist")).toHaveAccessibleName("Watchlist alerts");
  });
});

describe("Accessibility (axe, WCAG 2.1 AA)", () => {
  it("has no violations in the main Inbox views, the composer and the side panels", async () => {
    const draft = { id: "dr1", publishStatus: "draft", content: "Draft text\nMore", platform: "linkedin", tone: "professional", status: "draft", createdAt: hoursAgo(30), updatedAt: hoursAgo(2) };
    await mount("/dashboard?tab=stories", { extra: { __drafts: [draft], __schedules: [], __notes: [{ id: "n0", text: "A note", createdAt: hoursAgo(2), updatedAt: hoursAgo(2) }],
      __watchAlerts: [{ id: "w1", inboxItemId: "d1", term: "Data Desk", kind: "company", headline: "d1 headline", source: "Data Desk", articleUrl: "https://news.test/d1", createdAt: hoursAgo(1), seenAt: null }] } }, { width: 1440, height: 900 });
    await browserExpect(rows()).toHaveCount(7);
    const found: Record<string, unknown> = {};
    const check = async (name: string) => { const violations = await axeViolations(page); if (violations.length) found[name] = violations; };
    await check("stories");
    await page.getByTestId("button-generate-a1").click();
    await page.getByTestId("compose-body").fill("My take");
    await check("inline composer");
    await page.getByTestId("button-inbox-compose").click();
    await check("floating composer");
    for (const panel of ["notes", "watchlist", "plan", "more"]) {
      await page.getByTestId(`button-connector-${panel}`).click();
      await page.getByTestId(`panel-connector-${panel}`).waitFor();
      await check(`panel ${panel}`);
    }
    await page.getByTestId("button-quick-settings").click();
    await page.getByTestId("panel-connector-settings").waitFor();
    await check("quick settings");
    await page.getByTestId("nav-folder-drafts").click();
    await page.getByTestId("row-post-dr1").click();
    await check("drafts folder");
    await page.getByTestId("nav-folder-snoozed").click();
    await check("snoozed folder");
    expect(found).toEqual({});
  }, 60_000);

  it("has no violations on a phone-width list and reading pane", async () => {
    await mount("/dashboard", {}, { width: 390, height: 844 });
    const found: Record<string, unknown> = {};
    let violations = await axeViolations(page);
    if (violations.length) found.list = violations;
    await page.getByTestId("row-inbox-a1").click();
    violations = await axeViolations(page);
    if (violations.length) found.reading = violations;
    expect(found).toEqual({});
  }, 30_000);
});
