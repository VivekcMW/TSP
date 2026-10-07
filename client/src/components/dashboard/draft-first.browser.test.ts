import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { chromium, expect as check, type Browser, type Page } from "@playwright/test";
import type { Editor } from "@tiptap/react";
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import path from "node:path";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import { z } from "zod";
import { saveCreationSessionSchema, type CreationSession } from "@shared/creation-session";
import { EDITORIAL_RECOVERY_KEY } from "@/lib/editorial-recovery";

const root = path.resolve(import.meta.dirname, "../../../..");
const source = "Desk reports 12% lower latency in a pilot of 30 stores.";
const mainText = "The pilot reduced latency. My view: test the result before expanding the rollout.";
const article = { title: "A measured rollout", content: source, source: "Desk", url: "https://news.test/pilot", domain: "news.test" };
const evidence = { sourceId: "source-a", title: article.title, source: "Desk", url: article.url,
  sourceBrief: source, excerpts: [{ id: "p1", text: source, start: 0, end: source.length }], warnings: [],
  suppliedCharacters: source.length, retainedCharacters: source.length, verification: "source-excerpts-only" };
const detail = (content: string) => ({ content, evidence, attributions: [{ text: content, excerptIds: ["p1"] }],
  generation: { provider: "fixture", model: "fixture", usage: { inputTokens: 1, outputTokens: 1 }, fallbackUsed: false, attempts: [] },
  validation: { structural: "passed", attributionMapping: "passed", factualVerification: "not-performed", requiresHumanReview: true } });
const mainResult = () => ({ article, mainDraft: detail(mainText), posts: {}, details: {}, evidence, format: "short-post" });
const jobId = "00000000-0000-4000-8000-000000000011";
let browser: Browser, page: Page, bundle: string, css: string;
let saved: { revision: number; state: CreationSession | null };
let generationCalls: Record<string, unknown>[], writes: string[], errors: string[], unexpected: string[];
let failSave: boolean, failLoad: boolean, deferSave: boolean, deferMain: boolean, recoveredMain: boolean, failMain: boolean;
let failPlatform: string | undefined;
let saveDeferred: (() => void) | undefined, mainDeferred: (() => void) | undefined;

