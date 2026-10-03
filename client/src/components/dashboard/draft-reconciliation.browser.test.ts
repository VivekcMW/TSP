import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { chromium, expect as check, type Browser, type Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

// UX09 reproduction: actual persistent provider + Create + Content + transport.
// All HTTP/auth boundaries are in-memory. No app server, env, DB or providers.
let browser: Browser, page: Page, bundle: string;
let browserErrors: string[];
const root = path.resolve(import.meta.dirname, "../../../..");
const original = "A: Generated wording from the source.";
beforeAll(async () => {
  bundle = (await build({ absWorkingDir: root, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"' },
    stdin: { resolveDir: root, sourcefile: "revision-fixture.tsx", loader: "tsx", contents: `
      import React, { useState } from "react";
      import { createRoot } from "react-dom/client";
      import { QueryClientProvider } from "@tanstack/react-query";
      import { queryClient, accountCache } from "@/lib/queryClient";
      import { CreatePostProvider, useCreatePost } from "@/components/dashboard/create-post-provider";
      import Create from "@/pages/create-post";
      import Content from "@/pages/drafts";
      import { Link, Route } from "wouter";
      const w = window;
      w.calls = []; w.pending = {}; w.unexpected = []; w.failSnapshot = false; w.snapshotBody = undefined; w.defer = null;
      w.profile = { tenantId: "tenant-a", enabledPlatforms: ["linkedin"], defaultPlatform: "linkedin", defaultTone: "professional", requirePublishReview: false };
      w.row = null; w.revision = 0; w.queryClient = queryClient; w.accountCache = accountCache;
      w.advance = content => w.row = { ...w.row, content, updatedAt: new Date(Date.UTC(2030, 0, 1, 0, 0, ++w.revision)).toISOString() };
      window.fetch = async (input, options = {}) => {
        const url = String(input), method = options.method || "GET", body = options.body ? JSON.parse(options.body) : null;
        w.calls.push({ url, method, body, cache: options.cache });
        let result, status = 200;
        if (url.includes("instant-review")) result = { article: { title: "Source", content: "Source evidence never changes.", source: "Desk", url: "https://news.test/a", domain: "news.test" }, posts: { linkedin: { thoughtLeader: ${JSON.stringify(original)} } }, details: {}, format: "short-post" };
        else if (method === "GET" && url.endsWith("/editing-snapshot")) {
          status = w.failSnapshot || (w.row ? 200 : 404);
          result = w.snapshotBody === undefined ? w.row : w.snapshotBody;
        } else if (method === "GET" && url.startsWith("/api/drafts/scheduled")) result = { items: [], total: 0 };
        else if (method === "GET" && url === "/api/drafts") result = w.hideList ? [] : w.row ? [w.row] : [];
        else if (method === "POST" && url === "/api/drafts") {
          w.row = { id: "saved-a", ...body, tenantId: "tenant-a", userId: "user-a", status: "draft", publishStatus: "draft", publishedAt: null, publishApprovedAt: null, createdAt: "2030-01-01T00:00:00.000Z" };
          w.advance(body.content.trim()); result = w.row;
        } else if (method === "PATCH" && url === "/api/drafts/saved-a") {
          if (w.race) { w.advance(w.race); w.race = null; }
          if (body.expectedContent !== w.row.content || body.expectedUpdatedAt !== w.row.updatedAt) { status = 409; result = { code: "draft_conflict", message: "Draft changed. Review latest." }; }
          else { w.advance(body.content.trim()); result = w.row; }
        } else if (url === "/api/social-accounts" || url === "/api/publishing-rules" || url === "/api/integrations" || url === "/api/inbox") result = [];
        else if (url === "/api/profile") result = w.profile;
        else if (url === "/api/me") result = { id: "user-a", name: "Fixture" };
        else { w.unexpected.push(method + " " + url); throw new Error("Unmocked request " + method + " " + url); }
        if (w.saveBody !== undefined && method === "PATCH") result = w.saveBody;
        // Capture result BEFORE deferral; deliberately ignore abort until the
        // real transport checks it, exercising stale network/body completions.
        const responseBody = JSON.stringify(result);
        if (w.defer === method + " " + url) {
          w.defer = null;
          await new Promise(resolve => w.pending.network = resolve);
          delete w.pending.network;
        }
        const response = new Response(responseBody, { status, headers: { "Content-Type": "application/json" } });
        if (w.deferJson && method !== "GET") {
          w.deferJson = false;
          response.json = async () => { await new Promise(resolve => w.pending.json = resolve); delete w.pending.json; return JSON.parse(responseBody); };
        }
        return response;
      };
      queryClient.setQueryData(["/api/me"], { id: "user-a", name: "Fixture" });
      queryClient.setQueryData(["/api/profile"], w.profile);
      queryClient.setQueryData(["/api/inbox"], []);
      queryClient.setQueryData(["/api/integrations"], []);
      function Routes() {
        const { composer } = useCreatePost(); w.composer = composer;
        return <><nav><Link id="create" href="/dashboard/create">Create route</Link><Link id="content" href="/dashboard/content">Content route</Link></nav><Route path="/dashboard/create" component={Create}/><Route path="/dashboard/content" component={Content}/></>;
      }
      function App() {
        const [scope, setScope] = useState("a"); w.setScope = setScope;
        return <QueryClientProvider client={queryClient}><CreatePostProvider key={scope}><Routes/></CreatePostProvider></QueryClientProvider>;
      }
      createRoot(document.getElementById("root")).render(<App/>);
    ` }, plugins: [{ name: "mock-auth", setup(b) {
      b.onResolve({ filter: /^@\/lib\/(auth|dev-auth)$|^@\/hooks\/use-toast$/ }, a => ({ path: a.path, namespace: "fixture" }));
      b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ loader: "js", contents: a.path.includes("auth")
        ? "export const useAuth = () => ({user:{id:'user-a'}}); export const useIsSignedIn = () => true;"
        : "export const useToast = () => ({toast: () => {}});" }));
    } }] })).outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
}, 60_000);
afterAll(async () => { await browser?.close(); });
afterEach(async () => {
  try {
    if (page && !page.isClosed()) expect(await page.evaluate(() => (window as any).unexpected)).toEqual([]);
    expect(browserErrors).toEqual([]);
  } finally { await page?.close(); }
});
async function mount() {
  browserErrors = [];
  page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, serviceWorkers: "block" });
  page.on("pageerror", error => browserErrors.push(error.message));
  await page.context().route("**/*", route => route.abort());
  await page.route("https://revision.test/", route => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
  await page.goto("https://revision.test/");
  await page.evaluate(() => history.replaceState(null, "", "/dashboard/create"));
  await page.addScriptTag({ content: bundle });
  await page.getByTestId("input-instant-review-url").fill("https://news.test/a");
  await card().getByRole("button", { name: "Generate LinkedIn", exact: true }).click();
  await check(card().getByTestId("text-post-content-linkedin")).toHaveText(original);
  await card().getByRole("button", { name: "Save draft", exact: true }).click();
  await check(card().getByRole("button", { name: "Saved", exact: true })).toBeDisabled();
}
const card = () => page.getByTestId("social-preview-linkedin");
const writes = () => page.evaluate(() => (window as any).calls.filter((c: any) => c.url.startsWith("/api/drafts") && c.method !== "GET"));
const version = () => page.evaluate(() => (window as any).composer.versions["linkedin:thoughtLeader"]);
async function editLocal(text: string) {
  const editor = card().getByTestId("textarea-post-content-linkedin");
  if (!await editor.count()) await card().getByRole("button", { name: "Edit", exact: true }).click();
  await editor.fill(text);
}
async function editInContent(text: string) {
  await page.locator("#content").click();
  await page.getByTestId("button-menu-saved-a").click();
  await page.getByTestId("button-edit-saved-a").click();
  await page.getByLabel("Draft content").fill(text);
  await page.getByTestId("button-save-edit").click();
  await check(page.getByRole("dialog")).toHaveCount(0);
}
async function release(key = "network") {
  await check.poll(() => page.evaluate(key => Boolean((window as any).pending[key]), key)).toBe(true);
  await page.evaluate(key => (window as any).pending[key](), key);
}

