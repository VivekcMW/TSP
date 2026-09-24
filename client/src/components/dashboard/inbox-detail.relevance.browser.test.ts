import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { chromium, expect as browserExpect, type Browser, type Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
import type { InboxItem } from "@shared/schema";

const root = path.resolve(import.meta.dirname, "../../../..");
const storedReason = 'Matched article text: influencer "Ada Lovelace"; keyword "AI"; company "Meta".';
const sourceReason = "Selected from an active user source; no positive textual interests configured. This is source selection, not a topic match.";
let browser: Browser;
let page: Page;
let bundle: string;

beforeAll(async () => {
  const result = await build({
    absWorkingDir: root,
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { InboxDetail } from "@/components/dashboard/inbox-detail";
      import { Sheet, SheetContent } from "@/components/ui/sheet";
      window.__actions = [];
      const detail = <InboxDetail item={window.__item} inSheet={window.__inSheet}
        onGeneratePost={item => window.__actions.push(["generate", item.id])}
        onSave={item => window.__actions.push(["save", item.id])}
        onDismiss={item => window.__actions.push(["dismiss", item.id])} />;
      createRoot(document.getElementById("root")).render(window.__inSheet
        ? <Sheet open><SheetContent aria-describedby={undefined}>{detail}</SheetContent></Sheet> : detail);
    ` },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"' },
  });
  bundle = result.outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterEach(async () => { await page?.close(); });
afterAll(async () => { await browser?.close(); });

async function mount(overrides: Partial<InboxItem> = {}, inSheet = false) {
  page = await browser.newPage();
  page.setDefaultTimeout(3000);
  await page.route("**/*", route => route.abort());
  await page.setContent('<div id="root"></div>');
  const item: InboxItem = { id: "story", tenantId: "tenant", userId: "reader", headline: "Research news",
    canonicalUrl: "https://news.test/story", version: 0,
    publishedAt: null, discoveredAt: null, rankingScore: null, qualityMetadata: null,
    source: "Fixture publication", articleUrl: "https://news.test/story", summary: "Article summary",
    createdAt: null, relevanceScore: "0.9", relevanceReason: null, matchedKeywords: [], status: "active", ...overrides };
  await page.evaluate(({ item, inSheet }) => Object.assign(window, { __item: item, __inSheet: inSheet }), { item, inSheet });
  await page.addScriptTag({ content: bundle });
  await browserExpect(page.getByTestId("text-headline-story")).toBeVisible();
}

describe("inbox detail relevance explanations", () => {
  it("labels legacy creation as Added and never invents Today", async () => {
    await mount({ createdAt: new Date("2020-01-02T12:00:00Z") });
    await browserExpect(page.getByText(/Added .*Publication date unknown/)).toBeVisible();
    await browserExpect(page.getByText(/Saved excerpt \(legacy provenance unavailable\)/)).toBeVisible();
    expect(await page.locator("body").innerText()).not.toContain("Today");
  });

  it("shows unavailable excerpts and dates honestly", async () => {
    await mount({ summary: null });
    await browserExpect(page.getByText("Publication date unknown", { exact: true })).toBeVisible();
    await browserExpect(page.getByText("Excerpt unavailable. Open the original for context.")).toBeVisible();
  });

  it("shows stored evidence types and exact labels instead of reconstructing the reason from tags", async () => {
    await mount({ relevanceReason: storedReason, matchedKeywords: ["Ada Lovelace", "AI", "Meta"] });
    await browserExpect(page.locator("p").filter({ hasText: "Why this is relevant:" }))
      .toHaveText("Why this is relevant: Matches your topic AI. Mentions Meta, a company you follow. Mentions Ada Lovelace, who you follow.");
    for (const label of ["Ada Lovelace", "AI", "Meta"]) await browserExpect(page.getByText(label, { exact: true })).toBeVisible();
    expect(await page.locator("body").innerText()).not.toMatch(/confidence|%|0\.9/i);
  });

  it.each([false, true])("shows source-only explanations without keyword tags (sheet=%s)", async inSheet => {
    await mount({ relevanceScore: "0.1", relevanceReason: sourceReason, matchedKeywords: [] }, inSheet);
    await browserExpect(page.locator("p").filter({ hasText: "Why this is relevant:" }))
      .toHaveText("Why this is relevant: From one of your saved sources.");
    await browserExpect(page.locator('[class*="border-secondary/40"]')).toHaveCount(0);
    expect(await page.locator("body").innerText()).not.toMatch(/confidence|%|0\.1|matches /i);
    if (inSheet) await browserExpect(page.getByRole("dialog", { name: "Research news" })).toBeVisible();
  });

  it.each([null, undefined])("uses the legacy top-three reason only when absent (%s), preserving all tags", async relevanceReason => {
    await mount({ relevanceReason, relevanceScore: null, matchedKeywords: ["AI", "Cloud", "Meta", "Ada Lovelace"] });
    await browserExpect(page.locator("p").filter({ hasText: "Why this is relevant:" }))
      .toHaveText("Why this is relevant: Matches AI, Cloud, Meta and 1 more.");
    for (const label of ["AI", "Cloud", "Meta", "Ada Lovelace"]) await browserExpect(page.getByText(label, { exact: true })).toBeVisible();
    expect(await page.locator("body").innerText()).not.toMatch(/confidence|%/i);
  });

  it("does not invent an explanation for legacy rows with no reason or keywords", async () => {
    await mount({ relevanceReason: null, matchedKeywords: null, relevanceScore: null });
    await browserExpect(page.getByText("Why this is relevant:")).toHaveCount(0);
    await browserExpect(page.getByText("Article summary", { exact: true })).toBeVisible();
    expect(await page.locator("body").innerText()).not.toMatch(/confidence|%/i);
  });

  it("does not replace a present empty reason with inferred evidence", async () => {
    await mount({ relevanceReason: "", matchedKeywords: ["AI"] });
    await browserExpect(page.getByText("Why this is relevant:")).toHaveCount(0);
    await browserExpect(page.getByText("AI", { exact: true })).toBeVisible();
    expect(await page.locator("body").innerText()).not.toContain("matches AI");
  });

  it("renders stored text safely and preserves action callbacks", async () => {
    const reason = 'Matched article text: keyword "<img src=x onerror=alert(1)>".';
    await mount({ relevanceReason: reason });
    // The stored label is shown as text inside the plain summary, never as markup.
    await browserExpect(page.locator("p").filter({ hasText: "Why this is relevant:" })).toHaveText("Why this is relevant: Matches your topic <img src=x onerror=alert(1)>.");
    await browserExpect(page.locator("img")).toHaveCount(0);
    await page.getByRole("button", { name: "Create draft", exact: true }).click();
    await page.getByRole("button", { name: "Save story", exact: true }).click();
    await page.getByRole("button", { name: "Dismiss", exact: true }).click();
    expect(await page.evaluate(() => (window as any).__actions)).toEqual([["generate", "story"], ["save", "story"], ["dismiss", "story"]]);
  });
});