beforeAll(async () => {
  const result = await build({
    absWorkingDir: root, stdin: { resolveDir: root, sourcefile: "document-chat-fixture.tsx", loader: "tsx", contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { QueryClientProvider } from "@tanstack/react-query";
      import { queryClient } from "@/lib/queryClient";
      import { CreatePostProvider, useCreatePost } from "@/components/dashboard/create-post-provider";
      import CreatePostPage from "@/pages/create-post";
      import { Link, Route } from "wouter";
      function App() {
        const context = useCreatePost();
        return <div style={{height:"100dvh",display:"flex",flexDirection:"column"}}>
          <nav><Link href="/dashboard/create">Create</Link><Link href="/dashboard/content">Content</Link>
          <button onClick={context.startNewCreate}>Start new</button>
          <button onClick={() => context.openCreate({ id:"fixture-story",headline:"Another story",articleUrl:"https://news.test/other",source:"Desk",summary:"Another report." })}>Use fixture story</button></nav>
          <div style={{flex:1,minHeight:0}}><Route path="/dashboard/create"><CreatePostPage /></Route><Route path="/dashboard/content"><h1>Content fixture</h1></Route></div>
        </div>;
      }
      createRoot(document.getElementById("root")).render(<QueryClientProvider client={queryClient}><CreatePostProvider><App /></CreatePostProvider></QueryClientProvider>);
    ` }, bundle: true, write: false, format: "iife", jsx: "automatic",
    alias: { "@": path.join(root, "client/src"), "@shared": path.join(root, "shared") },
    plugins: [{ name: "auth-fixture", setup(build) {
      build.onResolve({ filter: /^@\/lib\/auth$/ }, () => ({ path: "auth", namespace: "fixture" }));
      build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: `export const useAuth=()=>({user:{id:"fixture",firstName:"Ada"}});export const useIsSignedIn=()=>true;`, loader: "js" }));
    } }],
  });
  bundle = result.outputFiles[0].text;
  css = (await postcss([tailwindcss(path.join(root, "tailwind.config.ts"))]).process(
    readFileSync(path.join(root, "client/src/index.css"), "utf8").replace('@import "./design/tokens.generated.css";',
      readFileSync(path.join(root, "client/src/design/tokens.generated.css"), "utf8")), { from: path.join(root, "client/src/index.css") })).css;
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });
beforeEach(async () => {
  saved = { revision: 0, state: null }; generationCalls = []; writes = []; errors = []; unexpected = [];
  failSave = false; failLoad = false; deferSave = false; deferMain = false; recoveredMain = false; failMain = false;
  saveDeferred = undefined; mainDeferred = undefined; failPlatform = undefined;
  page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" });
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    const reply = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.hostname !== "creation.test") { unexpected.push(request.url()); await route.abort(); return; }
    if (url.pathname === "/app.js") return route.fulfill({ contentType: "application/javascript", body: bundle });
    if (!url.pathname.startsWith("/api/")) return route.fulfill({ contentType: "text/html",
      body: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>` });
    if (method !== "GET") writes.push(`${method} ${url.pathname}`);
    if (url.pathname === "/api/profile") return reply({ tenantId: "tenant-a", enabledPlatforms: ["linkedin", "twitter", "threads", "substack", "medium"], defaultTone: "professional" });
    if (url.pathname === "/api/integrations") return reply([]);
    if (url.pathname === "/api/me") return reply({ name: "Ada Builder", email: "ada@example.test" });
    if (url.pathname === "/api/inbox") return reply(["pilot", "other"].map((id, index) => ({
      id, headline: index ? "Another story" : "Pilot report", source: "Desk", summary: null, articleUrl: `https://news.test/${id}`, status: "active", matchedKeywords: [],
    })));
    if (url.pathname === "/api/creation-session") {
      if (method === "GET") return failLoad ? reply({ message: "Fixture load unavailable" }, 503) : reply(saved);
      if (failSave) return reply({ message: "Fixture save unavailable" }, 503);
      const change = saveCreationSessionSchema.parse(request.postDataJSON());
      if (deferSave) { deferSave = false; await new Promise<void>(resolve => { saveDeferred = resolve; }); }
      if (change.revision !== saved.revision) return reply({ message: "Creation changed in another tab." }, 409);
      saved = { revision: saved.revision + 1, state: change.state }; return reply(saved);
    }
    if (recoveredMain && url.pathname === `/api/editorial/jobs/${jobId}`) return reply({ status: "completed", progress: { platformsCompleted: 0, platformsTotal: 0 } });
    if (recoveredMain && url.pathname === `/api/editorial/jobs/${jobId}/result`) return reply(mainResult());
    if (url.pathname.startsWith("/api/instant-review/")) {
      const body = z.record(z.unknown()).parse(request.postDataJSON()); generationCalls.push(body);
      if (body.stage === "main") {
        if (failMain) return reply({ code: "ai_invalid_output", message: "Suggestion could not be completed." }, 422);
        if (deferMain) await new Promise<void>(resolve => { mainDeferred = resolve; });
        return reply(mainResult());
      }
      const platform = z.array(z.string()).parse(body.selectedPlatforms)[0];
      if (platform === failPlatform) return reply({ code: "ai_invalid_output", message: "Platform generation failed." }, 422);
      const tone = z.array(z.string()).parse(body.tones)[0], content = `${platform}: ${String(body.content)}`;
      return reply({ article: { ...article, title: body.title, content: body.content, domain: "manual" },
        posts: { [platform]: { [tone]: content } }, details: { [platform]: { [tone]: detail(content) } },
        evidence, format: body.format, usage: { inputTokens: 1, outputTokens: 1 }, fallbackUsed: false });
    }
    if (url.pathname === "/api/drafts" && method === "POST") return reply({ ...z.record(z.unknown()).parse(request.postDataJSON()),
      id: "saved-platform", updatedAt: "2026-10-07T12:00:00.000Z" });
    unexpected.push(`${method} ${url.pathname}`); return reply({ message: "Unmocked API" }, 500);
  });
});
afterEach(async () => {
  mainDeferred?.(); saveDeferred?.();
  await page.close();
  expect(errors).toEqual([]); expect(unexpected).toEqual([]);
});
const editor = () => page.getByRole("textbox", { name: "Document text", exact: true });
const chat = () => page.getByRole("textbox", { name: "Message Pundit", exact: true });
const card = (platform = "linkedin") => page.getByTestId(`social-preview-${platform}`);
const format = (name: string) => page.getByRole("toolbar", { name: "Document formatting" }).getByRole("button", { name, exact: true });
const documentSelection = () => editor().evaluate(el => (el as HTMLElement & { editor: Editor }).editor.state.selection.toJSON());
async function selectDocument() {
  // Re-enter with a real click, not bare DOM focus, without disturbing an active selection.
  if (!await editor().evaluate(el => document.activeElement === el)) await editor().click();
  await editor().press("ControlOrMeta+a");
  await check.poll(documentSelection).toEqual({ type: "all" });
}
async function open() {
  await page.goto("https://creation.test/dashboard/create");
  await check(editor()).toBeEnabled();
}
async function command(value: string) { await chat().fill(`/${value}`); await chat().press("Enter"); }
async function propose() {
  await chat().fill("Draft an argument from this pilot: 30 stores reduced latency by 12%.");
  await page.getByRole("button", { name: "Send suggestion", exact: true }).click();
  await check(page.getByTestId("proposed-draft")).toHaveText(mainText);
}
async function main() { await propose(); await page.getByRole("button", { name: "Apply changes", exact: true }).click(); await check(editor()).toHaveText(mainText); }
async function choose(...platforms: string[]) {
  await command("platforms");
  for (const name of platforms) await page.getByRole("checkbox", { name, exact: true }).check();
}
async function generatePlatforms(...platforms: string[]) {
  await choose(...platforms); await page.getByTestId("button-generate-selected").click();
  await check(card()).toContainText(mainText);
}
async function saveProgress() {
  await page.getByRole("button", { name: "Save progress", exact: true }).click();
  await check(page.getByText("All changes saved", { exact: true }).first()).toBeVisible();
}

