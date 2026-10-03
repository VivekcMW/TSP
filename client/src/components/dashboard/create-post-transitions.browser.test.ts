import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { chromium, expect as browserExpect, type Browser, type Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
import { readFileSync } from "node:fs";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import { EDITORIAL_RECOVERY_KEY, type EditorialRecovery } from "@/lib/editorial-recovery";
import type { CreatePostContextValue } from "./create-post-provider";
import type { CreatePostComposer } from "./use-create-post-composer";

// UX-04/05: real provider, composer, transport, React Query, routes and Create UI.
// Only authentication/toasts and browser I/O are fixtures. No app server, env
// file, database, AI provider, persisted draft content or external network.
// Run via the parent's isolated test/ux-priority/run.mjs, never root Vitest.
const root = path.resolve(import.meta.dirname, "../../../..");
const origin = "https://composer-transition.test";
const createRoute = "/dashboard/create";
const otherRoute = "/dashboard/content";
const urlA = "https://news.test/a";
const urlB = "https://news.test/b";
const source = "The publisher reports 12% lower latency in a pilot of 30 stores.";
const replacementQuestion = "Replace the source? Current cards and unsaved edits will be discarded. Saved drafts remain in Content.";
const keptNotice = "Your existing creation was kept. Use the source controls to replace it when ready.";
const lockedNotice = "Finish, retry or cancel the current operation before changing the source.";
const copiedNotice = "Copied. Paste and publish manually; publication is not tracked here.";
const jobId = "00000000-0000-4000-8000-000000000041";
const recovery: EditorialRecovery = {
  tenantId: "tenant-a", userId: "fixture-user", jobId,
  requestIntent: "00000000-0000-4000-8000-000000000042",
};
const platforms = ["linkedin", "twitter", "medium"] as const;
const labels = { linkedin: "LinkedIn", twitter: "Twitter/X", medium: "Medium" };
const tones = ["thoughtLeader", "industryInsider", "provocateur", "dataDriven"] as const;
type Platform = typeof platforms[number];
type Tone = typeof tones[number];
type Transition = "url" | "story" | "paste" | "mode";
interface Step {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  url: string;
  body?: unknown;
  status?: number;
  networkError?: boolean;
  defer?: string;
}
interface RecordedCall {
  method: string;
  url: string;
  body: Record<string, unknown> | null;
  headers: Record<string, string>;
  signal?: AbortSignal;
}
interface FixtureWindow extends Window {
  __composer: CreatePostComposer;
  __context: CreatePostContextValue;
  __setScope: (scope: string) => void;
  __setPreferences: (profile: object) => void;
  __openCreate: CreatePostContextValue["openCreate"];
  __steps: Step[];
  __calls: RecordedCall[];
  __unexpected: string[];
  __pending: Record<string, () => void>;
  __deferCopy: boolean;
  __finishCopy?: () => void;
  __copies: string[];
}
let browser: Browser;
let page: Page;
let bundle: string;
let css: string;
let dialogs: { type: string; message: string }[];
let answers: boolean[];
let unexpectedDialogs: string[];
let browserErrors: string[];
let blockedNetwork: string[];

function text(platform: Platform = "linkedin", tone: Tone = "thoughtLeader", suffix = "original") {
  return `${platform}/${tone}: ${suffix}. Desk reports 12% lower latency.`;
}
function review(platform: Platform = "linkedin", suffix = "original", url = urlA) {
  return {
    article: { title: url ? "Pilot" : "My idea", content: source, source: url ? "Desk" : "Your draft", url, domain: url ? "news.test" : "manual" },
    posts: { [platform]: Object.fromEntries(tones.map(tone => [tone, text(platform, tone, suffix)])) },
    details: {}, format: "short-post",
  };
}
const generated = (platform: Platform = "linkedin", suffix = "original", url = urlA): Step => ({
  method: "POST", url: url ? "/api/instant-review/selected" : "/api/instant-review/manual", body: review(platform, suffix, url),
});
const saved = (id: string, content = text(), tone = "professional"): Step => ({ method: "POST", url: "/api/drafts",
  body: { id, content, platform: "linkedin", tone, updatedAt: "2030-01-01T00:00:00.000Z" } });

beforeAll(async () => {
  const result = await build({
    absWorkingDir: root,
    stdin: { resolveDir: root, sourcefile: "create-post-transitions-fixture.tsx", loader: "tsx", contents: `
      import React, { useState } from "react";
      import { createRoot } from "react-dom/client";
      import { QueryClientProvider } from "@tanstack/react-query";
      import { queryClient } from "@/lib/queryClient";
      import { EDITORIAL_RECOVERY_KEY } from "@/lib/editorial-recovery";
      import { CreatePostProvider, useCreatePost } from "@/components/dashboard/create-post-provider";
      import CreatePostPage from "@/pages/create-post";
      import { Link, Route, useLocation } from "wouter";
      const w = window;
      w.__calls = []; w.__unexpected = []; w.__pending = {}; w.__copies = []; w.__toasts = []; w.__draftRows = {};
      if (w.__recovery) sessionStorage.setItem(EDITORIAL_RECOVERY_KEY, JSON.stringify(w.__recovery));
      Object.defineProperty(navigator, "clipboard", { value: { writeText: async text => {
        w.__copies.push(text);
        if (w.__deferCopy) await new Promise(resolve => w.__finishCopy = () => { delete w.__finishCopy; resolve(); });
      } } });
      window.open = () => { w.__unexpected.push("Unexpected platform handoff"); return null; };
      window.fetch = async (input, options = {}) => {
        const url = String(input), method = options.method || "GET";
        const body = options.body instanceof FormData
          ? { files: options.body.getAll("files").map(file => file.name) }
          : options.body ? JSON.parse(options.body) : null;
        w.__calls.push({ url, method, body, headers: Object.fromEntries(new Headers(options.headers)), signal: options.signal });
        if (method === "GET" && url.endsWith("/editing-snapshot")) {
          const row = w.__draftRows[decodeURIComponent(url.split("/")[3])];
          if (!row) w.__unexpected.push("Missing editing snapshot: " + url);
          return new Response(JSON.stringify(row || {}), { status: row ? 200 : 404 });
        }
        const next = w.__steps.shift();
        if (!next || next.url !== url || next.method !== method) {
          const message = "Unexpected request: " + method + " " + url + "; expected " + JSON.stringify(next);
          w.__unexpected.push(message);
          throw new Error(message);
        }
        if (next.defer) await new Promise((resolve, reject) => {
          const abort = () => { delete w.__pending[next.defer]; reject(options.signal.reason); };
          w.__pending[next.defer] = () => {
            delete w.__pending[next.defer];
            options.signal?.removeEventListener("abort", abort);
            resolve();
          };
          options.signal?.addEventListener("abort", abort, { once: true });
          if (options.signal?.aborted) abort();
        });
        if (next.networkError) throw new TypeError("Fixture connection lost");
        if (method === "POST" && url === "/api/drafts" && (!next.status || next.status < 400)) w.__draftRows[next.body.id] = next.body;
        return new Response(JSON.stringify(next.body ?? {}), {
          status: next.status || 200, headers: { "Content-Type": "application/json" },
        });
      };
      const stories = ["a", "b"].map(id => ({ id, headline: "Story " + id,
        source: "Desk", summary: "A detailed report on the pilot and its measured latency results.",
        articleUrl: "https://news.test/" + id, status: "active", matchedKeywords: [] }));
      if (!w.__loadInbox) queryClient.setQueryData(["/api/inbox"], stories);
      w.__setPreferences = profile => queryClient.setQueryData(["/api/profile"], profile);
      if (!w.__loadPreferences) w.__setPreferences({ tenantId: "tenant-a", enabledPlatforms: ["linkedin", "twitter", "medium"], defaultPlatform: "linkedin", defaultTone: "professional" });
      queryClient.setQueryData(["/api/me"], { id: "fixture-user", name: "Ada Builder", email: "ada@example.test", industry: "Technology" });
      queryClient.setQueryData(["/api/integrations"], []);
      function OtherPage() {
        const [value, setValue] = useState("Other route content");
        return <main><h1>Content fixture</h1><input aria-label="Other route text" value={value} onChange={event => setValue(event.target.value)} /></main>;
      }
      function Fixture() {
        const context = useCreatePost();
        const { composer, openCreate, startNewCreate } = context;
        const [location, navigate] = useLocation();
        // Instrumentation belongs ONLY to this in-memory fixture, never production.
        w.__composer = composer; w.__openCreate = openCreate; w.__context = context;
        return <div className="flex h-screen min-h-0 flex-col">
          <nav className="flex shrink-0 flex-wrap gap-3 p-2" aria-label="Fixture navigation">
            <button id="fixture-create" onClick={() => openCreate()}>Global Create</button>
            <button id="fixture-new" onClick={startNewCreate}>New post</button>
            <button id="fixture-story-a" onClick={() => openCreate(stories[0])}>Create story a</button>
            <button id="fixture-story-b" onClick={() => openCreate(stories[1])}>Create story b</button>
            <Link id="fixture-other" href="/dashboard/content">Other route</Link>
            <button id="fixture-state" onClick={() => navigate("/dashboard/create?keep=1", { state: { createFromUrl: w.__link, marker: "retained" } })}>State entry</button>
            <Link id="fixture-query" href={"/dashboard/create?keep=1&article=" + encodeURIComponent(w.__link)}>Article link entry</Link>
          </nav>
          <output id="fixture-route">{location}</output>
          <div className="min-h-0 flex-1 overflow-hidden">
            <Route path="/dashboard/create" component={CreatePostPage} />
            <Route path="/dashboard/content" component={OtherPage} />
          </div>
        </div>;
      }
      function App() {
        const [scope, setScope] = useState("account-a:tenant-a"); w.__setScope = setScope;
        return <QueryClientProvider client={queryClient}><CreatePostProvider key={scope}><Fixture /></CreatePostProvider></QueryClientProvider>;
      }
      createRoot(document.getElementById("root")).render(<App />);
    ` },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"' },
    plugins: [{ name: "fixture-user-boundaries", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/(auth|dev-auth)$|^@\/hooks\/use-toast$/ }, args => ({ path: args.path, namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "js", contents: args.path.includes("auth")
        ? "export const useAuth = () => ({user: {id: 'fixture-user'}}); export const useIsSignedIn = () => true;"
        : "export const useToast = () => ({toast: value => window.__toasts.push(value)});" }));
    } }],
  });
  bundle = result.outputFiles[0].text;
  const stylesheet = readFileSync(path.join(root, "client/src/index.css"), "utf8")
    .replace('@import "./design/tokens.generated.css";', readFileSync(path.join(root, "client/src/design/tokens.generated.css"), "utf8"));
  css = (await postcss([tailwindcss(path.join(root, "tailwind.config.ts"))])
    .process(stylesheet, { from: path.join(root, "client/src/index.css") })).css;
  browser = await chromium.launch({ headless: true });
}, 60_000);

