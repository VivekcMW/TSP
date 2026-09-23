import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { chromium, expect as browserExpect, type Browser, type Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
import postcss from "postcss";
import tailwindcss from "tailwindcss";

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

beforeAll(async () => {
  const result = await build({
    absWorkingDir: path.resolve(import.meta.dirname, "../../../.."),
    stdin: { resolveDir: path.resolve(import.meta.dirname, "../../../.."), sourcefile: "editorial-test-harness.tsx", loader: "tsx", contents: `
      import React, { useState } from "react";
      import { createRoot } from "react-dom/client";
      import { QueryClientProvider } from "@tanstack/react-query";
      import { queryClient } from "@/lib/queryClient";
      import { CreatePostProvider, useCreatePost } from "@/components/dashboard/create-post-provider";
      import { PostGeneratorModal } from "@/components/dashboard/post-generator-modal";
      import Dashboard from "@/pages/dashboard";
      import CreatePostPage from "@/pages/create-post";
      import { Link, Route, useLocation } from "wouter";
      window.__calls = []; window.__actions = []; window.__pending = []; window.__toasts = [];
      window.__queryClient = queryClient;
      Object.defineProperty(navigator, "clipboard", { value: { writeText: async text => {
        window.__actions.push(["copy", text]);
        if (window.__copyFails) throw new Error("Clipboard denied");
      } } });
      window.fetch = async (url, options = {}) => {
        window.__calls.push({ url, method: options.method, body: options.body instanceof FormData ? { files: options.body.getAll("files").length } : options.body ? JSON.parse(options.body) : null, signal: options.signal });
        let next;
        if (url === "/api/media/upload") next = window.__uploadResponses.shift();
        else if (String(url).startsWith("/api/drafts")) next = window.__saveResponses.shift() || { body: { id: "saved" } };
        else if (url === "/api/inbox") next = { body: window.__inbox };
        else if (url === "/api/inbox?status=active") next = { body: window.__inbox.filter(item => item.status === "active") };
        else if (String(url).startsWith("/api/inbox/refresh")) next = window.__refreshResponses.shift() || { body: { count: 0 } };
        else if (String(url).startsWith("/api/inbox/")) {
          next = window.__triageResponses.shift() || { body: { id: "a" } };
          if (!next.status || next.status < 400) window.__inbox = window.__inbox.map(item => item.id === String(url).split("/").pop() ? { ...item, status: JSON.parse(options.body).status } : item);
        }
        else if (url === "/api/profile") next = { body: window.__profile };
        else if (url === "/api/integrations") next = { body: [{ key: "bluesky", enabled: false }] };
        else if (String(url).includes("instant-review") || String(url).includes("editorial/jobs")) next = window.__responses.shift() || { body: window.__fallback };
        else throw new Error("Unmocked API: " + url);
        if (next.networkError) throw new TypeError("Failed to fetch");
        if (next.defer) await new Promise(resolve => window.__pending.push(resolve));
        return new Response(JSON.stringify(next.body), { status: next.status || 200, headers: { "Content-Type": "application/json", ...next.headers } });
      };
      queryClient.setQueryData(["/api/inbox"], window.__inbox);
      queryClient.setQueryData(["/api/profile"], window.__profile);
      queryClient.setQueryData(["/api/integrations"], [{ key: "bluesky", enabled: false }]);
      function Launcher() {
        const { openCreate } = useCreatePost();
        const [open, setOpen] = useState(false);
        const [location] = useLocation();
        window.__openCreate = openCreate;
        const item = { id: "a", headline: "Pilot", source: "Desk", summary: "Inbox summary", articleUrl: "https://news.test/a" };
        return <><button id="open" onClick={() => window.__surface === "modal" ? setOpen(true) : openCreate()}>Create</button><button id="open-story" onClick={() => openCreate(item)}>Use story</button><Link id="route" href="/dashboard/content">Content route</Link><div key={location} id="route-content">{location}</div><PostGeneratorModal item={item} isOpen={open} onClose={() => setOpen(false)} onSaveDraft={() => window.__actions.push(["legacy-save"])} onPost={() => window.__actions.push(["legacy-post"])} />{window.__surface === "discover" && <Dashboard />}</>;
      }
      function Harness() {
        const [scope, setScope] = useState("account-a:tenant-a");
        window.__setScope = setScope;
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
  css = (await postcss([tailwindcss({ content: [path.resolve(import.meta.dirname, "../../**/*.tsx")] })]).process("@tailwind base; @tailwind utilities;", { from: undefined })).css;
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterEach(async () => { await page?.close(); });
afterAll(async () => { await browser?.close(); });

async function mount(surface: "panel" | "modal" | "discover" | "public", responses: unknown[] = [], profile: object = {}) {
  page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
  await page.route("**/*", route => route.abort());
  await page.route("https://editorial.test/", route => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
  await page.goto("https://editorial.test/");
  await page.evaluate(({ surface, responses, fallback, profile }) => Object.assign(window, { __surface: surface, __responses: responses, __fallback: fallback,
    __saveResponses: [], __triageResponses: [], __refreshResponses: [], __uploadResponses: [], __profile: { enabledPlatforms: ["linkedin", "twitter", "medium", "bluesky"], defaultPlatform: "linkedin", defaultTone: "professional", ...profile },
    __inbox: ["a", "b"].map(id => ({ id, headline: `Story ${id}`, source: "Desk", summary: "Inbox summary", articleUrl: `https://news.test/${id}`, status: "active", matchedKeywords: [] })) }), { surface, responses, fallback: response(), profile });
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: bundle });
  if (surface !== "discover") await page.locator("#open").click();
}
async function calls() {
  return page.evaluate(() => (window as any).__calls.map((call: any) => ({ url: call.url, method: call.method, body: call.body, aborted: call.signal?.aborted })));
}
async function generate() {
  await page.getByTestId("input-instant-review-url").fill("https://news.test/a");
  await page.getByTestId("button-regenerate").click();
}
async function expectContent(pattern: string | RegExp) { await browserExpect(page.getByTestId("textarea-post-content")).toHaveValue(pattern); }

describe("editorial generation UI (mocked browser)", () => {
  it("provides a safe unavailable action outside the provider", async () => {
    await mount("public");
    await browserExpect(page.locator("#open")).toBeVisible();
    expect(await page.evaluate(() => (window as any).__toasts.at(-1)?.title)).toBe("Create is unavailable here");
    expect(await calls()).toEqual([]);
    await browserExpect(page.getByRole("dialog")).toHaveCount(0);
  });

  it("drops session drafts when the provider is keyed to a new account/tenant", async () => {
    await mount("panel"); await generate(); await expectContent(/linkedin original/);
    await page.getByTestId("textarea-post-content").fill("Private to scope A");
    await page.evaluate(() => (window as any).__setScope("account-b:tenant-b"));
    await browserExpect(page.getByRole("dialog")).toHaveCount(0);
    await page.locator("#open").click();
    await browserExpect(page.getByTestId("textarea-post-content")).toHaveCount(0);
    await browserExpect(page.getByTestId("input-instant-review-url")).toHaveValue("");
    expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  });

  it("admits only one generation for two synchronous clicks", async () => {
    await mount("panel", [{ defer: true, body: response() }]);
    await page.getByTestId("input-instant-review-url").fill("https://news.test/a");
    await page.getByTestId("button-regenerate").evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
    await browserExpect(page.getByTestId("button-regenerate")).toBeDisabled();
    expect(await calls()).toHaveLength(1);
    await page.evaluate(() => (window as any).__pending.shift()());
    await expectContent(/linkedin original/);
  });

  it("blocks generation during upload and discards a late attachment after closing", async () => {
    await mount("panel");
    await page.getByLabel("Source type").selectOption("manual");
    await page.getByLabel("Article title", { exact: true }).fill("Manual source");
    await page.getByLabel("Article text", { exact: true }).fill(source);
    await page.evaluate(() => { (window as any).__uploadResponses = [{ defer: true, body: { assets: [{ id: "00000000-0000-4000-8000-000000000001", type: "image", name: "late.png", url: "/uploads/late.png" }] } }]; });
    await page.getByTestId("input-article-media").setInputFiles({ name: "late.png", mimeType: "image/png", buffer: Buffer.from("mock image") });
    await browserExpect(page.getByText("Uploading…", { exact: true })).toBeVisible();
    await browserExpect(page.getByTestId("button-regenerate")).toBeDisabled();
    await browserExpect(page.getByLabel("Source type")).toBeDisabled();
    page.once("dialog", dialog => dialog.accept()); await page.keyboard.press("Escape");
    await browserExpect(page.getByRole("dialog")).toHaveCount(0);
    await page.evaluate(() => (window as any).__pending.shift()());
    await page.locator("#open").click();
    await browserExpect(page.getByText("late.png (image)")).toHaveCount(0);
    await browserExpect(page.getByLabel("Article text", { exact: true })).toHaveValue(source);
    await browserExpect(page.getByTestId("button-regenerate")).toBeEnabled();
    expect((await calls())[0].aborted).toBe(true);
  });

  it("keeps draft text after a failed PATCH and retries the same saved ID", async () => {
    await mount("panel"); await generate(); await expectContent(/linkedin original/);
    await page.getByTestId("button-save-draft").click();
    await browserExpect(page.getByTestId("button-save-draft")).toHaveText("Saved");
    await page.getByTestId("textarea-post-content").fill("Updated after saving");
    await page.evaluate(() => { (window as any).__saveResponses = [{ networkError: true }]; });
    await page.getByTestId("button-save-draft").click();
    await browserExpect(page.getByRole("alert")).toContainText("Your text is retained");
    await expectContent("Updated after saving");
    await page.getByTestId("button-save-draft").click();
    await browserExpect(page.getByTestId("button-save-draft")).toHaveText("Saved");
    expect((await calls()).filter((call: any) => call.url.startsWith("/api/drafts")).map((call: any) => [call.method, call.url])).toEqual([["POST", "/api/drafts"], ["PATCH", "/api/drafts/saved"], ["PATCH", "/api/drafts/saved"]]);
  });

  it("uses saved tone and only globally available profile platforms without generating", async () => {
    await mount("panel", [], { defaultTone: "contrarian", defaultPlatform: "medium", enabledPlatforms: ["medium", "bluesky"] });
    await browserExpect(page.getByLabel("Tone", { exact: true })).toHaveValue("provocateur");
    await browserExpect(page.getByLabel("Platform", { exact: true })).toHaveValue("medium");
    expect(await page.getByLabel("Platform", { exact: true }).locator("option").allTextContents()).toEqual(["Medium"]);
    expect(await calls()).toEqual([]);
    await page.evaluate(() => {
      (window as any).__queryClient.setQueryData(["/api/profile"], { enabledPlatforms: [] });
    });
    await browserExpect(page.getByTestId("button-regenerate")).toBeDisabled();
    await browserExpect(page.getByText(/No enabled platforms are available/)).toBeVisible();
  });

  it("keeps edits per tone, confirms overwrites, and retains edits after a failed regeneration", async () => {
    await mount("panel", [{ body: response() }, { status: 422, body: { message: "Provider rejected request" } }]);
    await generate();
    await page.getByTestId("textarea-post-content").fill("My reviewed wording");
    await browserExpect(page.getByText(/attribution mappings describe the original generated text only/)).toBeVisible();
    await page.getByLabel("Tone", { exact: true }).selectOption("provocateur");
    await expectContent(/linkedin original/);
    await page.getByLabel("Tone", { exact: true }).selectOption("thoughtLeader");
    await expectContent("My reviewed wording");
    page.once("dialog", dialog => dialog.dismiss());
    await page.getByTestId("button-regenerate").click();
    expect(await calls()).toHaveLength(1);
    page.once("dialog", dialog => dialog.accept());
    await page.getByTestId("button-regenerate").click();
    await browserExpect(page.getByRole("alert")).toContainText("Provider rejected request");
    await expectContent("My reviewed wording");
  });

  it("retains failed saves, deduplicates rapid clicks, and PATCHes acknowledged draft IDs", async () => {
    await mount("panel"); await generate(); await expectContent(/linkedin original/);
    await page.getByTestId("textarea-post-content").fill("Reviewed draft");
    await page.evaluate(() => { (window as any).__saveResponses = [{ status: 500, body: { message: "Storage unavailable" } }, { defer: true, body: { id: "draft-a" } }, { body: { id: "draft-a" } }]; });
    await page.getByTestId("button-save-draft").click();
    await browserExpect(page.getByRole("alert")).toContainText("Your text is retained");
    await expectContent("Reviewed draft");
    await page.getByTestId("button-save-draft").evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
    await browserExpect(page.getByTestId("button-save-draft")).toHaveText("Saving…");
    expect((await calls()).filter((call: any) => call.url === "/api/drafts")).toHaveLength(2);
    await page.evaluate(() => (window as any).__pending.shift()());
    await browserExpect(page.getByTestId("button-save-draft")).toHaveText("Saved");
    await browserExpect(page.getByRole("link", { name: "Go to Calendar" })).toBeVisible();
    await page.getByTestId("textarea-post-content").fill("Reviewed again");
    await page.getByTestId("button-save-draft").click();
    await browserExpect(page.getByTestId("button-save-draft")).toHaveText("Saved");
    expect((await calls()).at(-1)).toMatchObject({ url: "/api/drafts/draft-a", method: "PATCH", body: { content: "Reviewed again" } });
    expect((await calls()).some((call: any) => /publish|schedule/.test(call.url))).toBe(false);
  });

  it("reports clipboard denial honestly and gives the external link no copy ownership", async () => {
    await mount("panel"); await generate(); await expectContent(/linkedin original/);
    await page.evaluate(() => { (window as any).__copyFails = true; });
    await page.getByTestId("button-copy-content").click();
    await browserExpect(page.getByText(/Copy failed. Select and copy/)).toBeVisible();
    expect(await page.getByText(/^Copied\./).count()).toBe(0);
    await browserExpect(page.getByTestId("button-post-now")).toHaveAttribute("target", "_blank");
    expect(await page.evaluate(() => (window as any).__actions)).toEqual([["copy", response().content]]);
    await page.evaluate(() => { (window as any).__copyFails = false; });
    await page.getByTestId("button-copy-content").click();
    await browserExpect(page.getByText(/^Copied\./)).toBeVisible();
    await page.getByTestId("textarea-post-content").fill(" ");
    await browserExpect(page.getByTestId("button-copy-content")).toBeDisabled();
    await browserExpect(page.getByTestId("button-save-draft")).toBeDisabled();
    await browserExpect(page.getByTestId("button-post-now")).toHaveCount(0);
  });

  it("guards unsaved close, source replacement, reload and saved-link navigation", async () => {
    await mount("panel"); await generate(); await expectContent(/linkedin original/);
    await page.getByTestId("textarea-post-content").fill("Keep this text");
    expect(await page.evaluate(() => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; })).toBe(true);
    page.once("dialog", dialog => dialog.dismiss()); await page.keyboard.press("Escape");
    await expectContent("Keep this text");
    page.once("dialog", dialog => dialog.dismiss());
    await page.evaluate(() => (window as any).__openCreate({ id: "b", headline: "Other source", articleUrl: "https://news.test/b" }));
    await expectContent("Keep this text");
    await browserExpect(page.getByTestId("input-instant-review-url")).toHaveValue("https://news.test/a");
    await page.getByTestId("button-save-draft").click();
    await browserExpect(page.getByTestId("button-save-draft")).toHaveText("Saved");
    page.once("dialog", dialog => dialog.dismiss());
    await page.getByRole("link", { name: "Go to Content" }).click();
    expect(new URL(page.url()).pathname).toBe("/");
    await expectContent("Keep this text");
    expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  });

  it("fits a 320px viewport with stacked controls and accessible touch targets", async () => {
    await mount("panel"); await page.setViewportSize({ width: 320, height: 740 });
    await generate(); await expectContent(/linkedin original/);
    const dialog = page.getByRole("dialog", { name: "Create draft", exact: true });
    const bounds = await dialog.boundingBox();
    expect(bounds?.width).toBe(320);
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    for (const control of [page.getByLabel("Platform", { exact: true }), page.getByLabel("Tone", { exact: true }), page.getByTestId("button-save-draft"), dialog.getByRole("button", { name: "Close", exact: true })]) {
      expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
  });

  it("Discover waits for triage acknowledgement and ignores modified/interactive shortcuts", async () => {
    await mount("discover");
    await browserExpect(page.getByRole("button", { name: "Save story", exact: true })).toBeVisible();
    expect((await calls()).some((call: any) => call.url === "/api/inbox/refresh")).toBe(false);
    await page.getByRole("button", { name: "Save story", exact: true }).focus();
    await page.keyboard.press("d");
    await page.locator("#route").focus(); await page.keyboard.press("s");
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
    await browserExpect(page.getByRole("dialog", { name: "Create draft", exact: true })).toHaveCount(1);
    await browserExpect(page.getByTestId("input-instant-review-url")).toHaveValue("https://news.test/b");
    expect((await calls()).filter((call: any) => call.url.includes("instant-review"))).toHaveLength(0);
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
    await mount("modal");
    expect(await calls()).toEqual([]);
    await page.getByTestId("button-regenerate").click();
    await browserExpect(page.getByTestId("textarea-post-content")).toHaveValue(/linkedin original/);
    await browserExpect(page.getByText("Human review required — not fact-checked.")).toBeVisible();
    await browserExpect(page.getByText(/mock-fallback-model/)).toBeVisible();
    await browserExpect(page.getByText(/Fallback provider used/)).toBeVisible();
    await page.getByText("Fetched article content", { exact: true }).click();
    await browserExpect(page.getByTestId("text-source-content")).toHaveText(source);
    await page.getByText("Source evidence excerpts (1)").click();
    await browserExpect(page.getByText("p1", { exact: true })).toBeVisible();
    expect((await calls())[0]).toMatchObject({ url: "/api/instant-review/selected", body: { url: "https://news.test/a", selectedPlatforms: ["linkedin"] } });
    expect(await page.evaluate(() => (window as any).__actions)).toEqual([]);
  });

  it("keeps save and composer disabled on actionable errors and empty output", async () => {
    await mount("modal", [{ status: 422, body: { code: "ai_budget", message: "Generation budget reached. Try again later or contact your administrator." } }, { body: response("linkedin", "empty", true) }]);
    await page.getByTestId("button-regenerate").click();
    await browserExpect(page.getByRole("alert")).toContainText("budget reached");
    await browserExpect(page.getByTestId("button-save-draft")).toHaveCount(0);
    await browserExpect(page.getByTestId("button-post-now")).toHaveCount(0);
    await page.getByTestId("button-regenerate").click();
    await browserExpect(page.getByText(/No usable text was returned/)).toBeVisible();
    await browserExpect(page.getByTestId("button-save-draft")).toBeDisabled();
    await browserExpect(page.getByTestId("button-post-now")).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__actions)).toEqual([]);
  });

  it("cancels long generation, forwards AbortSignal, and discards a late success", async () => {
    const jobId = "00000000-0000-4000-8000-000000000011";
    await mount("modal", [{ status: 202, body: { jobId } }, { defer: true, body: { status: "completed" } }, { body: { status: "cancelled" } }]);
    await page.getByTestId("button-regenerate").click();
    await browserExpect(page.getByRole("status")).toContainText("Results appear when complete");
    await browserExpect.poll(async () => (await calls()).length).toBe(2);
    await page.getByRole("button", { name: "Cancel generation" }).click();
    await page.evaluate(() => (window as any).__pending.shift()());
    await browserExpect(page.getByRole("alert")).toContainText("cancelled");
    expect((await calls())[1].aborted).toBe(true);
    await browserExpect(page.getByTestId("textarea-post-content")).toHaveCount(0);
    await browserExpect(page.getByTestId("button-save-draft")).toHaveCount(0);
  });

  it("supports article format only on suitable platforms and sends the selection", async () => {
    await mount("modal");
    await page.getByLabel("Format", { exact: true }).selectOption("article");
    expect(await calls()).toEqual([]);
    await page.getByTestId("button-regenerate").click();
    await expectContent(/linkedin original/);
    await browserExpect(page.getByTestId("button-regenerate")).toBeEnabled();
    expect((await calls()).at(-1).body.format).toBe("article");
    await page.getByLabel("Platform", { exact: true }).selectOption("twitter");
    await browserExpect(page.getByLabel("Format", { exact: true })).toHaveValue("short-post");
    expect(await page.getByLabel("Format", { exact: true }).locator('option[value="article"]').count()).toBe(0);
    await browserExpect(page.getByTestId("button-regenerate")).toBeEnabled();
    expect(await calls()).toHaveLength(1);
    await page.getByTestId("button-regenerate").click();
    expect((await calls()).at(-1).body).toMatchObject({ selectedPlatforms: ["twitter"], format: "short-post" });
  });

  it("regenerates one platform without erasing another or its evidence snapshot", async () => {
    await mount("panel", [{ body: response() }, { body: response("twitter", "second") }, { body: response("twitter", "regenerated") }]);
    await generate();
    await expectContent(/linkedin original:/);
    await page.getByLabel("Platform", { exact: true }).selectOption("twitter");
    await page.getByRole("button", { name: "Generate Twitter/X only", exact: true }).click();
    await expectContent(/twitter second:/);
    await page.getByRole("button", { name: "Regenerate Twitter/X only", exact: true }).click();
    await expectContent(/twitter regenerated:/);
    await page.getByLabel("Platform", { exact: true }).selectOption("linkedin");
    await expectContent(/linkedin original:/);
    await page.getByText("Source evidence excerpts (1)").first().click();
    await browserExpect(page.getByRole("blockquote").first()).toContainText(source);
    expect(await page.getByText(/Snapshot: regenerated/).count()).toBe(0);
    const requests = await calls();
    expect(requests.map((call: any) => call.body.selectedPlatforms)).toEqual([["linkedin"], ["twitter"], ["twitter"]]);
    expect(requests.every((call: any) => call.url === "/api/instant-review/selected")).toBe(true);
    expect(new Set(requests.map((call: any) => call.body.requestIntent)).size).toBe(3);
    expect(requests.every((call: any) => /^[0-9a-f-]{36}$/.test(call.body.requestIntent))).toBe(true);
    expect(await page.evaluate(() => (window as any).__actions)).toEqual([]);
  });

  it("keeps the selected manual platform and prevents empty option saves", async () => {
    await mount("panel", [{ body: { ...response("medium", "manual", true), article: { title: "Manual", content: source, source: "Your draft", url: "", domain: "manual" } } }]);
    await page.getByLabel("Platform", { exact: true }).selectOption("medium");
    await page.getByLabel("Source type").selectOption("manual");
    await page.getByTestId("input-manual-article-title").fill("Manual");
    await page.getByTestId("editor-manual-article").fill(source);
    await page.getByTestId("button-regenerate").click();
    await browserExpect(page.getByRole("button", { name: "Regenerate Medium only" })).toBeVisible();
    for (const button of await page.getByRole("button", { name: "Save draft", exact: true }).all()) await browserExpect(button).toBeDisabled();
    expect((await calls())[0]).toMatchObject({ url: "/api/instant-review/manual", body: { selectedPlatforms: ["medium"] } });
  });

  it("keeps generation and the single composer across close and route transitions", async () => {
    await mount("panel", [{ defer: true, body: response() }]);
    await generate();
    await browserExpect(page.getByRole("status")).toBeVisible();
    page.once("dialog", dialog => dialog.accept());
    await page.keyboard.press("Escape");
    expect((await calls())[0].aborted).toBe(false);
    await page.locator("#route").click();
    await browserExpect(page.locator("#route-content")).toHaveText("/dashboard/content");
    await page.evaluate(() => (window as any).__pending.shift()());
    await page.locator("#open").click();
    await expectContent(/linkedin original:/);
    await browserExpect(page.getByRole("dialog", { name: "Create draft", exact: true })).toHaveCount(1);
    expect(await calls()).toHaveLength(1);
  });

  it("locks platform changes during generation and never calls legacy save/post owners", async () => {
    await mount("modal", [{ defer: true, body: response() }, { body: response("twitter", "latest") }]);
    await page.getByTestId("button-regenerate").click();
    await browserExpect(page.getByRole("status")).toBeVisible();
    await browserExpect(page.getByLabel("Platform", { exact: true })).toBeDisabled();
    await page.evaluate(() => (window as any).__pending.shift()());
    await expectContent(/linkedin original/);
    await page.getByLabel("Platform", { exact: true }).selectOption("twitter");
    expect(await calls()).toHaveLength(1);
    await page.getByTestId("button-regenerate").click();
    await expectContent(/twitter latest/);
    await page.getByTestId("button-save-draft").click();
    await browserExpect(page.getByTestId("button-save-draft")).toHaveText("Saved");
    expect(await page.evaluate(() => (window as any).__actions)).toEqual([]);
    expect((await calls()).at(-1).body).toMatchObject({ platform: "twitter", content: expect.stringContaining("twitter latest") });
  });

  it("retains earlier platform results when regeneration fails", async () => {
    await mount("panel", [{ body: response() }, { status: 504, body: { message: "Generation timed out. Retry this platform." } }]);
    await generate();
    await expectContent(/linkedin original:/);
    await page.getByRole("button", { name: "Regenerate LinkedIn only" }).click();
    await browserExpect(page.getByRole("alert")).toContainText("Retry this platform");
    await expectContent(/linkedin original:/);
    await browserExpect(page.getByRole("button", { name: "Save draft", exact: true }).first()).toBeEnabled();
    expect((await calls()).map((call: any) => call.body.selectedPlatforms)).toEqual([["linkedin"], ["linkedin"]]);
  });

  it("cancels a real async UI request after status 503 with exactly one DELETE", async () => {
    const jobId = "00000000-0000-4000-8000-000000000001";
    await mount("panel", [{ status: 202, body: { jobId } },
      { status: 503, headers: { "Retry-After": "60" }, body: { message: "Temporary outage" } },
      { body: { jobId, status: "cancelled" } }]);
    await generate();
    await browserExpect.poll(async () => (await calls()).length).toBe(2);
    await browserExpect(page.getByRole("status")).toBeVisible();
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
    await page.getByRole("button", { name: "Regenerate LinkedIn only" }).click();
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