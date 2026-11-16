import { readFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import { axeViolations } from "../../../../test/axe";
import { chromium, expect as browserExpect, type Browser, type Page } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import config from "../../../../tailwind.config";

// Real admin Industry moments page against an in-memory API; no app server or real requests.
const root = path.resolve(import.meta.dirname, "../../../..");
let browser: Browser; let script: string; let css: string;
beforeAll(async () => {
  const bundle = await build({
    stdin: { contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { QueryClientProvider } from "@tanstack/react-query";
      import { queryClient } from "@/lib/queryClient";
      import Moments from "@/pages/admin/moments";
      createRoot(document.getElementById("root")).render(<QueryClientProvider client={queryClient}><Moments /></QueryClientProvider>);
    `, loader: "tsx", resolveDir: root },
    absWorkingDir: root, alias: { "@": path.join(root, "client/src"), "@shared": path.join(root, "shared") },
    bundle: true, write: false, format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"test"' },
    plugins: [{ name: "offline-auth-and-toasts", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/dev-auth$|^@\/hooks\/use-toast$/ }, args => ({ path: args.path, namespace: "stub" }));
      builder.onLoad({ filter: /.*/, namespace: "stub" }, args => ({ loader: "js", contents: args.path.endsWith("dev-auth")
        ? "export const useIsSignedIn = () => true; export const devAuthEnabled = false;"
        : "export const useToast = () => ({ toast: toast => { (window.__toasts ||= []).push(toast); return { id: '1', dismiss() {}, update() {} }; } });" }));
    } }],
  });
  script = bundle.outputFiles[0].text;
  const source = readFileSync(path.join(root, "client/src/index.css"), "utf8")
    .replace('@import "./design/tokens.generated.css";', readFileSync(path.join(root, "client/src/design/tokens.generated.css"), "utf8"));
  const content = ["client/src/pages/admin/moments.tsx", "client/src/components/ui/*.tsx", "client/src/components/dashboard/page-header.tsx", "client/src/components/admin/*.tsx"]
    .map(file => path.join(root, file));
  css = (await postcss([tailwindcss({ ...config, content })]).process(source, { from: path.join(root, "client/src/index.css") })).css;
  browser = await chromium.launch({ headless: true });
}, 90_000);
afterAll(async () => { await browser?.close(); });

interface Moment { id: string; title: string; startsOn: string; endsOn: string | null; region: string; tags: string[]; leadDays: number;
  url: string | null; description: string | null; archived: boolean; createdAt: string; updatedAt: string }
type Call = { method: string; path: string; body: Record<string, unknown> | null; reason: string | undefined };

async function open(width = 390) {
  const calls: Call[] = [];
  const stamp = "2026-11-16T00:00:00.000Z";
  const moments: Moment[] = [{ id: "11111111-1111-4111-8111-111111111111", title: "Union Budget", startsOn: "2027-02-01", endsOn: null, region: "IN",
    tags: ["finance", "tax"], leadDays: 21, url: "https://example.test/budget", description: "Annual budget speech.", archived: false, createdAt: stamp, updatedAt: stamp }];
  const page = await browser.newPage({ viewport: { width, height: 844 }, reducedMotion: "reduce" });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.setDefaultTimeout(5000);
  await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: '<div id="root" style="height:100vh"></div>' }));
  await page.route("https://admin.test/api/**", route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/admin/moments" && request.method() === "GET") {
      const filter = url.searchParams.get("filter");
      return route.fulfill({ json: moments.filter(row => filter === "archived" ? row.archived : !row.archived && (filter === "past") === (row.startsOn < "2026-11-16")) });
    }
    const body = request.postDataJSON() as Record<string, unknown> | null;
    calls.push({ method: request.method(), path: url.pathname, body, reason: request.headers()["x-access-reason"] });
    if (url.pathname === "/api/admin/moments" && request.method() === "POST") {
      const created = { ...(body as Omit<Moment, "id">), id: "22222222-2222-4222-8222-222222222222", archived: false, createdAt: stamp, updatedAt: stamp };
      moments.push(created);
      return route.fulfill({ status: 201, json: created });
    }
    const match = /^\/api\/admin\/moments\/([^/]+)(\/archive)?$/.exec(url.pathname);
    const row = match && moments.find(item => item.id === match[1]);
    if (row && match[2]) { row.archived = Boolean(body?.archived); return route.fulfill({ json: row }); }
    if (row && request.method() === "PATCH") { Object.assign(row, body); return route.fulfill({ json: row }); }
    return route.fulfill({ status: 500, json: { message: `Unexpected ${request.method()} ${url.pathname}` } });
  });
  await page.goto("https://admin.test/admin/moments");
  await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script });
  await page.getByRole("heading", { name: "Industry moments", exact: true }).waitFor();
  return { page, calls, errors };
}
const rows = (page: Page) => page.locator('[data-testid^="row-moment-"]');
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

describe("admin Industry moments page", { timeout: 30_000 }, () => {
  it("creates a moment with a change reason, validates dates first and fits a 390px screen", async () => {
    const { page, calls, errors } = await open();
    try {
      await browserExpect(rows(page)).toHaveCount(1);
      await browserExpect(rows(page).first()).toContainText("Union Budget");
      await browserExpect(page.getByRole("button", { name: "New moment" })).toBeDisabled();
      await page.getByLabel("Change reason").fill("Add the festive season");
      await page.getByRole("button", { name: "New moment" }).click();
      const dialog = page.getByRole("dialog", { name: "New moment" });
      await dialog.getByLabel("Title").fill("Diwali retail rush");
      await dialog.getByLabel("Starts on").fill("2026-11-01");
      await dialog.getByLabel("Ends on (optional)").fill("2026-10-30");
      await dialog.getByLabel("Region").selectOption("IN");
      await dialog.getByLabel("Tags").fill("Retail, festive, retail");
      await dialog.getByLabel("Lead time (days)").fill("30");
      await dialog.getByRole("button", { name: "Save moment" }).click();
      await browserExpect(dialog.getByRole("alert")).toHaveText("End date: End date must be on or after the start date");
      expect(calls).toEqual([]);
      await dialog.getByLabel("Ends on (optional)").fill("2026-11-05");
      await dialog.getByLabel("Starts on").fill("2026-12-01");
      await dialog.getByLabel("Ends on (optional)").fill("");
      expect(await noHorizontalScroll(page)).toBe(true);
      await dialog.getByRole("button", { name: "Save moment" }).click();
      await browserExpect(dialog).toHaveCount(0);
      expect(calls).toEqual([{ method: "POST", path: "/api/admin/moments", reason: "Add the festive season", body: {
        title: "Diwali retail rush", startsOn: "2026-12-01", endsOn: null, region: "IN", tags: ["retail", "festive"], leadDays: 30, url: null, description: null } }]);
      await browserExpect(rows(page)).toHaveCount(2);
      expect(await noHorizontalScroll(page)).toBe(true);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });

  it("edits, archives and restores with the reason, moving rows between filters", async () => {
    const { page, calls, errors } = await open(1280);
    try {
      await page.getByLabel("Change reason").fill("Correct the budget date");
      await page.getByRole("button", { name: "Edit Union Budget" }).click();
      const dialog = page.getByRole("dialog", { name: "Edit moment" });
      await browserExpect(dialog.getByLabel("Tags")).toHaveValue("finance, tax");
      await dialog.getByLabel("Title").fill("Union Budget 2027");
      await dialog.getByRole("button", { name: "Save moment" }).click();
      await browserExpect(dialog).toHaveCount(0);
      expect(calls[0]).toMatchObject({ method: "PATCH", path: "/api/admin/moments/11111111-1111-4111-8111-111111111111", reason: "Correct the budget date",
        body: { title: "Union Budget 2027", startsOn: "2027-02-01", region: "IN", tags: ["finance", "tax"], leadDays: 21, url: "https://example.test/budget" } });
      await browserExpect(rows(page).first()).toContainText("Union Budget 2027");

      await page.getByRole("button", { name: "Archive Union Budget 2027" }).click();
      await browserExpect(rows(page)).toHaveCount(0);
      await browserExpect(page.getByText("No upcoming moments.")).toBeVisible();
      expect(calls[1]).toEqual({ method: "POST", path: "/api/admin/moments/11111111-1111-4111-8111-111111111111/archive", body: { archived: true }, reason: "Correct the budget date" });
      await page.getByRole("button", { name: "Archived" }).click();
      await browserExpect(page.getByRole("button", { name: "Archived" })).toHaveAttribute("aria-pressed", "true");
      await page.getByRole("button", { name: "Restore Union Budget 2027" }).click();
      await browserExpect(rows(page)).toHaveCount(0);
      expect(calls[2]).toMatchObject({ body: { archived: false } });
      await page.getByRole("button", { name: "Upcoming" }).click();
      await browserExpect(rows(page)).toHaveCount(1);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
});

describe("admin Industry moments accessibility (axe, WCAG 2.1 AA)", { timeout: 30_000 }, () => {
  it("has no violations on the list or the new-moment dialog", async () => {
    const { page } = await open(1280);
    try {
      await browserExpect(rows(page)).toHaveCount(1);
      const found: Record<string, unknown> = {};
      let violations = await axeViolations(page);
      if (violations.length) found.list = violations;
      await page.getByLabel("Change reason").fill("Accessibility check");
      await page.getByRole("button", { name: "New moment" }).click();
      await page.getByRole("dialog", { name: "New moment" }).waitFor();
      violations = await axeViolations(page, '[role="dialog"]');
      if (violations.length) found.dialog = violations;
      expect(found).toEqual({});
    } finally { await page.close(); }
  });
});