describe("UX09 actual Create / Content reconciliation", () => {
  it("reproduces Save A → Content B → Create C without stale Saved or unconditional overwrite", async () => {
    await mount(); await editInContent("B: Content editor revision"); await page.locator("#create").click();
    await check(card()).toContainText("Draft changed elsewhere");
    expect((await version()).content).toBe(original);
    await editLocal("C: local working text");
    await card().getByRole("button", { name: "Keep local text", exact: true }).click();
    expect(await writes()).toHaveLength(2);
    await check(card().getByRole("button", { name: "Saved", exact: true })).toHaveCount(0);
    await card().getByRole("button", { name: "Use reviewed latest as baseline", exact: true }).click();
    expect(await writes()).toHaveLength(2); // adopting never writes
    await card().getByRole("button", { name: "Save changes", exact: true }).click();
    await check(card().getByRole("button", { name: "Saved", exact: true })).toBeDisabled();
    expect((await writes()).at(-1).body).toMatchObject({ content: "C: local working text", expectedContent: "B: Content editor revision", expectedUpdatedAt: "2030-01-01T00:00:02.000Z" });
    expect(await page.evaluate(() => [Object.keys(localStorage), Object.keys(sessionStorage)])).toEqual([[], []]);
  });

  it("Load latest confirms local loss and never changes generated original/evidence", async () => {
    await mount(); const before = await version(); await editLocal("Unsaved local work");
    await editInContent("B: latest"); await page.locator("#create").click();
    await check(card()).toContainText("Draft changed elsewhere");
    page.once("dialog", d => d.dismiss());
    await card().getByRole("button", { name: "Load latest", exact: true }).click();
    expect((await version()).content).toBe("Unsaved local work");
    page.once("dialog", d => d.accept());
    await card().getByRole("button", { name: "Load latest", exact: true }).click();
    expect(await version()).toMatchObject({ content: "B: latest", original: before.original, review: before.review, status: "saved" });
    expect(await writes()).toHaveLength(2);
  });

  it.each([503, 404, "malformed"])("keeps local text and blocks stale Saved after %s snapshot failure, then retries GET only", async failure => {
    await mount(); await page.locator("#content").click();
    await page.evaluate(failure => {
      (window as any).queryClient.setQueryData(["/api/drafts/saved-a/editing-snapshot"], (window as any).row);
      if (typeof failure === "number") (window as any).failSnapshot = failure; else (window as any).snapshotBody = { id: "saved-a" };
    }, failure);
    await page.locator("#create").click();
    await check(card()).toContainText("Could not check latest draft");
    expect((await version()).content).toBe(original);
    await check(card().getByRole("button", { name: "Saved", exact: true })).toHaveCount(0);
    await check(card().getByRole("link", { name: "Go to Content" })).toHaveCount(0);
    await check(page.getByText(/0 saved · 1 unsaved or unconfirmed/)).toBeVisible();
    await page.evaluate(() => { (window as any).failSnapshot = false; (window as any).snapshotBody = undefined; (window as any).hideList = true; });
    await card().getByRole("button", { name: "Check latest draft", exact: true }).click();
    await check(card().getByRole("button", { name: "Saved", exact: true })).toBeDisabled();
    await check(card().getByRole("link", { name: "Go to Content" })).toHaveAttribute("href", "/dashboard/content?draft=saved-a");
    await check(card().getByRole("link", { name: "Go to Calendar" })).toHaveAttribute("href", "/dashboard/calendar?draft=saved-a");
    expect(await writes()).toHaveLength(1);
    expect(await page.evaluate(() => (window as any).calls.filter((c: any) => c.url.endsWith("/editing-snapshot")).every((c: any) => c.method === "GET" && c.cache === "no-store"))).toBe(true);
  });

  it("CAS conflict does not retry writes, including another writer after explicit baseline adoption", async () => {
    await mount(); await editLocal("C");
    await page.evaluate(() => { (window as any).race = "B"; });
    await card().getByRole("button", { name: "Save changes", exact: true }).click();
    await check(card()).toContainText("Draft changed elsewhere");
    await card().getByRole("button", { name: "Check latest draft", exact: true }).click();
    await card().getByRole("button", { name: "Use reviewed latest as baseline", exact: true }).click();
    await page.evaluate(() => { (window as any).race = "D"; });
    await card().getByRole("button", { name: "Save changes", exact: true }).click();
    await check(card()).toContainText("Draft changed elsewhere");
    expect((await version()).content).toBe("C"); expect(await writes()).toHaveLength(3);
    expect(await page.evaluate(() => (window as any).row.content)).toBe("D");
  });

  it("accepts canonical trimming and locks same-turn edit/save and double save", async () => {
    await mount();
    await page.evaluate(() => {
      const c = (window as any).composer;
      c.editVersion("linkedin", "thoughtLeader", "  C trimmed  ");
      (window as any).defer = "PATCH /api/drafts/saved-a";
      void c.saveVersion("linkedin", "thoughtLeader");
      c.editVersion("linkedin", "thoughtLeader", "Must not sneak past the lock");
      void c.saveVersion("linkedin", "thoughtLeader");
    });
    await release();
    await check(card().getByRole("button", { name: "Saved", exact: true })).toBeDisabled();
    expect(await version()).toMatchObject({ content: "C trimmed", savedContent: "C trimmed", original });
    expect(await writes()).toHaveLength(2);
  });

  it("Content retains its local text on a competing writer and requires reviewed CAS resolution", async () => {
    await mount(); await page.locator("#content").click();
    await page.getByTestId("button-menu-saved-a").click();
    await page.getByTestId("button-edit-saved-a").click(); await page.getByLabel("Draft content").fill("Content local");
    await page.evaluate(() => { (window as any).race = "Other writer"; });
    await page.getByTestId("button-save-edit").evaluate(b => { (b as HTMLButtonElement).click(); (b as HTMLButtonElement).click(); });
    await check(page.getByRole("dialog")).toContainText("Draft changed elsewhere");
    await check(page.getByLabel("Draft content")).toHaveValue("Content local");
    await page.getByRole("button", { name: "Check latest draft", exact: true }).click();
    await page.getByRole("button", { name: "Use reviewed latest as baseline", exact: true }).click();
    await page.getByTestId("button-save-edit").click(); await check(page.getByRole("dialog")).toHaveCount(0);
    expect((await writes()).at(-1).body.expectedContent).toBe("Other writer");
    expect(await writes()).toHaveLength(3);
  });

  it("ignores superseded reads and late parsed save bodies after provider replacement", async () => {
    await mount(); await page.locator("#content").click();
    await page.evaluate(() => { (window as any).defer = "GET /api/drafts/saved-a/editing-snapshot"; });
    await page.locator("#create").click();
    await check.poll(() => page.evaluate(() => Boolean((window as any).pending.network))).toBe(true);
    await page.evaluate(() => { (window as any).advance("B"); void (window as any).composer.refreshVersion("linkedin", "thoughtLeader"); });
    await check(card()).toContainText("Draft changed elsewhere"); await release();
    expect((await version()).latestRevision.content).toBe("B");
    await card().getByRole("button", { name: "Use reviewed latest as baseline", exact: true }).click();
    await editLocal("C"); await page.evaluate(() => { (window as any).deferJson = true; });
    await card().getByRole("button", { name: "Save changes", exact: true }).click();
    await check.poll(() => page.evaluate(() => Boolean((window as any).pending.json))).toBe(true);
    await page.evaluate(() => (window as any).setScope("b"));
    await check(card()).toContainText("Ready to generate");
    await release("json");
    expect(await page.evaluate(() => (window as any).composer.versions)).toEqual({});
  });

  it("an edit made during a refresh survives, and a replaced source rejects the late response", async () => {
    await mount(); await page.locator("#content").click();
    await page.evaluate(() => { (window as any).advance("B"); (window as any).defer = "GET /api/drafts/saved-a/editing-snapshot"; });
    await page.locator("#create").click(); await check(card()).toContainText("Checking latest draft");
    await editLocal("C typed during refresh"); await release();
    await check(card()).toContainText("Draft changed elsewhere");
    expect((await version()).content).toBe("C typed during refresh");
    await page.evaluate(() => { (window as any).defer = "GET /api/drafts/saved-a/editing-snapshot"; void (window as any).composer.refreshVersion("linkedin", "thoughtLeader"); });
    await check(card()).toContainText("Checking latest draft");
    page.once("dialog", dialog => dialog.accept());
    await page.getByTestId("input-instant-review-url").fill("https://news.test/replacement");
    await check(card()).toContainText("Ready to generate"); await release();
    expect(await page.evaluate(() => (window as any).composer.versions)).toEqual({});
    expect(await writes()).toHaveLength(1);
  });

  it.each(["missing revision", "wrong id", "wrong platform", "wrong tone"])("retains local text and refuses Saved for a %s save acknowledgement", async kind => {
    await mount(); await editLocal("C");
    await page.evaluate(kind => {
      const w = window as any;
      w.saveBody = { ...w.row, content: "C" };
      if (kind === "missing revision") delete w.saveBody.updatedAt;
      if (kind === "wrong id") w.saveBody.id = "another-draft";
      if (kind === "wrong platform") w.saveBody.platform = "twitter";
      if (kind === "wrong tone") w.saveBody.tone = "contrarian";
    }, kind);
    await card().getByRole("button", { name: "Save changes", exact: true }).click();
    await check(card()).toContainText("Could not save draft");
    expect(await version()).toMatchObject({ content: "C", savedId: "saved-a", savedContent: original, status: "failed" });
    expect(await writes()).toHaveLength(2);
  });

  it("account-cache invalidation also fences a late parsed acknowledgement before provider remount", async () => {
    await mount(); await editLocal("C");
    await page.evaluate(() => { (window as any).deferJson = true; });
    await card().getByRole("button", { name: "Save changes", exact: true }).click();
    await check.poll(() => page.evaluate(() => Boolean((window as any).pending.json))).toBe(true);
    await page.evaluate(() => (window as any).accountCache.beginSignOut());
    await release("json");
    // The real authenticated shell remounts next; the old owner must not report
    // success or populate the next account's cache while that transition occurs.
    await check.poll(async () => (await version()).savedContent).toBe(original);
    expect((await version()).status).not.toBe("saved");
    expect(await page.evaluate(() => (window as any).queryClient.getQueryData(["/api/drafts"]))).toBeUndefined();
  });
});