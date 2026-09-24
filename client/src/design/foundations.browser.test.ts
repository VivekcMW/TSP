import { readFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import { chromium, type Browser, type Page } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import config from "../../../tailwind.config";

// Real primitives, bundled entirely in memory. No application bootstrap, API,
// credentials, environment files, external requests, or persistent fixtures.
const fixture = `
  import React, { useState } from "react";
  import { createRoot } from "react-dom/client";
  import { Inbox } from "lucide-react";
  import { PageHeader, PageBody } from "@/components/dashboard/page-header";
  import { DashboardEmptyState } from "@/components/dashboard/empty-state";
  import { AppFooter } from "@/components/dashboard/app-footer";
  import { InboxDetail } from "@/components/dashboard/inbox-detail";
  import { Sidebar, SidebarProvider, SidebarContent, SidebarGroup, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarTrigger } from "@/components/ui/sidebar";
  import { Sheet, SheetContent } from "@/components/ui/sheet";
  import { Button } from "@/components/ui/button";
  const h = React.createElement;
  function Fixture() {
    const [open, setOpen] = useState(false);
    const [saved, setSaved] = useState(false);
    const item = { id: "article", source: "Example publication", headline: "A real article headline", articleUrl: "https://example.com/article", summary: "Visible article content", matchedKeywords: ["Research"], createdAt: null, status: saved ? "saved" : "active" };
    return h(SidebarProvider, { className: "h-svh min-h-0" },
      h(Sidebar, { collapsible: "icon" },
        h(SidebarContent, null, h(SidebarGroup, null, h(SidebarMenu, null,
          h(SidebarMenuItem, null, h(SidebarMenuButton, { asChild: true, tooltip: "Discover" },
            h("a", { href: "#discover", "aria-label": "Discover", className: "text-secondary" }, h(Inbox), h("span", null, "Discover")))))))),
      h("div", { className: "flex min-w-0 flex-1 flex-col overflow-hidden" },
        h(PageHeader, { title: "Foundation checks", subtitle: "Shared gutters and visible data", contentClassName: "max-w-4xl", stats: 0,
          actions: h(React.Fragment, null, h(SidebarTrigger), h(Button, { onClick: () => setOpen(true) }, "Read article")) }),
        h(PageBody, { contentClassName: "max-w-4xl" }, h(DashboardEmptyState, { icon: Inbox, title: "Nothing to review", description: "This message never waits for scrolling.", action: h(Button, null, "Refresh articles") })),
        h(AppFooter)),
      h(Sheet, { open, onOpenChange: setOpen }, h(SheetContent, { "aria-describedby": undefined, className: "w-full p-0 sm:max-w-lg" },
        h(InboxDetail, { item, inSheet: true, onSave: () => setSaved(true), onGeneratePost: () => {}, onDismiss: () => setOpen(false) }))));
  }
  createRoot(document.getElementById("root")).render(h(Fixture));
`;

let browser: Browser;
let script: string;
let css: string;

beforeAll(async () => {
  const root = path.resolve(import.meta.dirname, "../../..");
  const bundle = await build({
    stdin: { contents: fixture, resolveDir: root, loader: "tsx" },
    absWorkingDir: root,
    alias: { "@": path.join(root, "client/src") },
    bundle: true,
    write: false,
    format: "iife",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"' },
  });
  script = bundle.outputFiles[0].text;
  const source = readFileSync(path.join(root, "client/src/index.css"), "utf8")
    .replace('@import "./design/tokens.generated.css";', readFileSync(path.join(root, "client/src/design/tokens.generated.css"), "utf8"));
  css = (await postcss([tailwindcss({ ...config, content: [...config.content, { raw: fixture }] })])
    .process(source, { from: path.join(root, "client/src/index.css") })).css;
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => { await browser?.close(); });

async function openFixture(width = 1280, reducedMotion: "reduce" | "no-preference" = "reduce") {
  const page = await browser.newPage({ viewport: { width, height: 800 }, reducedMotion });
  page.setDefaultTimeout(5_000);
  await page.route("**/*", (route) => route.abort());
  await page.setContent('<div id="root"></div>');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: script });
  await page.getByRole("heading", { name: "Foundation checks" }).waitFor();
  return page;
}

async function targetSize(page: Page, selector: string) {
  return page.locator(selector).evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { width: box.width, height: box.height };
  });
}

