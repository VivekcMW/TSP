import { readFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import { chromium, type Browser, type Page } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import config from "../../../../tailwind.config";

let browser: Browser; let script: string; let css: string;
beforeAll(async () => {
  const root = path.resolve(import.meta.dirname, "../../../..");
  const bundle = await build({
    stdin: { contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { QueryClientProvider } from "@tanstack/react-query";
      import { queryClient } from "@/lib/queryClient";
      import Announcements from "@/pages/admin/email-announcements";
      createRoot(document.getElementById("root")).render(<QueryClientProvider client={queryClient}><Announcements /></QueryClientProvider>);
    `, loader: "tsx", resolveDir: root },
    absWorkingDir: root, alias: { "@": path.join(root, "client/src"), "@shared": path.join(root, "shared") },
    bundle: true, write: false, format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"test"' },
    plugins: [{ name: "offline-auth", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/dev-auth$/ }, args => ({ path: args.path, namespace: "stub" }));
      builder.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ loader: "js", contents: "export const useIsSignedIn = () => true; export const devAuthEnabled = false;" }));
    } }],
  });
  script = bundle.outputFiles[0].text;
  const source = readFileSync(path.join(root, "client/src/index.css"), "utf8")
    .replace('@import "./design/tokens.generated.css";', readFileSync(path.join(root, "client/src/design/tokens.generated.css"), "utf8"));
  css = (await postcss([tailwindcss(config)]).process(source, { from: path.join(root, "client/src/index.css") })).css;
  browser = await chromium.launch({ headless: true });
}, 90_000);
afterAll(async () => { await browser?.close(); });
type Call = { path: string; body: Record<string, unknown>; reason: string | undefined };
async function open(options: { enabled?: boolean; testEnabled?: boolean; campaign?: boolean; paused?: boolean; width?: number; confirmationFails?: boolean } = {}) {
  const calls: Call[] = [];
  let paused = options.paused ?? false;
  const page = await browser.newPage({ viewport: { width: options.width ?? 390, height: 844 }, reducedMotion: "reduce" });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.setDefaultTimeout(5000);
  await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: '<div id="root" style="height:100vh"></div>' }));
  await page.route("https://admin.test/api/admin/email-announcements**", route => {
    const url = new URL(route.request().url());
    if (route.request().method() === "GET") return route.fulfill({ json: {
      enabled: options.enabled ?? true, testEnabled: options.testEnabled ?? false,
      campaigns: options.campaign ? [{ id: "saved-campaign", status: paused ? "paused" : "active", content: { type: "product_update", title: "Saved announcement" },
        createdAt: "2026-10-01T00:00:00.000Z", audienceCount: 3, processedCount: 1, sentCount: 1, suppressedCount: 0, unknownCount: 0, failedCount: 0 }] : [],
    } });
    const body = route.request().postDataJSON();
    calls.push({ path: url.pathname, body, reason: route.request().headers()["x-access-reason"] });
    if (url.pathname.endsWith("/pause")) { paused = body.paused; return route.fulfill({ json: { campaign: { status: paused ? "paused" : "active" } } }); }
    if (url.pathname.endsWith("/test")) return route.fulfill({ json: { outcome: "unknown" } });
    if (url.pathname.endsWith("/preview")) return route.fulfill({ status: 201, json: {
      campaign: { id: "campaign-one", content: body, audienceCount: 3 },
      html: "<!doctype html><html><body><h1>Offline preview</h1></body></html>",
    } });
    if (options.confirmationFails && calls.filter(call => call.path.endsWith("/confirm")).length === 1) return route.fulfill({ status: 503, json: { message: "Dispatch temporarily unavailable" } });
    return route.fulfill({ status: 202, json: { accepted: true } });
  });
  await page.goto("https://admin.test/admin/email-announcements");
  await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script });
  await page.getByRole("heading", { name: "Email announcements", exact: true }).waitFor();
  return { page, calls, errors };
}
async function fill(page: Page) {
  await page.getByRole("textbox", { name: "Subject", exact: true }).fill("New planning tools");
  await page.getByRole("textbox", { name: "Message", exact: true }).fill("A useful update is available in your workspace.");
  await page.getByRole("textbox", { name: "Button link", exact: true }).fill("https://example.invalid/update");
  await page.getByRole("textbox", { name: "Reason for this announcement", exact: true }).fill("Announce the planning release");
}
describe("admin email announcement workflow", { timeout: 30_000 }, () => {
  it("requires a preview and explicit confirmation, uses the saved campaign ID, and does not overflow mobile", async () => {
    const { page, calls } = await open();
    try {
      expect(await page.getByRole("button", { name: "Prepare preview and audience" }).isDisabled()).toBe(true);
      await fill(page);
      await page.getByRole("button", { name: "Prepare preview and audience" }).click();
      await page.getByRole("heading", { name: "Review before sending" }).waitFor();
      expect(calls).toHaveLength(1);
      expect(calls[0].reason).toBe("Announce the planning release");
      expect(await page.locator('iframe[title="Announcement email preview"]').getAttribute("sandbox")).toBe("");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.getByRole("button", { name: "Review and confirm send" }).click();
      await page.getByRole("alertdialog").waitFor();
      expect(calls).toHaveLength(1);
      await page.getByRole("button", { name: "Confirm send", exact: true }).click();
      await page.getByRole("button", { name: "Confirmed for delivery" }).waitFor();
      expect(calls[1]).toMatchObject({ path: "/api/admin/email-announcements/campaign-one/confirm", body: { confirm: true } });
      expect(await page.getByRole("button", { name: "Confirmed for delivery" }).isDisabled()).toBe(true);
    } finally { await page.close(); }
  });
  it("invalidates the prepared preview when content changes and blocks disabled broadcasts", async () => {
    const { page, calls } = await open({ enabled: false, width: 1280 });
    try {
      await page.getByText("Announcement dispatch is disabled.", { exact: false }).waitFor();
      await fill(page); await page.getByRole("button", { name: "Prepare preview and audience" }).click();
      await page.getByRole("heading", { name: "Review before sending" }).waitFor();
      expect(await page.getByRole("button", { name: "Review and confirm send" }).isDisabled()).toBe(true);
      await page.getByLabel("Subject", { exact: true }).fill("An edited subject");
      expect(await page.getByRole("heading", { name: "Review before sending" }).count()).toBe(0);
      expect(calls).toHaveLength(1);
    } finally { await page.close(); }
  });
  it("retries confirmation with the same campaign after a server error, never preparing another broadcast", async () => {
    const { page, calls } = await open({ confirmationFails: true });
    try {
      await fill(page); await page.getByRole("button", { name: "Prepare preview and audience" }).click();
      await page.getByRole("button", { name: "Review and confirm send" }).click();
      const failed = page.waitForResponse(response => response.status() === 503);
      await page.getByRole("button", { name: "Confirm send", exact: true }).click();
      await failed;
      await page.getByRole("button", { name: "Confirm send", exact: true }).click();
      await page.getByRole("button", { name: "Confirmed for delivery" }).waitFor();
      expect(calls.filter(call => call.path.endsWith("/preview"))).toHaveLength(1);
      expect(calls.filter(call => call.path.endsWith("/confirm")).map(call => call.path)).toEqual([
        "/api/admin/email-announcements/campaign-one/confirm", "/api/admin/email-announcements/campaign-one/confirm",
      ]);
    } finally { await page.close(); }
  });
  it("self-tests only the saved preview with explicit confirmation, never an arbitrary recipient or audience", async () => {
    const { page, calls } = await open({ testEnabled: true });
    try {
      await fill(page); await page.getByRole("button", { name: "Prepare preview and audience" }).click();
      await page.getByRole("heading", { name: "Review before sending" }).waitFor();
      const response = page.waitForResponse(result => result.url().endsWith("/test"));
      await page.getByRole("button", { name: "Send one test to my account" }).click(); await response;
      expect(calls).toHaveLength(2);
      expect(calls[1]).toEqual({ path: "/api/admin/email-announcements/campaign-one/test", body: { confirm: true }, reason: "Announce the planning release" });
      expect(calls.some(call => call.path.endsWith("/confirm"))).toBe(false);
    } finally { await page.close(); }
  });
  it("keeps self-tests disabled when only broadcast dispatch is enabled", async () => {
    const { page } = await open();
    try {
      await fill(page); await page.getByRole("button", { name: "Prepare preview and audience" }).click();
      await page.getByRole("heading", { name: "Review before sending" }).waitFor();
      expect(await page.getByRole("button", { name: "Send one test to my account" }).isDisabled()).toBe(true);
    } finally { await page.close(); }
  });
  it("pauses and resumes the saved audience without creating or confirming another campaign", async () => {
    const { page, calls, errors } = await open({ campaign: true });
    try {
      expect(await page.getByRole("button", { name: "Pause new sends" }).isDisabled()).toBe(true);
      await page.getByRole("textbox", { name: "Reason for this announcement", exact: true }).fill("Review delivery progress");
      expect(errors).toEqual([]);
      await page.getByRole("button", { name: "Pause new sends" }).click();
      await page.getByRole("button", { name: "Resume saved audience" }).waitFor();
      await page.getByRole("button", { name: "Resume saved audience" }).click();
      await page.getByRole("button", { name: "Pause new sends" }).waitFor();
      expect(calls.map(call => [call.path, call.body])).toEqual([
        ["/api/admin/email-announcements/saved-campaign/pause", { paused: true }],
        ["/api/admin/email-announcements/saved-campaign/pause", { paused: false }],
      ]);
    } finally { await page.close(); }
  });
  it("permits pausing with dispatch disabled but blocks resuming", async () => {
    const { page } = await open({ campaign: true, enabled: false });
    try {
      await page.getByRole("textbox", { name: "Reason for this announcement", exact: true }).fill("Stop future admissions");
      await page.getByRole("button", { name: "Pause new sends" }).click();
      await page.getByRole("button", { name: "Resume saved audience" }).waitFor();
      expect(await page.getByRole("button", { name: "Resume saved audience" }).isDisabled()).toBe(true);
    } finally { await page.close(); }
  });
});
