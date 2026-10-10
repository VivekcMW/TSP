import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { chromium, expect as browserExpect, type Browser, type Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
import { readFileSync } from "node:fs";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import { PLATFORMS } from "@/lib/platforms";
import type { CreatePostComposer } from "./use-create-post-composer";

// Real React, TanStack Query, Radix dialogs and Chromium; all data boundaries are mocked.
// No application server, authentication session, network, database or provider is used.
let browser: Browser;
let page: Page;
let bundle: string;
let css: string;
const source = "The publisher reports 12% lower latency in a pilot of 30 stores.";
function response(platform = "linkedin", suffix = "original", empty = false) {
  const text = empty ? " " : `${platform} ${suffix}: Desk reports 12% lower latency.`;
  const passage = suffix === "original" ? source : `${source} Snapshot: ${suffix}.`;
  const evidence = { sourceId: suffix, title: "Pilot", source: "Desk", url: "https://news.test/a", sourceBrief: passage, excerpts: [{ id: "p1", text: passage, start: 0, end: passage.length }], warnings: [{ code: "metadata_only", message: "Only a page description was extracted, not the article body." }], suppliedCharacters: passage.length, retainedCharacters: passage.length, verification: "source-excerpts-only" };
  const detail = { content: text, attributions: [{ text, excerptIds: ["p1"] }], generation: { provider: "openrouter", model: "mock-fallback-model", fallbackUsed: true, usage: { inputTokens: 20, outputTokens: 10 }, attempts: [] }, validation: { factualVerification: "not-performed", requiresHumanReview: true, structural: "passed", attributionMapping: "passed" } };
  const tones = ["thoughtLeader", "industryInsider", "provocateur", "dataDriven"];
  return { ...detail, evidence, article: { title: "Pilot", headline: "Pilot", source: "Desk", url: "https://news.test/a", articleUrl: "https://news.test/a", domain: "news.test", content: passage, summary: passage }, posts: { [platform]: Object.fromEntries(tones.map(tone => [tone, text])) }, details: { [platform]: Object.fromEntries(tones.map(tone => [tone, detail])) }, format: "short-post", usage: detail.generation.usage, fallbackUsed: true };
}
function manualResponse(platform = "linkedin", suffix = "original") {
  return { ...response(platform, suffix), article: { title: "Manual source", content: source, source: "Your draft", url: "", domain: "manual" } };
}

beforeAll(async () => {
  const result = await build({
    absWorkingDir: path.resolve(import.meta.dirname, "../../../.."),
    stdin: { resolveDir: path.resolve(import.meta.dirname, "../../../.."), sourcefile: "editorial-test-harness.tsx", loader: "tsx", contents: `
      import React, { useRef, useState } from "react";
      import { createRoot } from "react-dom/client";
      import { QueryClientProvider } from "@tanstack/react-query";
      import { queryClient } from "@/lib/queryClient";
      import { CreatePostProvider, useCreatePost } from "@/components/dashboard/create-post-provider";
      import { PostGeneratorModal } from "@/components/dashboard/post-generator-modal";
      import { PlatformComposeAction } from "@/components/platform-compose-action";
      import Dashboard from "@/pages/dashboard";
      import CreatePostPage from "@/pages/create-post";
      import { Link, Route, useLocation } from "wouter";
      window.__calls = []; window.__actions = []; window.__pending = []; window.__toasts = []; window.__draftRows = {};
      window.__queryClient = queryClient;
      window.__nativeOpen = window.open.bind(window);
      window.__popups = [];
      window.__finishCopies = []; window.__busyChanges = []; window.__directPublishes = 0;
      window.__handoffOwner = { unsafe: false, publishing: false, draftId: "draft-a" };
      window.open = (url, target) => {
        window.__actions.push(["reserve", url, target]);
        if (window.__popupBlocked) return null;
        const doc = document.implementation.createHTMLDocument();
        const createElement = doc.createElement.bind(doc);
        doc.createElement = tag => {
          const element = createElement(tag);
          if (tag === "a") element.click = () => {
            if (window.__navigateFails) throw new Error("Tab unavailable");
            window.__actions.push(["open", element.href, popup.opener, element.referrerPolicy]);
          };
          return element;
        };
        const popup = { opener: window, closed: false, document: doc, close: () => { popup.closed = true; } };
        window.__popups.push(popup);
        return popup;
      };
      Object.defineProperty(navigator, "clipboard", { value: { writeText: async text => {
        window.__actions.push(["copy", text]);
        if (window.__deferCopy) await new Promise(resolve => { window.__finishCopy = resolve; window.__finishCopies.push(resolve); });
        if (window.__copyFails) throw new Error("Clipboard denied");
      } } });
      window.fetch = async (url, options = {}) => {
        window.__calls.push({ url, method: options.method, body: options.body instanceof FormData ? { files: options.body.getAll("files").length } : options.body ? JSON.parse(options.body) : null, signal: options.signal });
        if (url === "/api/creation-session") {
          const current = window.__creations[window.__scope] ||= { revision: 0, state: null };
          if (options.method === "PUT") {
            const body = JSON.parse(options.body);
            if (body.revision !== current.revision) return new Response(JSON.stringify({ message: "Creation changed" }), { status: 409 });
            window.__creations[window.__scope] = { revision: current.revision + 1, state: body.state };
          }
          return new Response(JSON.stringify(window.__creations[window.__scope]), { headers: { "Content-Type": "application/json" } });
        }
        if (String(url).includes("instant-review") && JSON.parse(options.body).stage === "main") {
          const request = JSON.parse(options.body);
          const sourceUrl = request.url || request.sourceUrls?.[0] || request.sourceUrl || "";
          const article = { ...window.__fallback.article, title: sourceUrl ? "Pilot" : request.title || "Manual source", url: sourceUrl, source: sourceUrl ? "Desk" : "Your draft", domain: sourceUrl ? "news.test" : "manual" };
          return new Response(JSON.stringify({ ...window.__fallback, article, posts: {}, details: {}, mainDraft: { content: ${JSON.stringify(source)} } }), { headers: { "Content-Type": "application/json" } });
        }
        let next;
        if (url === "/api/media/upload") next = window.__uploadResponses.shift();
        else if (String(url).endsWith("/editing-snapshot") && options.method === "GET") next = { body: window.__draftRows[String(url).split("/")[3]] };
        else if (String(url).startsWith("/api/drafts") && ["POST", "PATCH"].includes(options.method)) {
          next = window.__saveResponses.shift() || { savedId: "saved" };
          if (!next.networkError && (!next.status || next.status < 400)) {
            const data = JSON.parse(options.body), id = options.method === "PATCH" ? String(url).split("/").pop() : next.savedId;
            next = { ...next, body: { ...window.__draftRows[id], ...data, id, content: data.content.trim(), updatedAt: new Date().toISOString() } };
            window.__draftRows[id] = next.body;
          }
        }
        else if (url === "/api/inbox") next = { body: window.__inbox };
        else if (url === "/api/inbox?status=active") next = { body: window.__inbox.filter(item => item.status === "active") };
        else if (String(url).startsWith("/api/inbox/refresh")) next = window.__refreshResponses.shift() || { body: { count: 0 } };
        else if (String(url).startsWith("/api/inbox/")) {
          next = window.__triageResponses.shift() || { body: { id: "a" } };
          if (!next.status || next.status < 400) window.__inbox = window.__inbox.map(item => item.id === String(url).split("/").pop() ? { ...item, status: JSON.parse(options.body).status } : item);
        }
        else if (url === "/api/profile") next = { body: window.__profile };
        else if (url === "/api/me") next = { body: { id: "fixture", name: "Ada Builder", email: "ada@example.test", industry: "Technology" } };
        else if (url === "/api/integrations") next = { body: [{ key: "bluesky", enabled: false }] };
        else if (String(url).includes("instant-review") || String(url).includes("editorial/jobs")) next = window.__responses.shift() || { body: window.__fallback };
        else throw new Error("Unmocked API: " + url);
        if (next.defer) await new Promise(resolve => window.__pending.push(resolve));
        if (next.networkError) throw new TypeError("Failed to fetch");
        return new Response(JSON.stringify(next.body), { status: next.status || 200, headers: { "Content-Type": "application/json", ...next.headers } });
      };
      queryClient.setQueryData(["/api/inbox"], window.__inbox);
      queryClient.setQueryData(["/api/profile"], window.__profile);
      queryClient.setQueryData(["/api/me"], { id: "fixture", name: "Ada Builder", email: "ada@example.test", industry: "Technology" });
      queryClient.setQueryData(["/api/integrations"], [{ key: "bluesky", enabled: false }]);
      function Launcher() {
        const { openCreate, composer } = useCreatePost();
        window.__composer = composer;
        const [open, setOpen] = useState(false);
        const [location] = useLocation();
        window.__openCreate = openCreate;
        const item = { id: "a", headline: "Pilot", source: "Desk", summary: "Inbox summary", articleUrl: "https://news.test/a" };
        return <><button id="open" onClick={() => window.__surface === "modal" ? setOpen(true) : openCreate()}>Create</button><button id="open-story" onClick={() => openCreate(item)}>Use story</button><Link id="route" href="/dashboard/content">Content route</Link><div key={location} id="route-content">{location}</div><PostGeneratorModal item={item} isOpen={open} onClose={() => setOpen(false)} onSaveDraft={() => window.__actions.push(["legacy-save"])} onPost={() => window.__actions.push(["legacy-post"])} />{window.__surface === "discover" && <Dashboard />}</>;
      }
      function HandoffFixture() {
        const [props, setProps] = useState({ platform: "linkedin", text: "Reviewed fixture post", disabled: false, visible: true, draftId: "draft-a", allowed: true });
        const pending = useRef(false);
        window.__handoffState = props; window.__handoffBusy = pending;
        window.__setHandoff = patch => setProps(current => ({ ...current, ...patch }));
        window.__tryDirectPublish = () => { if (!pending.current) window.__directPublishes++; };
        return <div data-testid="handoff-fixture" data-handoff-disabled={props.disabled}>{props.visible && <PlatformComposeAction
          platform={props.platform} text={props.text} disabled={props.disabled} testId="fixture-handoff"
          canProceed={() => props.allowed && !window.__handoffOwner.unsafe && !window.__handoffOwner.publishing && window.__handoffOwner.draftId === props.draftId}
          onBusyChange={busy => { pending.current = busy; window.__busyChanges.push(busy); }} />}</div>;
      }
      function Harness() {
        const [scope, setScope] = useState("account-a:tenant-a");
        window.__scope = scope;
        window.__creations ||= {};
        window.__setScope = setScope;
        if (window.__surface === "handoff") return <HandoffFixture />;
        return <QueryClientProvider client={queryClient}>{window.__surface === "public" ? <Launcher /> : <CreatePostProvider key={scope}><Launcher /><Route path="/dashboard/create" component={CreatePostPage} /></CreatePostProvider>}</QueryClientProvider>;
      }
      createRoot(document.getElementById("root")).render(<Harness />);
    ` },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"' },
    plugins: [{ name: "mock-user-boundaries", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/(dev-auth|auth)$|^@\/hooks\/use-toast$/ }, args => ({ path: args.path, namespace: "mock" }));
      builder.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents: args.path.includes("auth") ? "export const useIsSignedIn = () => true; export const useAuth = () => ({user: {id: 'fixture'}});" : "export const useToast = () => ({toast: value => window.__toasts.push(value)});", loader: "js" }));
    } }],
  });
  bundle = result.outputFiles[0].text;
  const root = path.resolve(import.meta.dirname, "../../../..");
  const stylesheet = readFileSync(path.join(root, "client/src/index.css"), "utf8")
    .replace('@import "./design/tokens.generated.css";', readFileSync(path.join(root, "client/src/design/tokens.generated.css"), "utf8"));
  css = (await postcss([tailwindcss(path.join(root, "tailwind.config.ts"))])
    .process(stylesheet, { from: path.join(root, "client/src/index.css") })).css;
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterEach(async () => { await page?.close(); });
afterAll(async () => { await browser?.close(); });

async function mount(surface: "panel" | "modal" | "discover" | "public" | "handoff", responses: unknown[] = [], profile: object = {}, reducedMotion: "reduce" | "no-preference" = "no-preference") {
  page = await browser.newPage({ viewport: { width: 1280, height: 1100 }, reducedMotion });
  page.setDefaultTimeout(5000);
  await page.route("**/*", route => route.abort());
  await page.route("https://editorial.test/", route => route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head></head><body><div id="root"></div></body></html>' }));
  await page.goto("https://editorial.test/");
  await page.evaluate(({ surface, responses, fallback, profile }) => Object.assign(window, { __surface: surface, __responses: responses, __fallback: fallback,
    __saveResponses: [], __triageResponses: [], __refreshResponses: [], __uploadResponses: [], __profile: { enabledPlatforms: ["linkedin", "twitter", "medium", "bluesky"], defaultPlatform: "linkedin", defaultTone: "professional", ...profile },
    __inbox: ["a", "b"].map(id => ({ id, headline: `Story ${id}`, source: "Desk", summary: "Inbox summary", articleUrl: `https://news.test/${id}`, status: "active", matchedKeywords: [] })) }), { surface, responses, fallback: response(), profile });
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: bundle });
  if (surface !== "discover" && surface !== "handoff") await page.locator("#open").click();
}
async function calls() {
  // These legacy orchestration assertions count platform/publication traffic.
  // Main generation is exercised and asserted separately by preparePlatforms.
  return page.evaluate(() => (window as any).__calls.filter((call: any) => call.url !== "/api/creation-session" && call.body?.stage !== "main").map((call: any) => ({ url: call.url, method: call.method, body: call.body, aborted: call.signal?.aborted })));
}
const card = (platform = "linkedin") => page.getByTestId(`social-preview-${platform}`);
const cardGenerate = (platform = "linkedin") => card(platform).getByRole("button", { name: /^(Generate .+|Regenerate)$/ });
const cardSave = (platform = "linkedin") => card(platform).getByRole("button", { name: /^(Save draft|Save changes|Saving…|Saved)$/ });
const cardCopy = (platform = "linkedin") => card(platform).getByRole("button", { name: "Copy", exact: true });
const cardHandoff = (platform = "linkedin") => card(platform).getByTestId(`button-open-${platform}`);
const articlePlatformTrigger = () => page.getByRole("button", { name: /^(Adapt for )?platforms$/ });
const articlePlatformCheckbox = (name: string) => page.getByRole("group", { name: "Platforms to generate" }).getByRole("checkbox", { name, exact: true });
const documentButton = () => page.getByRole("button", { name: "Document", exact: true });
const chat = () => page.getByRole("textbox", { name: "Message Pundit", exact: true });
async function command(action: string) { await chat().fill(`/${action}`); await chat().press("Enter"); }
async function closePanel() {
  if (await page.locator('[role="dialog"][data-state="open"]').count()) await page.getByRole("button", { name: "Close", exact: true }).click();
  await browserExpect(page.getByRole("dialog")).toHaveCount(0);
}
async function versionsView() { await closePanel(); await page.getByRole("button", { name: /^Versions(?: \(\d+\))?$/ }).click(); }
async function useLink(url: string) {
  await closePanel(); await command("link");
  await page.getByRole("textbox", { name: "Article URL", exact: true }).fill(url);
  await page.getByRole("button", { name: "Use article link", exact: true }).click();
}
async function useNotes() {
  await closePanel(); await command("notes");
  const use = page.getByRole("button", { name: "Use notes as source", exact: true });
  if (await use.count()) await use.click();
}
async function proposeMain() {
  await closePanel();
  await chat().fill("Create a careful draft from the supplied source.");
  await chat().press("Enter");
  await browserExpect(page.getByTestId("textarea-main-draft")).toHaveText(source);
  await browserExpect(page.getByRole("button", { name: "Undo AI update", exact: true })).toBeVisible();
  await browserExpect(articlePlatformTrigger()).toBeEnabled();
}
async function changeLength(format: string) {
  await command("length");
  await page.getByRole("button", { name: format === "article" ? "Expanded article" : "Short draft", exact: true }).click();
  await closePanel();
}
const generationProgress = () => page.getByRole("status").filter({ hasText: "Results appear when complete" });
async function cardEditor(platform = "linkedin") {
  const editor = card(platform).getByTestId(`textarea-post-content-${platform}`);
  if (!await editor.isVisible()) await card(platform).getByRole("button", { name: "Edit", exact: true }).click();
  return editor;
}
async function generate(platform = "linkedin") {
  await useLink("https://news.test/a");
  await preparePlatforms();
  await cardGenerate(platform).click();
}
async function preparePlatforms(targets?: string[], versions = true) {
  await proposeMain();
  await browserExpect(page.getByTestId("textarea-main-draft")).toHaveText(source);
  const mainRequest = await page.evaluate(() => (window as any).__calls.findLast((call: any) => call.body?.stage === "main").body);
  expect(mainRequest.selectedPlatforms).toEqual([]);
  await articlePlatformTrigger().click();
  const options = page.getByRole("group", { name: "Platforms to generate" }).getByRole("checkbox");
  await browserExpect(page.getByRole("group", { name: "Platforms to generate" }).locator("input:checked")).toHaveCount(0);
  if (targets) for (const name of targets) await articlePlatformCheckbox(name).check();
  else for (const option of (await options.all()).slice(0, 4)) await option.check();
  if (versions) await versionsView();
}
async function changeTone(tone: string) {
  await command("tone");
  const label = { thoughtLeader: "Thought Leader", industryInsider: "Industry Insider", provocateur: "Provocateur", dataDriven: "Data-Driven" }[tone];
  await page.getByRole("button", { name: label, exact: true }).click();
  await closePanel();
}
async function generateIdea(platform = "linkedin") {
  await useNotes();
  await page.getByRole("textbox", { name: "Article title", exact: true }).fill("Manual source");
  await page.getByRole("textbox", { name: "Article text", exact: true }).fill(source);
  await preparePlatforms();
  await cardGenerate(platform).click();
}
async function expectContent(pattern: string | RegExp, platform = "linkedin") { await browserExpect(await cardEditor(platform)).toHaveValue(pattern); }
async function expectIdeaContent(pattern: string | RegExp) { await expectContent(pattern); }