describe("shared visual and accessibility foundations in Chromium", () => {
  it.each([320, 390, 768, 1440])("aligns header/body and avoids horizontal overflow at %spx", async (width) => {
    const page = await openFixture(width);
    try {
      const geometry = await page.evaluate(() => {
        const header = document.querySelector("header .dashboard-container")!.getBoundingClientRect();
        const body = document.querySelector("main .dashboard-container")!.getBoundingClientRect();
        return { headerX: header.x, bodyX: body.x, headerWidth: header.width, bodyWidth: body.width, overflow: document.documentElement.scrollWidth > innerWidth };
      });
      expect(geometry.headerX).toBe(geometry.bodyX);
      expect(geometry.headerWidth).toBe(geometry.bodyWidth);
      expect(geometry.overflow).toBe(false);
      for (const selector of ['[data-sidebar="trigger"]', '[data-testid="button-app-footer-legal"]', '[data-testid="link-app-footer-contact"]']) {
        const size = await targetSize(page, selector);
        expect(size.width).toBeGreaterThanOrEqual(44);
        expect(size.height).toBeGreaterThanOrEqual(44);
      }
    } finally { await page.close(); }
  });

  it("opens legal links by keyboard and restores focus on Escape", async () => {
    const page = await openFixture(390);
    try {
      const trigger = page.getByRole("button", { name: "Legal" });
      await trigger.focus();
      await page.keyboard.press("Enter");
      const menu = page.getByRole("menu", { name: "Legal" });
      await menu.waitFor({ timeout: 5_000 });
      // Radix's opening scale transform briefly shrinks the visual box; measure
      // the settled target rather than sampling an arbitrary animation frame.
      await menu.evaluate(async (element) => {
        await Promise.all(element.getAnimations().map((animation) => animation.finished));
      });
      const links = await menu.getByRole("menuitem").evaluateAll((items) => items.map((item) => ({ href: item.getAttribute("href"), height: item.getBoundingClientRect().height })));
      // The last item reopens the cookie consent banner rather than linking anywhere.
      expect(links.map((link) => link.href)).toEqual(["/privacy", "/terms", "/refund-policy", "/cookies", "/data-retention", "/ai-data-processing", null]);
      for (const link of links) expect(link.height, link.href ?? "legal link").toBeGreaterThanOrEqual(44);
      await page.keyboard.press("ArrowDown");
      expect(await menu.evaluate((element) => element.contains(document.activeElement))).toBe(true);
      await page.keyboard.press("Escape");
      await menu.waitFor({ state: "hidden", timeout: 5_000 });
      expect(await trigger.evaluate((element) => element === document.activeElement)).toBe(true);
    } finally { await page.close(); }
  });

  it("names the inbox sheet with its visible headline and keeps actions working", async () => {
    const page = await openFixture(390);
    const errors: string[] = [];
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    try {
      await page.getByRole("button", { name: "Read article" }).click();
      const dialog = page.getByRole("dialog", { name: "A real article headline" });
      await dialog.waitFor();
      expect(await dialog.getByRole("heading", { name: "A real article headline" }).count()).toBe(1);
      expect(await dialog.getByRole("link", { name: "Open original (opens in a new tab)" }).getAttribute("rel")).toBe("noopener noreferrer");
      for (const selector of ['[data-testid="button-generate-article"]', '[data-testid="button-save-article"]', '[data-testid="button-dismiss-article"]']) {
        expect((await targetSize(page, selector)).height).toBeGreaterThanOrEqual(44);
      }
      const save = dialog.getByTestId("button-save-article");
      await save.click();
      expect(await save.isDisabled()).toBe(true);
      await dialog.getByRole("button", { name: "Dismiss", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      expect(errors.filter((message) => /DialogTitle|accessible name/i.test(message))).toEqual([]);
    } finally { await page.close(); }
  });

  it.each(["reduce", "no-preference"] as const)("renders the empty state immediately with motion=%s", async (motion) => {
    const page = await openFixture(1280, motion);
    try {
      const heading = page.getByRole("heading", { name: "Nothing to review" });
      expect(await heading.isVisible()).toBe(true);
      const styles = await heading.evaluate((element) => {
        const ancestors: string[] = [];
        for (let node: Element | null = element; node; node = node.parentElement) ancestors.push(getComputedStyle(node).opacity);
        return ancestors;
      });
      expect(styles.every((opacity) => opacity === "1")).toBe(true);
      expect(await page.locator("body").evaluate((element) => getComputedStyle(element).fontVariantNumeric)).toBe("tabular-nums");
    } finally { await page.close(); }
  });

  it("preserves bright sidebar gold and 44px targets when collapsed", async () => {
    const page = await openFixture();
    try {
      const link = page.getByRole("link", { name: "Discover", exact: true });
      const before = await link.evaluate((element) => getComputedStyle(element).color);
      await page.getByRole("button", { name: "Toggle Sidebar" }).click();
      await page.locator('[data-slot="sidebar"][data-state="collapsed"]').waitFor();
      const size = await targetSize(page, '[data-sidebar="menu-button"]');
      expect(size.width).toBeGreaterThanOrEqual(44);
      expect(size.height).toBeGreaterThanOrEqual(44);
      expect(await link.evaluate((element) => getComputedStyle(element).color)).toBe(before);
      await page.keyboard.press("Tab");
      await link.focus();
      expect(await link.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe("solid");
      expect(await page.locator('[data-sidebar="content"]').evaluate((element) => getComputedStyle(element).overflowY)).toBe("auto");
    } finally { await page.close(); }
  });
});