afterEach(async () => {
  try {
    if (page && !page.isClosed()) {
      expect(await page.evaluate(() => (window as unknown as FixtureWindow).__unexpected)).toEqual([]);
      expect(await page.evaluate(() => (window as unknown as FixtureWindow).__steps)).toEqual([]);
      expect(await page.evaluate(() => Object.keys((window as unknown as FixtureWindow).__pending))).toEqual([]);
      expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
    }
    expect(unexpectedDialogs).toEqual([]);
    expect(answers).toEqual([]);
    expect(browserErrors).toEqual([]);
    expect(blockedNetwork).toEqual([]);
  } finally { await page?.close(); }
});
afterAll(async () => { await browser?.close(); });

async function mount(options: { route?: string; state?: unknown; steps?: Step[]; recovery?: EditorialRecovery; loadInbox?: boolean; loadPreferences?: boolean; hasTouch?: boolean } = {}) {
  dialogs = []; answers = []; unexpectedDialogs = []; browserErrors = []; blockedNetwork = [];
  page = await browser.newPage({ viewport: { width: 1280, height: 1100 }, hasTouch: options.hasTouch, reducedMotion: "reduce", serviceWorkers: "block" });
  page.setDefaultTimeout(5000);
  page.on("pageerror", error => browserErrors.push(error.message));
  page.on("dialog", async dialog => {
    dialogs.push({ type: dialog.type(), message: dialog.message() });
    const answer = answers.shift();
    if (answer === undefined) unexpectedDialogs.push(dialog.message());
    if (answer) await dialog.accept(); else await dialog.dismiss();
  });
  // Context-level deny catches popups/subresources as well as this page. The one
  // HTML document is fulfilled locally; fetch never delegates to native fetch.
  await page.context().route("**/*", route => {
    blockedNetwork.push(route.request().url());
    return route.abort();
  });
  await page.route(`${origin}/`, route => route.fulfill({ contentType: "text/html", body: '<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><div id="root"></div>' }));
  await page.goto(`${origin}/`);
  await page.evaluate(({ route, state, steps, recovery, link, loadInbox, loadPreferences }: { route: string; state: unknown; steps: Step[]; recovery?: EditorialRecovery; link: string; loadInbox?: boolean; loadPreferences?: boolean }) => {
    history.replaceState(state, "", route);
    Object.assign(window, { __steps: steps, __recovery: recovery, __link: link, __deferCopy: false, __loadInbox: loadInbox, __loadPreferences: loadPreferences });
  }, { route: options.route ?? createRoute, state: options.state ?? { marker: "retained" }, steps: options.steps ?? [], recovery: options.recovery, link: urlB, loadInbox: options.loadInbox, loadPreferences: options.loadPreferences });
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: bundle });
  await browserExpect(page.locator("#fixture-route")).toHaveText((options.route ?? createRoute).split("?")[0]);
  if (!options.loadPreferences) await browserExpect.poll(() => page.evaluate(() => (window as unknown as FixtureWindow).__composer.preferencesReady)).toBe(true);
}
async function queue(...steps: Step[]) {
  await page.evaluate(steps => (window as unknown as FixtureWindow).__steps.push(...steps), steps);
}
async function release(name: string) {
  await browserExpect.poll(() => page.evaluate(name => Boolean((window as unknown as FixtureWindow).__pending[name]), name)).toBe(true);
  await page.evaluate(name => (window as unknown as FixtureWindow).__pending[name](), name);
}
async function calls() {
  return page.evaluate(() => (window as unknown as FixtureWindow).__calls.map(({ signal, ...call }) => ({ ...call, aborted: signal?.aborted ?? false })));
}
async function expectRequests(expected: [string, string][]) {
  expect((await calls()).map(call => [call.method, call.url])).toEqual(expected);
}
async function idle() {
  await browserExpect.poll(() => page.evaluate(() => (window as unknown as FixtureWindow).__composer.busy)).toBe(false);
}
async function work() {
  return page.evaluate(() => {
    const c = (window as unknown as FixtureWindow).__composer;
    const states = Object.fromEntries(["linkedin", "twitter", "medium"].flatMap(platform =>
      (["thoughtLeader", "industryInsider", "provocateur", "dataDriven"] as const).map(tone => [`${platform}:${tone}`, c.generationState(platform, tone) ?? null])));
    return { mode: c.mode, url: c.url, item: c.item ?? null, manual: c.manual, versions: c.versions,
      states, batch: c.batch, batchStopRequested: c.batchStopRequested, copyStatus: c.copyStatus,
      platform: c.platform, selectedPlatforms: c.selectedPlatforms, tone: c.tone, format: c.requestedFormat, dirty: c.dirty };
  });
}
async function confirmSource(accept: boolean, action: () => Promise<unknown>) {
  const before = dialogs.length;
  answers.push(accept);
  await action();
  expect(dialogs.slice(before)).toEqual([{ type: "confirm", message: replacementQuestion }]);
  expect(answers).toEqual([]);
}
const articleUrl = () => page.getByTestId("input-instant-review-url");
const story = () => page.getByRole("combobox", { name: "Story", exact: true });
const platformTrigger = () => page.getByTestId("button-platforms");
const platformOptions = () => page.getByRole("group", { name: "Platforms to generate", exact: true });
const platformCheckbox = (name: string) => platformOptions().getByRole("checkbox", { name, exact: true });
async function openPlatforms() {
  if (await platformTrigger().getAttribute("aria-expanded") !== "true") await platformTrigger().click();
  await browserExpect(platformOptions()).toBeVisible();
}
const toneSelect = () => page.getByRole("combobox", { name: "Tone", exact: true });
const modeButton = (name: "Idea" | "Article") => page.getByRole("group", { name: "Create from", exact: true }).getByRole("button", { name, exact: true });
const card = (platform: Platform = "linkedin") => page.getByTestId(`social-preview-${platform}`);
const preview = (platform: Platform = "linkedin") => card(platform).getByTestId(`text-post-content-${platform}`);
const saveCard = (platform: Platform = "linkedin") => card(platform).getByRole("button", { name: /^Save (draft|changes)$/, exact: true });
const ideaPlatform = (name: string) => page.getByRole("group", { name: "Platform", exact: true }).getByRole("button", { name, exact: true });
async function generateCard(platform: Platform = "linkedin", suffix = "original", tone: Tone = "thoughtLeader") {
  await card(platform).getByRole("button", { name: `Generate ${labels[platform]}`, exact: true }).click();
  await browserExpect(preview(platform)).toHaveText(text(platform, tone, suffix));
  await idle();
}
async function editCard(value: string, platform: Platform = "linkedin") {
  await card(platform).getByRole("button", { name: "Edit", exact: true }).click();
  await card(platform).getByRole("textbox", { name: `${labels[platform]} post content`, exact: true }).fill(value);
  await card(platform).getByRole("button", { name: "Preview", exact: true }).click();
  await browserExpect(preview(platform)).toHaveText(value);
}
async function saveReadyCard(platform: Platform = "linkedin") {
  await saveCard(platform).click();
  await browserExpect(card(platform).getByRole("button", { name: "Saved", exact: true })).toBeDisabled();
  await idle();
}
async function writeIdea() {
  await modeButton("Idea").click();
  await page.getByRole("textbox", { name: "Article title", exact: true }).fill("My idea");
  await page.getByRole("textbox", { name: "Article text", exact: true }).fill(source);
  await browserExpect(page.getByTestId("button-regenerate")).toBeEnabled();
}
async function expectFreshArticle(url = "") {
  await browserExpect(page.getByRole("heading", { name: "Create post", exact: true })).toHaveCount(1);
  await browserExpect(modeButton("Article")).toHaveAttribute("aria-pressed", "true");
  await browserExpect(modeButton("Idea")).toHaveAttribute("aria-pressed", "false");
  await browserExpect(articleUrl()).toHaveValue(url);
  await browserExpect(story()).toHaveValue("");
  await browserExpect(page.getByRole("heading", { name: "Your platform posts", exact: true })).toBeVisible();
  for (const platform of platforms) {
    await browserExpect(card(platform)).toContainText("Ready to generate");
    await browserExpect(preview(platform)).toHaveCount(0);
  }
  await browserExpect(page.getByTestId("editor-manual-article")).toHaveCount(0);
  expect((await work()).versions).toEqual({});
}
async function expectHistoryClean(state: unknown = { marker: "retained" }) {
  await browserExpect.poll(() => page.evaluate(() => location.search)).toBe("?keep=1");
  await browserExpect.poll(() => page.evaluate(() => history.state)).toEqual(state);
}

