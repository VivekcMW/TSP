import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { chromium, expect as browserExpect, type Browser, type Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import { axeViolations } from "../../../../test/axe";
import { ideaId } from "@shared/topic-ideas";

// Real Inbox shell + Ideas folder against an in-memory backend built from the shared idea/plan functions.
const root = path.resolve(import.meta.dirname, "../../../..");
const MYTH = ideaId("pillar", "Retail media", "myth");
const STORY = ideaId("story", "s1", "my-take");
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
      import { buildPlan, generateIdeas, rankIdeas, suggestStrategy, weekStartOf } from "@shared/topic-ideas";
      window.__calls = []; window.__toasts = []; window.__unexpected = []; window.__weekStart = weekStartOf(new Date(), "UTC");
      const profile = { userId: "user", tenantId: "tenant", focusDescription: "I advise D2C brands on retail media.", timezone: "UTC", preferredPublishTime: "09:00",
        keywords: [{ keyword: "Retail media", weight: 0.9 }, { keyword: "Pricing", weight: 0.5 }], requirePublishReview: true, defaultTone: "professional" };
      const story = { id: "s1", headline: "Retail media networks pass $60B", source: "Ad Brief", url: "https://news.test/s1", relevance: 0.9, matchedKeywords: ["Retail media"] };
      const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
      const db = () => window.__db;
      const currentStrategy = () => db().strategy ?? suggestStrategy(profile);
      const strategyResponse = () => ({ saved: Boolean(db().strategy), revision: db().revision, updatedAt: db().strategy ? new Date().toISOString() : null,
        strategy: db().strategy, suggested: suggestStrategy(profile), timezone: "UTC" });
      const ranked = limit => {
        const candidates = generateIdeas({ strategy: currentStrategy(), trends: [], stories: db().stories ?? [story], checkins: db().checkin ? [db().checkin] : [], published: [], now: new Date(), timeZone: "UTC" });
        return rankIdeas(candidates, Object.entries(db().states).map(([ideaId, entry]) => ({ ideaId, state: entry.state, idea: entry.idea ?? null })), limit);
      };
      window.fetch = async (url, options = {}) => {
        const method = options.method || "GET";
        const body = options.body ? JSON.parse(options.body) : undefined;
        window.__calls.push({ url, method, body });
        if (url === "/api/me") return json({ id: "user", firstName: "Reader", lastName: "One", email: "reader@test" });
        if (url === "/api/profile") return json(profile);
        if (url === "/api/integrations/linkedin/status") return json({ provider: "linkedin", connected: true, assessment: { canPublish: true, status: "connected" } });
        if (url === "/api/inbox?status=active") return json(db().records ?? []);
        if (url.startsWith("/api/inbox?")) return json([]);
        if (url === "/api/inbox/visit") return json({ previousVisitAt: null, currentVisitAt: new Date().toISOString() });
        if (method === "POST" && /^\\/api\\/inbox\\/[^/]+\\/read$/.test(url)) return json({ id: url.split("/")[3], readAt: new Date().toISOString() });
        if (url === "/api/trends") return json([]);
        if (url.startsWith("/api/drafts?")) return json([]);
        if (method === "POST" && url === "/api/drafts") return json({ id: "draft-1", content: body.content, updatedAt: new Date().toISOString() });
        if (method === "PATCH" && /^\\/api\\/drafts\\/[^/]+$/.test(url)) return json({ id: url.split("/")[3], content: body.content, updatedAt: new Date(Date.now() + window.__calls.length).toISOString() });
        if (url.startsWith("/api/drafts/scheduled?")) return json({ items: [], total: 0 });
        if (url === "/api/notes" && method === "GET") return json(db().notes);
        if (url === "/api/notes" && method === "POST") { const note = { id: "n" + db().notes.length, text: body.text }; db().notes.unshift(note); return json(note, 201); }
        if (url === "/api/strategy" && method === "GET") return json(strategyResponse());
        if (url === "/api/strategy" && method === "PUT") {
          if (body.revision !== db().revision) return json({ message: "Your strategy was changed in another tab or device. Load the latest version, then save again.", current: strategyResponse() }, 409);
          db().strategy = body.strategy; db().revision += 1;
          return json(strategyResponse());
        }
        const weekStart = weekStartOf(new Date(), "UTC");
        if (url === "/api/checkins/current" && method === "GET") return json({ weekStart: db().staleWeek ?? weekStart, checkin: db().checkin });
        if (url === "/api/checkins/current" && method === "PUT") {
          const current = { weekStart, checkin: db().checkin };
          const answered = db().checkin && ["win", "lesson", "question"].some(field => (db().checkin.answers[field] || "").trim());
          if (body.weekStart !== weekStart) { db().staleWeek = undefined; return json({ message: "A new week has started. Here is this week's check-in.", current }, 409); }
          if (answered && !body.replace) return json({ message: "You already checked in this week, maybe in another tab. Here are your answers.", current }, 409);
          db().checkin = { weekStart, answers: body.answers, updatedAt: new Date().toISOString() };
          return json({ weekStart, checkin: db().checkin });
        }
        const parsed = new URL(url, "https://inbox.test");
        const extraStates = () => Object.fromEntries((parsed.searchParams.get("extra") || "").split(",").filter(id => db().states[id]).map(id => [id, db().states[id].state]));
        if (parsed.pathname === "/api/ideas" && method === "GET") return json({ ideas: ranked(30), states: extraStates(), hasStrategy: Boolean(db().strategy), generatedAt: new Date().toISOString() });
        const idea = url.match(/^\\/api\\/ideas\\/([0-9a-f]{16})$/);
        if (idea && method === "PATCH") { if (body.state) db().states[idea[1]] = { state: body.state, idea: body.idea }; else delete db().states[idea[1]]; return json({ id: idea[1], state: body.state }); }
        if (parsed.pathname === "/api/plan") return json(buildPlan({ now: new Date(), days: Number(parsed.searchParams.get("days")), timeZone: "UTC", strategy: currentStrategy(), fallbackTime: "09:00",
          hasStrategy: Boolean(db().strategy), scheduled: db().scheduled, ideas: ranked(200), states: extraStates() }));
        if (url.startsWith("/api/moments")) return db().moments ? json(db().moments) : json({ message: "Not found" }, 404);
        // Other phases' optional endpoints: absent here, like before they ship.
        if (url === "/api/watch-alerts" && method === "GET") return json([]);
        if (/^\\/api\\/(searches|feed-preferences|inputs)/.test(url)) return json({ message: "Not found" }, 404);
        window.__unexpected.push(method + " " + url);
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
  css = (await postcss([tailwindcss({ content: [path.join(root, "client/src/**/*.tsx")] })]).process("@tailwind base; @tailwind utilities;", { from: undefined })).css;
  browser = await chromium.launch({ headless: true });
}, 90_000);
afterEach(async () => {
  if (page) expect(await page.evaluate(() => (window as any).__unexpected)).toEqual([]);
  await page?.close();
});
afterAll(async () => { await browser?.close(); });