describe("document editor and integrated agent chat", { timeout: 15_000 }, () => {
  it.each([["Bold", "strong"], ["Italic", "em"], ["Underline", "u"], ["Strikethrough", "s"], ["Highlight", "mark"]])(
    "saves and restores %s formatting without an AI request", async (action, tag) => {
      await open(); await editor().fill(mainText); await selectDocument(); await format(action).click();
      await check(editor().locator(tag)).toHaveText(mainText);
      await check(format(action)).toHaveAttribute("aria-pressed", "true");
      await saveProgress(); expect(saved.state?.main?.formatJson).toBeTruthy();
      await page.reload(); await check(editor().locator(tag)).toHaveText(mainText);
      await page.getByRole("link", { name: "Content", exact: true }).click();
      await page.getByRole("link", { name: "Create", exact: true }).click();
      await check(editor().locator(tag)).toHaveText(mainText);
      expect(generationCalls).toEqual([]);
    },
  );
  it.each([["Heading", "h2"], ["Bulleted list", "ul > li"], ["Numbered list", "ol > li"], ["Quote", "blockquote"]])(
    "saves %s structure and clears it back to plain paragraphs", async (action, selector) => {
      await open(); await editor().fill(mainText); await selectDocument(); await format(action).click();
      await check(editor().locator(selector)).toHaveText(mainText);
      await saveProgress(); await page.reload(); await check(editor().locator(selector)).toHaveText(mainText);
      await selectDocument(); await format("Clear formatting").click();
      await check(editor().locator(selector)).toHaveCount(0); await check(editor().locator("p")).toHaveText(mainText);
    },
  );
  it.each(["left", "center", "right"])("saves %s paragraph alignment", async alignment => {
    await open(); await editor().fill(mainText); await format(`Align ${alignment}`).click();
    await check(editor().locator("p")).toHaveCSS("text-align", alignment);
    await saveProgress(); await page.reload(); await check(editor().locator("p")).toHaveCSS("text-align", alignment);
    await selectDocument(); await format("Clear formatting").click();
    await check(editor().locator("p")).not.toHaveAttribute("style", /text-align/);
  });
  it("supports typing, keyboard formatting, undo and redo without moving the cursor", async () => {
    await open(); await editor().pressSequentially("Document text");
    await selectDocument(); await editor().press("ControlOrMeta+b");
    await check(editor().locator("strong")).toHaveText("Document text");
    await format("Undo").click(); await check(editor().locator("strong")).toHaveCount(0);
    await format("Redo").click(); await check(editor().locator("strong")).toHaveText("Document text");
    await selectDocument(); await format("Clear formatting").click();
    await check(editor().locator("strong")).toHaveCount(0);
    await editor().press("ArrowRight");
    // Native navigation reaches ProseMirror through asynchronous selectionchange.
    await check.poll(documentSelection).toEqual({ type: "text", anchor: 14, head: 14 });
    await editor().pressSequentially(" stays in order.");
    await check(editor()).toHaveText("Document text stays in order.");
    await saveProgress(); await selectDocument(); await editor().press("ArrowLeft");
    await check.poll(documentSelection).toEqual({ type: "text", anchor: 1, head: 1 });
    await editor().pressSequentially("My ");
    await check(editor()).toHaveText("My Document text stays in order.");
  });
  it.each(["Start new", "Use fixture story"])("does not undo into the previous creation after %s", async action => {
    await open(); await editor().fill("Private wording from the previous document.");
    await selectDocument(); await format("Bold").click();
    page.once("dialog", dialog => dialog.accept()); await page.getByRole("button", { name: action, exact: true }).click();
    await check(editor()).toHaveText(""); await check(format("Undo")).toBeDisabled();
    await editor().press("ControlOrMeta+z"); await check(editor()).toHaveText("");
  });
  it("keeps text revisions and versions current after formatting, and sends only canonical plain text", async () => {
    await open(); await editor().fill(mainText); await saveProgress();
    const revision = saved.state!.main!.revision;
    await selectDocument(); await format("Bold").click(); await saveProgress();
    expect(saved.state?.main?.revision).toBe(revision);
    await generatePlatforms("LinkedIn");
    expect(generationCalls[0]).toMatchObject({ stage: "platform", content: mainText });
    expect(generationCalls[0]).not.toHaveProperty("formatJson");
    await page.getByRole("button", { name: "Document", exact: true }).click();
    await selectDocument(); await format("Italic").click();
    await page.getByRole("button", { name: "Versions (1)", exact: true }).click();
    await check(page.getByText(/Document updated\. Your earlier text/)).toHaveCount(0);
    await check(card().getByRole("button", { name: "Save draft", exact: true })).toBeEnabled();
    expect(generationCalls).toHaveLength(1);
  });
  it("can continue an interrupted platform batch after formatting-only edits", async () => {
    await open(); await main(); failPlatform = "twitter";
    await generatePlatforms("LinkedIn", "Twitter/X", "Threads");
    await check(card("twitter")).toContainText("Platform generation failed.");
    await page.getByRole("button", { name: "Document", exact: true }).click();
    await selectDocument(); await format("Bold").click();
    await command("versions");
    await page.getByRole("button", { name: "Continue remaining versions", exact: true }).click();
    await check(card("threads")).toContainText(mainText);
    expect(generationCalls.slice(1).map(call => call.selectedPlatforms)).toEqual([["linkedin"], ["twitter"], ["threads"]]);
  });
  it("protects formatting edits made after a proposal and discloses formatting replacement on Apply", async () => {
    await open(); await editor().fill("Preserve this original styled document.");
    await propose(); await selectDocument(); await format("Bold").click();
    await check(page.getByRole("button", { name: "Apply changes", exact: true })).toBeDisabled();
    await check(page.getByRole("alert")).toContainText("You edited the document");
    await page.getByRole("button", { name: "Discard", exact: true }).click();
    await propose();
    await check(page.getByText("Applying replaces the document body and its formatting.", { exact: false })).toBeVisible();
    expect(generationCalls[1]).toMatchObject({ currentDraft: "Preserve this original styled document." });
    await page.getByRole("button", { name: "Apply changes", exact: true }).click();
    await check(editor()).toHaveText(mainText); await check(editor().locator("strong")).toHaveCount(0);
    await saveProgress(); expect(saved.state?.main?.formatJson).toBeUndefined();
  });
  it("accepts 5,000 characters but rejects oversized typing and paste without truncating the document", async () => {
    await open(); await editor().fill("x".repeat(5000)); await saveProgress();
    expect(saved.state?.main?.content.length).toBe(5000);
    await editor().press("End"); await editor().pressSequentially("y");
    await check(page.getByRole("alert")).toContainText("5,000 characters");
    await check(editor()).toHaveText("x".repeat(5000));
    await editor().fill("A short document that should not disappear.");
    await selectDocument();
    await editor().evaluate(element => {
      const data = new DataTransfer(); data.setData("text/plain", "z".repeat(5001));
      element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await check(page.getByRole("alert")).toContainText("5,000 characters");
    await check(editor()).toHaveText("A short document that should not disappear.");
    await saveProgress(); expect(saved.state?.main?.content).toBe("A short document that should not disappear.");
  });
  it("shows a writing skeleton without changing text, respects reduced motion, and removes it on cancellation", async () => {
    await open(); await editor().fill(mainText); deferMain = true;
    await chat().fill("Shorten this document"); await chat().press("Enter");
    await check(page.getByTestId("pundit-writing-preview")).toBeVisible();
    await check(page.getByRole("status", { name: "Pundit writing status" })).toHaveCount(2);
    await check(editor()).toHaveText(mainText);
    await check(page.getByTestId("pundit-writing-preview").locator('span[aria-hidden="true"] > span').first()).toHaveCSS("animation-name", "none");
    await page.getByRole("button", { name: "Cancel generation", exact: true }).click();
    await check(page.getByTestId("pundit-writing-preview")).toHaveCount(0);
    await check(page.getByRole("status", { name: "Pundit writing status" })).toHaveCount(0);
    mainDeferred!(); await check(editor()).toHaveText(mainText);
    await check(page.getByTestId("proposed-draft")).toHaveCount(0);
  });
  it.each(["skip", "complete", "discard"])("reveals a completed suggestion progressively and supports %s", async action => {
    await page.emulateMedia({ reducedMotion: "no-preference" }); await open(); deferMain = true;
    await chat().fill("Draft an argument from the pilot."); await chat().press("Enter");
    await check(page.getByTestId("pundit-writing-preview")).toBeVisible();
    await page.clock.install(); await page.clock.pauseAt(new Date(Date.now() + 1000)); mainDeferred!();
    await check(page.getByRole("button", { name: "Show full suggestion", exact: true })).toBeVisible();
    await check(page.getByRole("button", { name: "Apply changes", exact: true })).toBeDisabled();
    await page.clock.runFor(150);
    const partial = await page.getByTestId("proposed-draft").textContent();
    expect(partial!.length).toBeGreaterThan(0); expect(partial!.length).toBeLessThan(mainText.length);
    expect(mainText.startsWith(partial!)).toBe(true);
    if (action === "discard") {
      await page.getByRole("button", { name: "Discard", exact: true }).click();
      await page.clock.fastForward(3000); await check(page.getByTestId("proposed-draft")).toHaveCount(0);
    } else {
      if (action === "skip") await page.getByRole("button", { name: "Show full suggestion", exact: true }).click();
      else await page.clock.fastForward(3000);
      await check(page.getByTestId("proposed-draft")).toHaveText(mainText);
      await check(page.getByRole("button", { name: "Apply changes", exact: true })).toBeEnabled();
    }
    await page.clock.resume();
  });
  it("opens a writable document with a bottom chat and no dropdowns, steps, or automatic generation", async () => {
    await open();
    await check(page.getByRole("navigation", { name: "Creation steps" })).toHaveCount(0);
    await check(page.getByRole("combobox")).toHaveCount(0);
    await check(page.locator('[data-testid^="social-preview-"]')).toHaveCount(0);
    await editor().fill("My own document, written without an AI call.");
    await saveProgress(); await page.reload();
    await check(editor()).toHaveText("My own document, written without an AI call.");
    expect(generationCalls).toEqual([]);
  });
  it("proposes a draft without replacing the document until Apply", async () => {
    await open(); await editor().fill("My original text and its important caveat.");
    await page.getByRole("textbox", { name: "Document title", exact: true }).fill("Keep my chosen title");
    await propose();
    await check(editor()).toHaveText("My original text and its important caveat.");
    expect(generationCalls[0]).toMatchObject({ stage: "main", selectedPlatforms: [], currentDraft: "My original text and its important caveat." });
    await page.getByRole("button", { name: "Apply changes", exact: true }).click();
    await check(editor()).toHaveText(mainText);
    await check(page.getByRole("textbox", { name: "Document title", exact: true })).toHaveValue("Keep my chosen title");
    expect(writes.some(value => /drafts|publish|schedule/.test(value))).toBe(false);
  });
  it("discards a proposal without changing the original and restores a pending proposal after reload", async () => {
    await open(); await editor().fill("Keep this original document intact.");
    await propose(); await saveProgress(); await page.reload();
    await check(page.getByTestId("proposed-draft")).toHaveText(mainText);
    await page.getByRole("button", { name: "Discard", exact: true }).click();
    await check(editor()).toHaveText("Keep this original document intact.");
    await check(page.getByTestId("proposed-draft")).toHaveCount(0);
    expect(generationCalls).toHaveLength(1);
  });
  it("will not apply an older proposal over newer manual edits", async () => {
    await open(); await propose();
    await editor().fill("I wrote a newer version while reviewing the proposal.");
    await check(page.getByRole("button", { name: "Apply changes", exact: true })).toBeDisabled();
    await check(page.getByRole("alert")).toContainText("You edited the document");
    await check(editor()).toHaveText("I wrote a newer version while reviewing the proposal.");
  });
  it("supports slash keyboard selection and makes option changes without AI calls", async () => {
    await open(); await chat().fill("/tone");
    await check(page.getByRole("listbox", { name: "Slash commands" })).toBeVisible();
    await chat().press("Escape");
    await check(page.getByRole("listbox", { name: "Slash commands" })).toHaveCount(0);
    await chat().fill("/tone"); await chat().press("ArrowDown"); await chat().press("Enter");
    await page.getByRole("button", { name: "Industry Insider", exact: true }).click();
    await check(page.getByRole("button", { name: "Industry Insider", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await command("length"); await page.getByRole("button", { name: "Expanded article", exact: true }).click();
    expect(generationCalls).toEqual([]);
  });
  it("attaches multiple crawled articles and sends them together with the editing instruction", async () => {
    await open(); await command("sources");
    await page.getByRole("checkbox", { name: /Pilot report/ }).check();
    await page.getByRole("checkbox", { name: /Another story/ }).check();
    await page.getByRole("button", { name: "Use selected articles", exact: true }).click();
    await check(page.getByRole("region", { name: "Pundit chat" })).toContainText("Pilot report");
    await check(page.getByRole("region", { name: "Pundit chat" })).toContainText("Another story");
    await chat().fill("Compare these reports"); await chat().press("Enter");
    await check(page.getByTestId("proposed-draft")).toBeVisible();
    expect(generationCalls[0]).toMatchObject({ sourceUrls: ["https://news.test/pilot", "https://news.test/other"], instruction: "Compare these reports", selectedPlatforms: [] });
  });
  it("saves attached references and unsent chat across reloads", async () => {
    await open(); await command("sources"); await page.getByRole("checkbox", { name: /Pilot report/ }).check();
    await page.getByRole("button", { name: "Use selected articles", exact: true }).click();
    await chat().fill("My unsent suggestion"); await saveProgress(); await page.reload();
    await check(chat()).toHaveValue("My unsent suggestion");
    await check(page.getByRole("region", { name: "Pundit chat" })).toContainText("Pilot report");
    expect(generationCalls).toEqual([]);
  });
  it("adapts only the applied and edited document, with explicit platform choice", async () => {
    await open(); await main();
    const edited = "My edited argument and caveat, approved for platform adaptation.";
    await editor().fill(edited);
    await page.getByRole("textbox", { name: "Document title", exact: true }).fill("My title");
    await choose("LinkedIn", "Twitter/X"); await page.getByTestId("button-generate-selected").click();
    await check(card("twitter")).toContainText(edited);
    expect(generationCalls.slice(1)).toMatchObject([
      { stage: "platform", content: edited, title: "My title", selectedPlatforms: ["linkedin"] },
      { stage: "platform", content: edited, selectedPlatforms: ["twitter"] },
    ]);
    await card().getByRole("button", { name: "Save draft", exact: true }).click();
    await check(card().getByRole("link", { name: "Go to Content", exact: true })).toBeVisible();
    expect(writes.filter(value => value.includes("/api/drafts"))).toEqual(["POST /api/drafts"]);
    expect(writes.some(value => /publish|schedule/.test(value))).toBe(false);
  });
  it("preserves platform edits across reload and blocks old versions after a document edit", async () => {
    await open(); await main(); await generatePlatforms("LinkedIn");
    await card().getByRole("button", { name: "Edit", exact: true }).click();
    await card().getByTestId("textarea-post-content-linkedin").fill("My carefully edited platform version.");
    await saveProgress(); await page.reload(); await check(card()).toContainText("My carefully edited platform version.");
    await page.getByRole("button", { name: "Document", exact: true }).click();
    await editor().fill(mainText + " New caveat.");
    await command("versions");
    await check(card()).toContainText("My carefully edited platform version.");
    await check(card().getByRole("button", { name: "Copy", exact: true })).toBeDisabled();
    await check(page.getByText(/Document updated/)).toBeVisible();
  });
  it("keeps edited platform text when regeneration fails after explicit consent", async () => {
    await open(); await main(); await generatePlatforms("LinkedIn");
    await card().getByRole("button", { name: "Edit", exact: true }).click();
    await card().getByTestId("textarea-post-content-linkedin").fill("Retain these platform edits.");
    failPlatform = "linkedin"; page.once("dialog", dialog => dialog.accept());
    await card().getByRole("button", { name: "Regenerate", exact: true }).click();
    await check(card()).toContainText("Platform generation failed.");
    await check(card().getByTestId("textarea-post-content-linkedin")).toHaveValue("Retain these platform edits.");
  });
  it("continues only unattempted platforms after a partial failure", async () => {
    await open(); await main(); failPlatform = "twitter";
    await generatePlatforms("LinkedIn", "Twitter/X", "Threads");
    await check(card("twitter")).toContainText("Platform generation failed.");
    await page.getByRole("button", { name: "Continue remaining versions", exact: true }).click();
    await check(card("threads")).toContainText(mainText);
    expect(generationCalls.slice(1).map(call => call.selectedPlatforms)).toEqual([["linkedin"], ["twitter"], ["threads"]]);
  });
  it("admits one suggestion for duplicate clicks and locks document mutation while generating", async () => {
    await open(); deferMain = true; await chat().fill("Write a proposal about the pilot evidence and its caveats.");
    await page.getByRole("button", { name: "Send suggestion", exact: true }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
    await check.poll(() => generationCalls.length).toBe(1); await check(editor()).toBeDisabled();
    mainDeferred!(); await check(page.getByTestId("proposed-draft")).toBeVisible(); await check(editor()).toHaveText("");
  });
  it("keeps the document on failed suggestions and starts a fresh attempt only on explicit send", async () => {
    await open(); await editor().fill("Keep my original wording despite a failed suggestion."); failMain = true;
    await chat().fill("Shorten this document"); await chat().press("Enter");
    await check(page.getByText("Suggestion could not be completed.", { exact: true })).toBeVisible();
    await check(page.getByRole("status", { name: "Pundit writing status" })).toHaveCount(0);
    await check(page.getByTestId("pundit-writing-preview")).toHaveCount(0);
    await check(editor()).toHaveText("Keep my original wording despite a failed suggestion.");
    await check(page.getByTestId("proposed-draft")).toHaveCount(0);
    expect(generationCalls).toHaveLength(1);
    failMain = false; await propose(); expect(generationCalls).toHaveLength(2);
  });
  it("does not generate for multiline input, composing Enter, or an unknown slash command", async () => {
    await open(); await chat().fill("Please revise this text"); await chat().press("Shift+Enter");
    await check(chat()).toHaveValue("Please revise this text\n");
    await chat().dispatchEvent("keydown", { key: "Enter", isComposing: true });
    await chat().fill("/unknown"); await chat().press("Enter");
    await check(page.getByText(/Unknown command/)).toBeVisible();
    expect(generationCalls).toEqual([]);
  });
  it("reports a saved interrupted suggestion without automatically submitting another request", async () => {
    await open(); await editor().fill("The document before an interrupted request."); await saveProgress();
    saved.state = { ...saved.state!, chat: { input: "", referenceUrls: [], messages: [],
      pending: { id: jobId, title: saved.state!.main!.title, content: saved.state!.main!.content, revision: saved.state!.main!.revision } } };
    await page.reload();
    await check(page.getByText(/A previous suggestion was interrupted/)).toBeVisible();
    await page.getByRole("button", { name: "Dismiss interrupted suggestion", exact: true }).click();
    await check(editor()).toHaveText("The document before an interrupted request.");
    expect(generationCalls).toEqual([]);
  });
  it("retains local text on failed or conflicting saves and offers explicit retry", async () => {
    await open(); await main(); await saveProgress(); failSave = true;
    await editor().fill(mainText + " Unsaved edit."); await page.getByRole("button", { name: "Save progress", exact: true }).click();
    await check(page.getByText(/Fixture save unavailable/)).toBeVisible(); await check(editor()).toHaveText(mainText + " Unsaved edit.");
    failSave = false; await page.getByRole("button", { name: "Retry saving", exact: true }).click();
    await check.poll(() => saved.state?.main?.content).toBe(mainText + " Unsaved edit.");
    saved.revision++; await editor().fill(mainText + " Competing edit."); await page.getByRole("button", { name: "Save progress", exact: true }).click();
    await check(page.getByText(/Creation changed in another tab/)).toBeVisible();
    expect(saved.state?.main?.content).toBe(mainText + " Unsaved edit.");
  });
  it("autosaves newer edits made during a pending save", async () => {
    await open(); await main(); await saveProgress(); deferSave = true;
    await editor().fill(mainText + " First."); await page.getByRole("button", { name: "Save progress", exact: true }).click();
    await check.poll(() => Boolean(saveDeferred)).toBe(true); await editor().fill(mainText + " Newer."); saveDeferred!();
    await check.poll(() => saved.state?.main?.content).toBe(mainText + " Newer.");
    await page.reload(); await check(editor()).toHaveText(mainText + " Newer.");
  });
  it("fails closed on load errors instead of overwriting saved work", async () => {
    failLoad = true; await page.goto("https://creation.test/dashboard/create");
    await check(page.getByText(/Fixture load unavailable/)).toBeVisible(); await check(editor()).toBeDisabled(); expect(writes).toEqual([]);
    failLoad = false; await page.getByRole("button", { name: "Reload saved creation", exact: true }).click(); await check(editor()).toBeEnabled();
  });
  it("recovers a neutral job with GET only and still requires Apply", async () => {
    recoveredMain = true;
    await page.addInitScript(({ key, jobId }) => sessionStorage.setItem(key, JSON.stringify({
      userId: "fixture", tenantId: "tenant-a", jobId, requestIntent: "00000000-0000-4000-8000-000000000012",
    })), { key: EDITORIAL_RECOVERY_KEY, jobId });
    await page.goto("https://creation.test/dashboard/create");
    await check(page.getByTestId("proposed-draft")).toHaveText(mainText); await check(editor()).toHaveText("");
    expect(generationCalls).toEqual([]);
    await page.getByRole("button", { name: "Apply changes", exact: true }).click(); await check(editor()).toHaveText(mainText);
  });
  it("preserves existing work on an automatic article link", async () => {
    await open(); await main(); await saveProgress();
    await page.goto("https://creation.test/dashboard/create?keep=1&article=https%3A%2F%2Fnews.test%2Fother");
    await check(editor()).toHaveText(mainText); expect(new URL(page.url()).search).toBe("?keep=1");
    expect(generationCalls).toHaveLength(1);
  });
  it.each([true, false])("loads progress before confirming explicit Discover replacement (%s)", async accepted => {
    await open(); await main(); await saveProgress(); await page.goto("https://creation.test/dashboard/content");
    page.once("dialog", dialog => accepted ? dialog.accept() : dialog.dismiss());
    await page.getByRole("button", { name: "Use fixture story", exact: true }).click();
    await check(editor()).toHaveText(accepted ? "" : mainText);
    if (accepted) await check(page.getByRole("region", { name: "Pundit chat" })).toContainText("Another story");
    expect(generationCalls).toHaveLength(1);
  });
  it.each([390, 1440])("keeps chat visible while the document scrolls and avoids overflow at %i px", async width => {
    await page.setViewportSize({ width, height: 900 }); await open();
    await editor().fill("A long paragraph about the pilot and its caveats.\n\n".repeat(60));
    const dock = page.getByTestId("sticky-chat"), before = await dock.boundingBox();
    await page.getByTestId("document-scroll-area").evaluate(element => { element.scrollTop = element.scrollHeight; });
    const after = await dock.boundingBox();
    expect(after!.y).toBe(before!.y); expect(after!.y + after!.height).toBeLessThanOrEqual(901);
    const paper = await page.getByRole("article", { name: "Editable document" }).boundingBox();
    if (width === 1440) expect(paper!.width).toBeGreaterThan(1100);
    else {
      const toolbar = await page.getByRole("toolbar", { name: "Document formatting" }).evaluate(element => ({ width: element.clientWidth, content: element.scrollWidth }));
      expect(toolbar.width).toBeLessThan(width); expect(toolbar.content).toBeGreaterThan(toolbar.width);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await command("sources"); await check(page.getByRole("dialog")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
  it("keeps platform selection explicit and capped at four", async () => {
    await open(); await main(); await choose();
    await check(page.getByTestId("button-generate-selected")).toBeDisabled();
    for (const name of ["LinkedIn", "Twitter/X", "Threads", "Substack Notes"]) await page.getByRole("checkbox", { name, exact: true }).check();
    await check(page.getByRole("checkbox", { name: "Medium", exact: true })).toBeDisabled();
    expect(generationCalls).toHaveLength(1);
  });
});