describe("UX-04 — canonical Create entry and in-memory resumption", () => {
  it("distinguishes loading stories from an empty inbox while keeping URL entry usable", async () => {
    const item = { id: "a", headline: "Story a", source: "Desk", summary: source, articleUrl: urlA, status: "active", matchedKeywords: [] };
    await mount({ loadInbox: true, steps: [{ method: "GET", url: "/api/inbox", defer: "stories", body: [item] }] });
    await browserExpect(page.getByRole("region", { name: "Choose a story" })).toHaveAttribute("aria-busy", "true");
    await browserExpect(page.getByText("Loading stories… You can still paste an article URL.")).toBeVisible();
    await browserExpect(page.getByText("No saved stories available. Paste an article URL.")).toHaveCount(0);
    await articleUrl().fill(urlB);
    await browserExpect(page.getByTestId("button-generate-selected")).toBeEnabled();
    await release("stories");
    await browserExpect(story().locator("option")).toHaveCount(2);
    await browserExpect(page.getByRole("region", { name: "Choose a story" })).toHaveAttribute("aria-busy", "false");
    await browserExpect(articleUrl()).toHaveValue(urlB);
    await browserExpect(story()).toHaveValue("");
    await expectRequests([["GET", "/api/inbox"]]);
    expect(dialogs).toEqual([]);
  });

  it("offers a read-only story retry after failure without resetting typed input or generating", async () => {
    await mount({ loadInbox: true, steps: [{ method: "GET", url: "/api/inbox", status: 500, body: { message: "Inbox unavailable" } }] });
    await browserExpect(page.getByRole("alert")).toContainText("Could not load stories");
    await browserExpect(page.getByText("No saved stories available. Paste an article URL.")).toHaveCount(0);
    await articleUrl().fill(urlB);
    await queue({ method: "GET", url: "/api/inbox", body: [] });
    await page.getByRole("button", { name: "Retry stories", exact: true }).click();
    await browserExpect(page.getByRole("alert")).toHaveCount(0);
    await browserExpect(page.getByText("No saved stories available. Paste an article URL.")).toBeVisible();
    await expectFreshArticle(urlB);
    await browserExpect(page.getByTestId("button-generate-selected")).toBeEnabled();
    await expectRequests([["GET", "/api/inbox"], ["GET", "/api/inbox"]]);
    expect(dialogs).toEqual([]);
  });

  it.each(["direct", "global"] as const)("fresh %s entry opens one Article board and never generates", async entry => {
    await mount({ route: entry === "direct" ? createRoute : otherRoute });
    if (entry === "global") await page.locator("#fixture-create").click();
    await browserExpect(page.locator("#fixture-route")).toHaveText(createRoute);
    await expectFreshArticle();
    await browserExpect(page.getByTestId("button-generate-selected")).toBeDisabled();
    expect(dialogs).toEqual([]);
    await expectRequests([]);
  });

  it.each(["state", "query"] as const)("consumes a fresh %s link once, preserving unrelated history", async entry => {
    await mount({ route: otherRoute });
    await page.locator(`#fixture-${entry}`).click();
    await expectFreshArticle(urlB);
    await expectHistoryClean(entry === "state" ? { marker: "retained" } : null);
    await articleUrl().fill(urlA);
    await page.locator("#fixture-other").click();
    await page.goBack();
    await browserExpect(page.locator("#fixture-route")).toHaveText(createRoute);
    await browserExpect(articleUrl()).toHaveValue(urlA);
    await expectHistoryClean(entry === "state" ? { marker: "retained" } : null);
    expect(dialogs).toEqual([]);
    await expectRequests([]);
  });

  it("prefers valid navigation state over the article query and scrubs both on direct entry", async () => {
    await mount({ route: `${createRoute}?keep=1&article=${encodeURIComponent(urlB)}`, state: { marker: "retained", createFromUrl: "https://NEWS.test:443" } });
    await expectFreshArticle("https://news.test/");
    await expectHistoryClean();
    await expectRequests([]);
    expect(dialogs).toEqual([]);
  });

  it.each([
    { kind: "empty query", value: "", state: false },
    { kind: "malformed query", value: "not a URL", state: false },
    { kind: "script query", value: "javascript:alert(1)", state: false },
    { kind: "insecure query", value: "http://news.test/a", state: false },
    { kind: "overlong query", value: `https://news.test/${"a".repeat(2048)}`, state: false },
    { kind: "script state", value: "javascript:alert(1)", state: true },
    { kind: "malformed state", value: "not a URL", state: true },
  ])("ignores and removes $kind without generating", async ({ value, state }) => {
    await mount({ route: `${createRoute}?keep=1${state ? "" : `&article=${encodeURIComponent(value)}`}`,
      state: state ? { marker: "retained", createFromUrl: value } : { marker: "retained" } });
    await expectFreshArticle();
    await expectRequests([]);
    expect(dialogs).toEqual([]);
    // Invalid state must be one-shot too, not remain in history for a later visit.
    await expectHistoryClean();
  });

  it("resumes an edited Idea and preserves its existing revision when the source text is edited", async () => {
    await mount();
    await writeIdea();
    await queue(generated("linkedin", "idea", ""), saved("saved-idea", text("linkedin", "thoughtLeader", "idea")));
    await page.getByTestId("button-regenerate").click();
    await browserExpect(page.getByTestId("textarea-post-content")).toHaveValue(text("linkedin", "thoughtLeader", "idea"));
    await idle();
    await page.getByTestId("button-save-draft").click();
    await browserExpect(page.getByTestId("button-save-draft")).toHaveText("Saved");
    await idle();
    await page.getByTestId("textarea-post-content").fill("My reviewed Idea revision");
    const revision = (await work()).versions;
    expect(revision["linkedin:thoughtLeader"].savedId).toBe("saved-idea");
    await page.getByRole("textbox", { name: "Article text", exact: true }).fill(`${source} Additional context.`);
    expect((await work()).versions).toEqual(revision);
    const before = await work();
    await page.locator("#fixture-other").click();
    await page.locator("#fixture-create").click();
    await browserExpect(page.getByTestId("textarea-post-content")).toHaveValue("My reviewed Idea revision");
    await browserExpect(page.getByRole("textbox", { name: "Article text", exact: true })).toHaveText(`${source} Additional context.`);
    await browserExpect.poll(work).toEqual(before);
    await page.locator("#fixture-other").click();
    await page.locator("#fixture-state").click();
    await browserExpect(page.getByText(keptNotice, { exact: true })).toBeVisible();
    await expectHistoryClean();
    await browserExpect.poll(work).toEqual(before);
    expect(dialogs).toEqual([]);
    await expectRequests([["POST", "/api/instant-review/manual"], ["POST", "/api/drafts"],
      ["GET", "/api/drafts/saved-idea/editing-snapshot"], ["GET", "/api/drafts/saved-idea/editing-snapshot"]]);
  });

  it.each(["state", "query"] as const)("resumes saved cards and refuses replacement by a %s link even when clean", async entry => {
    await mount();
    await page.locator("#fixture-story-a").click();
    await queue(generated(), saved("saved-a"));
    await generateCard();
    await saveReadyCard();
    const before = await work();
    expect(before.dirty).toBe(false);
    expect(before.versions["linkedin:thoughtLeader"].savedId).toBe("saved-a");
    await page.locator("#fixture-other").click();
    await page.locator("#fixture-create").click();
    await browserExpect(preview()).toHaveText(text());
    await browserExpect.poll(work).toEqual(before);
    await page.locator("#fixture-other").click();
    await page.locator(`#fixture-${entry}`).click();
    await browserExpect(page.getByText(keptNotice, { exact: true })).toBeVisible();
    await browserExpect(articleUrl()).toHaveValue(urlA);
    await browserExpect(story()).toHaveValue("a");
    await expectHistoryClean(entry === "state" ? { marker: "retained" } : null);
    await browserExpect.poll(work).toEqual(before);
    expect(dialogs).toEqual([]);
    await expectRequests([["POST", "/api/instant-review/selected"], ["POST", "/api/drafts"],
      ["GET", "/api/drafts/saved-a/editing-snapshot"], ["GET", "/api/drafts/saved-a/editing-snapshot"]]);
  });

  it("cancelling cross-route story prefill keeps that route, its input and the entire creation intact", async () => {
    await mount();
    await writeIdea();
    await queue(generated("linkedin", "idea", ""));
    await page.getByTestId("button-regenerate").click();
    await browserExpect(page.getByTestId("textarea-post-content")).toHaveValue(text("linkedin", "thoughtLeader", "idea"));
    await idle();
    await page.getByTestId("textarea-post-content").fill("Keep my unsaved post");
    const before = await work();
    await page.locator("#fixture-other").click();
    await page.getByRole("textbox", { name: "Other route text", exact: true }).fill("Keep this route's input too");
    await confirmSource(false, () => page.locator("#fixture-story-b").click());
    await browserExpect(page.locator("#fixture-route")).toHaveText(otherRoute);
    expect(new URL(page.url()).pathname).toBe(otherRoute);
    await browserExpect(page.getByRole("textbox", { name: "Other route text", exact: true })).toHaveValue("Keep this route's input too");
    await browserExpect(page.getByRole("heading", { name: "Create post", exact: true })).toHaveCount(0);
    expect(await work()).toEqual(before);
    await page.locator("#fixture-create").click();
    await browserExpect(page.getByTestId("textarea-post-content")).toHaveValue("Keep my unsaved post");
    expect(await work()).toEqual(before);
    await expectRequests([["POST", "/api/instant-review/manual"]]);
  });
});