interface Db {
  strategy: unknown; revision: number; checkin: unknown; states: Record<string, unknown>; notes: unknown[]; scheduled: unknown[]; moments: unknown[] | null;
  stories?: unknown[]; records?: unknown[]; staleWeek?: string;
}
const emptyDb = (): Db => ({ strategy: null, revision: 0, checkin: null, states: {}, notes: [], scheduled: [], moments: null });
const savedStrategy = {
  audience: "D2C founders", goal: "build_authority", goalNote: "",
  pillars: [{ name: "Retail media", expertise: 3, proof: "" }, { name: "Pricing", expertise: 2, proof: "" }],
  cadence: { postsPerWeek: 3, slots: [{ weekday: 1, time: "09:00" }, { weekday: 3, time: "09:00" }, { weekday: 5, time: "09:00" }] },
};

async function mount(url: string, db: Partial<Db> = {}, viewport = { width: 1440, height: 900 }) {
  page = await browser.newPage({ viewport });
  page.setDefaultTimeout(5000);
  await page.route("**/*", route => route.abort());
  await page.route("https://inbox.test/**", route => route.fulfill({ contentType: "text/html", body: '<div id="root" style="height:100vh"></div>' }));
  await page.goto(`https://inbox.test${url}`);
  await page.evaluate(state => Object.assign(window, { __db: state }), { ...emptyDb(), ...db });
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: bundle });
}
type Call = { url: string; method: string; body: any };
const calls = (method: string, pattern: RegExp): Promise<Call[]> => page.evaluate(([method, source]) => (window as any).__calls
  .filter((call: Call) => call.method === method && new RegExp(source).test(call.url)), [method, pattern.source] as const);