describe("editorial generation UI (mocked browser)", { timeout: 15_000 }, () => {
  it("keeps publication actions absent until the main draft has been reviewed and platforms explicitly chosen", async () => {
    await mount("panel");
    await useLink("https://news.test/a");
    await proposeMain();
    await browserExpect(page.getByTestId("textarea-main-draft")).toHaveText(source);
    await browserExpect(page.locator('[data-testid^="social-preview-"]')).toHaveCount(0);
    await browserExpect(page.getByRole("button", { name: "Save draft", exact: true })).toHaveCount(0);
    await articlePlatformTrigger().click();
    await browserExpect(page.getByRole("group", { name: "Platforms to generate" }).locator("input:checked")).toHaveCount(0);
    await browserExpect(page.getByTestId("button-generate-selected")).toBeDisabled();
    expect(await calls()).toEqual([]);
  });

  it("uses reviewed main edits rather than re-fetching the source for platform requests", async () => {
    await mount("panel");
    await useLink("https://news.test/a");
    await proposeMain();
    const reviewed = `${source} My interpretation is deliberately cautious.`;
    await page.getByTestId("textarea-main-draft").fill(reviewed);
    await articlePlatformTrigger().click();
    await articlePlatformCheckbox("LinkedIn").check();
    await page.getByTestId("button-generate-selected").click();
    await expectContent(/linkedin original/);
    expect(await calls()).toEqual([expect.objectContaining({ url: "/api/instant-review/manual", body: expect.objectContaining({
      stage: "platform", content: reviewed, sourceUrl: "https://news.test/a", sourceLabel: "Desk", selectedPlatforms: ["linkedin"],
    }) })]);
  });
  it.each([
    ["sources", "Select up to"],
    ["link", "Changing the source replaces the current creation only after your confirmation."],
  ])("shows /%s guidance without starting or altering a creation", async (action, guidance) => {
    await mount("panel", [], {}, "reduce");
    const popup = page.getByRole("dialog");
    await browserExpect(popup).toHaveCount(0);
    const before = await page.evaluate(() => {
      const c = (window as any).__composer as CreatePostComposer;
      return { url: c.url, selected: c.selectedPlatforms, tone: c.tone, versions: c.versions };
    });
    const requests = await calls();
    await command(action);
    await browserExpect(popup).toBeVisible();
    await browserExpect(popup).toContainText(guidance);
    await page.keyboard.press("Escape");
    await browserExpect(popup).toHaveCount(0);
    await browserExpect(articlePlatformTrigger()).toBeDisabled();
    expect(await calls()).toEqual(requests);
    expect(await page.evaluate(() => {
      const c = (window as any).__composer as CreatePostComposer;
      return { url: c.url, selected: c.selectedPlatforms, tone: c.tone, versions: c.versions };
    })).toEqual(before);
    await command("link");
    await page.getByRole("textbox", { name: "Article URL", exact: true }).fill("invalid-url");
    await browserExpect(page.getByRole("button", { name: "Use article link", exact: true })).toBeDisabled();
  });

  it("provides a safe unavailable action outside the provider", async () => {
    await mount("public");
    await browserExpect(page.locator("#open")).toBeVisible();
    expect(await page.evaluate(() => (window as any).__toasts.at(-1)?.title)).toBe("Create is unavailable here");
    expect(await calls()).toEqual([]);
    await browserExpect(page.getByRole("dialog")).toHaveCount(0);
  });

  it("drops session drafts when the provider is keyed to a new account/tenant", async () => {
    await mount("panel"); await generate(); await expectContent(/linkedin original/);
    await (await cardEditor()).fill("Private to scope A");
    await page.evaluate(() => (window as any).__setScope("account-b:tenant-b"));
    await browserExpect(page.getByRole("dialog")).toHaveCount(0);
    await page.locator("#open").click();
    await browserExpect(page.locator('[data-testid^="textarea-post-content-"]')).toHaveCount(0);
    await browserExpect(page.locator('[data-testid^="text-post-content-"]')).toHaveCount(0);
    await browserExpect(card()).toHaveCount(0);
    await browserExpect(page.getByRole("textbox", { name: "Document text", exact: true })).toHaveText("");
    expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  });

  it("admits only one generation for two synchronous clicks", async () => {
    await mount("panel", [{ defer: true, body: response() }]);
    await useLink("https://news.test/a");
    await preparePlatforms();
    await cardGenerate().evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
    await browserExpect(cardGenerate()).toBeDisabled();
    expect(await calls()).toHaveLength(1);
    expect((await calls())[0]).toMatchObject({ url: "/api/instant-review/manual", body: { stage: "platform", content: source, sourceUrl: "https://news.test/a", selectedPlatforms: ["linkedin"], tones: ["thoughtLeader"] } });
    await page.evaluate(() => (window as any).__pending.shift()());
    await expectContent(/linkedin original/);
  });

  it("blocks generation during upload and discards a late attachment after leaving Create", async () => {
    await mount("panel");
    await useNotes();
    await page.getByRole("textbox", { name: "Article title", exact: true }).fill("Manual source");
    await page.getByRole("textbox", { name: "Article text", exact: true }).fill(source);
    await page.evaluate(() => { (window as any).__uploadResponses = [{ defer: true, body: { assets: [{ id: "00000000-0000-4000-8000-000000000001", type: "image", name: "late.png", url: "/uploads/late.png" }] } }]; });
    await page.getByTestId("input-article-media").setInputFiles({ name: "late.png", mimeType: "image/png", buffer: Buffer.from("mock image") });
    await browserExpect(page.getByText("Uploading…", { exact: true })).toBeVisible();
    await browserExpect(page.getByRole("textbox", { name: "Article title", exact: true })).toBeDisabled();
    expect(await page.evaluate(() => ((window as any).__composer as CreatePostComposer).canGenerate)).toBe(false);
    await closePanel();
    await page.locator("#route").click();
    await browserExpect(chat()).toHaveCount(0);
    await page.evaluate(() => (window as any).__pending.shift()());
    await page.locator("#open").click();
    await useNotes();
    await browserExpect(page.getByText("late.png (image)")).toHaveCount(0);
    await browserExpect(page.getByRole("textbox", { name: "Article text", exact: true })).toHaveText(source);
    await browserExpect(page.getByRole("textbox", { name: "Article title", exact: true })).toBeEnabled();
    expect((await calls())[0].aborted).toBe(true);
  });

  it("keeps draft text after a failed PATCH and retries the same saved ID", async () => {
    await mount("panel"); await generate(); await expectContent(/linkedin original/);
    await page.evaluate(() => { (window as any).__saveResponses = [{ defer: true, savedId: "saved" }]; });
    await cardSave().evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
    await browserExpect(cardSave()).toHaveText("Saving…");
    expect((await calls()).filter((call: any) => call.url === "/api/drafts")).toHaveLength(1);
    await page.evaluate(() => (window as any).__pending.shift()());
    await browserExpect(cardSave()).toHaveText("Saved");
    await (await cardEditor()).fill("Updated after saving");
    await page.evaluate(() => { (window as any).__saveResponses = [{ networkError: true }]; });
    await cardSave().click();
    await browserExpect(card().getByRole("alert")).toContainText("Your text is retained");
    await expectContent("Updated after saving");
    await cardSave().click();
    await browserExpect(cardSave()).toHaveText("Saved");
    expect((await calls()).filter((call: any) => call.url.startsWith("/api/drafts")).map((call: any) => [call.method, call.url])).toEqual([["POST", "/api/drafts"], ["PATCH", "/api/drafts/saved"], ["PATCH", "/api/drafts/saved"]]);
  });

  it("uses saved tone and only globally available profile platforms without generating", async () => {
    await mount("panel", [], { defaultTone: "contrarian", defaultPlatform: "medium", enabledPlatforms: ["medium", "bluesky"] });
    await command("tone");
    await browserExpect(page.getByRole("button", { name: "Provocateur", exact: true })).toHaveAttribute("aria-pressed", "true");
    await closePanel();
    await useLink("https://news.test/a");
    await preparePlatforms([], false);
    await browserExpect(articlePlatformCheckbox("Medium")).not.toBeChecked();
    expect(await page.getByRole("group", { name: "Platforms to generate" }).locator("label").allTextContents()).toEqual(["Medium"]);
    await browserExpect(page.locator('[data-testid^="social-preview-"]')).toHaveCount(0);
    expect(await calls()).toEqual([]);
    await page.evaluate(() => {
      (window as any).__queryClient.setQueryData(["/api/profile"], { enabledPlatforms: [] });
    });
    await browserExpect(page.getByTestId("button-generate-selected")).toBeDisabled();
    await browserExpect(page.locator('[data-testid^="social-preview-"]')).toHaveCount(0);
    await browserExpect(page.getByText(/No enabled platforms are available/)).toBeVisible();
  });

  it("keeps edits per tone, confirms overwrites, and retains edits after a failed regeneration", async () => {
    await mount("panel", [{ body: response() }, { status: 422, body: { message: "Provider rejected request" } }]);
    await generate();
    await (await cardEditor()).fill("My reviewed wording");
    await browserExpect(card().getByText(/attribution mappings describe the original generated text only/)).toBeVisible();
    await changeTone("provocateur");
    await browserExpect(card()).toContainText("Ready to generate");
    await browserExpect(card().getByTestId("textarea-post-content-linkedin")).toHaveCount(0);
    await browserExpect(card().getByTestId("text-post-content-linkedin")).toHaveCount(0);
    await changeTone("thoughtLeader");
    await expectContent("My reviewed wording");
    expect(await calls()).toHaveLength(1);
    page.once("dialog", dialog => dialog.dismiss());
    await cardGenerate().click();
    expect(await calls()).toHaveLength(1);
    page.once("dialog", dialog => dialog.accept());
    await cardGenerate().click();
    await browserExpect(page.getByRole("alert")).toContainText("Provider rejected request");
    await expectContent("My reviewed wording");
  });

  it("generates one platform and one tone per request and keeps earlier versions", async () => {
    await mount("panel", [{ body: response() }, { body: response("linkedin", "bold") }]);
    await generate();
    await expectContent(/linkedin original:/);
    await changeTone("provocateur");
    expect(await calls()).toHaveLength(1);
    await cardGenerate().click();
    await expectContent(/linkedin bold:/);
    await changeTone("thoughtLeader");
    await expectContent(/linkedin original:/);
    expect((await calls()).map((call: any) => [call.body.selectedPlatforms, call.body.tones])).toEqual([[["linkedin"], ["thoughtLeader"]], [["linkedin"], ["provocateur"]]]);
    expect((await calls()).every((call: any) => call.url === "/api/instant-review/manual" && call.body.stage === "platform" && call.body.content === source)).toBe(true);
  });

  it("retains failed saves, deduplicates rapid clicks, and PATCHes acknowledged draft IDs", async () => {
    await mount("panel", [{ body: manualResponse() }]); await generateIdea(); await expectIdeaContent(/linkedin original/);
    await (await cardEditor()).fill("Reviewed draft");
    await page.evaluate(() => { (window as any).__saveResponses = [{ status: 500, body: { message: "Storage unavailable" } }, { defer: true, savedId: "draft-a" }, { savedId: "draft-a" }]; });
    await cardSave().click();
    await browserExpect(page.getByRole("alert")).toContainText("Your text is retained");
    await expectIdeaContent("Reviewed draft");
    await cardSave().evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
    await browserExpect(cardSave()).toHaveText("Saving…");
    expect((await calls()).filter((call: any) => call.url === "/api/drafts")).toHaveLength(2);
    await page.evaluate(() => (window as any).__pending.shift()());
    await browserExpect(cardSave()).toHaveText("Saved");
    await browserExpect(page.getByRole("link", { name: "Go to Calendar" })).toBeVisible();
    await (await cardEditor()).fill("Reviewed again");
    await cardSave().click();
    await browserExpect(cardSave()).toHaveText("Saved");
    expect((await calls()).at(-1)).toMatchObject({ url: "/api/drafts/draft-a", method: "PATCH", body: { content: "Reviewed again" } });
    expect((await calls())[0]).toMatchObject({ url: "/api/instant-review/manual", body: { selectedPlatforms: ["linkedin"] } });
    expect((await calls()).some((call: any) => /publish|schedule/.test(call.url))).toBe(false);
  });

  it("reports clipboard denial honestly and disables handoff for empty content", async () => {
    await mount("panel"); await generate(); await expectContent(/linkedin original/);
    await page.evaluate(() => { (window as any).__copyFails = true; });
    await cardCopy().click();
    await browserExpect(page.getByText(/Copy failed. Select and copy/)).toBeVisible();
    expect(await page.getByText(/^Copied\./).count()).toBe(0);
    await browserExpect(cardHandoff()).toHaveText("Copy & open LinkedIn");
    expect(await page.evaluate(() => (window as any).__actions)).toEqual([["copy", response().content]]);
    await page.evaluate(() => { (window as any).__copyFails = false; });
    await cardCopy().click();
    await browserExpect(page.getByText(/^Copied\./)).toBeVisible();
    await (await cardEditor()).fill(" ");
    await browserExpect(cardCopy()).toBeDisabled();
    await browserExpect(cardSave()).toBeDisabled();
    await browserExpect(cardHandoff()).toHaveCount(0);
  });

  it("guards unsaved work on reload, source replacement and saved-link navigation", async () => {
    await mount("panel", [{ body: manualResponse() }, { body: manualResponse("twitter", "second") }]);
    await generateIdea(); await expectIdeaContent(/linkedin original/);
    await (await cardEditor()).fill("Keep this text");
    expect(await page.evaluate(() => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; })).toBe(true);
    page.once("dialog", dialog => dialog.dismiss());
    await page.evaluate(() => (window as any).__openCreate({ id: "b", headline: "Other source", articleUrl: "https://news.test/b" }));
    await expectIdeaContent("Keep this text");
    expect(await page.evaluate(() => ((window as any).__composer as CreatePostComposer).manual)).toMatchObject({ title: "Manual source", content: source });
    await browserExpect(page.getByRole("dialog")).toHaveCount(0);
    await cardSave().click();
    await browserExpect(cardSave()).toHaveText("Saved");
    await cardGenerate("twitter").click();
    await expectContent(/twitter second/, "twitter");
    await expectIdeaContent("Keep this text");
    await page.getByRole("button", { name: "Save progress", exact: true }).click();
    await browserExpect(page.getByText("All changes saved", { exact: true }).first()).toBeVisible();
    expect(await page.evaluate(() => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; })).toBe(false);
    await page.getByRole("link", { name: "Go to Content" }).click();
    expect(new URL(page.url()).pathname).toBe("/dashboard/content");
    await page.locator("#open").click();
    await expectIdeaContent("Keep this text");
    expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  });

  it("fits a 320px viewport with wrapped controls and accessible touch targets", async () => {
    await mount("panel"); await page.setViewportSize({ width: 320, height: 740 });
    await generate(); await expectContent(/linkedin original/);
    expect(await card().evaluate(element => { const scroller = element.closest(".overflow-y-auto")!; return scroller.scrollWidth <= scroller.clientWidth; })).toBe(true);
    for (const control of [articlePlatformTrigger(), cardSave()]) {
      expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await articlePlatformTrigger().click();
    for (const target of await page.getByRole("group", { name: "Platforms to generate" }).locator("label").all()) {
      await browserExpect.poll(async () => (await target.boundingBox())!.height, { timeout: 1000, intervals: [16, 32, 50] }).toBeGreaterThanOrEqual(44);
    }
  });

  it("Discover waits for triage acknowledgement and opens Create without generating", async () => {
    await mount("discover");
    await browserExpect(page.getByRole("button", { name: "Save story", exact: true })).toBeVisible();
    expect((await calls()).some((call: any) => call.url === "/api/inbox/refresh")).toBe(false);
    await page.getByRole("button", { name: "Save story", exact: true }).focus();
    await page.keyboard.press("d");
    await page.evaluate(() => { document.body.focus(); window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true })); });
    expect((await calls()).filter((call: any) => call.method === "PATCH")).toHaveLength(0);
    await page.evaluate(() => { (window as any).__triageResponses = [{ defer: true, status: 500, body: { message: "No acknowledgement" } }]; });
    await page.getByRole("button", { name: "Save story", exact: true }).click();
    expect(await page.evaluate(() => (window as any).__toasts)).toEqual([]);
    await page.evaluate(() => (window as any).__pending.shift()());
    await browserExpect.poll(() => page.evaluate(() => (window as any).__toasts.at(-1)?.title)).toBe("Failed to update");
    await page.getByRole("button", { name: "Save story", exact: true }).click();
    await browserExpect.poll(() => page.evaluate(() => (window as any).__toasts.at(-1)?.title)).toBe("Story saved");
    await page.getByRole("button", { name: "Create draft", exact: true }).last().click();
    await browserExpect(page.locator("#route-content")).toHaveText("/dashboard/create");
    await browserExpect.poll(() => page.evaluate(() => ((window as any).__composer as CreatePostComposer).url)).toMatch(/https:\/\/news\.test\/[ab]/);
    expect((await calls()).filter((call: any) => call.url.includes("instant-review"))).toHaveLength(0);
  });

  it("turns Create draft into sequential social-preview cards without changing Idea mode", async () => {
    await mount("panel", [{ body: response("linkedin") }, { body: response("twitter") }, { body: response("medium") }]);
    await page.locator("#open-story").click(); await preparePlatforms();
    await browserExpect(page.getByRole("heading", { name: "Platform versions" })).toBeVisible();
    await browserExpect(page.getByTestId("social-preview-linkedin")).toContainText("LinkedIn preview");
    await browserExpect(page.getByTestId("social-preview-twitter")).toContainText("@ada");
    await browserExpect(page.getByTestId("social-preview-medium")).toContainText("Ready to generate");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.setViewportSize({ width: 1280, height: 1100 });
    await articlePlatformTrigger().click(); await page.getByTestId("button-generate-selected").click();
    await browserExpect(page.getByTestId("text-post-content-linkedin")).toContainText("linkedin original");
    await browserExpect(page.getByTestId("text-post-content-twitter")).toContainText("twitter original");
    await browserExpect(page.getByTestId("text-post-content-medium")).toContainText("medium original");
    const generated = (await calls()).filter((call: any) => call.url.includes("instant-review"));
    expect(generated.map((call: any) => call.body.selectedPlatforms)).toEqual([["linkedin"], ["twitter"], ["medium"]]);
    expect(generated.every((call: any) => call.body.tones[0] === "thoughtLeader")).toBe(true);
    const linkedIn = page.getByTestId("social-preview-linkedin");
    await linkedIn.getByRole("button", { name: "Edit", exact: true }).click();
    await linkedIn.getByRole("textbox", { name: "LinkedIn post content", exact: true }).fill("Reviewed LinkedIn card");
    await linkedIn.getByRole("button", { name: "Save draft", exact: true }).click();
    await browserExpect(linkedIn.getByRole("button", { name: "Saved", exact: true })).toBeVisible();
    expect((await calls()).at(-1)).toMatchObject({ url: "/api/drafts", method: "POST", body: { platform: "linkedin", content: "Reviewed LinkedIn card" } });
    await changeTone("provocateur");
    await browserExpect(linkedIn).toContainText("Ready to generate");
    await changeTone("thoughtLeader");
    await browserExpect(page.getByTestId("text-post-content-linkedin")).toHaveText("Reviewed LinkedIn card");
    await documentButton().click();
    page.once("dialog", dialog => dialog.accept());
    await useNotes();
    await browserExpect(page.getByTestId("editor-manual-article")).toBeVisible();
    await browserExpect(page.getByTestId("editor-manual-article")).toHaveText("");
    await browserExpect(page.getByTestId("input-manual-article-title")).toHaveValue("");
    await browserExpect(page.locator('[data-testid^="social-preview-"]')).toHaveCount(0);
    await browserExpect(page.getByRole("heading", { name: "Platform versions" })).toHaveCount(0);
  });

  it.each(["no-preference", "reduce"] as const)("uses 6px neutral cards with accessible motion (%s)", async reducedMotion => {
    await mount("panel", [{ defer: true, body: response("linkedin") }, { body: response("twitter") }, { body: response("medium") }], {}, reducedMotion);
    await page.locator("#open-story").click(); await preparePlatforms();
    const cards = page.locator('[data-testid^="social-preview-"]');
    await browserExpect(cards).toHaveCount(3);
    for (const card of await cards.all()) {
      await browserExpect(card).toHaveCSS("border-radius", "6px");
      await browserExpect(card).toHaveCSS("border-top-width", "1px");
      await browserExpect(card).toHaveCSS("opacity", "1");
      await browserExpect(card).toHaveCSS("transform", "none");
      expect(await card.evaluate(element => {
        const style = getComputedStyle(element);
        return style.borderTopColor === style.borderRightColor && style.borderTopColor === style.borderBottomColor && style.borderTopColor === style.borderLeftColor;
      })).toBe(true);
      await browserExpect(card).toHaveCSS("transition-property", reducedMotion === "reduce" ? "none" : "box-shadow");
    }
    await articlePlatformTrigger().click(); await page.getByTestId("button-generate-selected").click();
    const skeleton = page.getByTestId("social-preview-linkedin").locator("output span").first();
    await browserExpect(skeleton).toHaveCSS("animation-name", reducedMotion === "reduce" ? "none" : "pulse");
    await page.evaluate(() => (window as any).__pending.shift()());
    await browserExpect(page.getByTestId("text-post-content-medium")).toContainText("medium original");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await browserExpect(page.getByTestId("text-post-content-linkedin")).toBeVisible();
    for (const card of await cards.all()) await browserExpect(card).toHaveCSS("opacity", "1");
  });

  it.each([
    { width: 320, sidebar: 0 }, { width: 375, sidebar: 0 }, { width: 390, sidebar: 0 },
    { width: 768, sidebar: 224 }, { width: 1080, sidebar: 224 },
    { width: 1280, sidebar: 48 }, { width: 1440, sidebar: 224 },
  ])("contains the native platform picker at $width px with $sidebar px sidebar", async ({ width, sidebar }) => {
    await mount("panel", [], { enabledPlatforms: PLATFORMS.map(platform => platform.value) }, "reduce");
    await page.setViewportSize({ width, height: 900 });
    // Reproduce the available width of the dashboard shell, not just the viewport.
    await page.locator("#root").evaluate((root, sidebar) => {
      root.style.marginLeft = `${sidebar}px`;
      root.style.width = `calc(100% - ${sidebar}px)`;
      root.style.height = "100vh";
    }, sidebar);
    await page.locator("#open-story").click(); await preparePlatforms();
    const card = page.getByTestId("social-preview-linkedin");
    await browserExpect(card).toBeVisible();
    const layout = await card.evaluate(element => {
      const scroller = element.closest(".overflow-y-auto")!;
      return { overflow: scroller.scrollWidth - scroller.clientWidth,
        fields: Array.from(scroller.querySelectorAll<HTMLSelectElement>("select")).map(select => {
          const style = getComputedStyle(select), measure = document.createElement("canvas").getContext("2d")!;
          measure.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
          return { name: select.getAttribute("aria-labelledby"), width: select.getBoundingClientRect().width,
            labelWidth: measure.measureText(select.selectedOptions[0]?.textContent ?? "").width + Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight),
            fieldWidth: select.closest("[data-field]")!.getBoundingClientRect().width,
            overflow: select.closest("[data-field]")!.scrollWidth - select.closest("[data-field]")!.clientWidth };
        }) };
    });
    expect(layout.overflow, JSON.stringify(layout)).toBeLessThanOrEqual(1);
    for (const field of layout.fields) {
      expect(field.overflow, JSON.stringify(field)).toBeLessThanOrEqual(1);
      expect(field.width, JSON.stringify(field)).toBeLessThanOrEqual(field.fieldWidth + 1);
      expect(field.width, JSON.stringify(field)).toBeGreaterThanOrEqual(field.labelWidth);
    }
    await articlePlatformTrigger().click();
    const options = page.getByRole("group", { name: "Platforms to generate" });
    const popup = page.getByRole("dialog", { name: "Adapt for platforms", exact: true });
    await browserExpect(popup).toBeVisible();
    expect(await options.getByRole("checkbox").count()).toBeGreaterThan(20);
    const popupBox = (await popup.boundingBox())!;
    expect(popupBox.x).toBeGreaterThanOrEqual(0);
    expect(popupBox.x + popupBox.width).toBeLessThanOrEqual(width);
    await browserExpect(options.getByRole("checkbox", { checked: true })).toHaveCount(4);
    const lastPlatform = options.getByRole("checkbox").last();
    await browserExpect(lastPlatform).toBeDisabled();
    // Native fieldset rows remain reachable within the dialog scroller.
    await options.locator("label").last().scrollIntoViewIfNeeded();
    expect(await popup.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    await browserExpect(lastPlatform).toBeInViewport({ ratio: 1 });
    for (const control of [options, page.getByTestId("button-generate-selected")]) {
      const bounds = (await control.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    }
  });

  it("keeps completed cards when a later platform generation fails", async () => {
    await mount("panel", [{ body: response("linkedin") }, { status: 422, body: { message: "X generation failed" } }]);
    await page.locator("#open-story").click(); await preparePlatforms(undefined, false);
    await page.getByTestId("button-generate-selected").click();
    await browserExpect(page.getByTestId("text-post-content-linkedin")).toContainText("linkedin original");
    await browserExpect(page.getByTestId("social-preview-twitter")).toContainText("Needs retry");
    await browserExpect(page.getByTestId("social-preview-medium")).toContainText("Not attempted");
    expect((await calls()).filter((call: any) => call.url.includes("instant-review")).map((call: any) => call.body.selectedPlatforms)).toEqual([["linkedin"], ["twitter"]]);
  });

  it("stops a batch after the current platform and retains its completed card", async () => {
    await mount("panel", [{ defer: true, body: response("linkedin") }, { body: response("twitter") }]);
    await page.locator("#open-story").click(); await preparePlatforms(undefined, false);
    await page.getByTestId("button-generate-selected").click();
    await browserExpect(page.getByRole("button", { name: "Stop after current post" })).toBeVisible();
    await page.getByRole("button", { name: "Stop after current post" }).click();
    await page.evaluate(() => (window as any).__pending.shift()());
    await browserExpect(page.getByTestId("text-post-content-linkedin")).toContainText("linkedin original");
    await browserExpect(page.getByText(/Stopped after 1 completed post/)).toBeVisible();
    expect((await calls()).filter((call: any) => call.url.includes("instant-review"))).toHaveLength(1);
  });

  it("shows terminal job errors and generates only the failed card with a fresh intent", async () => {
    const jobId = "00000000-0000-4000-8000-000000000091";
    const message = "AI generation is not configured correctly. Ask an administrator to check the provider credentials and model.";
    await mount("panel", [{ body: response("linkedin") }, { status: 202, body: { jobId } },
      { body: { status: "failed", error: { status: 503, body: { code: "ai_configuration", message } } } },
      { defer: true, body: response("twitter", "retried") }, { body: response("medium") }]);
    await page.locator("#open-story").click(); await preparePlatforms(undefined, false);
    await page.getByTestId("button-generate-selected").click();
    const linkedin = page.getByTestId("social-preview-linkedin");
    const twitter = page.getByTestId("social-preview-twitter");
    await browserExpect(page.getByRole("alert")).toHaveText(message);
    await browserExpect(twitter).toContainText("Needs retry");
    await browserExpect(page.getByRole("button", { name: "Retry same request" })).toHaveCount(0);
    await linkedin.getByRole("button", { name: "Edit", exact: true }).click();
    await linkedin.getByRole("textbox", { name: "LinkedIn post content", exact: true }).fill("Keep my completed LinkedIn edit");
    await linkedin.getByRole("button", { name: "Preview", exact: true }).click();
    await changeTone("provocateur");
    await browserExpect(twitter).not.toContainText("Needs retry");
    await changeTone("thoughtLeader");
    await twitter.getByRole("button", { name: "Generate Twitter/X again", exact: true }).evaluate(button => {
      (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click();
    });
    await browserExpect(twitter).toContainText("Generating");
    await browserExpect(page.getByText(/Results appear when complete/)).toBeVisible();
    await browserExpect(page.getByTestId("text-post-content-linkedin")).toHaveText("Keep my completed LinkedIn edit");
    await page.evaluate(() => (window as any).__pending.shift()());
    await browserExpect(page.getByTestId("text-post-content-twitter")).toContainText("twitter retried");
    await browserExpect(twitter).not.toContainText("Needs retry");
    await browserExpect(twitter.locator("header")).toContainText("Generated · not saved");
    await browserExpect(page.getByRole("alert")).toHaveCount(0);
    await page.getByTestId("social-preview-medium").getByRole("button", { name: "Generate Medium", exact: true }).click();
    await browserExpect(page.getByTestId("text-post-content-medium")).toContainText("medium original");
    const posts = (await calls()).filter((call: any) => call.url.includes("instant-review"));
    expect(posts.map((call: any) => call.body.selectedPlatforms)).toEqual([["linkedin"], ["twitter"], ["twitter"], ["medium"]]);
    expect(new Set(posts.map((call: any) => call.body.requestIntent)).size).toBe(4);
    await twitter.getByRole("button", { name: "Save draft", exact: true }).click();
    await browserExpect(twitter.getByRole("button", { name: "Saved", exact: true })).toBeVisible();
    await twitter.getByRole("button", { name: "Edit", exact: true }).click();
    await twitter.getByRole("textbox", { name: "Twitter/X post content", exact: true }).fill("Reviewed retry");
    await twitter.getByRole("button", { name: "Save changes", exact: true }).click();
    await browserExpect(twitter.getByRole("button", { name: "Saved", exact: true })).toBeVisible();
    await twitter.getByRole("button", { name: "Copy", exact: true }).click();
    await browserExpect(page.getByText(/^Copied\./)).toBeVisible();
    expect((await calls()).filter((call: any) => call.url.startsWith("/api/drafts")).map((call: any) => [call.method, call.url])).toEqual([["POST", "/api/drafts"], ["PATCH", "/api/drafts/saved"]]);
    expect(await page.evaluate(() => (window as any).__actions)).toEqual([["copy", "Reviewed retry"]]);
    expect((await calls()).some((call: any) => /publish|schedule/.test(call.url))).toBe(false);
  }, 15_000);

  it("hands off the exact edited card text, article URL, hashtags and Unicode", async () => {
    await mount("panel", [{ body: response("linkedin") }]);
    await page.locator("#open-story").click(); await preparePlatforms();
    const card = page.getByTestId("social-preview-linkedin");
    await card.getByRole("button", { name: "Generate LinkedIn", exact: true }).click();
    await card.getByRole("button", { name: "Edit", exact: true }).click();
    const text = "My edited insight 👩🏽‍💻 — café & growth + 12%\n\nSource: Desk\nhttps://news.test/a?one=1&two=%23tag#section\n\n#AI #Marketing";
    await card.getByRole("textbox", { name: "LinkedIn post content", exact: true }).fill(text);
    const before = await calls();
    await card.getByTestId("button-open-linkedin").click();
    await browserExpect(card.getByText(/Post text copied. Opening LinkedIn/)).toBeVisible();
    const actions = await page.evaluate(() => (window as any).__actions);
    expect(actions[0]).toEqual(["copy", text]);
    expect(actions[1]).toEqual(["reserve", "about:blank", "_blank"]);
    expect(actions[2].slice(2)).toEqual([null, "no-referrer"]);
    const url = new URL(actions[2][1]);
    expect(url.pathname).toBe("/feed/");
    expect(url.searchParams.get("text")).toBe(text);
    expect(await calls()).toEqual(before); // no publish, save, schedule or regeneration
    await card.getByRole("textbox", { name: "LinkedIn post content", exact: true }).fill(`${text}\nAnother edit`);
    await browserExpect(card.getByText(/Post text copied/)).toHaveCount(0);
    await card.getByTestId("button-open-linkedin").click();
    await browserExpect(card.getByText(/Post text copied/)).toBeVisible();
    expect(await page.evaluate(() => (window as any).__actions.at(-3))).toEqual(["copy", `${text}\nAnother edit`]);
  });

  it("hands off only each selected platform/tone and leaves other cards untouched", async () => {
    await mount("panel", [{ body: response("linkedin") }, { body: response("twitter") }, { body: response("threads") }, { body: response("linkedin", "bold") }], { enabledPlatforms: ["linkedin", "twitter", "threads"] });
    await page.locator("#open-story").click(); await preparePlatforms(undefined, false);
    await page.getByTestId("button-generate-selected").click();
    await browserExpect(page.getByTestId("text-post-content-threads")).toBeVisible();
    for (const platform of ["linkedin", "twitter", "threads"]) {
      await page.getByTestId(`button-open-${platform}`).click();
      await browserExpect(page.getByTestId(`social-preview-${platform}`).getByText(/Post text copied/)).toBeVisible();
      const actions = await page.evaluate(() => (window as any).__actions);
      expect(actions.at(-3)).toEqual(["copy", response(platform).content]);
      expect(new URL(actions.at(-1)[1]).searchParams.get("text")).toBe(response(platform).content);
      await browserExpect(page.getByTestId(`text-post-content-${platform}`)).toHaveText(response(platform).content);
    }
    await changeTone("provocateur");
    await page.getByTestId("social-preview-linkedin").getByRole("button", { name: "Generate LinkedIn", exact: true }).click();
    await page.getByTestId("button-open-linkedin").click();
    await browserExpect(page.getByTestId("social-preview-linkedin").getByText(/Post text copied/)).toBeVisible();
    expect(await page.evaluate(() => (window as any).__actions.at(-3))).toEqual(["copy", response("linkedin", "bold").content]);
    await changeTone("thoughtLeader");
    await browserExpect(page.getByTestId("text-post-content-linkedin")).toHaveText(response().content);
    expect((await calls()).some((call: any) => /publish|schedule|drafts/.test(call.url))).toBe(false);
  });

  it("uses the same copy-and-paste fallback for Idea and platforms without intents", async () => {
    await mount("panel", [{ body: { ...response("medium"), article: { title: "Idea", content: source, source: "Your draft", url: "", domain: "manual" } } }]);
    await generateIdea("medium");
    await browserExpect(card("medium").getByTestId("text-source-content")).toHaveText(source);
    const text = "My edited idea\n\n#Thoughts";
    await (await cardEditor("medium")).fill(text);
    await cardHandoff("medium").click();
    await browserExpect(page.getByText(/Post text copied. Opening Medium/)).toBeVisible();
    const actions = await page.evaluate(() => (window as any).__actions);
    expect(actions[0]).toEqual(["copy", text]);
    expect(actions.at(-1)).toEqual(["open", "https://medium.com/new-story", null, "no-referrer"]);
    expect((await calls()).some((call: any) => /publish|schedule|drafts/.test(call.url))).toBe(false);
  });

  it("closes the reserved tab on copy failure and supplies exact manually copyable text", async () => {
    await mount("panel"); await generate(); await expectContent(/linkedin original/);
    await page.evaluate(() => { (window as any).__copyFails = true; });
    await cardHandoff().click();
    await browserExpect(card().getByRole("alert")).toContainText("Copy failed. No platform was opened");
    await browserExpect(card().getByLabel("Text to copy for LinkedIn")).toHaveValue(response().content);
    await browserExpect(card().getByText(/Post text copied/)).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__popups[0].closed)).toBe(true);
    expect(await page.evaluate(() => (window as any).__actions.some((action: string[]) => action[0] === "open"))).toBe(false);
    const fallback = card().getByRole("link", { name: "Continue to LinkedIn after copying" });
    await browserExpect(fallback).toHaveAttribute("rel", "noopener noreferrer");
    await page.evaluate(() => { (window as any).__copyFails = false; });
    await cardHandoff().click();
    await browserExpect(card().getByText(/Post text copied. Opening LinkedIn/)).toBeVisible();
    await browserExpect(card().getByRole("alert")).toHaveCount(0);
  });

  it.each(["blocked", "navigation failed"])("retains copied text and offers a secure link when the tab is %s", async kind => {
    await mount("panel"); await generate(); await expectContent(/linkedin original/);
    await page.evaluate(kind => { (window as any).__popupBlocked = kind === "blocked"; (window as any).__navigateFails = kind === "navigation failed"; }, kind);
    await cardHandoff().click();
    await browserExpect(card().getByText(/Post text copied, but the new tab could not be opened/)).toBeVisible();
    const link = card().getByRole("link", { name: "Continue to LinkedIn", exact: true });
    await browserExpect(link).toHaveAttribute("target", "_blank");
    await browserExpect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(new URL(await link.getAttribute("href") ?? "").searchParams.get("text")).toBe(response().content);
    await browserExpect(card().getByText(/Post text copied. Opening/)).toHaveCount(0);
  });

  it("reserves one tab before awaiting clipboard permission and prevents duplicate handoffs", async () => {
    await mount("panel"); await generate(); await expectContent(/linkedin original/);
    await page.evaluate(() => { (window as any).__deferCopy = true; });
    await cardHandoff().evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
    await browserExpect(cardHandoff()).toBeDisabled();
    expect(await page.evaluate(() => (window as any).__actions)).toEqual([["copy", response().content], ["reserve", "about:blank", "_blank"]]);
    await page.evaluate(() => (window as any).__finishCopy());
    await browserExpect(card().getByText(/Post text copied. Opening/)).toBeVisible();
    expect(await page.evaluate(() => (window as any).__actions.length)).toBe(3);
  });

  it("reports handoff busy synchronously to a competing action and releases it exactly once", async () => {
    await mount("handoff");
    await page.evaluate(() => { (window as any).__deferCopy = true; });
    await page.getByTestId("fixture-handoff").evaluate(button => {
      (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click();
      (window as any).__tryDirectPublish();
    });
    expect(await page.evaluate(() => ({ busy: (window as any).__handoffBusy.current, changes: (window as any).__busyChanges, publishes: (window as any).__directPublishes })))
      .toEqual({ busy: true, changes: [true], publishes: 0 });
    expect(await page.evaluate(() => (window as any).__actions)).toEqual([["copy", "Reviewed fixture post"], ["reserve", "about:blank", "_blank"]]);
    await page.evaluate(() => (window as any).__finishCopy());
    await browserExpect(page.getByText(/Post text copied. Opening LinkedIn/)).toBeVisible();
    expect(await page.evaluate(() => (window as any).__busyChanges)).toEqual([true, false]);
    expect(await page.evaluate(() => (window as any).__directPublishes)).toBe(0);
    await browserExpect(page.getByText(/Media must be attached there separately/)).toBeVisible();
    expect(await calls()).toEqual([]);
  });

  it.each(["copy rejected", "popup blocked", "navigation failed"])("releases busy exactly once after %s without implying publication", async kind => {
    await mount("handoff");
    await page.evaluate(kind => {
      const w = window as any;
      w.__copyFails = kind === "copy rejected";
      w.__popupBlocked = kind === "popup blocked";
      w.__navigateFails = kind === "navigation failed";
    }, kind);
    await page.getByTestId("fixture-handoff").click();
    await browserExpect(page.getByRole("link", { name: /Continue to LinkedIn/ })).toBeVisible();
    await browserExpect(page.getByTestId("fixture-handoff")).toBeEnabled();
    expect(await page.evaluate(() => (window as any).__busyChanges)).toEqual([true, false]);
    expect(await page.evaluate(() => (window as any).__handoffBusy.current)).toBe(false);
    expect(await page.evaluate(() => (window as any).__actions.some((action: string[]) => action[0] === "open"))).toBe(false);
    expect(await page.evaluate(() => (window as any).__directPublishes)).toBe(0);
    if (kind === "copy rejected") await browserExpect(page.getByLabel("Text to copy for LinkedIn")).toHaveValue("Reviewed fixture post");
    if (kind !== "popup blocked") expect(await page.evaluate(() => (window as any).__popups[0].closed)).toBe(true);
    expect(await calls()).toEqual([]);
  });

  it.each(["unsafe", "publishing", "draft identity"])("rejects a handoff at admission when its owner is %s", async kind => {
    await mount("handoff");
    await page.evaluate(kind => {
      const owner = (window as any).__handoffOwner;
      if (kind === "draft identity") owner.draftId = "draft-b"; else owner[kind] = true;
    }, kind);
    await page.getByTestId("fixture-handoff").click();
    expect(await page.evaluate(() => (window as any).__actions)).toEqual([]);
    expect(await page.evaluate(() => (window as any).__busyChanges)).toEqual([]);
    expect(await calls()).toEqual([]);
  });

  it.each(["disabled", "unmounted", "text", "platform", "unsafe", "publishing", "draft identity", "guard prop"])("abandons a reserved popup after deferred clipboard completion when %s changes", async kind => {
    await mount("handoff");
    await page.evaluate(() => { (window as any).__deferCopy = true; });
    await page.getByTestId("fixture-handoff").click();
    // Busy already disables the button while the external prop is still false.
    await browserExpect(page.getByTestId("fixture-handoff")).toBeDisabled();
    await browserExpect(page.getByTestId("handoff-fixture")).toHaveAttribute("data-handoff-disabled", "false");
    expect(await page.evaluate(() => (window as any).__popups[0].closed)).toBe(false);
    await page.evaluate(kind => {
      const w = window as any;
      if (kind === "disabled") w.__setHandoff({ disabled: true });
      else if (kind === "unmounted") w.__setHandoff({ visible: false });
      else if (kind === "text") w.__setHandoff({ text: "New reviewed text" });
      else if (kind === "platform") w.__setHandoff({ platform: "threads" });
      else if (kind === "draft identity") { w.__handoffOwner.draftId = "draft-b"; w.__setHandoff({ draftId: "draft-b" }); }
      else if (kind === "guard prop") w.__setHandoff({ allowed: false });
      else w.__handoffOwner[kind] = true;
    }, kind);
    // Wait for the prop's DOM commit, not the already-true busy disabled state.
    if (kind === "disabled") await browserExpect(page.getByTestId("handoff-fixture")).toHaveAttribute("data-handoff-disabled", "true");
    if (kind === "unmounted") await browserExpect(page.getByTestId("fixture-handoff")).toHaveCount(0);
    if (kind === "text") await browserExpect.poll(() => page.evaluate(() => (window as any).__handoffState.text)).toBe("New reviewed text");
    if (kind === "platform") await browserExpect(page.getByTestId("fixture-handoff")).toHaveText("Copy & open Threads");
    if (kind === "draft identity") await browserExpect.poll(() => page.evaluate(() => (window as any).__handoffState.draftId)).toBe("draft-b");
    if (kind === "guard prop") await browserExpect.poll(() => page.evaluate(() => (window as any).__handoffState.allowed)).toBe(false);
    await page.evaluate(() => (window as any).__finishCopy());
    await browserExpect.poll(() => page.evaluate(() => (window as any).__popups[0].closed)).toBe(true);
    // Copy started and may have written; abandonment does not claim to undo it.
    expect(await page.evaluate(() => (window as any).__actions)).toEqual([["copy", "Reviewed fixture post"], ["reserve", "about:blank", "_blank"]]);
    expect(await page.evaluate(() => (window as any).__busyChanges)).toEqual([true, false]);
    expect(await page.evaluate(() => (window as any).__handoffBusy.current)).toBe(false);
    await browserExpect(page.getByTestId("handoff-fixture").locator("output, [role=alert], a")).toHaveCount(0);
    expect(await calls()).toEqual([]);
  });

  it("does not let an abandoned completion clear the newer handoff's busy owner or restore old feedback", async () => {
    await mount("handoff");
    await page.evaluate(() => { (window as any).__deferCopy = true; });
    await page.getByTestId("fixture-handoff").click();
    await page.evaluate(() => (window as any).__setHandoff({ text: "Temporary change" }));
    await browserExpect.poll(() => page.evaluate(() => (window as any).__handoffState.text)).toBe("Temporary change");
    await page.evaluate(() => (window as any).__setHandoff({ text: "Reviewed fixture post" }));
    await browserExpect.poll(() => page.evaluate(() => (window as any).__handoffState.text)).toBe("Reviewed fixture post");
    await page.getByTestId("fixture-handoff").click();
    expect(await page.evaluate(() => (window as any).__busyChanges)).toEqual([true, false, true]);
    await page.evaluate(() => (window as any).__finishCopies.shift()());
    await browserExpect.poll(() => page.evaluate(() => (window as any).__popups[0].closed)).toBe(true);
    expect(await page.evaluate(() => (window as any).__busyChanges)).toEqual([true, false, true]);
    expect(await page.evaluate(() => (window as any).__handoffBusy.current)).toBe(true);
    await browserExpect(page.getByTestId("fixture-handoff")).toBeDisabled();
    await browserExpect(page.getByTestId("handoff-fixture").locator("output, a")).toHaveCount(0);
    await page.evaluate(() => (window as any).__finishCopies.shift()());
    await browserExpect(page.getByText(/Post text copied. Opening LinkedIn/)).toBeVisible();
    expect(await page.evaluate(() => (window as any).__busyChanges)).toEqual([true, false, true, false]);
    expect(await page.evaluate(() => (window as any).__actions.filter((action: string[]) => action[0] === "open").length)).toBe(1);
    expect(await calls()).toEqual([]);
  });

  it.each(["disabled", "unmounted", "text"])("closes an actual Chromium blank tab without external navigation after %s changes", async kind => {
    await mount("handoff");
    const external: string[] = [];
    await page.context().route("https://www.linkedin.com/**", route => {
      external.push(route.request().url());
      return route.fulfill({ contentType: "text/html", body: "Unexpected external navigation" });
    });
    await page.evaluate(() => { (window as any).__deferCopy = true; window.open = (window as any).__nativeOpen; });
    const opened = page.waitForEvent("popup");
    await page.getByTestId("fixture-handoff").click();
    const popup = await opened;
    try {
      expect(popup.url()).toBe("about:blank");
      expect(await popup.evaluate(() => window.opener)).toBeNull();
      await page.evaluate(kind => (window as any).__setHandoff(kind === "disabled" ? { disabled: true } : kind === "unmounted" ? { visible: false } : { text: "New text" }), kind);
      await browserExpect.poll(() => page.evaluate(kind => {
        const props = (window as any).__handoffState;
        return kind === "disabled" ? props.disabled : kind === "unmounted" ? !props.visible : props.text === "New text";
      }, kind)).toBe(true);
      await page.evaluate(() => (window as any).__finishCopy());
      await browserExpect.poll(() => popup.isClosed()).toBe(true);
      expect(external).toEqual([]);
      expect(await page.evaluate(() => (window as any).__busyChanges)).toEqual([true, false]);
      await browserExpect(page.getByTestId("handoff-fixture").locator("output, a")).toHaveCount(0);
    } finally { if (!popup.isClosed()) await popup.close(); }
    expect(await calls()).toEqual([]);
  });

  it.each(["active", "queued"])("revokes a pending handoff when its version becomes %s in the same turn", async kind => {
    await mount("panel", [{ body: response("twitter") }, { defer: true, body: response(kind === "active" ? "twitter" : "linkedin", "regenerated") }]);
    await generate("twitter"); await expectContent(/twitter original/, "twitter");
    await page.evaluate(() => { (window as any).__deferCopy = true; });
    await cardHandoff("twitter").click();
    await page.evaluate(kind => {
      const w = window as any, c = w.__composer as CreatePostComposer;
      if (kind === "active") void c.generatePlatform("twitter");
      else { void c.generateBatch(["linkedin", "twitter"]); c.stopBatchAfterCurrent(); }
      w.__finishCopy();
    }, kind);
    await browserExpect.poll(() => page.evaluate(() => (window as any).__popups[0].closed)).toBe(true);
    expect(await page.evaluate(() => (window as any).__actions)).toEqual([["copy", response("twitter").content], ["reserve", "about:blank", "_blank"]]);
    await browserExpect(cardHandoff("twitter")).toHaveCount(0);
    await browserExpect(cardSave("twitter")).toBeDisabled();
    await browserExpect.poll(() => page.evaluate(() => (window as any).__pending.length)).toBe(1);
    await page.evaluate(() => (window as any).__pending.shift()());
    await browserExpect(cardCopy("twitter")).toBeEnabled();
    expect((await calls()).some((call: any) => /drafts|publish|schedule/.test(call.url))).toBe(false);
  });

  it.each([
    { mode: "Article", change: "edit" }, { mode: "Article", change: "source" },
    { mode: "Idea", change: "edit" }, { mode: "Idea", change: "source" },
  ])("fences a pending $mode handoff from a same-turn $change before React receives new props", async ({ mode, change }) => {
    await mount("panel", [{ body: mode === "Article" ? response() : manualResponse() }]);
    if (mode === "Article") { await generate(); await expectContent(/linkedin original/); }
    else { await generateIdea(); await expectIdeaContent(/linkedin original/); }
    await page.evaluate(() => { (window as any).__deferCopy = true; });
    await cardHandoff().click();
    if (change === "source") page.once("dialog", dialog => dialog.accept());
    await page.evaluate(change => {
      const w = window as any, c = w.__composer as CreatePostComposer;
      if (change === "edit") c.editVersion("linkedin", "thoughtLeader", "New reviewed wording");
      else c.setUrl("https://news.test/replacement");
      w.__finishCopy();
    }, change);
    await browserExpect.poll(() => page.evaluate(() => (window as any).__popups[0].closed)).toBe(true);
    expect(await page.evaluate(() => (window as any).__actions)).toEqual([["copy", response().content], ["reserve", "about:blank", "_blank"]]);
    await browserExpect(page.getByText(/Post text copied. Opening/)).toHaveCount(0);
    if (change === "edit") {
      if (mode === "Article") await expectContent("New reviewed wording"); else await expectIdeaContent("New reviewed wording");
    } else await browserExpect.poll(() => page.evaluate(() => ((window as any).__composer as CreatePostComposer).url)).toBe("https://news.test/replacement");
    expect(await calls()).toHaveLength(1);
  });

  it("lets an already pending completed-card handoff finish while an unrelated card generates", async () => {
    await mount("panel", [{ body: response() }, { defer: true, body: response("twitter") }]);
    await generate(); await expectContent(/linkedin original/);
    await page.evaluate(() => { (window as any).__deferCopy = true; });
    await cardHandoff().click();
    await cardGenerate("twitter").click();
    await page.evaluate(() => (window as any).__finishCopy());
    await browserExpect(card().getByText(/Post text copied. Opening LinkedIn/)).toBeVisible();
    expect(await page.evaluate(() => (window as any).__popups[0].closed)).toBe(false);
    await page.evaluate(() => (window as any).__pending.shift()());
    expect((await calls()).some((call: any) => /drafts|publish|schedule/.test(call.url))).toBe(false);
  });

  it("isolates a real browser popup from its opener and suppresses the referrer", async () => {
    await mount("panel"); await generate(); await expectContent(/linkedin original/);
    let referrer: string | undefined;
    await page.context().route("https://www.linkedin.com/**", async route => {
      referrer = route.request().headers().referer ?? "";
      await route.fulfill({ contentType: "text/html", body: "<title>Mock platform composer</title>" });
    });
    await page.evaluate(() => { window.open = (window as any).__nativeOpen; });
    const popupPromise = page.waitForEvent("popup");
    await cardHandoff().click();
    const popup = await popupPromise;
    try {
      await browserExpect(popup).toHaveTitle("Mock platform composer");
      expect(new URL(popup.url()).searchParams.get("text")).toBe(response().content);
      expect(await popup.evaluate(() => window.opener)).toBeNull();
      expect(referrer).toBe("");
    } finally { await popup.close(); }
  });

  it("hides handoff for invalid text but keeps completed-card handoff during unrelated generation", async () => {
    await mount("panel", [{ body: response("linkedin") }, { defer: true, body: response("twitter") }]);
    await page.locator("#open-story").click(); await preparePlatforms();
    const card = page.getByTestId("social-preview-linkedin");
    await card.getByRole("button", { name: "Generate LinkedIn", exact: true }).click();
    await card.getByRole("button", { name: "Edit", exact: true }).click();
    for (const text of [" ", "a".repeat(3001)]) {
      await card.getByRole("textbox", { name: "LinkedIn post content", exact: true }).fill(text);
      await browserExpect(card.getByTestId("button-open-linkedin")).toHaveCount(0);
    }
    await card.getByRole("textbox", { name: "LinkedIn post content", exact: true }).fill("Valid again");
    await browserExpect(card.getByTestId("button-open-linkedin")).toBeVisible();
    await page.getByTestId("social-preview-twitter").getByRole("button", { name: "Generate Twitter/X", exact: true }).click();
    await browserExpect(card.getByTestId("button-open-linkedin")).toBeVisible();
    await card.getByTestId("button-open-linkedin").click();
    await browserExpect(card.getByText(/Post text copied. Opening LinkedIn/)).toBeVisible();
    expect(await page.evaluate(() => (window as any).__actions[0])).toEqual(["copy", "Valid again"]);
    await page.evaluate(() => (window as any).__pending.shift()());
    await browserExpect(card.getByTestId("button-open-linkedin")).toBeVisible();
  });

  it("keeps populated handoff controls inside mobile and narrow dashboard cards", async () => {
    const platforms = ["linkedin", "twitter", "threads", "substack"];
    await mount("panel", platforms.map(platform => ({ body: response(platform) })), { enabledPlatforms: platforms }, "reduce");
    await page.locator("#open-story").click(); await preparePlatforms(undefined, false);
    await page.getByTestId("button-generate-selected").click();
    await browserExpect(page.getByTestId("button-open-substack")).toBeVisible();
    for (const { width, sidebar } of [{ width: 320, sidebar: 0 }, { width: 768, sidebar: 224 }, { width: 1080, sidebar: 224 }]) {
      await page.setViewportSize({ width, height: 900 });
      await page.locator("#root").evaluate((root, sidebar) => {
        root.style.marginLeft = `${sidebar}px`;
        root.style.width = `calc(100% - ${sidebar}px)`;
      }, sidebar);
      for (const platform of platforms) {
        const card = page.getByTestId(`social-preview-${platform}`);
        // Sample the card and its action atomically after responsive reflow.
        await browserExpect.poll(() => card.evaluate((element, { platform, minimum }) => {
          const outer = element.getBoundingClientRect();
          const button = element.querySelector(`[data-testid="button-open-${platform}"]`)!.getBoundingClientRect();
          return { noOverflow: element.scrollWidth - element.clientWidth <= 1,
            containedLeft: button.x >= outer.x, containedRight: button.right <= outer.right, targetHeight: button.height >= minimum };
        }, { platform, minimum: width < 768 ? 44 : 32 }), { timeout: 1000, intervals: [16, 32, 50] })
          .toEqual({ noOverflow: true, containedLeft: true, containedRight: true, targetHeight: true });
      }
    }
  });

  it.each([
    { kind: "blank", body: response("linkedin", "blank", true) },
    { kind: "missing platform", body: response("twitter") },
    { kind: "missing article", body: { posts: response().posts } },
  ])("stops a batch on $kind output rather than marking it complete", async ({ kind, body }) => {
    await mount("panel", [{ body }, { body: response("twitter") }]);
    await page.locator("#open-story").click(); await preparePlatforms(undefined, false);
    await page.getByTestId("button-generate-selected").click();
    await browserExpect(page.getByText(/No usable text was returned/)).toBeVisible();
    await browserExpect(page.getByTestId("social-preview-linkedin")).toContainText("Needs retry");
    await browserExpect(page.getByTestId("social-preview-twitter")).toContainText("Not attempted");
    expect((await calls()).filter((call: any) => call.url.includes("instant-review"))).toHaveLength(1);
    if (kind === "blank") await browserExpect(cardSave()).toBeDisabled();
    else await browserExpect(cardSave()).toHaveCount(0);
    await browserExpect(cardSave("twitter")).toHaveCount(0);
    await browserExpect(cardSave("medium")).toHaveCount(0);
    await browserExpect(cardHandoff()).toHaveCount(0);
    for (const button of await page.getByRole("button", { name: "Save draft", exact: true }).all()) await browserExpect(button).toBeDisabled();
  });

  it("recovers a bento admission with the original intent and clears the failed card state", async () => {
    const jobId = "00000000-0000-4000-8000-000000000092";
    await mount("panel", [{ networkError: true }, { status: 202, body: { jobId } },
      { body: { status: "completed" } }, { body: response("linkedin", "recovered") }]);
    await page.locator("#open-story").click(); await preparePlatforms(undefined, false);
    await page.getByTestId("button-generate-selected").click();
    await browserExpect(page.getByRole("alert")).toContainText("Failed to fetch");
    await browserExpect(page.getByRole("button", { name: "Generate LinkedIn again", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Retry same request" }).click();
    await browserExpect(page.getByTestId("text-post-content-linkedin")).toContainText("linkedin recovered");
    await browserExpect(page.getByTestId("social-preview-linkedin")).not.toContainText("Needs retry");
    const posts = (await calls()).filter((call: any) => call.method === "POST");
    expect(posts).toHaveLength(2);
    expect(posts[0].body.requestIntent).toBe(posts[1].body.requestIntent);
    expect((await calls()).map((call: any) => call.method)).toEqual(["POST", "POST", "GET", "GET"]);
  });

  it("clears failed card metadata when a new story replaces the source", async () => {
    await mount("panel", [{ status: 422, body: { message: "Source unavailable" } }]);
    await page.locator("#open-story").click(); await preparePlatforms(undefined, false);
    await page.getByTestId("button-generate-selected").click();
    await browserExpect(page.getByTestId("social-preview-linkedin")).toContainText("Needs retry");
    page.once("dialog", dialog => dialog.accept());
    await page.evaluate(() => (window as any).__openCreate({ id: "b", headline: "Other source", articleUrl: "https://news.test/b" }));
    await browserExpect(page.getByTestId("social-preview-linkedin")).toHaveCount(0);
    await browserExpect(page.getByRole("alert")).toHaveCount(0);
  });

  it("Discover reports queued refresh until completion without duplicate admission", async () => {
    await mount("discover"); await page.clock.install();
    await page.evaluate(() => { (window as any).__refreshResponses = [{ body: { jobId: "refresh-a" } }, { body: { status: "completed", progress: { articlesCreated: 2 } } }]; });
    await page.getByTestId("button-refresh-inbox").evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
    await browserExpect(page.getByText(/Refresh queued/)).toBeVisible();
    await browserExpect(page.getByTestId("button-refresh-inbox")).toBeDisabled();
    expect((await calls()).filter((call: any) => call.url === "/api/inbox/refresh")).toHaveLength(1);
    await page.clock.runFor(1600);
    await browserExpect(page.getByText(/Refresh finished. 2 new articles added/)).toBeVisible();
  });

  it("shows fetched content, source excerpts, provider/model and honest review warnings", async () => {
    await mount("panel");
    expect(await calls()).toEqual([]);
    await generate();
    await expectContent(/linkedin original/);
    await browserExpect(card().getByText("Human review required — not fact-checked.")).toBeVisible();
    await browserExpect(card().getByText(/Fallback provider used/)).toBeVisible();
    await browserExpect(card().getByText("Only a page description was extracted, not the article body.")).toBeVisible();
    await browserExpect(card().getByTestId("text-source-content")).toHaveText(source);
    await browserExpect(card().getByRole("link", { name: "Open original" })).toHaveAttribute("href", "https://news.test/a");
    await browserExpect(card().getByText(/mock-fallback-model/)).not.toBeVisible();
    expect(await card().evaluate(element => {
      const guidance = element.querySelector('[aria-label="Generation evidence"]')!;
      const save = Array.from(element.querySelectorAll("button")).find(button => button.textContent?.includes("Save draft"))!;
      return Boolean(guidance.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING);
    })).toBe(true);
    await card().getByText("Generation details", { exact: true }).click();
    await browserExpect(card().getByText(/mock-fallback-model/)).toBeVisible();
    await card().getByText("Source evidence excerpts (1)").click();
    await browserExpect(card().getByRole("blockquote").locator("p")).toHaveText(source);
    await browserExpect(card().getByText("p1", { exact: true })).toBeVisible();
    expect((await calls())[0]).toMatchObject({ url: "/api/instant-review/manual", body: { stage: "platform", content: source, sourceUrl: "https://news.test/a", sourceLabel: "Desk", selectedPlatforms: ["linkedin"] } });
    expect(await page.evaluate(() => (window as any).__actions)).toEqual([]);
  });

  it("keeps save and composer disabled on actionable errors and empty output", async () => {
    await mount("panel", [{ status: 422, body: { code: "ai_budget", message: "Generation budget reached. Try again later or contact your administrator." } }, { body: response("linkedin", "empty", true) }]);
    await useLink("https://news.test/a");
    await preparePlatforms();
    await cardGenerate().click();
    await browserExpect(page.getByRole("alert")).toContainText("budget reached");
    await browserExpect(cardSave()).toHaveCount(0);
    await browserExpect(cardHandoff()).toHaveCount(0);
    await cardGenerate().click();
    await browserExpect(page.getByText(/No usable text was returned/)).toBeVisible();
    await browserExpect(cardSave()).toBeDisabled();
    await browserExpect(cardCopy()).toBeDisabled();
    await browserExpect(cardHandoff()).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__actions)).toEqual([]);
  });

  it("cancels long generation, forwards AbortSignal, and discards a late success", async () => {
    const jobId = "00000000-0000-4000-8000-000000000011";
    await mount("panel", [{ status: 202, body: { jobId } }, { defer: true, body: { status: "completed" } }, { body: { status: "cancelled" } }]);
    await useLink("https://news.test/a");
    await preparePlatforms();
    await cardGenerate().click();
    await browserExpect(generationProgress()).toContainText("Results appear when complete");
    await browserExpect.poll(async () => (await calls()).length).toBe(2);
    await page.getByRole("button", { name: "Cancel generation" }).click();
    await page.evaluate(() => (window as any).__pending.shift()());
    await browserExpect(page.getByRole("alert")).toContainText("cancelled");
    expect((await calls())[1].aborted).toBe(true);
    await browserExpect(card().getByTestId("textarea-post-content-linkedin")).toHaveCount(0);
    await browserExpect(card().getByTestId("text-post-content-linkedin")).toHaveCount(0);
    await browserExpect(cardSave()).toHaveCount(0);
  });

  it("supports article format only on suitable platforms and sends the selection", async () => {
    await mount("panel", [{ body: { ...manualResponse(), format: "article" } }, { body: manualResponse("twitter") }]);
    await changeLength("article");
    await useNotes();
    await page.getByRole("textbox", { name: "Article title", exact: true }).fill("Manual source");
    await page.getByRole("textbox", { name: "Article text", exact: true }).fill(source);
    expect(await calls()).toEqual([]);
    await preparePlatforms();
    await cardGenerate().click();
    await expectIdeaContent(/linkedin original/);
    await browserExpect(cardGenerate()).toBeEnabled();
    expect((await calls()).at(-1).body.format).toBe("article");
    expect(await page.evaluate(() => ((window as any).__composer as CreatePostComposer).requestedFormat)).toBe("article");
    await browserExpect(cardGenerate("twitter")).toBeEnabled();
    expect(await calls()).toHaveLength(1);
    await cardGenerate("twitter").click();
    await browserExpect.poll(async () => (await calls()).length).toBe(2);
    expect((await calls()).at(-1).body).toMatchObject({ selectedPlatforms: ["twitter"], format: "short-post" });
    await expectContent(/twitter original/, "twitter");
    expect((await calls()).every((call: any) => call.url === "/api/instant-review/manual")).toBe(true);
  });

  it("uses the requested Article format per card and falls back only for unsupported platforms", async () => {
    await mount("panel", [{ body: { ...response(), format: "article" } }, { body: response("twitter") }]);
    await changeLength("article");
    expect(await calls()).toEqual([]);
    await generate();
    await expectContent(/linkedin original/);
    await cardGenerate("twitter").click();
    await expectContent(/twitter original/, "twitter");
    expect(await page.evaluate(() => ((window as any).__composer as CreatePostComposer).requestedFormat)).toBe("article");
    await browserExpect(cardGenerate()).toBeEnabled();
    await browserExpect(cardGenerate("twitter")).toBeEnabled();
    expect((await calls()).map((call: any) => [call.url, call.body.sourceUrl, call.body.selectedPlatforms, call.body.format])).toEqual([
      ["/api/instant-review/manual", "https://news.test/a", ["linkedin"], "article"],
      ["/api/instant-review/manual", "https://news.test/a", ["twitter"], "short-post"],
    ]);
  });

  it("regenerates one platform without erasing another or its evidence snapshot", async () => {
    await mount("panel", [{ body: response() }, { body: response("twitter", "second") }, { body: response("twitter", "regenerated") }]);
    await generate();
    await expectContent(/linkedin original:/);
    await browserExpect(card("twitter")).toContainText("Ready to generate");
    await browserExpect(card("twitter").getByTestId("text-post-content-twitter")).toHaveCount(0);
    await cardGenerate("twitter").click();
    await expectContent(/twitter second:/, "twitter");
    await cardGenerate("twitter").click();
    await expectContent(/twitter regenerated:/, "twitter");
    await expectContent(/linkedin original:/);
    await card().getByText("Generation details", { exact: true }).click();
    await card().getByText("Source evidence excerpts (1)").click();
    await browserExpect(card().getByRole("blockquote").locator("p")).toHaveText(source);
    expect(await card().getByText(/Snapshot: regenerated/).count()).toBe(0);
    await card("twitter").getByText("Generation details", { exact: true }).click();
    await card("twitter").getByText("Source evidence excerpts (1)").click();
    await browserExpect(card("twitter").getByRole("blockquote").locator("p")).toHaveText(`${source} Snapshot: regenerated.`);
    const requests = await calls();
    expect(requests.map((call: any) => call.body.selectedPlatforms)).toEqual([["linkedin"], ["twitter"], ["twitter"]]);
    expect(requests.every((call: any) => call.url === "/api/instant-review/manual")).toBe(true);
    expect(new Set(requests.map((call: any) => call.body.requestIntent)).size).toBe(3);
    expect(requests.every((call: any) => /^[0-9a-f-]{36}$/.test(call.body.requestIntent))).toBe(true);
    expect(await page.evaluate(() => (window as any).__actions)).toEqual([]);
  });

  it("keeps the selected manual platform and prevents empty option saves", async () => {
    await mount("panel", [{ body: { ...response("medium", "manual", true), article: { title: "Manual", content: source, source: "Your draft", url: "", domain: "manual" } } }]);
    await useNotes();
    await page.getByTestId("input-manual-article-title").fill("Manual");
    await page.getByTestId("editor-manual-article").fill(source);
    await preparePlatforms(["Medium"]);
    await cardGenerate("medium").click();
    await browserExpect(cardGenerate("medium")).toHaveText("Generate Medium again");
    await browserExpect(cardSave("medium")).toBeDisabled();
    for (const button of await page.getByRole("button", { name: "Save draft", exact: true }).all()) await browserExpect(button).toBeDisabled();
    expect((await calls())[0]).toMatchObject({ url: "/api/instant-review/manual", body: { selectedPlatforms: ["medium"] } });
  });

  it("keeps generation and the single composer across route transitions", async () => {
    await mount("panel", [{ defer: true, body: response() }]);
    await generate();
    await browserExpect(generationProgress()).toBeVisible();
    await page.locator("#route").click();
    await browserExpect(page.locator("#route-content")).toHaveText("/dashboard/content");
    expect((await calls())[0].aborted).toBe(false);
    await page.evaluate(() => (window as any).__pending.shift()());
    await page.locator("#open").click();
    await expectContent(/linkedin original:/);
    await browserExpect(page.getByTestId("textarea-post-content-linkedin")).toHaveCount(1);
    await browserExpect(page.locator('[data-testid^="social-preview-"]')).toHaveCount(3);
    expect(await calls()).toHaveLength(1);
  });

  it("locks platform changes during generation and never calls legacy save/post owners", async () => {
    await mount("panel", [{ defer: true, body: response() }, { body: response("twitter", "latest") }]);
    await useLink("https://news.test/a");
    await preparePlatforms();
    await cardGenerate().click();
    await browserExpect(generationProgress()).toBeVisible();
    await browserExpect(articlePlatformTrigger()).toBeDisabled();
    await browserExpect(documentButton()).toBeDisabled();
    await page.evaluate(() => (window as any).__pending.shift()());
    await expectContent(/linkedin original/);
    await articlePlatformTrigger().click();
    await articlePlatformCheckbox("Twitter/X").uncheck();
    await browserExpect(articlePlatformCheckbox("Twitter/X")).not.toBeChecked();
    await browserExpect(card("twitter")).toHaveCount(0);
    await articlePlatformCheckbox("Twitter/X").check();
    await browserExpect(articlePlatformCheckbox("Twitter/X")).toBeChecked();
    await versionsView();
    expect(await calls()).toHaveLength(1);
    await cardGenerate("twitter").click();
    await expectContent(/twitter latest/, "twitter");
    await cardSave("twitter").click();
    await browserExpect(cardSave("twitter")).toHaveText("Saved");
    expect(await page.evaluate(() => (window as any).__actions)).toEqual([]);
    expect((await calls()).at(-1).body).toMatchObject({ platform: "twitter", content: expect.stringContaining("twitter latest") });
  });

  it("counts an X link as 23 characters for the limit, counter and Open X", async () => {
    const link = `https://news.test/${"story-".repeat(15)}trial`;
    const text = `${"Desk reports 12% lower latency in a pilot. ".repeat(5).trim()} ${link}`;
    const xResponse = response("twitter", "long");
    xResponse.posts.twitter.thoughtLeader = text;
    await mount("panel", [{ body: xResponse }]);
    await generate("twitter");
    await expectContent(text, "twitter");
    expect(text.length).toBeGreaterThan(280);
    await browserExpect(card("twitter").getByText(`${text.length - link.length + 23} / 280 characters`)).toBeVisible();
    await browserExpect(cardSave("twitter")).toBeEnabled();
    await cardHandoff("twitter").click();
    await browserExpect(card("twitter").getByText(/Post text copied. Opening/)).toBeVisible();
    expect(await page.evaluate(() => (window as any).__actions[0])).toEqual(["copy", text]);
    expect(new URL(await page.evaluate(() => (window as any).__actions.at(-1)[1])).searchParams.get("text")).toBe(text);
  });

  it.each(["Article", "Idea"] as const)("associates the raw 5,000-character cap with the X field in %s", async mode => {
    await mount("panel", [{ body: mode === "Article" ? response("twitter") : manualResponse("twitter") }]);
    if (mode === "Article") await generate("twitter");
    else await generateIdea("twitter");
    const editor = await cardEditor("twitter");
    const save = cardSave("twitter");
    const handoff = cardHandoff("twitter");
    const text = `https://news.test/${"a".repeat(5001)}`;
    await editor.fill(text);
    await browserExpect(editor).toHaveAttribute("aria-invalid", "true");
    const descriptions = await editor.evaluate(element => (element.getAttribute("aria-describedby") ?? "").split(/\s+/).map(id => document.getElementById(id)?.textContent));
    expect(descriptions.every(Boolean)).toBe(true);
    expect(descriptions.join(" ")).toContain("23 / 280 characters");
    expect(descriptions.join(" ")).toContain("5,000");
    expect(descriptions.join(" ")).toContain("raw characters");
    expect(await editor.evaluate(element => {
      const ids = (element.getAttribute("aria-describedby") ?? "").split(/\s+/);
      return ids.some(id => document.getElementById(id)?.getAttribute("role") === "alert");
    })).toBe(true);
    await browserExpect(save).toBeDisabled();
    await browserExpect(handoff).toHaveCount(0);
    await editor.fill("Reviewed within both limits");
    await browserExpect(editor).toHaveAttribute("aria-invalid", "false");
    await browserExpect(save).toBeEnabled();
    expect((await calls()).some((call: any) => /drafts|publish|schedule|voice/.test(call.url))).toBe(false);
  });

  it("reserves active and queued versions, releases completed cards, and continues past unrelated concurrent saves", async () => {
    await mount("panel", [
      { body: response("linkedin") }, { body: response("twitter") }, { body: response("medium") },
      { defer: true, body: response("linkedin", "batch") }, { defer: true, body: response("twitter", "batch") }, { defer: true, body: response("medium", "batch") },
    ]);
    await generate(); await expectContent(/linkedin original/);
    await cardGenerate("twitter").click(); await expectContent(/twitter original/, "twitter");
    await cardGenerate("medium").click(); await expectContent(/medium original/, "medium");
    await page.evaluate(() => {
      const c = (window as any).__composer as CreatePostComposer;
      void c.generateBatch(["linkedin", "twitter", "medium"]);
      for (const target of ["linkedin", "twitter", "medium"]) {
        c.editVersion(target, "thoughtLeader", "Must not alter active or queued targets");
        void c.saveVersion(target, "thoughtLeader"); void c.copyVersion(target, "thoughtLeader");
        // These children still exist in this turn, before React sees the lock.
        document.querySelector<HTMLButtonElement>(`[data-testid="button-open-${target}"]`)?.click();
      }
    });
    for (const target of ["linkedin", "twitter", "medium"]) {
      await browserExpect(card(target).getByTestId(`textarea-post-content-${target}`)).toHaveValue(response(target).content);
      await browserExpect(cardSave(target)).toBeDisabled();
      await browserExpect(cardCopy(target)).toBeDisabled();
      await browserExpect(cardHandoff(target)).toHaveCount(0);
    }
    expect((await calls()).filter((call: any) => call.url.startsWith("/api/drafts"))).toHaveLength(0);
    expect(await page.evaluate(() => (window as any).__actions)).toEqual([]);
    await browserExpect(generationProgress()).toContainText("Batch: 0 of 3 posts completed");
    await page.evaluate(() => (window as any).__pending.shift()());
    await browserExpect(card("twitter").locator("header")).toContainText("Generating");
    await browserExpect(generationProgress()).toContainText("Batch: 1 of 3 posts completed");
    await browserExpect(generationProgress()).not.toContainText("1 of 1");
    await (await cardEditor()).fill("Completed card edited while X runs");
    await cardCopy().click();
    await cardHandoff().click();
    await browserExpect(card().getByText(/Post text copied. Opening LinkedIn/)).toBeVisible();
    await page.evaluate(() => {
      (window as any).__saveResponses = [{ defer: true, savedId: "linkedin-saved" }];
      const c = (window as any).__composer as CreatePostComposer;
      void c.saveVersion("linkedin", "thoughtLeader"); void c.saveVersion("linkedin", "thoughtLeader");
      c.editVersion("linkedin", "thoughtLeader", "Must not race save");
    });
    await browserExpect(cardSave()).toHaveText("Saving…");
    await browserExpect.poll(() => page.evaluate(() => (window as any).__pending.length)).toBe(2);
    await page.evaluate(() => (window as any).__pending.shift()()); // X finishes; LinkedIn save remains outstanding.
    await browserExpect(card("medium").locator("header")).toContainText("Generating");
    expect((await calls()).filter((call: any) => call.url.includes("instant-review")).map((call: any) => call.body.selectedPlatforms)).toEqual([
      ["linkedin"], ["twitter"], ["medium"], ["linkedin"], ["twitter"], ["medium"],
    ]);
    await browserExpect(cardCopy("twitter")).toBeEnabled();
    await browserExpect(cardSave()).toHaveText("Saving…");
    await page.evaluate(() => (window as any).__pending.pop()()); // Medium finishes before LinkedIn save.
    await browserExpect(cardCopy("medium")).toBeEnabled();
    await page.evaluate(() => {
      (window as any).__saveResponses = [{ defer: true, savedId: "medium-saved" }];
      const c = (window as any).__composer as CreatePostComposer;
      void c.saveVersion("medium", "thoughtLeader"); void c.saveVersion("medium", "thoughtLeader");
    });
    await browserExpect.poll(() => page.evaluate(() => (window as any).__pending.length)).toBe(2);
    await page.evaluate(() => (window as any).__pending.pop()());
    await browserExpect(cardSave("medium")).toHaveText("Saved");
    expect(await page.evaluate(() => ((window as any).__composer as CreatePostComposer).saving)).toBe(true);
    await browserExpect(documentButton()).toBeDisabled();
    await page.evaluate(() => (window as any).__pending.shift()());
    await browserExpect(cardSave()).toHaveText("Saved");
    await browserExpect(documentButton()).toBeEnabled();
    await expectContent("Completed card edited while X runs");
    const saves = (await calls()).filter((call: any) => call.url.startsWith("/api/drafts"));
    expect(saves.map((call: any) => [call.method, call.body.platform, call.body.content])).toEqual([
      ["POST", "linkedin", "Completed card edited while X runs"], ["POST", "medium", response("medium", "batch").content],
    ]);
    expect((await calls()).some((call: any) => /publish|schedule/.test(call.url))).toBe(false);
    await browserExpect(page.getByText(/2 saved · 1 unsaved or unconfirmed/)).toBeVisible();
  }, 20_000);

  it("a same-turn save blocks its own regeneration but not an unrelated target", async () => {
    await mount("panel", [{ body: response() }, { defer: true, body: response("twitter") }]);
    await generate(); await expectContent(/linkedin original/);
    await page.evaluate(() => {
      (window as any).__saveResponses = [{ defer: true, savedId: "saved-a" }];
      const c = (window as any).__composer as CreatePostComposer;
      void c.saveVersion("linkedin", "thoughtLeader");
      void c.generatePlatform("linkedin"); void c.generateBatch(["linkedin", "twitter"]);
      void c.generatePlatform("twitter");
    });
    await browserExpect.poll(() => page.evaluate(() => (window as any).__pending.length)).toBe(2);
    expect((await calls()).map((call: any) => [call.method, call.url])).toEqual([
      ["POST", "/api/instant-review/manual"], ["POST", "/api/drafts"], ["POST", "/api/instant-review/manual"],
    ]);
    await page.evaluate(() => (window as any).__pending.pop()());
    await browserExpect(cardCopy("twitter")).toBeEnabled();
    await page.evaluate(() => (window as any).__pending.shift()());
    await browserExpect(cardSave()).toHaveText("Saved");
    expect((await calls())[2].body.selectedPlatforms).toEqual(["twitter"]);
  });

  it("keeps only the uncertain target locked while completed cards can be saved and copied", async () => {
    await mount("panel", [{ body: response() }, { body: response("twitter") }, { networkError: true }, { body: response("twitter", "recovered") }]);
    await generate(); await expectContent(/linkedin original/);
    await cardGenerate("twitter").click(); await expectContent(/twitter original/, "twitter");
    await cardGenerate("twitter").click();
    await browserExpect(page.getByRole("button", { name: "Retry same request" })).toBeVisible();
    await browserExpect(cardCopy("twitter")).toBeDisabled();
    await browserExpect(cardSave("twitter")).toBeDisabled();
    await browserExpect(cardHandoff("twitter")).toHaveCount(0);
    await (await cardEditor()).fill("Completed text during uncertainty");
    await cardCopy().click(); await cardSave().click();
    await browserExpect(cardSave()).toHaveText("Saved");
    await browserExpect(documentButton()).toBeDisabled();
    await page.getByRole("button", { name: "Retry same request" }).click();
    await expectContent(/twitter recovered/, "twitter");
    await expectContent("Completed text during uncertainty");
    const posts = (await calls()).filter((call: any) => call.url.includes("instant-review"));
    expect(posts).toHaveLength(4);
    expect(posts[2].body.requestIntent).toBe(posts[3].body.requestIntent);
  });

  it.each(["Article", "Idea"] as const)("links the exact saved draft in %s without scheduling or publishing", async mode => {
    await mount("panel", [{ body: mode === "Article" ? response() : manualResponse() }]);
    if (mode === "Article") { await generate(); await expectContent(/linkedin original/); }
    else { await generateIdea(); await expectIdeaContent(/linkedin original/); }
    const id = "draft/id ?é#one";
    await page.evaluate(id => { (window as any).__saveResponses = [{ savedId: id }]; }, id);
    const save = cardSave();
    await save.click(); await browserExpect(save).toHaveText("Saved");
    for (const [label, destination] of [["Content", "content"], ["Calendar", "calendar"]]) {
      const link = page.getByRole("link", { name: `Go to ${label}`, exact: true });
      await browserExpect(link).toHaveAttribute("href", `/dashboard/${destination}?draft=${encodeURIComponent(id)}`);
      expect(await link.evaluate(element => Boolean(element.closest("button") || element.querySelector("button, a")))).toBe(false);
    }
    const editor = await cardEditor();
    await editor.fill("Changed since save");
    await browserExpect(save).toHaveText("Save changes");
    await browserExpect(page.getByRole("link", { name: "Go to Content" })).toHaveCount(0);
    expect((await calls()).some((call: any) => /schedule|publish|voice/.test(call.url))).toBe(false);
  });

  it("keeps human review, optional voice consent and publishing approval separate", async () => {
    const result = response();
    await mount("panel", [{ body: { ...result, details: { linkedin: { thoughtLeader: {
      ...result.details.linkedin.thoughtLeader,
      claimSupport: { method: "conservative-source-comparison-v1", status: "needs-review", factualVerification: "not-performed", requiresHumanReview: true, truncated: true, claims: [] },
    } } } } }]);
    await generate(); await expectContent(/linkedin original/);
    await browserExpect(card().getByText(/Report limited: some text/)).toBeVisible();
    const review = card().getByRole("checkbox", { name: /I have reviewed the wording/ });
    await browserExpect(review).not.toBeChecked();
    await cardCopy().click(); await cardSave().click();
    await browserExpect(cardSave()).toHaveText("Saved");
    await browserExpect(review).not.toBeChecked();
    await review.check();
    await browserExpect(card().getByText(/not a factual verification certificate or publishing approval/)).toBeVisible();
    await (await cardEditor()).fill("New wording needs separate human review");
    await browserExpect(review).not.toBeChecked();
    await browserExpect(card().getByText(/The original claim report is stale/)).toBeVisible();
    await browserExpect(card().getByText(/Claim checks/)).toHaveCount(0);
    await card().getByRole("button", { name: "Approve an edit as a voice sample…", exact: true }).click();
    await browserExpect(card().getByText("Only select text you have permission to retain. This does not enable voice guidance, verify facts or approve publishing.", { exact: true })).toBeVisible();
    const consent = card().getByRole("checkbox", { name: /I explicitly approve retaining/ });
    await browserExpect(consent).not.toBeChecked();
    await browserExpect(card().getByRole("button", { name: "Retain approved edit", exact: true })).toBeDisabled();
    await consent.check();
    await card().getByRole("textbox", { name: "Approved edit sample", exact: true }).fill("Another bounded optional voice sample");
    await browserExpect(consent).not.toBeChecked();
    await card().getByRole("button", { name: "Cancel approval", exact: true }).click();
    expect((await calls()).some((call: any) => /voice|approve|publish|schedule/.test(call.url))).toBe(false);
    expect((await calls()).find((call: any) => call.url === "/api/drafts").body).not.toHaveProperty("publishApprovedAt");
  });

  it("retains usable earlier results after an acknowledged terminal regeneration failure", async () => {
    const jobId = "00000000-0000-4000-8000-000000000093";
    await mount("panel", [{ body: response() }, { status: 202, body: { jobId } },
      { body: { status: "failed", error: { status: 503, body: { message: "Generation failed. Retry this platform." } } } }]);
    await generate();
    await expectContent(/linkedin original:/);
    await cardGenerate().click();
    await browserExpect(page.getByRole("alert")).toContainText("Retry this platform");
    await expectContent(/linkedin original:/);
    await browserExpect(cardSave()).toBeEnabled();
    await browserExpect(cardCopy()).toBeEnabled();
    await browserExpect(cardHandoff()).toBeEnabled();
    await browserExpect(page.getByRole("button", { name: "Retry same request" })).toHaveCount(0);
    expect((await calls()).filter((call: any) => call.method === "POST").map((call: any) => call.body.selectedPlatforms)).toEqual([["linkedin"], ["linkedin"]]);
  });

  it.each([503, 504])("retains but locks original output after unresolved regeneration %i until the same request resolves", async status => {
    await mount("panel", [{ body: response() }, { status, body: { message: "Generation acknowledgement unavailable" } }, { body: response("linkedin", "recovered") }]);
    await generate(); await expectContent(/linkedin original:/);
    const original = await page.evaluate(() => ((window as any).__composer as CreatePostComposer).versions["linkedin:thoughtLeader"]);
    await cardGenerate().click();
    await browserExpect(page.getByRole("button", { name: "Retry same request" })).toBeVisible();
    await browserExpect(card().getByTestId("textarea-post-content-linkedin")).toHaveValue(response().content);
    await browserExpect(card().getByTestId("textarea-post-content-linkedin")).toBeDisabled();
    await browserExpect(cardSave()).toBeDisabled(); await browserExpect(cardCopy()).toBeDisabled();
    await browserExpect(cardHandoff()).toHaveCount(0);
    expect(await page.evaluate(() => {
      const c = (window as any).__composer as CreatePostComposer;
      c.editVersion("linkedin", "thoughtLeader", "Must not alter uncertain output");
      void c.saveVersion("linkedin", "thoughtLeader"); void c.copyVersion("linkedin", "thoughtLeader");
      return c.setUrl("https://news.test/other");
    })).toBe(false);
    expect(await page.evaluate(() => ((window as any).__composer as CreatePostComposer).versions["linkedin:thoughtLeader"])).toEqual(original);
    expect(await page.evaluate(() => (window as any).__actions)).toEqual([]);
    expect(await calls()).toHaveLength(2);
    await page.getByRole("button", { name: "Retry same request" }).click();
    await expectContent(/linkedin recovered:/);
    await browserExpect(cardSave()).toBeEnabled();
    const requests = await calls();
    expect(requests).toHaveLength(3);
    expect(requests[1].body).toEqual(requests[2].body);
    expect(requests.every((call: any) => call.url === "/api/instant-review/manual")).toBe(true);
  });

  it("cancels a real async UI request after status 503 with exactly one DELETE", async () => {
    const jobId = "00000000-0000-4000-8000-000000000001";
    await mount("panel", [{ status: 202, body: { jobId } },
      { status: 503, headers: { "Retry-After": "60" }, body: { message: "Temporary outage" } },
      { body: { jobId, status: "cancelled" } }]);
    await generate();
    await browserExpect.poll(async () => (await calls()).length).toBe(2);
    await browserExpect(generationProgress()).toBeVisible();
    await page.getByRole("button", { name: "Cancel generation" }).click();
    await browserExpect(page.getByRole("alert")).toContainText("Generation cancelled");
    const requests = await calls();
    expect(requests.map((call: any) => call.method)).toEqual(["POST", "GET", "DELETE"]);
    expect(requests[2]).toMatchObject({ url: `/api/editorial/jobs/${jobId}`, aborted: false });
    expect(await page.getByRole("button", { name: "Save draft", exact: true }).count()).toBe(0);
  });

  it("shows cancellation network failure and can retry cancellation without new generation", async () => {
    const jobId = "00000000-0000-4000-8000-000000000002";
    await mount("panel", [{ status: 202, body: { jobId } },
      { status: 503, headers: { "Retry-After": "60" }, body: { message: "Temporary outage" } },
      { networkError: true }, { body: { jobId, status: "cancelled" } }]);
    await generate();
    await browserExpect.poll(async () => (await calls()).length).toBe(2);
    await page.getByRole("button", { name: "Cancel generation" }).click();
    await browserExpect(page.getByRole("alert")).toContainText("Cancellation could not be confirmed");
    await browserExpect(page.getByRole("button", { name: "Retry same request" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel generation" }).click();
    await browserExpect(page.getByRole("alert")).toContainText("Generation cancelled");
    expect((await calls()).map((call: any) => call.method)).toEqual(["POST", "GET", "DELETE", "DELETE"]);
  });

  it("recovers uncertain admission with the same UUID, then regenerates with a new UUID", async () => {
    const jobId = "00000000-0000-4000-8000-000000000003";
    await mount("panel", [{ networkError: true }, { status: 202, body: { jobId } },
      { body: { status: "completed", progress: { platformsCompleted: 1, platformsTotal: 1 } } },
      { body: response() }, { body: response("linkedin", "new-intent") }]);
    await generate();
    await browserExpect(page.getByRole("alert")).toContainText("Failed to fetch");
    await page.getByRole("button", { name: "Retry same request" }).click();
    await expectContent(/linkedin original:/);
    await cardGenerate().click();
    await expectContent(/linkedin new-intent:/);
    const posts = (await calls()).filter((call: any) => call.method === "POST");
    expect(posts).toHaveLength(3);
    expect(posts[0].body.requestIntent).toBe(posts[1].body.requestIntent);
    expect(posts[2].body.requestIntent).not.toBe(posts[1].body.requestIntent);
  });

  it("recovers exhausted status polling through Retry without losing the job or posting again", async () => {
    const jobId = "00000000-0000-4000-8000-000000000004";
    await mount("panel", [{ status: 202, body: { jobId } },
      ...Array.from({ length: 6 }, () => ({ status: 503, body: { message: "Temporary outage" } })),
      { body: { status: "completed", progress: { platformsCompleted: 1, platformsTotal: 1 } } },
      { body: response("linkedin", "recovered") }]);
    await page.clock.install();
    await generate();
    await browserExpect.poll(async () => (await calls()).length).toBe(2);
    await page.clock.runFor(25_000);
    await browserExpect(page.getByRole("alert")).toContainText("Temporary outage");
    await page.getByRole("button", { name: "Retry same request" }).click();
    await expectContent(/linkedin recovered:/);
    expect((await calls()).filter((call: any) => call.method === "POST")).toHaveLength(1);
  });
});

describe("UX-06 — partial batch recovery (mocked Chromium)", { timeout: 15_000 }, () => {
  const primary = () => page.getByRole("button", { name: /^(Create platform versions|Continue remaining versions)$/ });
  const checkOriginal = () => page.getByRole("button", { name: "Retry same request", exact: true });
  const posts = async () => (await calls()).filter((call: any) => call.url.includes("instant-review") && call.method === "POST");
  const finish = async () => {
    await browserExpect.poll(() => page.evaluate(() => (window as any).__pending.length)).toBe(1);
    await page.evaluate(() => (window as any).__pending.shift()());
  };
  const idle = async () => {
    await browserExpect.poll(() => page.evaluate(() => ((window as any).__composer as CreatePostComposer).busy)).toBe(false);
  };
  const batchStart = async () => {
    await page.locator("#open-story").click(); await preparePlatforms(undefined, false);
    await primary().click();
  };
  const failure = { status: 422, body: { message: "Fixture terminal failure" } };

  it("continues only the unattempted card, then explicitly retries the failed card without touching saved edits", async () => {
    await mount("panel", [{ body: response() }, failure,
      { defer: true, body: response("medium", "continued") }, { defer: true, body: response("twitter", "new attempt") }]);
    await batchStart();
    await browserExpect(card("twitter")).toContainText("Needs retry");
    await browserExpect(card("medium")).toContainText("Not attempted");
    await browserExpect(primary()).toHaveText("Continue remaining versions");
    await (await cardEditor()).fill("Completed LinkedIn edit must survive recovery");
    await cardSave().click();
    await browserExpect(cardSave()).toHaveText("Saved");
    const completed = await page.evaluate(() => ((window as any).__composer as CreatePostComposer).versions["linkedin:thoughtLeader"]);
    await primary().evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
    await browserExpect(card("medium")).toContainText("Generating");
    await browserExpect(card("twitter").getByText("Fixture terminal failure", { exact: true })).toBeVisible();
    expect((await posts()).map((call: any) => call.body.selectedPlatforms)).toEqual([["linkedin"], ["twitter"], ["medium"]]);
    await finish();
    await browserExpect(card("medium").getByTestId("text-post-content-medium")).toContainText("medium continued");
    await browserExpect(primary()).toHaveText("Continue remaining versions");
    await browserExpect(primary()).toBeDisabled();
    await browserExpect(card("twitter")).toContainText("may count toward usage");
    await cardGenerate("twitter").evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
    await finish();
    await browserExpect(card("twitter").getByTestId("text-post-content-twitter")).toContainText("twitter new attempt");
    await idle();
    expect(await page.evaluate(() => ((window as any).__composer as CreatePostComposer).versions["linkedin:thoughtLeader"])).toEqual(completed);
    expect(await page.evaluate(() => ((window as any).__composer as CreatePostComposer).batch.completed)).toEqual(["linkedin", "twitter", "medium"]);
    const requests = await posts();
    expect(requests.map((call: any) => call.body.selectedPlatforms)).toEqual([["linkedin"], ["twitter"], ["medium"], ["twitter"]]);
    expect(new Set(requests.map((call: any) => call.body.requestIntent)).size).toBe(4);
    expect(requests.every((call: any) => call.body.sourceUrl === "https://news.test/a" && call.body.content === source && call.body.tones.join() === "thoughtLeader")).toBe(true);
  });

  it("stops safely and continues the untouched queue sequentially despite duplicate and competing clicks", async () => {
    await mount("panel", [{ defer: true, body: response() }, { defer: true, body: response("twitter") }, { defer: true, body: response("medium") }]);
    await batchStart();
    await page.getByRole("button", { name: "Stop after current post", exact: true }).click();
    await finish();
    await browserExpect(primary()).toHaveText("Continue remaining versions");
    await idle();
    await browserExpect(card("twitter")).toContainText("Not attempted");
    await browserExpect(card("medium")).toContainText("Not attempted");
    expect(await posts()).toHaveLength(1);
    expect(await page.evaluate(() => {
      const c = (window as any).__composer as CreatePostComposer;
      void c.continueBatch(); void c.continueBatch(); void c.generateBatch(["linkedin", "twitter", "medium"]);
      void c.generatePlatform("medium"); void c.generate();
      c.setTone("provocateur"); c.setFormat("article"); c.setPlatform("medium");
      return c.setUrl("https://news.test/b");
    })).toBe(false);
    expect(await page.evaluate(() => {
      const c = (window as any).__composer as CreatePostComposer;
      return { tone: c.tone, format: c.requestedFormat, url: c.url };
    })).toEqual({ tone: "thoughtLeader", format: "short-post", url: "https://news.test/a" });
    await browserExpect(card("twitter")).toContainText("Generating");
    await browserExpect(card("medium")).toContainText("Not attempted");
    await browserExpect(cardGenerate("medium")).toBeDisabled();
    expect((await posts()).map((call: any) => call.body.selectedPlatforms)).toEqual([["linkedin"], ["twitter"]]);
    await finish();
    await browserExpect(card("medium")).toContainText("Generating");
    expect((await posts()).map((call: any) => call.body.selectedPlatforms)).toEqual([["linkedin"], ["twitter"], ["medium"]]);
    await finish();
    await browserExpect(card("medium").getByTestId("text-post-content-medium")).toBeVisible();
    await idle();
    expect(await posts()).toHaveLength(3);
  });

  it.each(["tone", "format"] as const)("fences same-turn and rendered continuation after changing %s until the original input is restored", async field => {
    await mount("panel", [{ body: response() }, failure, { body: response("medium", "original snapshot") }]);
    await batchStart();
    await browserExpect(primary()).toHaveText("Continue remaining versions");
    await idle();
    await page.evaluate(field => {
      const c = (window as any).__composer as CreatePostComposer;
      if (field === "tone") c.setTone("provocateur"); else c.setFormat("article");
      void c.continueBatch(); void c.generateBatch(["linkedin", "twitter", "medium"]);
      void c.generatePlatform("twitter"); void c.generate(true);
    }, field);
    await browserExpect(primary()).toBeDisabled();
    expect(await page.evaluate(() => ((window as any).__composer as CreatePostComposer).batchInputMatches)).toBe(false);
    expect(await posts()).toHaveLength(2);
    await page.evaluate(() => {
      const c = (window as any).__composer as CreatePostComposer;
      void c.continueBatch(); void c.generateBatch(["linkedin", "twitter", "medium"]);
    });
    expect(await posts()).toHaveLength(2);
    if (field === "tone") await changeTone("thoughtLeader");
    else {
      await browserExpect(cardGenerate("twitter")).toBeDisabled();
      await browserExpect(cardGenerate("medium")).toBeDisabled();
      await page.evaluate(() => {
        const c = (window as any).__composer as CreatePostComposer;
        void c.generatePlatform("twitter"); void c.generatePlatform("medium");
      });
      expect(await posts()).toHaveLength(2);
      await changeLength("short-post");
    }
    await browserExpect(primary()).toBeEnabled();
    await primary().click();
    await browserExpect(card("medium").getByTestId("text-post-content-medium")).toContainText("original snapshot");
    expect((await posts()).at(-1).body).toMatchObject({ sourceUrl: "https://news.test/a", content: source, selectedPlatforms: ["medium"], tones: ["thoughtLeader"], format: "short-post" });
  });

  it("keeps later cards Not attempted if continuation itself fails, never replaying earlier attempts", async () => {
    await mount("panel", [{ body: response() }, failure, failure, { body: response("medium") }],
      { enabledPlatforms: ["linkedin", "twitter", "threads", "medium", "substack"] });
    await page.locator("#open-story").click(); await preparePlatforms();
    await page.evaluate(() => {
      const c = (window as any).__composer as CreatePostComposer;
      void c.generateBatch(["linkedin", "twitter", "threads", "medium", "substack", "linkedin"]);
    });
    await browserExpect(primary()).toHaveText("Continue remaining versions");
    await idle();
    expect(await page.evaluate(() => ((window as any).__composer as CreatePostComposer).batch.targets)).toEqual(["linkedin", "twitter", "threads", "medium"]);
    await primary().click();
    await browserExpect(card("threads")).toContainText("Needs retry");
    await browserExpect(primary()).toHaveText("Continue remaining versions");
    // The initial four visible platforms include Substack, not Medium; the
    // continuation ledger still owns Medium even after selection changes.
    await articlePlatformTrigger().click();
    await articlePlatformCheckbox("Substack Notes").uncheck();
    await articlePlatformCheckbox("Medium").check();
    await versionsView();
    await browserExpect(card("medium")).toContainText("Not attempted");
    await primary().click();
    await browserExpect(card("medium").getByTestId("text-post-content-medium")).toBeVisible();
    await browserExpect(primary()).toHaveText("Continue remaining versions");
    await browserExpect(primary()).toBeDisabled();
    expect((await posts()).map((call: any) => call.body.selectedPlatforms)).toEqual([["linkedin"], ["twitter"], ["threads"], ["medium"]]);
  });

  it("requires fresh overwrite consent for an edited unattempted card while leaving completed cards alone", async () => {
    await mount("panel", [{ body: response("medium", "old") }, failure, { body: response("twitter") }, { body: response("medium", "continued") }]);
    await generate("medium");
    await articlePlatformTrigger().click();
    await primary().click();
    await browserExpect(card()).toContainText("Needs retry");
    await browserExpect(card("medium")).toContainText("Not attempted");
    await (await cardEditor("medium")).fill("New edit while the batch is paused");
    const before = await posts();
    page.once("dialog", dialog => dialog.dismiss());
    await primary().click();
    expect(await posts()).toEqual(before);
    await expectContent("New edit while the batch is paused", "medium");
    page.once("dialog", dialog => dialog.accept());
    await primary().click();
    await expectContent(/medium continued/, "medium");
    expect((await posts()).map((call: any) => call.body.selectedPlatforms)).toEqual([["medium"], ["linkedin"], ["twitter"], ["medium"]]);
  });

  it("clears the recovery ledger on accepted source replacement and rejects old continuation callbacks", async () => {
    await mount("panel", [{ body: response() }, failure]);
    await batchStart();
    await browserExpect(primary()).toHaveText("Continue remaining versions");
    await idle();
    page.once("dialog", dialog => dialog.accept());
    await page.evaluate(() => {
      const old = (window as any).__composer as CreatePostComposer;
      old.setUrl("https://news.test/b");
      void old.continueBatch(); void old.generateBatch(["linkedin", "twitter", "medium"]);
      void old.generatePlatform("twitter"); void old.generate(true);
    });
    expect(await page.evaluate(() => ((window as any).__composer as CreatePostComposer).url)).toBe("https://news.test/b");
    await browserExpect(chat()).toBeEnabled();
    for (const platform of ["linkedin", "twitter", "medium"]) await browserExpect(card(platform)).toHaveCount(0);
    expect(await page.evaluate(() => ((window as any).__composer as CreatePostComposer).batchRecovery)).toBeUndefined();
    expect(await posts()).toHaveLength(2);
  });

  it("checks a lost admission with its original UUID, never auto-continues and ignores a stale check after delivery", async () => {
    const jobId = "00000000-0000-4000-8000-000000000061";
    await mount("panel", [{ body: response() }, { networkError: true }, { status: 202, body: { jobId } },
      { body: { status: "completed" } }, { body: response("twitter", "recovered") }, { body: response("medium", "continued") }]);
    await batchStart();
    await browserExpect(checkOriginal()).toBeVisible();
    await browserExpect(card("twitter")).toContainText("Check request");
    await browserExpect(card("twitter")).not.toContainText("Needs retry");
    await browserExpect(card("medium")).toContainText("Not attempted");
    await browserExpect(primary()).toBeDisabled();
    await browserExpect(documentButton()).toBeDisabled();
    await idle();
    await page.evaluate(() => {
      const c = (window as any).__composer as CreatePostComposer;
      c.setTone("provocateur"); c.setFormat("article");
      void c.continueBatch(); void c.generateBatch(["linkedin", "twitter", "medium"]); void c.generatePlatform("twitter");
      (window as any).__staleCheck = () => c.generate(true);
      void c.generate(true); void c.generate(true); void c.generation.retry();
    });
    await browserExpect(card("twitter").getByTestId("text-post-content-twitter")).toContainText("twitter recovered");
    await browserExpect(primary()).toHaveText("Continue remaining versions");
    await idle();
    const requests = await posts();
    expect(requests.map((call: any) => call.body.selectedPlatforms)).toEqual([["linkedin"], ["twitter"], ["twitter"]]);
    expect(requests[1].body).toEqual(requests[2].body);
    expect((await calls()).map((call: any) => call.method)).toEqual(["POST", "POST", "POST", "GET", "GET"]);
    await (await cardEditor("twitter")).fill("Keep this edit after request delivery");
    await page.evaluate(() => (window as any).__staleCheck());
    await expectContent("Keep this edit after request delivery", "twitter");
    expect(await calls()).toHaveLength(5);
    await primary().click();
    await browserExpect(card("medium").getByTestId("text-post-content-medium")).toContainText("medium continued");
    expect((await posts()).at(-1).body.selectedPlatforms).toEqual(["medium"]);
  });

  it.each(["completed", "failed"] as const)("checks an acknowledged job with GET only and handles %s without new paid work", async outcome => {
    const jobId = "00000000-0000-4000-8000-000000000062";
    const next = outcome === "completed"
      ? [{ body: response("twitter", "recovered") }]
      : [{ body: response("twitter", "explicit retry") }];
    await mount("panel", [{ body: response() }, { status: 202, body: { jobId } },
      { status: 403, body: { message: "Status temporarily inaccessible" } },
      { defer: true, body: { status: outcome, error: { status: 422, body: { message: "Confirmed terminal failure" } } } }, ...next]);
    await batchStart();
    await browserExpect(checkOriginal()).toBeVisible();
    await checkOriginal().evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
    await finish();
    if (outcome === "completed") await browserExpect(card("twitter").getByTestId("text-post-content-twitter")).toContainText("recovered");
    else await browserExpect(card("twitter")).toContainText("Needs retry");
    await idle();
    await browserExpect(card("medium")).toContainText("Not attempted");
    await browserExpect(checkOriginal()).toHaveCount(0);
    expect(await posts()).toHaveLength(2);
    expect((await calls()).filter((call: any) => call.method === "DELETE")).toHaveLength(0);
    expect((await calls()).filter((call: any) => call.method === "GET").map((call: any) => call.url)).toEqual([
      `/api/editorial/jobs/${jobId}`, `/api/editorial/jobs/${jobId}`, ...(outcome === "completed" ? [`/api/editorial/jobs/${jobId}/result`] : []),
    ]);
    if (outcome === "failed") {
      await browserExpect(card("twitter")).toContainText("new attempt");
      await cardGenerate("twitter").click();
      await browserExpect(card("twitter").getByTestId("text-post-content-twitter")).toContainText("explicit retry");
      const requests = await posts();
      expect(requests.map((call: any) => call.body.selectedPlatforms)).toEqual([["linkedin"], ["twitter"], ["twitter"]]);
      expect(requests[2].body.requestIntent).not.toBe(requests[1].body.requestIntent);
    }
  });

  it("locks cancellation of a paused request synchronously, retains uncertainty on failure, then continues only untouched cards", async () => {
    const jobId = "00000000-0000-4000-8000-000000000063";
    await mount("panel", [{ status: 202, body: { jobId } }, { status: 403, body: { message: "Status temporarily inaccessible" } },
      { defer: true, networkError: true }, { defer: true, body: { status: "cancelled" } },
      { body: response("twitter") }, { body: response("medium") }]);
    await batchStart();
    await browserExpect(checkOriginal()).toBeVisible();
    await idle();
    expect(await page.evaluate(() => {
      const c = (window as any).__composer as CreatePostComposer;
      void c.generation.cancel(); void c.generation.cancel(); void c.generate(true); void c.generation.retry();
      void c.generateBatch(["linkedin", "twitter", "medium"]); void c.continueBatch();
      c.setTone("provocateur"); c.setFormat("article");
      return c.setUrl("https://news.test/b");
    })).toBe(false);
    await browserExpect(primary()).toBeDisabled();
    await finish();
    await browserExpect(page.getByRole("alert")).toContainText("Cancellation could not be confirmed");
    await browserExpect(card()).toContainText("Check request");
    await browserExpect(primary()).toBeDisabled();
    expect((await calls()).map((call: any) => call.method)).toEqual(["POST", "GET", "DELETE"]);
    await page.getByRole("button", { name: "Cancel generation", exact: true }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
    await finish();
    await browserExpect(page.getByRole("alert")).toContainText("Generation cancelled");
    await browserExpect(card()).toContainText("Needs retry");
    await browserExpect(primary()).toHaveText("Continue remaining versions");
    await primary().click();
    await browserExpect(card("medium").getByTestId("text-post-content-medium")).toBeVisible();
    expect((await posts()).map((call: any) => call.body.selectedPlatforms)).toEqual([["linkedin"], ["twitter"], ["medium"]]);
    expect((await calls()).filter((call: any) => call.method === "DELETE")).toHaveLength(2);
    await browserExpect(card()).toContainText("Needs retry");
    await browserExpect(primary()).toBeDisabled();
  });

  it("reconciles a completed cancellation race before any continuation and retains the delivered card", async () => {
    const jobId = "00000000-0000-4000-8000-000000000064";
    await mount("panel", [{ body: response() }, { status: 202, body: { jobId } },
      { status: 503, headers: { "Retry-After": "60" }, body: { message: "Temporary outage" } },
      { body: { status: "completed" } }, { body: { status: "completed" } },
      { body: response("twitter", "won cancellation race") }, { body: response("medium") }]);
    await batchStart();
    await browserExpect.poll(async () => (await calls()).length).toBe(3);
    await page.getByRole("button", { name: "Cancel generation", exact: true }).click();
    await browserExpect(page.getByRole("alert")).toContainText("Generation already finished");
    await browserExpect(card("twitter")).toContainText("Check request");
    await browserExpect(primary()).toBeDisabled();
    await checkOriginal().click();
    await browserExpect(card("twitter").getByTestId("text-post-content-twitter")).toContainText("won cancellation race");
    await browserExpect(card("medium")).toContainText("Not attempted");
    await idle();
    expect((await calls()).map((call: any) => call.method)).toEqual(["POST", "POST", "GET", "DELETE", "GET", "GET"]);
    await primary().click();
    await browserExpect(card("medium").getByTestId("text-post-content-medium")).toBeVisible();
    expect((await posts()).map((call: any) => call.body.selectedPlatforms)).toEqual([["linkedin"], ["twitter"], ["medium"]]);
  });

  it.each([
    { kind: "blank", body: response("linkedin", "blank", true) },
    { kind: "null response", body: null },
    { kind: "missing platform", body: response("twitter") },
    { kind: "non-text post", body: { ...response(), posts: { linkedin: { thoughtLeader: { text: "invalid" } } } } },
    { kind: "malformed article", body: { ...response(), article: { title: "Missing source fields" } } },
    { kind: "malformed evidence", body: { ...response(), evidence: {} } },
    { kind: "malformed excerpt", body: { ...response(), evidence: { ...response().evidence, excerpts: [null] } } },
    { kind: "malformed warning", body: { ...response(), evidence: { ...response().evidence, warnings: [{ code: "invalid", message: {} }] } } },
    { kind: "malformed attribution", body: { ...response(), details: { linkedin: { thoughtLeader: { ...response().details.linkedin.thoughtLeader, attributions: [{ text: "Invalid", excerptIds: 1 }] } } } } },
    { kind: "malformed provider metadata", body: { ...response(), details: { linkedin: { thoughtLeader: { ...response().details.linkedin.thoughtLeader, generation: { provider: "mock", model: {} } } } } } },
    { kind: "malformed claim report", body: { ...response(), details: { linkedin: { thoughtLeader: { ...response().details.linkedin.thoughtLeader, claimSupport: { claims: null } } } } } },
    { kind: "malformed attachments", body: { ...response(), article: { ...response().article, media: {} } } },
    { kind: "malformed format", body: { ...response(), format: "unknown-format" } },
    { kind: "over-limit post", body: { ...response(), posts: { linkedin: { thoughtLeader: "a".repeat(5001) } } } },
  ])("fails $kind without erasing saved output or attempting the remainder", async ({ body }) => {
    await mount("panel", [{ body: response() }, { body }]);
    await generate();
    await (await cardEditor()).fill("Keep this usable saved revision");
    await cardSave().click();
    await browserExpect(cardSave()).toHaveText("Saved");
    const before = await page.evaluate(() => ((window as any).__composer as CreatePostComposer).versions["linkedin:thoughtLeader"]);
    await articlePlatformTrigger().click();
    page.once("dialog", dialog => dialog.accept());
    await primary().click();
    await browserExpect(card()).toContainText("Needs retry");
    await browserExpect(page.getByText(/No usable text was returned/)).toBeVisible();
    await browserExpect(card("twitter")).toContainText("Not attempted");
    await browserExpect(card("medium")).toContainText("Not attempted");
    await browserExpect(primary()).toHaveText("Continue remaining versions");
    expect(await page.evaluate(() => ((window as any).__composer as CreatePostComposer).versions["linkedin:thoughtLeader"])).toEqual(before);
    expect((await posts()).map((call: any) => call.body.selectedPlatforms)).toEqual([["linkedin"], ["linkedin"]]);
    await browserExpect(cardSave()).toHaveText("Saved");
    await browserExpect(cardCopy()).toBeEnabled();
  });
});