describe("UX-17/18 — explicit new/resume and selection continuity", () => {
  const newQuestion = "Start a new post? Current inputs, cards and unsaved edits will be discarded. Saved drafts remain in Content. Cancel to resume this creation.";

  it("New post cancels losslessly across routes, then atomically resets and fences old callbacks on acceptance", async () => {
    await mount();
    expect(await page.evaluate(() => (window as unknown as FixtureWindow).__context.hasCreation)).toBe(false);
    const before = await seedMultipleVersions();
    expect(await page.evaluate(() => (window as unknown as FixtureWindow).__context.hasCreation)).toBe(true);
    await page.locator("#fixture-other").click();
    answers.push(false);
    await page.locator("#fixture-new").click();
    expect(dialogs.at(-1)).toEqual({ type: "confirm", message: newQuestion });
    await browserExpect(page.locator("#fixture-route")).toHaveText(otherRoute);
    expect(await work()).toEqual(before);
    const requests = await calls();
    answers.push(true);
    await page.evaluate(() => {
      const w = window as unknown as FixtureWindow, old = w.__composer;
      w.__context.startNewCreate();
      void old.generate(); void old.continueBatch(); void old.saveVersion("linkedin", "thoughtLeader");
      void old.copyVersion("twitter", "provocateur"); old.setSelectedPlatforms([]);
    });
    await browserExpect(page.locator("#fixture-route")).toHaveText(createRoute);
    await expectCleared();
    await expectFreshArticle();
    expect(await work()).toMatchObject({ selectedPlatforms: [...platforms], tone: "thoughtLeader", format: "short-post" });
    expect(await calls()).toEqual(requests);
    expect(await page.evaluate(() => (window as unknown as FixtureWindow).__context.hasCreation)).toBe(false);
    expect(await page.evaluate(() => Object.keys(sessionStorage))).toEqual([]);
  }, 20_000);

  it.each(["generation", "save", "upload", "uncertain"] as const)("New post cannot replace a same-turn %s owner", async operation => {
    await mount();
    await page.locator("#fixture-story-a").click();
    if (operation === "save") { await queue(generated()); await generateCard(); await queue({ ...saved("saved-a"), defer: "save" }); }
    if (operation === "generation") await queue({ ...generated(), defer: "generation" });
    if (operation === "uncertain") await queue({ method: "POST", url: "/api/instant-review/selected", networkError: true });
    expect(await page.evaluate(async operation => {
      const c = (window as unknown as FixtureWindow).__composer;
      if (operation === "save") void c.saveVersion("linkedin", "thoughtLeader");
      if (operation === "generation") void c.generatePlatform("linkedin");
      if (operation === "upload") c.setUploading(true);
      if (operation === "uncertain") await c.generatePlatform("linkedin");
      return c.startNewCreate();
    }, operation)).toBe(false);
    await browserExpect(articleUrl()).toHaveValue(urlA);
    await browserExpect(page.getByText(lockedNotice, { exact: true })).toBeVisible();
    expect(dialogs).toEqual([]);
    if (operation === "generation" || operation === "save") await release(operation);
    if (operation === "upload") await page.evaluate(() => (window as unknown as FixtureWindow).__composer.setUploading(false));
    await idle();
    expect((await work()).item?.id).toBe("a");
    expect((await calls()).some(call => call.method === "DELETE")).toBe(false);
  });

  it("retains selected platforms, tone, format and unsaved versions through Resume and browser Back", async () => {
    await mount();
    await page.locator("#fixture-story-a").click();
    await openPlatforms();
    await platformCheckbox("Twitter/X").uncheck();
    await page.keyboard.press("Escape");
    await toneSelect().selectOption("provocateur");
    await page.getByLabel("Format", { exact: true }).selectOption("article");
    await queue(generated("linkedin", "bold"));
    await generateCard("linkedin", "bold", "provocateur");
    await editCard("Retain this private working text");
    const before = await work();
    expect(before.selectedPlatforms).toEqual(["linkedin", "medium"]);
    await page.locator("#fixture-other").click();
    await page.locator("#fixture-create").click();
    await browserExpect(preview()).toHaveText("Retain this private working text");
    expect(await work()).toEqual(before);
    await page.locator("#fixture-other").click(); await page.goBack();
    await openPlatforms();
    await browserExpect(platformCheckbox("Twitter/X")).not.toBeChecked();
    await page.keyboard.press("Escape");
    expect(await work()).toEqual(before);
    await expectRequests([["POST", "/api/instant-review/selected"]]);
    expect(await page.evaluate(() => [Object.keys(localStorage), Object.keys(sessionStorage)])).toEqual([[], []]);
  });

  it("follows a saved card's exact Content link and resumes the other unsaved cards unchanged", async () => {
    await mount(); await articleUrl().fill(urlA);
    await queue(generated(), saved("saved-a"));
    await generateCard(); await saveReadyCard();
    await queue(generated("twitter")); await generateCard("twitter");
    await editCard("Unsaved X text must survive the saved-card handoff", "twitter");
    const before = await work();
    await card().getByRole("link", { name: "Go to Content", exact: true }).click();
    await browserExpect(page.locator("#fixture-route")).toHaveText(otherRoute);
    expect(new URL(page.url()).searchParams.get("draft")).toBe("saved-a");
    expect(await work()).toEqual(before);
    await page.locator("#fixture-create").click();
    await browserExpect(preview("twitter")).toHaveText("Unsaved X text must survive the saved-card handoff");
    await browserExpect.poll(work).toEqual(before);
    await expectRequests([["POST", "/api/instant-review/selected"], ["POST", "/api/drafts"], ["POST", "/api/instant-review/selected"], ["GET", "/api/drafts/saved-a/editing-snapshot"]]);
    expect(dialogs).toEqual([]);
  });

  it("initializes selection only after preferences arrive and never refills an intentional empty selection", async () => {
    const profile = { tenantId: "tenant-a", enabledPlatforms: [...platforms], defaultPlatform: "linkedin" };
    await mount({ loadPreferences: true, steps: [{ method: "GET", url: "/api/profile", body: profile, defer: "preferences" }] });
    await browserExpect(page.getByTestId("button-generate-selected")).toBeDisabled();
    expect((await work()).selectedPlatforms).toEqual([]);
    await release("preferences");
    await browserExpect.poll(async () => (await work()).selectedPlatforms).toEqual([...platforms]);
    await page.evaluate(() => (window as unknown as FixtureWindow).__composer.setSelectedPlatforms([]));
    await page.locator("#fixture-other").click(); await page.locator("#fixture-create").click();
    await browserExpect(page.locator('[data-testid^="social-preview-"]')).toHaveCount(0);
    await page.evaluate(profile => (window as unknown as FixtureWindow).__setPreferences(profile), { ...profile, enabledPlatforms: [...platforms, "threads"] });
    await openPlatforms();
    await browserExpect(platformCheckbox("Threads")).toBeVisible();
    expect((await work()).selectedPlatforms).toEqual([]);
    await expectRequests([["GET", "/api/profile"]]);
  });

  it("guards selection mutations in the same turn as generation and resets it with the account/tenant owner", async () => {
    await mount(); await articleUrl().fill(urlA);
    await openPlatforms();
    await queue({ ...generated(), defer: "generation" });
    await page.evaluate(() => {
      const c = (window as unknown as FixtureWindow).__composer;
      void c.generateBatch(["linkedin"]);
      c.setSelectedPlatforms([]); c.toggleSelectedPlatform("twitter");
    });
    expect((await work()).selectedPlatforms).toEqual([...platforms]);
    await browserExpect(platformTrigger()).toBeDisabled();
    for (const name of ["LinkedIn", "Twitter/X", "Medium"]) await browserExpect(platformCheckbox(name)).toBeDisabled();
    await release("generation"); await idle();
    await browserExpect(platformCheckbox("LinkedIn")).toBeEnabled();
    await page.keyboard.press("Escape");
    await page.evaluate(() => (window as unknown as FixtureWindow).__composer.setSelectedPlatforms(["medium"]));
    await browserExpect.poll(async () => (await work()).selectedPlatforms).toEqual(["medium"]);
    await page.evaluate(() => (window as unknown as FixtureWindow).__setScope("account-b:tenant-b"));
    await expectFreshArticle();
    expect((await work()).selectedPlatforms).toEqual([...platforms]);
    expect(await page.evaluate(() => [Object.keys(localStorage), Object.keys(sessionStorage)])).toEqual([[], []]);
  });

  it("discloses preview-only formatting and restores plain text and separate attachments without persisting DOM styling", async () => {
    await mount(); await writeIdea();
    await browserExpect(page.getByText(/Formatting controls change this editor preview only/)).toBeVisible();
    const editor = page.getByRole("textbox", { name: "Article text", exact: true });
    await editor.focus();
    await page.keyboard.press("ControlOrMeta+a");
    await page.getByRole("button", { name: "Bold", exact: true }).click();
    expect(await editor.locator("b, strong").count()).toBeGreaterThan(0);
    const plainText = (await work()).manual.content;
    const asset = { id: "00000000-0000-4000-8000-000000000045", type: "image", name: "source.png", url: "/uploads/source.png" };
    await queue({ method: "POST", url: "/api/media/upload", body: { assets: [asset] } });
    await page.getByTestId("input-article-media").setInputFiles({ name: "source.png", mimeType: "image/png", buffer: Buffer.from("fixture") });
    await browserExpect(page.getByText("source.png (image)", { exact: true })).toBeVisible();
    await page.locator("#fixture-other").click(); await page.locator("#fixture-create").click();
    await browserExpect(editor).toHaveText(plainText);
    await browserExpect(editor.locator("b, strong, font")).toHaveCount(0);
    expect((await work()).manual).toEqual({ title: "My idea", content: plainText, media: [asset] });
    expect(await page.getByRole("group", { name: "Article formatting toolbar" }).locator("button, select, input").count()).toBe(24);
    await queue(generated("linkedin", "plain text", ""));
    await page.getByTestId("button-regenerate").click();
    await browserExpect(page.getByTestId("textarea-post-content")).toHaveValue(text("linkedin", "thoughtLeader", "plain text"));
    expect((await calls()).at(-1)?.body).toMatchObject({ content: plainText, media: [asset] });
    expect(await page.evaluate(() => [Object.keys(localStorage), Object.keys(sessionStorage)])).toEqual([[], []]);
  });
});