const lastToast = () => page.evaluate(() => (window as any).__toasts.at(-1)?.title);

describe("Topic discovery: strategy, ideas, check-in and plan", () => {
  it("saves a strategy, drafts an idea with its angle, saves a check-in to Notes and shows the plan", async () => {
    await mount("/dashboard?folder=ideas&view=strategy");
    await browserExpect(page.getByTestId("banner-strategy-suggested")).toBeVisible();
    await browserExpect(page.getByTestId("input-pillar-name-0")).toHaveValue("Retail media");
    await browserExpect(page.getByTestId("input-pillar-name-1")).toHaveValue("Pricing");
    await page.getByTestId("input-strategy-audience").fill("D2C founders");
    await page.getByTestId("pillar-0").getByRole("button", { name: "Expert" }).click();
    await page.getByTestId("button-add-pillar").click();
    await page.getByTestId("input-pillar-name-2").fill("AI agents");
    await page.getByTestId("pillar-2").getByRole("button", { name: "Learning" }).click();
    await page.getByTestId("button-save-strategy").click();
    await expect.poll(async () => (await calls("PUT", /^\/api\/strategy$/)).length).toBe(1);
    const [put] = await calls("PUT", /^\/api\/strategy$/);
    expect(put.body).toMatchObject({ revision: 0, strategy: { audience: "D2C founders", pillars: [{ name: "Retail media", expertise: 3 }, { name: "Pricing", expertise: 2 }, { name: "AI agents", expertise: 1 }] } });
    await expect.poll(lastToast).toBe("Strategy saved");
    await browserExpect(page.getByTestId("banner-strategy-suggested")).toHaveCount(0);

    await page.getByTestId("tab-ideas-ideas").click();
    expect(await page.evaluate(() => location.search)).toBe("?folder=ideas");
    await browserExpect(page.getByTestId("card-checkin")).toBeVisible();
    await page.getByTestId(`row-idea-${MYTH}`).click();
    await browserExpect(page.getByTestId("text-idea-title")).toHaveText("Myth vs reality: Retail media");
    await browserExpect(page.getByTestId("text-idea-why")).toContainText("Your pillar: Retail media (expert)");
    await page.getByTestId("button-draft-idea").click();
    const compose = page.getByTestId("compose-float");
    await browserExpect(compose).toBeVisible();
    await browserExpect(compose.getByLabel("Angle")).toHaveValue("Name a common belief about Retail media and show what you see in practice.");
    await expect.poll(async () => (await calls("PATCH", new RegExp(`^/api/ideas/${MYTH}$`))).map(call => call.body))
      .toMatchObject([{ state: "used", idea: { id: MYTH, title: "Myth vs reality: Retail media" } }]);
    await browserExpect(page.getByTestId(`row-idea-${MYTH}`)).toContainText("Drafted");

    await page.getByTestId("input-checkin-win").fill("Closed a pricing workshop with a new client");
    await page.getByTestId("button-checkin-save").click();
    const week = await page.evaluate(() => (window as any).__weekStart);
    await expect.poll(async () => (await calls("PUT", /^\/api\/checkins\/current$/)).map(call => call.body))
      .toEqual([{ weekStart: week, answers: { win: "Closed a pricing workshop with a new client", lesson: "", question: "" }, replace: false }]);
    await page.getByTestId("button-checkin-note-win").click();
    await browserExpect(page.getByTestId("card-checkin")).toContainText("Saved to Notes");
    expect((await calls("POST", /^\/api\/notes$/)).map(call => call.body)).toEqual([{ text: "Win: Closed a pricing workshop with a new client" }]);
    await browserExpect(page.getByText("A recent win: Closed a pricing workshop with a new client")).toBeVisible();

    await page.getByTestId("tab-ideas-plan").click();
    await browserExpect(page.getByTestId("plan-agenda")).toContainText("Suggestions only. Nothing is scheduled or posted automatically.");
    await browserExpect(page.getByTestId("plan-entry-suggestion").first()).toBeVisible();
    expect(await page.getByTestId("plan-entry-suggestion").count()).toBeGreaterThanOrEqual(10);
    await browserExpect(page.getByRole("heading", { name: /^Week of/ }).first()).toBeVisible();
    expect(await calls("POST", /\/(schedule|publish-now)$/)).toEqual([]);
  }, 45_000);

  it("drafts a story idea from its source, hides and restores ideas, saves and navigates with j/k", async () => {
    await mount("/dashboard?folder=ideas", { strategy: savedStrategy, revision: 1, checkin: { weekStart: "2026-11-16", answers: { win: "", lesson: "", question: "" } } });
    await browserExpect(page.getByTestId(`row-idea-${STORY}`)).toBeVisible();
    await browserExpect(page.getByTestId("card-checkin")).toHaveCount(0);
    await page.getByTestId(`row-idea-${STORY}`).click();
    await browserExpect(page.getByTestId("link-idea-story")).toHaveAttribute("href", "https://news.test/s1");
    await page.getByTestId("button-draft-idea").click();
    await browserExpect(page.getByTestId("compose-float")).toContainText("Retail media networks pass $60B");

    // The compose window now covers the bottom of the pane, so use the pane's toolbar like a person would.
    const toolbar = page.locator('[aria-label="Idea actions"]');
    await page.getByTestId(`row-idea-${MYTH}`).click();
    await toolbar.getByRole("button", { name: "Not for me" }).click();
    await browserExpect(page.getByTestId(`row-idea-${MYTH}`)).toHaveCount(0);
    expect(await lastToast()).toBe("Idea hidden");
    await page.evaluate(() => (window as any).__toasts.at(-1).action.props.onClick());
    await browserExpect(page.getByTestId(`row-idea-${MYTH}`)).toBeVisible();
    expect((await calls("PATCH", new RegExp(`^/api/ideas/${MYTH}$`))).map(call => call.body)).toEqual([{ state: "dismissed" }, { state: null }]);

    await page.getByTestId(`row-idea-${MYTH}`).click();
    await toolbar.getByRole("button", { name: "Save idea" }).click();
    await expect.poll(async () => (await calls("PATCH", new RegExp(`^/api/ideas/${MYTH}$`))).at(-1)?.body).toMatchObject({ state: "saved", idea: { id: MYTH, title: "Myth vs reality: Retail media" } });
    await expect.poll(() => page.locator('[data-testid^="row-idea-"]').first().getAttribute("data-testid")).toBe(`row-idea-${MYTH}`);

    await page.getByTestId(`row-idea-${MYTH}`).focus();
    await page.keyboard.press("j");
    const second = await page.locator('[data-testid^="row-idea-"]').nth(1).getAttribute("data-testid");
    await browserExpect(page.getByTestId(second!)).toBeFocused();
    await browserExpect(page.getByTestId(second!)).toHaveAttribute("aria-current", "true");
    await page.keyboard.press("k");
    await browserExpect(page.getByTestId(`row-idea-${MYTH}`)).toBeFocused();
  }, 30_000);

  it("handles a strategy save conflict without losing edits", async () => {
    await mount("/dashboard?folder=ideas&view=strategy", { strategy: savedStrategy, revision: 1 });
    await page.getByTestId("input-strategy-audience").fill("Heads of growth");
    await page.evaluate(() => { (window as any).__db.revision = 2; (window as any).__db.strategy = { ...(window as any).__db.strategy, audience: "Changed elsewhere" }; });
    await page.getByTestId("button-save-strategy").click();
    await browserExpect(page.getByTestId("alert-strategy-conflict")).toBeVisible();
    await browserExpect(page.getByTestId("input-strategy-audience")).toHaveValue("Heads of growth");
    await page.getByRole("button", { name: "Load latest" }).click();
    await browserExpect(page.getByTestId("input-strategy-audience")).toHaveValue("Changed elsewhere");
    await page.getByTestId("input-strategy-audience").fill("Heads of growth");
    await page.getByTestId("button-save-strategy").click();
    await expect.poll(lastToast).toBe("Strategy saved");
    expect((await calls("PUT", /^\/api\/strategy$/)).map(call => call.body.revision)).toEqual([1, 2]);
  }, 30_000);

  it("shows the next 7 days and moments in the Plan panel, and drafts from it", async () => {
    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    await mount("/dashboard?folder=ideas&view=plan", { strategy: { ...savedStrategy, cadence: { postsPerWeek: 7, slots: [] } }, revision: 1,
      moments: [{ id: "m1", title: "Retail media summit", date: soon, endDate: null, leadDays: 7, category: "Event", url: null, description: null, suggestedAngle: "What I expect from the summit", inLeadWindow: true }] });
    await browserExpect(page.getByTestId("plan-entry-moment")).toContainText("Retail media summit");
    expect((await calls("GET", /^\/api\/plan\?/)).at(-1)?.url).toBe(`/api/plan?days=30&extra=${ideaId("moment", "m1", "lead")}`);
    await page.getByTestId("button-connector-plan").click();
    const panel = page.getByTestId("panel-connector-plan");
    await browserExpect(panel.getByTestId("plan-panel-week")).toBeVisible();
    expect(await panel.getByTestId("plan-entry-suggestion").count()).toBeGreaterThanOrEqual(6);
    await browserExpect(panel.getByRole("link", { name: "Open Calendar" })).toHaveAttribute("href", "/dashboard/calendar");
    await panel.getByTestId("button-plan-draft").first().click();
    await browserExpect(page.getByTestId("compose-float")).toBeVisible();
    await expect.poll(async () => (await calls("PATCH", /^\/api\/ideas\//)).map(call => call.body.state)).toEqual(["used"]);

    // Drafting the moment opens its angle and takes it out of the plan.
    await page.getByTestId("button-connector-plan").click();
    await page.getByTestId("plan-entry-moment").getByRole("button", { name: "Draft this" }).click();
    await expect.poll(async () => (await calls("PATCH", new RegExp(`^/api/ideas/${ideaId("moment", "m1", "lead")}$`))).map(call => call.body.state)).toEqual(["used"]);
    await browserExpect(page.getByTestId("plan-entry-moment")).toHaveCount(0);
  }, 30_000);

  it("guides people to Strategy when there are no ideas, and fits a 390px screen", async () => {
    await mount("/dashboard?folder=ideas", { stories: [] }, { width: 390, height: 844 });
    await browserExpect(page.getByTestId("banner-suggested-strategy")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.getByTestId("tab-ideas-strategy").click();
    await browserExpect(page.getByTestId("button-save-strategy")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    for (const index of [1, 0]) await page.getByTestId(`pillar-${index}`).getByRole("button", { name: /^Remove / }).click();
    await page.getByTestId("button-save-strategy").click();
    await page.getByTestId("tab-ideas-ideas").click();
    await browserExpect(page.getByTestId("ideas-empty")).toContainText("No ideas right now");
    await browserExpect(page.getByTestId("ideas-empty").getByRole("link", { name: "Open Strategy" })).toBeVisible();
  }, 30_000);

  it("Draft this brings the story's existing inline Draft my take into a floating window", async () => {
    const record = { id: "s1", headline: "Retail media networks pass $60B", status: "active", summary: "Summary", source: "Ad Brief", matchedKeywords: ["Retail media"],
      articleUrl: "https://news.test/s1", relevanceScore: "0.9", rankingScore: "0.9", publishedAt: null, readAt: null, createdAt: new Date().toISOString() };
    await mount("/dashboard?tab=stories", { strategy: savedStrategy, revision: 1, records: [record], checkin: { weekStart: "2026-11-16", answers: { win: "", lesson: "", question: "" } } });
    await page.getByTestId("button-generate-s1").click();
    await page.getByTestId("compose-inline").getByTestId("compose-body").fill("My existing take on retail media");
    await page.getByTestId("nav-folder-ideas").click();
    await page.getByTestId(`row-idea-${STORY}`).click();
    await page.getByTestId("button-draft-idea").click();
    const float = page.getByTestId("compose-float");
    await browserExpect(float).toBeVisible();
    await browserExpect(float.getByTestId("compose-body")).toHaveValue("My existing take on retail media");
    await expect.poll(async () => (await calls("PATCH", new RegExp(`^/api/ideas/${STORY}$`))).map(call => call.body.state)).toEqual(["used"]);
  }, 30_000);

  it("never overwrites a check-in answered in another tab, replaces it only from Edit, and follows a new week", async () => {
    await mount("/dashboard?folder=ideas", { strategy: savedStrategy, revision: 1, staleWeek: "2026-01-05" });
    const week = await page.evaluate(() => (window as any).__weekStart);
    // A tab opened last week: its Save is refused and the answers stay for this week.
    await page.getByTestId("input-checkin-win").fill("Shipped the pricing page");
    await page.getByTestId("button-checkin-save").click();
    await expect.poll(lastToast).toBe("A new week has started");
    await browserExpect(page.getByTestId("input-checkin-win")).toHaveValue("Shipped the pricing page");
    // Meanwhile another tab answers this week; this tab's Skip must not wipe it.
    await page.evaluate(week => { (window as any).__db.checkin = { weekStart: week, answers: { win: "Saved elsewhere", lesson: "", question: "" }, updatedAt: new Date().toISOString() }; }, week);
    await page.getByTestId("button-checkin-skip").click();
    await browserExpect(page.getByTestId("text-checkin-notice")).toContainText("You already checked in this week");
    await browserExpect(page.getByTestId("card-checkin")).toContainText("Saved elsewhere");
    expect(await page.evaluate(() => (window as any).__db.checkin.answers.win)).toBe("Saved elsewhere");
    await page.getByTestId("button-checkin-edit").click();
    await browserExpect(page.getByTestId("input-checkin-win")).toHaveValue("Saved elsewhere");
    await page.getByTestId("input-checkin-win").fill("Saved elsewhere, then edited");
    await page.getByTestId("button-checkin-save").click();
    await browserExpect(page.getByTestId("card-checkin")).toContainText("Saved elsewhere, then edited");
    expect((await calls("PUT", /^\/api\/checkins\/current$/)).map(call => [call.body.weekStart, call.body.answers.win, call.body.replace])).toEqual([
      ["2026-01-05", "Shipped the pricing page", false], [week, "", false], [week, "Saved elsewhere, then edited", true],
    ]);
  }, 30_000);

  it("keeps focus on a pillar moved with the keyboard and announces the move", async () => {
    await mount("/dashboard?folder=ideas&view=strategy", { revision: 1,
      strategy: { ...savedStrategy, pillars: [...savedStrategy.pillars, { name: "AI agents", expertise: 1, proof: "" }] } });
    const names = () => page.locator('[data-testid^="input-pillar-name-"]').evaluateAll(nodes => nodes.map(node => (node as HTMLInputElement).value));
    // The row's DOM node travels with its pillar (stable key), so nothing typed or focused inside it is lost.
    await page.getByTestId("pillar-2").evaluate(node => { (node as HTMLElement).dataset.marker = "ai-agents"; });
    await page.getByRole("button", { name: "Move AI agents up" }).focus();
    await page.keyboard.press("Enter");
    await browserExpect(page.getByRole("button", { name: "Move AI agents up" })).toBeFocused();
    await page.keyboard.press("Enter");
    expect(await names()).toEqual(["AI agents", "Retail media", "Pricing"]);
    await browserExpect(page.getByTestId("pillar-0")).toHaveAttribute("data-marker", "ai-agents");
    await browserExpect(page.getByRole("button", { name: "Move AI agents down" })).toBeFocused();
    expect(await page.evaluate(() => document.activeElement?.closest('[data-testid^="pillar-"]')?.getAttribute("data-testid"))).toBe("pillar-0");
    await browserExpect(page.getByTestId("text-pillar-announcement")).toHaveText("Moved AI agents to position 1 of 3.");
  }, 30_000);
});

describe("Ideas accessibility (axe, WCAG 2.1 AA)", () => {
  it("has no violations on the Ideas, 30-day plan and Strategy tabs", async () => {
    const found: Record<string, unknown> = {};
    for (const view of ["ideas", "plan", "strategy"]) {
      await mount(`/dashboard?folder=ideas&view=${view}`);
      await page.waitForTimeout(400);
      const violations = await axeViolations(page, "main");
      if (violations.length) found[view] = violations;
    }
    expect(found).toEqual({});
  }, 30_000);
});