describe("Article source row and checkbox platform picker", () => {
  it.each([
    { width: 320, hasTouch: false, zoom: 1 }, { width: 375, hasTouch: true, zoom: 1 },
    { width: 767, hasTouch: false, zoom: 1 }, { width: 768, hasTouch: false, zoom: 1 },
    { width: 1440, hasTouch: false, zoom: 1 }, { width: 1440, hasTouch: true, zoom: 1 },
    { width: 320, hasTouch: false, zoom: 2 }, { width: 768, hasTouch: false, zoom: 2 },
  ])("aligns sources and contains accessible picker targets at $width px, touch=$hasTouch, zoom=$zoom", async ({ width, hasTouch, zoom }) => {
    await mount({ hasTouch });
    await page.setViewportSize({ width, height: 1000 });
    if (zoom !== 1) await page.addStyleTag({ content: `html { font-size: ${16 * zoom}px; }` });
    await story().selectOption("a");
    await browserExpect(articleUrl()).toHaveValue(urlA);
    const help = "Choose a saved story or paste an article URL. Only one source is needed.";
    await browserExpect(story()).toHaveAccessibleDescription(help);
    await browserExpect(articleUrl()).toHaveAccessibleDescription(new RegExp(help.replaceAll(".", "\\.")));
    const fields = await page.getByTestId("article-source-row").locator("[data-field]").evaluateAll(elements => elements.map(element => {
      const control = element.querySelector<HTMLInputElement | HTMLSelectElement>("input, select")!;
      const box = control.getBoundingClientRect(), label = element.querySelector("label")!.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height, labelY: label.y, required: control.required };
    }));
    expect(fields).toHaveLength(2);
    expect(Math.abs(fields[0].width - fields[1].width)).toBeLessThanOrEqual(1);
    expect(fields.every(field => field.height >= 44 && !field.required)).toBe(true);
    if (width >= 768) {
      expect(Math.abs(fields[0].y - fields[1].y)).toBeLessThanOrEqual(1);
      expect(Math.abs(fields[0].labelY - fields[1].labelY)).toBeLessThanOrEqual(1);
      expect(fields[1].x).toBeGreaterThanOrEqual(fields[0].x + fields[0].width);
    } else {
      expect(fields[0].x).toBe(fields[1].x);
      expect(fields[1].y).toBeGreaterThanOrEqual(fields[0].y + fields[0].height);
    }
    // Read sibling geometry in one layout snapshot, after viewport/text reflow.
    await browserExpect.poll(() => page.getByTestId("article-source-row").evaluate(element => {
      const row = element.getBoundingClientRect();
      const preview = element.parentElement!.querySelector('[data-testid="selected-story-preview"]')!.getBoundingClientRect();
      return { xDifference: preview.x - row.x, widthDifference: preview.width - row.width, below: preview.y >= row.bottom };
    }), { timeout: 1000, intervals: [16, 32, 50] }).toEqual({ xDifference: 0, widthDifference: 0, below: true });
    if (width >= 768 && zoom === 1) {
      const heading = (await page.getByRole("heading", { name: "Your platform posts", exact: true }).boundingBox())!;
      const trigger = (await platformTrigger().boundingBox())!;
      expect(Math.abs(heading.y + heading.height / 2 - trigger.y - trigger.height / 2)).toBeLessThanOrEqual(1);
      expect(trigger.x).toBeGreaterThanOrEqual(heading.x + heading.width);
    }
    const capture = process.env.UX_PRIORITY_TEST_OUTPUT && zoom === 1 && (width === 375 || width === 1440 && !hasTouch);
    if (capture) await page.screenshot({ path: path.join(process.env.UX_PRIORITY_TEST_OUTPUT!, `article-source-${width}.png`), fullPage: true });
    await openPlatforms();
    const popup = page.getByRole("dialog", { name: "Choose platforms" });
    const bounds = (await popup.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    await browserExpect(popup).toHaveCSS("animation-name", "none");
    await browserExpect.poll(() => platformOptions().locator("label").evaluateAll(elements => Math.min(...elements.map(element => element.getBoundingClientRect().height))),
      { timeout: 1000, intervals: [16, 32, 50] }).toBeGreaterThanOrEqual(width < 768 || hasTouch ? 44 : 36);
    const targets = await platformOptions().locator("label").evaluateAll(elements => elements.map(element => {
      const box = element.getBoundingClientRect();
      return { y: box.y, bottom: box.bottom, width: box.width, height: box.height, icons: element.querySelectorAll("svg").length };
    }));
    expect(targets).toHaveLength(3);
    expect(targets.every(target => target.height >= (width < 768 || hasTouch ? 44 : 36) && target.width >= 44 && target.icons > 0)).toBe(true);
    expect(targets.slice(1).every((target, index) => target.y >= targets[index].bottom)).toBe(true);
    if (capture) await page.screenshot({ path: path.join(process.env.UX_PRIORITY_TEST_OUTPUT!, `article-platforms-${width}.png`), fullPage: true });
    // Activate the label edge, well outside the 16px checkbox: the whole row is the target.
    const label = platformOptions().locator("label").first();
    const position = { x: (await label.boundingBox())!.width - 8, y: 12 };
    // Locator actions wait for Popper positioning/actionability; raw viewport
    // coordinates can target the old popup location between animation frames.
    if (hasTouch) await label.tap({ position });
    else await label.click({ position });
    await browserExpect(platformCheckbox("LinkedIn")).not.toBeChecked();
    await browserExpect(popup).toBeVisible();
    await page.keyboard.press("Escape");
    await browserExpect(platformTrigger()).toBeFocused();
    await browserExpect(platformTrigger()).toHaveAccessibleDescription("Twitter/X · Medium");
    expect(await page.locator("[data-page-body]").evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await expectRequests([]);
    expect(dialogs).toEqual([]);
  });

  it("supports Enter, Tab, Space and Escape without closing on selection or generating", async () => {
    await mount();
    await articleUrl().fill(urlA);
    await platformTrigger().focus();
    await platformTrigger().press("Enter");
    for (const name of ["LinkedIn", "Twitter/X", "Medium"]) {
      await browserExpect(platformCheckbox(name)).toBeFocused();
      await page.keyboard.press("Space");
      await browserExpect(platformCheckbox(name)).not.toBeChecked();
      await browserExpect(platformOptions()).toBeVisible();
      if (name !== "Medium") await page.keyboard.press("Tab");
    }
    await browserExpect(platformTrigger()).toHaveText("Platforms · 0/4 selected");
    await browserExpect(page.getByTestId("button-generate-selected")).toBeDisabled();
    await page.keyboard.press("Escape");
    await browserExpect(platformTrigger()).toBeFocused();
    await browserExpect(platformTrigger()).toHaveAccessibleDescription("No platforms selected. Choose at least one to generate.");
    await platformTrigger().press("Enter");
    await page.keyboard.press("Space");
    await browserExpect(platformCheckbox("LinkedIn")).toBeChecked();
    await page.getByRole("heading", { name: "Your platform posts", exact: true }).click();
    await browserExpect(platformOptions()).toHaveCount(0);
    await browserExpect(page.getByTestId("button-generate-selected")).toHaveText("Generate 1 post");
    await browserExpect(page.getByTestId("button-generate-selected")).toBeEnabled();
    await browserExpect(platformTrigger()).toHaveAccessibleDescription("LinkedIn");
    await expectRequests([]);
  });

  it("explains the four-platform cap and allows replacing a selection without closing", async () => {
    const available = ["linkedin", "twitter", "threads", "substack", "medium"];
    await mount({ loadPreferences: true, steps: [{ method: "GET", url: "/api/profile", body: { tenantId: "tenant-a", enabledPlatforms: available } }] });
    await browserExpect(platformTrigger()).toHaveText("Platforms · 4/4 selected");
    await openPlatforms();
    await browserExpect(platformOptions().getByRole("checkbox", { checked: true })).toHaveCount(4);
    await browserExpect(platformCheckbox("Medium")).toBeDisabled();
    await browserExpect(page.getByRole("status").filter({ hasText: "Four selected. Deselect a platform to choose another." })).toBeVisible();
    await platformCheckbox("LinkedIn").uncheck();
    await browserExpect(platformCheckbox("Medium")).toBeEnabled();
    await platformCheckbox("Medium").check();
    await browserExpect(platformOptions()).toBeVisible();
    await browserExpect(platformOptions().getByRole("checkbox", { checked: true })).toHaveCount(4);
    await browserExpect(platformCheckbox("LinkedIn")).toBeDisabled();
    await page.keyboard.press("Escape");
    await browserExpect(platformTrigger()).toHaveAccessibleDescription("Twitter/X · Threads · Substack Notes · Medium");
    await expectRequests([["GET", "/api/profile"]]);
  });

  it("retains edited cards when deselected and restored without saving or regenerating", async () => {
    await mount(); await articleUrl().fill(urlA);
    await queue(generated()); await generateCard();
    await editCard("Keep my reviewed post when hidden");
    const versions = (await work()).versions;
    await openPlatforms();
    await platformCheckbox("LinkedIn").uncheck();
    await browserExpect(card()).toHaveCount(0);
    expect((await work()).versions).toEqual(versions);
    await platformCheckbox("LinkedIn").check();
    await page.keyboard.press("Escape");
    await browserExpect(preview()).toHaveText("Keep my reviewed post when hidden");
    await browserExpect(saveCard()).toBeVisible();
    await browserExpect(card().getByRole("button", { name: "Copy", exact: true })).toBeVisible();
    expect((await work()).versions).toEqual(versions);
    await expectRequests([["POST", "/api/instant-review/selected"]]);
  });
});

describe("UX-11/12 — shared Create frame and preserved toolbar", () => {
  it.each([320, 375, 390, 768, 1024, 1440])("aligns both modes and exposes all formatting controls at %i px", async width => {
    await mount(); await page.setViewportSize({ width, height: 900 });
    for (const mode of ["Article", "Idea"] as const) {
      if (mode === "Idea") await modeButton("Idea").click();
      await browserExpect(page.getByRole("main")).toHaveCount(1);
      await browserExpect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await browserExpect(page.getByRole("heading", { level: 1 })).toHaveCSS("font-size", "24px");
      await browserExpect(page.getByRole("heading", { level: 1 })).toHaveCSS("font-weight", "600");
      const header = page.locator("[data-page-header] [data-page-container]");
      const body = page.locator("[data-page-body]");
      await browserExpect(header).toHaveAttribute("data-page-width", "workbench");
      await browserExpect(body).toHaveAttribute("data-page-width", "workbench");
      expect(await body.evaluate(element => element.tagName)).toBe("DIV");
      // A resize can finish between separate protocol calls. Compare both
      // gutters in the same layout snapshot without relaxing the 1px tolerance.
      await browserExpect.poll(() => page.evaluate(() => {
        const a = document.querySelector("[data-page-header] [data-page-container]")!.getBoundingClientRect();
        const b = document.querySelector("[data-page-body] > [data-page-container]")!.getBoundingClientRect();
        return Math.max(Math.abs(a.x - b.x), Math.abs(a.width - b.width));
      }), { timeout: 1000, intervals: [16, 32, 50] }).toBeLessThanOrEqual(1);
      const layout = await body.evaluate(element => ({ width: element.clientWidth, overflow: element.scrollWidth - element.clientWidth,
        fields: Array.from(element.querySelectorAll<HTMLSelectElement>("[data-field] select")).map(select => {
          const style = getComputedStyle(select), measure = document.createElement("canvas").getContext("2d")!;
          measure.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
          return { width: select.getBoundingClientRect().width, fieldWidth: select.closest("[data-field]")!.getBoundingClientRect().width,
            labelWidth: measure.measureText(select.selectedOptions[0]?.textContent ?? "").width + Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight),
            overflow: select.closest("[data-field]")!.scrollWidth - select.closest("[data-field]")!.clientWidth };
        }) }));
      expect(layout.overflow, JSON.stringify({ mode, ...layout })).toBeLessThanOrEqual(1);
      for (const field of layout.fields) {
        expect(field.overflow, JSON.stringify(field)).toBeLessThanOrEqual(1);
        expect(field.width, JSON.stringify(field)).toBeLessThanOrEqual(field.fieldWidth + 1);
        expect(field.width, JSON.stringify(field)).toBeGreaterThanOrEqual(field.labelWidth);
      }
      for (const control of await page.getByRole("group", { name: "Create from", exact: true }).getByRole("button").all()) expect((await control.boundingBox())!.height).toBe(width < 768 ? 44 : 32);
    }
    const toolbar = page.getByRole("group", { name: "Article formatting toolbar" });
    const controls = toolbar.locator("button, select, input");
    expect(await controls.count()).toBe(24);
    for (const control of await controls.all()) {
      await control.focus();
      expect(await control.evaluate(element => {
        const box = element.getBoundingClientRect(), strip = element.closest("fieldset")!.getBoundingClientRect();
        return box.left >= strip.left && box.right <= strip.right;
      })).toBe(true);
    }
    expect(await page.locator("[data-page-body]").evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    await expectRequests([]);
  });
});

// Deliberately seed through the real UI, not by injecting versions: two tones,
// saved IDs, a failed PATCH, a failed batch, another failed platform and a copy.
async function seedMultipleVersions() {
  await page.locator("#fixture-story-a").click();
  await queue(generated(), { method: "POST", url: "/api/instant-review/selected", status: 422, body: { message: "Twitter source unavailable" } });
  await page.getByTestId("button-generate-selected").click();
  await browserExpect(card("twitter")).toContainText("Needs retry");
  await idle();
  await queue(saved("saved-original"));
  await saveReadyCard();
  await editCard("Edited saved original");
  await queue({ method: "PATCH", url: "/api/drafts/saved-original", status: 500, body: { message: "Save unavailable" } });
  await saveCard().click();
  await browserExpect(card().getByRole("alert")).toContainText("Your text is retained");
  await idle();
  await toneSelect().selectOption("provocateur");
  await queue(generated("linkedin", "bold"), saved("saved-bold", text("linkedin", "provocateur", "bold"), "contrarian"));
  await generateCard("linkedin", "bold", "provocateur");
  await saveReadyCard();
  await queue(generated("twitter", "bold"));
  await generateCard("twitter", "bold", "provocateur");
  await queue({ method: "POST", url: "/api/instant-review/selected", status: 422, body: { message: "Medium source unavailable" } });
  await card("medium").getByRole("button", { name: "Generate Medium", exact: true }).click();
  await browserExpect(card("medium")).toContainText("Needs retry");
  await browserExpect(page.getByRole("alert")).toHaveText("Medium source unavailable");
  await idle();
  await card("twitter").getByRole("button", { name: "Copy", exact: true }).click();
  await browserExpect(page.getByText(copiedNotice, { exact: true })).toBeVisible();
  const state = await work();
  expect(Object.keys(state.versions).sort()).toEqual(["linkedin:provocateur", "linkedin:thoughtLeader", "twitter:provocateur"]);
  expect(state.versions["linkedin:thoughtLeader"]).toMatchObject({ savedId: "saved-original", content: "Edited saved original", status: "failed", error: expect.stringContaining("Save unavailable") });
  expect(state.versions["linkedin:provocateur"].savedId).toBe("saved-bold");
  expect(state.batch).toEqual({ targets: ["linkedin", "twitter", "medium"], completed: ["linkedin"], failed: "twitter" });
  expect(state.states["twitter:thoughtLeader"]).toBe("failed");
  expect(state.states["medium:provocateur"]).toBe("failed");
  await expectRequests([
    ["POST", "/api/instant-review/selected"], ["POST", "/api/instant-review/selected"],
    ["POST", "/api/drafts"], ["PATCH", "/api/drafts/saved-original"],
    ["POST", "/api/instant-review/selected"], ["POST", "/api/drafts"],
    ["POST", "/api/instant-review/selected"], ["POST", "/api/instant-review/selected"],
  ]);
  return state;
}
async function changeSource(kind: Transition) {
  if (kind === "url") await articleUrl().fill(urlB);
  else if (kind === "story") await story().selectOption("b");
  else if (kind === "paste") await story().selectOption("");
  else await modeButton("Idea").click();
}
async function expectCleared() {
  await browserExpect.poll(async () => (await work()).versions).toEqual({});
  const state = await work();
  expect(state.versions).toEqual({});
  expect(Object.values(state.states)).toEqual(Array(12).fill(null));
  expect(state.manual).toEqual({ title: "", content: "", media: [] });
  expect(state.batch).toEqual({ targets: [], completed: [] });
  expect(state.batchStopRequested).toBe(false);
  expect(state.copyStatus).toBe("");
  expect(await page.evaluate(() => {
    const c = (window as unknown as FixtureWindow).__composer;
    return { notice: c.notice, error: c.generation.error, active: c.generation.hasActiveRequest(), recoverable: c.generation.recoverable };
  })).toEqual({ notice: "", error: "", active: false, recoverable: false });
  await browserExpect(page.getByRole("alert")).toHaveCount(0);
  await browserExpect(page.getByText(copiedNotice, { exact: true })).toHaveCount(0);
}

describe("UX-05 — atomic source replacement", () => {
  it.each(["url", "story", "paste", "mode"] as const)("%s replacement cancels losslessly, then clears every version/ID/error/batch/copy on acceptance", async kind => {
    await mount();
    const before = await seedMultipleVersions();
    const requestsBefore = await calls();
    await confirmSource(false, () => changeSource(kind));
    expect(await work()).toEqual(before);
    await browserExpect(articleUrl()).toHaveValue(urlA);
    await browserExpect(story()).toHaveValue("a");
    await browserExpect(preview()).toHaveText(text("linkedin", "provocateur", "bold"));
    expect(await calls()).toEqual(requestsBefore);
    // A late clipboard completion must not put the old success notice back.
    await page.evaluate(() => { (window as unknown as FixtureWindow).__deferCopy = true; });
    await card("twitter").getByRole("button", { name: "Copy", exact: true }).click();
    await browserExpect.poll(() => page.evaluate(() => Boolean((window as unknown as FixtureWindow).__finishCopy))).toBe(true);
    await confirmSource(true, () => changeSource(kind));
    await page.evaluate(() => (window as unknown as FixtureWindow).__finishCopy!());
    await expectCleared();
    const after = await work();
    expect(after.mode).toBe(kind === "mode" ? "manual" : "article");
    expect(after.url).toBe(kind === "url" || kind === "story" ? urlB : "");
    expect(after.item?.id ?? null).toBe(kind === "story" ? "b" : null);
    if (kind === "mode") {
      await browserExpect(page.getByRole("textbox", { name: "Article text", exact: true })).toHaveText("");
      await browserExpect(page.getByTestId("textarea-post-content")).toHaveCount(0);
    } else {
      await browserExpect(story()).toHaveValue(kind === "story" ? "b" : "");
      for (const platform of platforms) await browserExpect(card(platform)).toContainText("Ready to generate");
      await toneSelect().selectOption("thoughtLeader");
      for (const platform of platforms) await browserExpect(card(platform)).toContainText("Ready to generate");
      await toneSelect().selectOption("provocateur");
    }
    await page.evaluate(() => (window as unknown as FixtureWindow).__composer.generate(true));
    expect(await calls()).toEqual(requestsBefore); // No stale lastGeneration retry, DELETE or autosave.

    if (kind === "mode") {
      await page.getByRole("textbox", { name: "Article title", exact: true }).fill("My idea");
      await page.getByRole("textbox", { name: "Article text", exact: true }).fill(source);
      await ideaPlatform("LinkedIn").click();
    } else if (kind === "paste") await articleUrl().fill(urlB);
    await queue(generated("linkedin", "replacement", kind === "mode" ? "" : urlB), saved("saved-replacement", text("linkedin", "provocateur", "replacement"), "contrarian"));
    if (kind === "mode") {
      await page.getByTestId("button-regenerate").click();
      await browserExpect(page.getByTestId("textarea-post-content")).toHaveValue(text("linkedin", "provocateur", "replacement"));
      await idle();
      await page.getByTestId("button-save-draft").click();
      await browserExpect(page.getByTestId("button-save-draft")).toHaveText("Saved");
      await idle();
    } else {
      await generateCard("linkedin", "replacement", "provocateur");
      await saveReadyCard();
    }
    const requests = await calls();
    expect(requests).toHaveLength(10);
    expect(requests.slice(0, 8)).toEqual(requestsBefore);
    expect(requests.slice(8).map(call => [call.method, call.url])).toEqual([
      ["POST", kind === "mode" ? "/api/instant-review/manual" : "/api/instant-review/selected"], ["POST", "/api/drafts"],
    ]);
    expect(requests[9].body).toEqual({ platform: "linkedin", tone: "contrarian", content: text("linkedin", "provocateur", "replacement"), media: [], ...(kind === "story" ? { inboxItemId: "b" } : {}) });
    expect(Object.keys((await work()).versions)).toEqual(["linkedin:provocateur"]);
    expect(dialogs).toHaveLength(2);
  }, 20_000);

  it.each(["Article to Idea", "Idea to Article"] as const)("confirms %s for input alone, retaining on cancel and emptying on accept", async direction => {
    await mount();
    if (direction === "Article to Idea") await articleUrl().fill(urlA);
    else await writeIdea();
    const before = await work();
    const destination = direction === "Article to Idea" ? "Idea" : "Article";
    await confirmSource(false, () => modeButton(destination).click());
    expect(await work()).toEqual(before);
    await confirmSource(true, () => modeButton(destination).click());
    await expectCleared();
    const after = await work();
    expect(after).toMatchObject({ mode: destination === "Idea" ? "manual" : "article", url: "", item: null, dirty: false });
    await expectRequests([]);
  });

  it("allows initial URL typing, deletion and correction without confirmation or automatic generation", async () => {
    await mount();
    await articleUrl().pressSequentially(urlA);
    await browserExpect(articleUrl()).toHaveValue(urlA);
    await browserExpect(page.getByTestId("button-generate-selected")).toBeEnabled();
    await articleUrl().fill("");
    await browserExpect(page.getByTestId("button-generate-selected")).toBeDisabled();
    await articleUrl().fill(urlB);
    await browserExpect(articleUrl()).toHaveValue(urlB);
    await browserExpect(story()).toHaveValue("");
    expect(dialogs).toEqual([]);
    expect((await work()).versions).toEqual({});
    await expectRequests([]);
  });
});

// These invoke public composer actions in ONE JavaScript turn. Separate clicks
// would only exercise rendered disabled flags and miss the ref-lock regression.
async function attemptAllSourceChanges() {
  return page.evaluate(() => {
    const c = (window as unknown as FixtureWindow).__composer;
    return { url: c.setUrl("https://news.test/b"), story: c.prefill(c.inbox[1]),
      mode: c.setMode(c.mode === "article" ? "manual" : "article"), navigation: c.prefillUrl("https://news.test/b") };
  });
}
const blockedChanges = { url: false, story: false, mode: false, navigation: false };

describe("UX-05 — synchronous operation locks and recovery ownership", () => {
  it.each(["generate", "generatePlatform", "generateBatch"] as const)("%s locks source changes in the same turn before React renders busy", async method => {
    await mount();
    await page.locator("#fixture-story-a").click();
    await queue({ ...generated(), defer: "generation" });
    const result = await page.evaluate(method => {
      const c = (window as unknown as FixtureWindow).__composer;
      const renderedBusy = c.busy;
      if (method === "generate") void c.generate();
      else if (method === "generatePlatform") void c.generatePlatform("linkedin");
      else void c.generateBatch(["linkedin"]);
      return { renderedBusy, reset: c.generation.reset(), url: c.setUrl("https://news.test/b"), story: c.prefill(c.inbox[1]),
        mode: c.setMode("manual"), paste: c.selectPasteUrl(), navigation: c.prefillUrl("https://news.test/b") };
    }, method);
    expect(result).toEqual({ renderedBusy: false, reset: false, ...blockedChanges, paste: false });
    await browserExpect(articleUrl()).toBeDisabled();
    await browserExpect(story()).toBeDisabled();
    await browserExpect(modeButton("Idea")).toBeDisabled();
    await browserExpect(articleUrl()).toHaveValue(urlA);
    await browserExpect(story()).toHaveValue("a");
    await browserExpect(page.getByText(keptNotice, { exact: true })).toBeVisible();
    await release("generation");
    await browserExpect(preview()).toHaveText(text());
    await idle();
    expect((await work()).versions["linkedin:thoughtLeader"].inboxItemId).toBe("a");
    await expectRequests([["POST", "/api/instant-review/selected"]]);
    expect((await calls())[0]).toMatchObject({ aborted: false, body: { url: urlA, selectedPlatforms: ["linkedin"], tones: ["thoughtLeader"] } });
    expect(dialogs).toEqual([]);
  });

  it("save locks source replacement synchronously and keeps the acknowledged ID on the original story", async () => {
    await mount();
    await page.locator("#fixture-story-a").click();
    await queue(generated());
    await generateCard();
    await queue({ ...saved("saved-a"), defer: "save" });
    expect(await page.evaluate(() => {
      const c = (window as unknown as FixtureWindow).__composer;
      void c.saveVersion("linkedin", "thoughtLeader");
      return { renderedBusy: c.busy, url: c.setUrl("https://news.test/b"), story: c.prefill(c.inbox[1]),
        mode: c.setMode("manual"), navigation: c.prefillUrl("https://news.test/b"), paste: c.selectPasteUrl() };
    })).toEqual({ renderedBusy: false, ...blockedChanges, paste: false });
    await browserExpect(card().getByRole("button", { name: "Saving…", exact: true })).toBeDisabled();
    await browserExpect(articleUrl()).toHaveValue(urlA);
    await release("save");
    await browserExpect(card().getByRole("button", { name: "Saved", exact: true })).toBeDisabled();
    await idle();
    expect((await work()).versions["linkedin:thoughtLeader"]).toMatchObject({ savedId: "saved-a", inboxItemId: "a", content: text() });
    await expectRequests([["POST", "/api/instant-review/selected"], ["POST", "/api/drafts"]]);
    expect((await calls())[1].body?.inboxItemId).toBe("a");
    expect(dialogs).toEqual([]);
  });

  it("setUploading locks source and generation in the same turn without replacing the Idea revision", async () => {
    await mount();
    await writeIdea();
    const before = await work();
    expect(await page.evaluate(() => {
      const c = (window as unknown as FixtureWindow).__composer;
      c.setUploading(true);
      void c.generate(); void c.generatePlatform("linkedin"); void c.generateBatch(["linkedin"]);
      return { renderedBusy: c.busy, url: c.setUrl("https://news.test/b"), story: c.prefill(c.inbox[1]),
        mode: c.setMode("article"), navigation: c.prefillUrl("https://news.test/b") };
    })).toEqual({ renderedBusy: false, ...blockedChanges });
    await browserExpect(page.getByTestId("button-regenerate")).toBeDisabled();
    await browserExpect(modeButton("Article")).toBeDisabled();
    expect(await work()).toEqual(before);
    await expectRequests([]);
    await page.evaluate(() => (window as unknown as FixtureWindow).__composer.setUploading(false));
    await browserExpect(page.getByTestId("button-regenerate")).toBeEnabled();
    expect(dialogs).toEqual([]);
  });

  it("a real deferred attachment upload keeps source edits blocked and attaches only to its original Idea", async () => {
    await mount();
    await writeIdea();
    const asset = { id: "00000000-0000-4000-8000-000000000043", name: "pilot.png", type: "image", url: "/uploads/pilot.png" };
    await queue({ method: "POST", url: "/api/media/upload", defer: "upload", body: { assets: [asset] } });
    await page.getByTestId("input-article-media").setInputFiles({ name: "pilot.png", mimeType: "image/png", buffer: Buffer.from("fixture image") });
    await browserExpect(page.getByRole("button", { name: "Uploading…", exact: true })).toBeDisabled();
    expect(await attemptAllSourceChanges()).toEqual(blockedChanges);
    await release("upload");
    await browserExpect(page.getByText("pilot.png (image)", { exact: true })).toBeVisible();
    await browserExpect(page.getByTestId("button-regenerate")).toBeEnabled();
    expect((await work()).manual).toEqual({ title: "My idea", content: source, media: [asset] });
    expect((await work()).mode).toBe("manual");
    await expectRequests([["POST", "/api/media/upload"]]);
    expect((await calls())[0]).toMatchObject({ aborted: false, body: { files: ["pilot.png"] } });
    expect(dialogs).toEqual([]);
  });

  it.each(["url", "story", "paste", "mode"] as const)("accepted %s replacement fences generation from the old render's closures", async kind => {
    await mount();
    await page.locator("#fixture-story-a").click();
    await confirmSource(true, () => page.evaluate(kind => {
      const c = (window as unknown as FixtureWindow).__composer;
      let accepted: boolean;
      if (kind === "url") accepted = c.setUrl("https://news.test/b");
      else if (kind === "story") accepted = c.prefill(c.inbox[1]);
      else if (kind === "paste") accepted = c.selectPasteUrl();
      else accepted = c.setMode("manual");
      if (!accepted) throw new Error("Fixture expected source acceptance");
      // No await/rerender between acceptance and these stale callbacks.
      void c.generate(); void c.generatePlatform("linkedin"); void c.generateBatch(["linkedin"]);
    }, kind));
    await browserExpect.poll(async () => (await work()).url).toBe(kind === "url" || kind === "story" ? urlB : "");
    await expectCleared();
    await expectRequests([]);
    if (kind === "mode") {
      await page.getByRole("textbox", { name: "Article title", exact: true }).fill("My idea");
      await page.getByRole("textbox", { name: "Article text", exact: true }).fill(source);
    } else if (kind === "paste") await articleUrl().fill(urlB);
    await queue(generated("linkedin", "fresh", kind === "mode" ? "" : urlB));
    if (kind === "mode") {
      await page.getByTestId("button-regenerate").click();
      await browserExpect(page.getByTestId("textarea-post-content")).toHaveValue(text("linkedin", "thoughtLeader", "fresh"));
      await idle();
    } else await generateCard("linkedin", "fresh");
    await expectRequests([["POST", kind === "mode" ? "/api/instant-review/manual" : "/api/instant-review/selected"]]);
    expect((await calls())[0].body).toMatchObject(kind === "mode" ? { title: "My idea", content: source } : { url: urlB });
  });

  it("preserves uncertain admission across every source action and navigation, then retries exactly the same UUID/body", async () => {
    await mount();
    await page.locator("#fixture-story-a").click();
    await queue({ method: "POST", url: "/api/instant-review/selected", networkError: true });
    await card().getByRole("button", { name: "Generate LinkedIn", exact: true }).click();
    await browserExpect(page.getByRole("alert")).toHaveText("Fixture connection lost");
    await idle();
    const before = await work();
    const original = (await calls())[0];
    expect(original.body?.requestIntent).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(await attemptAllSourceChanges()).toEqual(blockedChanges);
    expect(await page.evaluate(() => (window as unknown as FixtureWindow).__composer.selectPasteUrl())).toBe(false);
    await browserExpect(page.getByText(lockedNotice, { exact: true })).toBeVisible();
    await browserExpect(articleUrl()).toBeDisabled();
    await browserExpect(story()).toBeDisabled();
    await browserExpect(modeButton("Idea")).toBeDisabled();
    expect(await work()).toEqual(before);
    await browserExpect(card().getByRole("button", { name: "Generate LinkedIn again", exact: true })).toBeDisabled();
    await page.locator("#fixture-other").click();
    await page.locator("#fixture-story-b").click();
    await browserExpect(page.locator("#fixture-route")).toHaveText(otherRoute);
    await page.locator("#fixture-query").click();
    await browserExpect(page.getByText(keptNotice, { exact: true })).toBeVisible();
    await expectHistoryClean(null);
    expect(await work()).toEqual(before);
    await expectRequests([["POST", "/api/instant-review/selected"]]);
    expect(await page.evaluate(() => Object.keys(sessionStorage))).toEqual([]); // No admitted job yet.
    await queue({ method: "POST", url: "/api/instant-review/selected", status: 202, body: { jobId } },
      { method: "GET", url: `/api/editorial/jobs/${jobId}`, body: { status: "completed" } },
      { method: "GET", url: `/api/editorial/jobs/${jobId}/result`, body: review("linkedin", "recovered") });
    await page.getByRole("button", { name: "Retry same request", exact: true }).click();
    await browserExpect(preview()).toHaveText(text("linkedin", "thoughtLeader", "recovered"));
    await idle();
    await expectRequests([["POST", "/api/instant-review/selected"], ["POST", "/api/instant-review/selected"],
      ["GET", `/api/editorial/jobs/${jobId}`], ["GET", `/api/editorial/jobs/${jobId}/result`]]);
    expect((await calls())[1].body).toEqual(original.body);
    expect((await work()).versions["linkedin:thoughtLeader"].inboxItemId).toBe("a");
    expect(await page.evaluate(key => sessionStorage.getItem(key), EDITORIAL_RECOVERY_KEY)).toBeNull();
    expect(dialogs).toEqual([]);
  });

  it("makes Idea source editing read-only during uncertainty instead of silently ignoring visible edits", async () => {
    await mount();
    await writeIdea();
    await queue({ method: "POST", url: "/api/instant-review/manual", networkError: true });
    await page.getByTestId("button-regenerate").click();
    await browserExpect(page.getByRole("alert")).toHaveText("Fixture connection lost");
    await idle();
    const editor = page.getByRole("textbox", { name: "Article text", exact: true });
    await browserExpect(editor).toHaveAttribute("contenteditable", "false");
    await browserExpect(editor).toHaveAttribute("aria-readonly", "true");
    await browserExpect(editor).not.toBeEditable();
    await browserExpect(page.getByRole("textbox", { name: "Article title", exact: true })).toBeDisabled();
    await browserExpect(page.getByRole("button", { name: "Add media", exact: true })).toBeDisabled();
    const controls = page.getByRole("group", { name: "Article formatting toolbar" }).locator("button, select, input");
    expect(await controls.count()).toBe(24);
    for (const control of await controls.all()) await browserExpect(control).toBeDisabled();
    const original = (await calls())[0];
    expect(await attemptAllSourceChanges()).toEqual(blockedChanges);
    await browserExpect(editor).toHaveText(source);
    expect((await work()).manual).toEqual({ title: "My idea", content: source, media: [] });
    await expectRequests([["POST", "/api/instant-review/manual"]]);
    await queue({ method: "POST", url: "/api/instant-review/manual", status: 202, body: { jobId } },
      { method: "GET", url: `/api/editorial/jobs/${jobId}`, body: { status: "completed" } },
      { method: "GET", url: `/api/editorial/jobs/${jobId}/result`, body: review("linkedin", "recovered idea", "") });
    await page.getByRole("button", { name: "Retry same request", exact: true }).click();
    await browserExpect(page.getByTestId("textarea-post-content")).toHaveValue(text("linkedin", "thoughtLeader", "recovered idea"));
    await browserExpect(editor).toBeEditable();
    await browserExpect(editor).toHaveAttribute("aria-readonly", "false");
    await expectRequests([["POST", "/api/instant-review/manual"], ["POST", "/api/instant-review/manual"],
      ["GET", `/api/editorial/jobs/${jobId}`], ["GET", `/api/editorial/jobs/${jobId}/result`]]);
    expect((await calls())[1].body).toEqual(original.body);
    await editor.fill(`${source} Reviewed source update.`);
    expect((await work()).manual.content).toBe(`${source} Reviewed source update.`);
    expect(dialogs).toEqual([]);
  });

  it("forgets terminal recovery ownership on source replacement so a stale Retry cannot restore the old article", async () => {
    await mount({ recovery, steps: [
      { method: "GET", url: `/api/editorial/jobs/${jobId}`, body: { status: "completed" } },
      { method: "GET", url: `/api/editorial/jobs/${jobId}/result`, body: review("linkedin", "reattached") },
    ] });
    await browserExpect(preview()).toHaveText(text("linkedin", "thoughtLeader", "reattached"));
    await idle();
    await confirmSource(true, () => articleUrl().fill(urlB));
    await expectCleared();
    expect(await page.evaluate(() => {
      const g = (window as unknown as FixtureWindow).__composer.generation;
      return { reattached: g.reattached, progress: g.progress, elapsed: g.elapsed };
    })).toEqual({ reattached: false, progress: null, elapsed: 0 });
    await page.evaluate(async () => {
      const c = (window as unknown as FixtureWindow).__composer;
      await c.generate(true);
      await c.generation.retry();
    });
    await expectFreshArticle(urlB);
    await expectRequests([["GET", `/api/editorial/jobs/${jobId}`], ["GET", `/api/editorial/jobs/${jobId}/result`]]);
    await queue(generated("linkedin", "new source", urlB));
    await generateCard("linkedin", "new source");
    const requests = await calls();
    expect(requests).toHaveLength(3);
    expect(requests[2]).toMatchObject({ method: "POST", url: "/api/instant-review/selected", body: { url: urlB } });
    expect(requests[2].body?.requestIntent).not.toBe(recovery.requestIntent);
  });

  it.each(["retry", "cancel"] as const)("loaded recovery survives link arrival/source attempts and explicit %s never admits another job", async action => {
    await mount({ route: `${createRoute}?keep=1&article=${encodeURIComponent(urlB)}`, recovery,
      steps: [{ method: "GET", url: `/api/editorial/jobs/${jobId}`, defer: "reconnect", status: 403, body: { message: "Status temporarily inaccessible" } }] });
    await browserExpect(page.getByText(keptNotice, { exact: true })).toBeVisible();
    await expectHistoryClean();
    await browserExpect(articleUrl()).toHaveValue("");
    await browserExpect(articleUrl()).toBeDisabled();
    expect(await attemptAllSourceChanges()).toEqual(blockedChanges);
    await release("reconnect");
    await browserExpect(page.getByRole("alert")).toHaveText("Status temporarily inaccessible");
    await idle();
    expect(await page.evaluate(() => {
      const c = (window as unknown as FixtureWindow).__composer;
      return { active: c.generation.hasActiveRequest(), recoverable: c.generation.recoverable, reattached: c.generation.reattached };
    })).toEqual({ active: true, recoverable: true, reattached: true });
    expect(await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)!), EDITORIAL_RECOVERY_KEY)).toEqual(recovery);
    expect(await attemptAllSourceChanges()).toEqual(blockedChanges);
    await page.locator("#fixture-other").click();
    await page.locator("#fixture-state").click();
    await browserExpect(page.getByText(keptNotice, { exact: true })).toBeVisible();
    await expectHistoryClean();
    await expectRequests([["GET", `/api/editorial/jobs/${jobId}`]]);
    await browserExpect(page.getByTestId("button-generate-selected")).toBeDisabled();

    if (action === "retry") {
      await queue({ method: "GET", url: `/api/editorial/jobs/${jobId}`, body: { status: "completed" } },
        { method: "GET", url: `/api/editorial/jobs/${jobId}/result`, body: review("linkedin", "reattached") });
      await page.getByRole("button", { name: "Retry same request", exact: true }).click();
      await browserExpect(preview()).toHaveText(text("linkedin", "thoughtLeader", "reattached"));
      await idle();
      await expectRequests([["GET", `/api/editorial/jobs/${jobId}`], ["GET", `/api/editorial/jobs/${jobId}`], ["GET", `/api/editorial/jobs/${jobId}/result`]]);
    } else {
      await queue({ method: "DELETE", url: `/api/editorial/jobs/${jobId}`, defer: "cancel", networkError: true });
      await page.getByRole("button", { name: "Cancel generation", exact: true }).click();
      expect(await attemptAllSourceChanges()).toEqual(blockedChanges);
      await release("cancel");
      await browserExpect(page.getByRole("alert")).toHaveText("Cancellation could not be confirmed. The job may still be running. Retry or cancel again.");
      expect(await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)!), EDITORIAL_RECOVERY_KEY)).toEqual(recovery);
      expect(await attemptAllSourceChanges()).toEqual(blockedChanges);
      await queue({ method: "DELETE", url: `/api/editorial/jobs/${jobId}`, body: { status: "cancelled" } });
      await page.getByRole("button", { name: "Cancel generation", exact: true }).click();
      await browserExpect(page.getByRole("alert")).toHaveText("Generation cancelled. An attempt that already started may still count toward usage.");
      await expectRequests([["GET", `/api/editorial/jobs/${jobId}`], ["DELETE", `/api/editorial/jobs/${jobId}`], ["DELETE", `/api/editorial/jobs/${jobId}`]]);
      expect((await work()).versions).toEqual({});
      await articleUrl().fill(urlB);
      await browserExpect(articleUrl()).toHaveValue(urlB);
      await browserExpect(page.getByTestId("button-generate-selected")).toBeEnabled();
    }
    const requests = await calls();
    expect(requests).toHaveLength(3);
    expect(requests.every(call => call.headers["x-tenant-id"] === recovery.tenantId)).toBe(true);
    expect(requests.every(call => call.body === null && !call.aborted)).toBe(true);
    expect(await page.evaluate(key => sessionStorage.getItem(key), EDITORIAL_RECOVERY_KEY)).toBeNull();
    expect(dialogs).toEqual([]);
  });
});