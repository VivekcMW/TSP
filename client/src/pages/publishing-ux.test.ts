import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { chromium, expect as browserExpect, type Browser, type Page } from "@playwright/test";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import path from "node:path";

// Real React/Radix/Query and actual Tailwind layout. Every fetch, clipboard write
// and window.open is mocked; Chromium cannot reach any server or provider.
let browser: Browser;
let page: Page;
let bundle: string;
let css: string;
const root = path.resolve(import.meta.dirname, "../../..");
const draft = (id = "d", publishStatus = "draft", platform = "linkedin") => ({ id, publishStatus, platform, content: `Review this ${id} post before publishing.`, tone: "professional", media: [], platformPublishRules: {} });
const schedule = (states: string[], status = "scheduled", draftId = "d") => ({
  id: `s-${draftId}`, draftId, status, scheduledPublishAt: "2026-09-20T09:00:00Z", draft: draft(draftId),
  targets: states.map((state, index) => ({ id: `t${index}`, platform: ["linkedin", "twitter"][index], status: state, lastError: state === "failed" ? "Reconnect the account" : null })),
});
const fixture = () => ({
  drafts: [draft()], schedules: [],
  profile: { timezone: "Asia/Kolkata", preferredPublishTime: "18:45", defaultPlatform: "twitter", enabledPlatforms: ["linkedin", "twitter", "bluesky", "mastodon", "devto", "telegram", "medium"] },
  integrations: ["linkedin", "twitter", "bluesky", "mastodon", "devto", "telegram", "medium"].map((key) => ({ key, enabled: true })),
  rules: [], postSchedules: [schedule(["published", "queued"])], scheduleError: false, clipboardError: false, publishError: false,
});

beforeAll(async () => {
  const result = await build({
    absWorkingDir: root,
    stdin: { resolveDir: root, sourcefile: "publishing-test-harness.tsx", loader: "tsx", contents: `
      import React, { useState } from "react";
      import { createRoot } from "react-dom/client";
      import { QueryClientProvider } from "@tanstack/react-query";
      import { queryClient } from "@/lib/queryClient";
      import Drafts from "@/pages/drafts";
      import Calendar from "@/pages/calendar";
      import { ScheduleArticleModal } from "@/components/schedule-article-modal";
      import { usePublishStatus, useDraftPublishStatus } from "@/hooks/use-publish-status";
      import { recheckPublishingRecovery } from "@/lib/publishing";
      import { Link, useLocation } from "wouter";
      window.__calls = []; window.__toasts = []; window.__copies = []; window.__opens = []; window.__pending = [];
      window.__refresh = () => queryClient.invalidateQueries();
      window.open = (...args) => { window.__opens.push(args); return null; };
      Object.defineProperty(navigator, "clipboard", { value: { writeText: async text => {
        if (window.__state.clipboardError) throw new Error("Clipboard denied"); window.__copies.push(text);
      } } });
      window.fetch = async (url, options = {}) => {
        window.__calls.push({ url, method: options.method || "GET", body: options.body ? JSON.parse(options.body) : null, signal: options.signal });
        const s = window.__state;
        if (String(url).endsWith("/publish-status")) {
          const draftId = decodeURIComponent(String(url).split("/")[3]);
          const snapshot = JSON.stringify({ schedule: s.schedules.find(item => item.draftId === draftId) || null });
          if (s.deferStatus) await new Promise(resolve => window.__pending.push(resolve));
          return new Response(s.scheduleError ? JSON.stringify({ message: "Temporarily unavailable" }) : snapshot, { status: s.scheduleError ? 503 : 200 });
        }
        if (String(url).includes("/publish-logs")) {
          if (s.deferLogs) await new Promise(resolve => window.__pending.push(resolve));
          return new Response(JSON.stringify(s.logs || []), { status: s.logError ? 503 : 200 });
        }
        if (url === "/api/drafts" && options.method === "POST") {
          const copy = { ...JSON.parse(options.body), id: "copy", status: "draft", publishStatus: "draft", publishedAt: null, scheduledAt: null };
          s.drafts.push(copy); return new Response(JSON.stringify(copy));
        }
        if (options.method === "PATCH") {
          if (s.patchError) return new Response(JSON.stringify({ message: "Published draft is immutable" }), { status: 409 });
          return new Response(JSON.stringify({ id: "d", ...JSON.parse(options.body) }));
        }
        if (String(url).includes("/api/jobs/")) {
          if (s.deferJob && String(url).includes("old")) await new Promise(resolve => window.__pending.push(resolve));
          return new Response(JSON.stringify({ id: String(url).includes("old") ? "old" : "new", state: "completed", progress: { platform: "linkedin", status: "skipped" } }));
        }
        if (String(url).includes("publish-now")) {
          s.schedules = s.postSchedules;
          if (s.publishError) throw new TypeError("Failed to fetch");
          return new Response(JSON.stringify({ jobId: "first", jobIds: ["first", "second"], status: "queued" }));
        }
        if (String(url).endsWith("/approve-publishing")) {
          s.drafts[0].publishApprovedAt = new Date().toISOString();
          return new Response(JSON.stringify(s.drafts[0]));
        }
        if (String(url).includes("/targets/")) {
          if (s.recoverySchedules) s.schedules = s.recoverySchedules;
          if (s.recoveryError === "network") throw new TypeError("Failed to fetch");
          return new Response(JSON.stringify({ message: "Request processed" }), { status: s.recoveryError ? 503 : 200 });
        }
        if ((options.method || "GET") !== "GET") return new Response(JSON.stringify({ id: "saved", scheduled: ["d"], failed: [], message: "Saved" }));
        if (String(url).startsWith("/api/drafts/scheduled")) {
          if (s.scheduleError) return new Response(JSON.stringify({ message: "Temporarily unavailable" }), { status: 503 });
          return new Response(JSON.stringify({ items: s.schedules, total: s.schedules.length }));
        }
        if (url === "/api/drafts") return new Response(JSON.stringify(s.draftsError ? { message: "Unavailable" } : s.drafts), { status: s.draftsError ? 503 : 200 });
        if (url === "/api/profile") return new Response(JSON.stringify(s.profile));
        if (url === "/api/integrations") return new Response(JSON.stringify(s.integrations));
        if (url === "/api/publishing-rules") return new Response(JSON.stringify(s.rules));
        if (String(url).includes("/status")) return new Response(JSON.stringify({ connected: true, assessment: { canPublish: true, status: "connected" } }));
        throw new Error("Unmocked URL: " + url);
      };
      function JobHarness() {
        const [id, setId] = useState("old"); const result = usePublishStatus(id, 100);
        return <><button onClick={() => setId("new")}>Switch job</button><output>{JSON.stringify(result.status)}</output></>;
      }
      function MonitorHarness() {
        const [id, setId] = useState("d"); const result = useDraftPublishStatus(id, 100);
        return <><button onClick={() => setId("other")}>Switch draft</button><button onClick={() => recheckPublishingRecovery("d")}>Recover draft</button><button onClick={() => recheckPublishingRecovery("unrelated")}>Recover unrelated</button><output>{JSON.stringify({ schedule: result.schedule, outcome: result.outcome, error: result.error })}</output></>;
      }
      function App() {
        const [open, setOpen] = useState(true);
        const [location, navigate] = useLocation();
        window.__navigate = navigate;
        return <QueryClientProvider client={queryClient}><Link id="leave-content" href="/elsewhere">Leave Content</Link>{location === "/elsewhere" ? <Link href="/">Return to Content</Link> : window.__surface === "calendar" ? <Calendar /> : window.__surface === "modal" ? <><button onClick={() => setOpen(true)}>Reopen modal</button><ScheduleArticleModal draftId="d" open={open} onOpenChange={setOpen} /></> : window.__surface === "jobs" ? <JobHarness /> : window.__surface === "monitor" ? <MonitorHarness /> : <Drafts />}</QueryClientProvider>;
      }
      createRoot(document.getElementById("root")).render(<App />);
    ` },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"' },
    plugins: [{ name: "mock-user-boundaries", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/dev-auth$|^@\/hooks\/use-toast$/ }, args => ({ path: args.path, namespace: "mock" }));
      builder.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents: args.path.includes("dev-auth") ? "export const useIsSignedIn = () => true;" : "export const useToast = () => ({ toast: value => window.__toasts.push(value) });", loader: "js" }));
    } }],
  });
  bundle = result.outputFiles[0].text;
  css = (await postcss([tailwindcss(path.join(root, "tailwind.config.ts"))]).process("@tailwind base; @tailwind components; @tailwind utilities;", { from: undefined })).css;
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterEach(async () => { await page?.close(); });
afterAll(async () => { await browser?.close(); });

async function mount(surface = "drafts", overrides: Record<string, unknown> = {}, width = 1280) {
  page = await browser.newPage({ viewport: { width, height: 850 }, timezoneId: "America/Los_Angeles" });
  await page.route("**/*", route => route.abort());
  await page.route("https://publishing.test/", route => route.fulfill({ contentType: "text/html", body: '<div id="root" style="height:100dvh"></div>' }));
  await page.goto("https://publishing.test/");
  await page.clock.install({ time: new Date("2026-09-17T10:00:00Z") });
  await page.evaluate(({ surface, state }) => Object.assign(window, { __surface: surface, __state: state }), { surface, state: { ...fixture(), ...overrides } });
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: bundle });
}
async function calls() {
  return page.evaluate(() => (window as any).__calls.map((call: any) => ({ url: call.url, method: call.method, body: call.body, aborted: call.signal?.aborted })));
}
async function change(overrides: Record<string, unknown>, refresh = false) {
  await page.evaluate(async ({ overrides, refresh }) => { Object.assign((window as any).__state, overrides); if (refresh) await (window as any).__refresh(); }, { overrides, refresh });
}
async function openPublish(scheduled = false) {
  if (scheduled) await page.getByTestId("tab-scheduled").click();
  await page.getByTestId("button-post-d").click();
  await browserExpect(page.getByTestId("button-publish-now")).toBeEnabled();
}

describe("audited publishing UX (isolated browser)", () => {
  it("shows simulation without a live success message or receipt", async () => {
    await mount("drafts", { postSchedules: [schedule(["simulated"], "simulated")] });
    await openPublish(); await page.getByTestId("button-publish-now").click();
    await browserExpect(page.getByRole("dialog")).toContainText("Simulation completed. Nothing was posted externally");
    expect(await page.getByText(/All targets are recorded as published/).count()).toBe(0);
    expect((await calls()).filter((call: any) => call.method === "POST")).toHaveLength(1);
  });
  it("requires explicit review before publishing and sends the exact revision", async () => {
    const reviewed = { ...draft(), updatedAt: "2026-09-17T09:00:00.000Z" };
    await mount("drafts", { drafts: [reviewed], profile: { ...fixture().profile, requirePublishReview: true } });
    await page.getByTestId("button-post-d").click();
    await browserExpect(page.getByTestId("button-publish-now")).toBeDisabled();
    await page.getByRole("button", { name: "I reviewed this exact draft — approve publishing" }).click();
    await browserExpect(page.getByTestId("button-publish-now")).toBeEnabled();
    const writes = (await calls()).filter((call: any) => call.method === "POST");
    expect(writes).toHaveLength(1); expect(writes[0]).toMatchObject({ url: "/api/drafts/d/approve-publishing", body: { content: reviewed.content, updatedAt: reviewed.updatedAt } });
  });
  it("records a manual reconciliation without dispatching a retry", async () => {
    const pending = schedule(["unknown"], "unknown");
    Object.assign(pending.targets[0], { revision: 3, executionMode: "live" });
    await mount("drafts", { drafts: [draft("d", "unknown")], schedules: [pending] });
    await page.getByTestId("tab-attention").click();
    await page.getByRole("button", { name: "Record manual reconciliation" }).click();
    await page.getByRole("combobox", { name: /^Decision/ }).selectOption("delivered", { timeout: 1500 });
    await page.getByLabel("Evidence note (no credentials)").fill("Inspected the matching provider post manually");
    await browserExpect(page.getByRole("button", { name: "Save manual decision — do not publish" })).toBeDisabled();
    await page.getByLabel("Provider post ID or receipt reference").fill("provider-post-123");
    await page.getByRole("button", { name: "Save manual decision — do not publish" }).click();
    const writes = (await calls()).filter((call: any) => call.method === "POST");
    expect(writes).toHaveLength(1); expect(writes[0]).toMatchObject({ url: "/api/drafts/d/schedule/targets/t0/reconcile", body: { expectedRevision: 3, decision: "delivered", receipt: "provider-post-123" } });
  });
  it("renders draft query failures with retry, not an empty list", async () => {
    await mount("drafts", { draftsError: true });
    await browserExpect(page.getByRole("alert")).toContainText("Content could not be loaded");
    expect(await page.getByText("No drafts yet").count()).toBe(0);
    await change({ draftsError: false });
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await browserExpect(page.getByTestId("card-draft-d")).toBeVisible();
  });
  it("preserves Content query-string navigation, published media/time and lazy honest receipts", async () => {
    await mount("drafts", { drafts: [{ ...draft("d", "published"), publishedAt: "2026-09-17T10:00:00Z", media: [{ id: "image", type: "image", name: "Receipt image", url: "/image.png" }] }], deferLogs: true });
    await page.evaluate(() => (window as any).__navigate("/?view=published"));
    await browserExpect(page.getByTestId("tab-published")).toHaveAttribute("aria-pressed", "true");
    await browserExpect(page.getByTestId("card-draft-d")).toContainText("Published Sep 17, 2026 at 03:30 PM (Asia/Kolkata)");
    await browserExpect(page.getByAltText("Receipt image")).toHaveCount(1);
    expect((await calls()).some((call: any) => call.url.includes("publish-logs"))).toBe(false);
    await page.getByRole("button", { name: "Show publishing receipts" }).click();
    await browserExpect(page.getByText("Loading publishing receipts…")).toBeVisible();
    await page.evaluate(() => (window as any).__pending.shift()());
    await browserExpect(page.getByText(/No publish log is available/)).toBeVisible();
    await change({ deferLogs: false, logError: true }, true);
    await browserExpect(page.getByRole("alert")).toContainText("receipts could not be loaded");
    await change({ logError: false, logs: [{ id: "log", platform: "twitter", status: "published", executionMode: "live", receiptKind: "provider_id", attempt: 2, maxAttempts: 3, publishedPostId: "provider-42", startedAt: "2026-09-17T10:00:00Z" }] });
    await page.getByRole("button", { name: "Retry receipts" }).click();
    await browserExpect(page.getByText("Provider post ID: provider-42")).toBeVisible();
    await browserExpect(page.getByText(/Twitter\/X · published · attempt 2\/3/)).toBeVisible();
  });
  it("disables published edit and only copies safe fields after explicit confirmation", async () => {
    const original = { ...draft("d", "published"), status: "published", publishedAt: "2026-09-17T10:00:00Z", scheduledAt: "2026-09-17T09:00:00Z" };
    await mount("drafts", { drafts: [original] });
    await page.getByTestId("tab-published").click();
    await page.getByTestId("button-menu-d").click();
    await browserExpect(page.getByTestId("button-edit-d")).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Copy to new draft", exact: true }).click();
    expect((await calls()).filter((call: any) => call.method !== "GET")).toEqual([]);
    await page.getByRole("button", { name: "Create new draft", exact: true }).click();
    await browserExpect(page.getByTestId("card-draft-copy")).toBeVisible();
    expect((await calls()).filter((call: any) => call.method !== "GET")).toEqual([{ url: "/api/drafts", method: "POST", body: { content: original.content, platform: original.platform, tone: original.tone, media: [] }, aborted: false }]);
    expect(await page.evaluate(() => (window as any).__state.drafts[0])).toEqual(original);
  });
  it("keeps edits after failed saves and guards Cancel, Escape, navigation and reload", async () => {
    await mount("drafts", { patchError: true });
    await page.getByTestId("button-menu-d").click(); await page.getByTestId("button-edit-d").click();
    await page.getByLabel("Draft content").fill("Unsaved wording");
    page.once("dialog", dialog => dialog.dismiss()); await page.getByTestId("button-cancel-edit").click();
    await browserExpect(page.getByLabel("Draft content")).toHaveValue("Unsaved wording");
    page.once("dialog", dialog => dialog.dismiss()); await page.keyboard.press("Escape");
    page.once("dialog", dialog => dialog.dismiss()); await page.evaluate(() => (window as any).__navigate("/elsewhere"));
    expect(new URL(page.url()).pathname).toBe("/");
    expect(await page.evaluate(() => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; })).toBe(true);
    await page.getByTestId("button-save-edit").click();
    await browserExpect.poll(() => page.evaluate(() => (window as any).__toasts.at(-1)?.description)).toContain("Your text is retained");
    await browserExpect(page.getByLabel("Draft content")).toHaveValue("Unsaved wording");
    page.once("dialog", dialog => dialog.accept()); await page.getByTestId("button-cancel-edit").click();
    await browserExpect(page.getByRole("dialog")).toHaveCount(0);
    expect(await page.evaluate(() => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; })).toBe(false);
  });
  it("blocks a stale editor when a target delivers before saving", async () => {
    await mount(); await page.getByTestId("button-menu-d").click(); await page.getByTestId("button-edit-d").click();
    await page.getByLabel("Draft content").fill("Too late");
    await change({ schedules: [schedule(["published", "queued"])] }, true);
    await page.getByTestId("button-save-edit").click();
    await browserExpect.poll(() => page.evaluate(() => (window as any).__toasts.at(-1)?.title)).toBe("Draft is read-only");
    expect((await calls()).filter((call: any) => call.method === "PATCH")).toEqual([]);
    await browserExpect(page.getByLabel("Draft content")).toHaveValue("Too late");
  });
  it("guards Back/Forward without losing edits, and releases navigation after saving", async () => {
    await mount();
    await page.getByTestId("tab-scheduled").click(); await page.getByTestId("tab-ready").click();
    await page.getByTestId("button-menu-d").click(); await page.getByTestId("button-edit-d").click();
    await page.getByLabel("Draft content").fill("Keep across Back");
    page.once("dialog", dialog => dialog.dismiss()); await page.evaluate(() => history.back());
    await browserExpect(page.getByLabel("Draft content")).toHaveValue("Keep across Back");
    expect(new URL(page.url()).search).toBe("?view=ready");
    await page.getByTestId("button-save-edit").click();
    await browserExpect(page.getByRole("dialog")).toHaveCount(0);
    await page.evaluate(() => history.back());
    await browserExpect(page.getByTestId("tab-scheduled")).toHaveAttribute("aria-pressed", "true");
    await page.evaluate(() => history.forward());
    await browserExpect(page.getByTestId("tab-ready")).toHaveAttribute("aria-pressed", "true");
  });
  it.each(["published", "partial", "unknown", "publishing"])("disables edits for a %s target despite a stale draft flag", async (status) => {
    await mount("drafts", { schedules: [schedule([status], "scheduled")] });
    await page.getByTestId("button-menu-d").click();
    await browserExpect(page.getByTestId("button-edit-d")).toHaveAttribute("aria-disabled", "true");
  });
  it("still checks every scheduled target's readiness, not just the draft platform", async () => {
    await mount("drafts", { drafts: [draft("d", "scheduled")], schedules: [schedule(["scheduled", "scheduled"])], rules: [{ platform: "twitter", enabled: false }] });
    await page.getByTestId("tab-scheduled").click(); await page.getByTestId("button-post-d").click();
    await browserExpect(page.getByTestId("button-publish-now")).toBeDisabled();
    await browserExpect(page.getByRole("dialog")).toContainText("Twitter/X: Disabled by a publishing rule");
    expect((await calls()).filter((call: any) => call.method === "POST")).toEqual([]);
  });
  it("scopes unknown blocking to its draft and preserves uncertainty after dismissal and remount", async () => {
    await mount("drafts", { drafts: [draft(), draft("other")], postSchedules: [], publishError: true });
    await openPublish(); await page.getByTestId("button-publish-now").click();
    await browserExpect(page.getByRole("button", { name: "Dismiss monitor", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Dismiss monitor", exact: true }).click();
    await page.getByTestId("button-post-other").click();
    await browserExpect(page.getByTestId("button-publish-now")).toBeEnabled();
    await browserExpect(page.getByTestId("button-copy-and-post")).toBeEnabled();
    await page.getByTestId("button-cancel-post").click();
    await page.locator("#leave-content").click();
    await page.clock.runFor(6 * 60_000);
    await page.getByRole("link", { name: "Return to Content" }).click();
    await page.getByTestId("button-post-d").click();
    await browserExpect(page.getByTestId("button-publish-now")).toBeDisabled();
    await browserExpect(page.getByTestId("button-copy-and-post")).toBeDisabled();
    await page.getByRole("button", { name: "Check delivery status", exact: true }).click();
    expect((await calls()).filter((call: any) => call.method === "POST")).toHaveLength(1);
  });
  it("keeps partial/unknown/new statuses visible and offers only failed-target recovery", async () => {
    await mount("drafts", { drafts: [draft("d", "partial"), draft("u", "unknown"), draft("future", "future-state")], schedules: [schedule(["published", "failed"], "partial"), schedule(["unknown"], "unknown", "u")] });
    await page.getByTestId("tab-attention").click();
    await browserExpect(page.getByTestId("tab-attention")).toContainText("3");
    for (const id of ["d", "u", "future"]) await browserExpect(page.getByTestId(`card-draft-${id}`)).toBeVisible();
    await browserExpect(page.getByRole("button", { name: "Retry twitter", exact: true })).toBeEnabled();
    expect(await page.getByRole("button", { name: "Retry linkedin", exact: true }).count()).toBe(0);
    await browserExpect(page.getByTestId("card-draft-u")).toContainText("delivery could have succeeded");
    await page.getByRole("button", { name: "Retry twitter", exact: true }).click();
    expect((await calls()).filter((call: any) => call.method === "POST").map((call: any) => call.url)).toEqual(["/api/drafts/d/schedule/targets/t1/retry"]);
  });
  it("does not announce success on the first job, waits for all persisted targets, and prevents duplicate POSTs", async () => {
    await mount("drafts", { drafts: [draft("d", "scheduled")], schedules: [schedule(["scheduled", "scheduled"])] });
    await openPublish(true);
    await page.getByTestId("button-publish-now").dblclick();
    await browserExpect(page.getByRole("dialog")).toContainText("Twitter/X: queued");
    expect(await page.getByText(/All targets are recorded as published/).count()).toBe(0);
    expect((await calls()).filter((call: any) => call.method === "POST")).toHaveLength(1);
    await change({ schedules: [schedule(["published", "published"], "published")] });
    await page.clock.runFor(1100);
    await browserExpect(page.getByRole("dialog")).toContainText("All targets are recorded as published");
    expect((await calls()).some((call: any) => call.url.includes("/api/jobs/"))).toBe(false);
    expect(await page.evaluate(() => (window as any).__toasts.some((toast: any) => /live/i.test(JSON.stringify(toast))))).toBe(false);
  });
  it("treats skipped outcomes and network interruption as uncertain, never successful", async () => {
    await mount("drafts", { publishError: true, postSchedules: [schedule(["skipped"], "completed")] });
    await openPublish();
    await page.getByTestId("button-publish-now").click();
    await browserExpect(page.getByRole("dialog")).toContainText("Delivery is uncertain");
    await browserExpect(page.getByTestId("button-publish-now")).toBeDisabled();
    await browserExpect(page.getByTestId("button-copy-and-post")).toBeDisabled();
    await page.getByRole("button", { name: "Check delivery status" }).click();
    expect((await calls()).filter((call: any) => call.method === "POST")).toHaveLength(1);
  });
  it.each(["retry", "cancel"])("refreshes terminal dialog targets after %s without a manual status check", async (action) => {
    await mount("drafts", { postSchedules: [schedule(["published", "failed"], "failed")] });
    await openPublish(); await page.getByTestId("button-publish-now").click();
    const dialog = page.getByRole("dialog");
    await browserExpect(dialog).toContainText("Not all targets published");
    const next = schedule(["published", action === "retry" ? "queued" : "cancelled"], action === "retry" ? "queued" : "partial");
    if (action === "retry") next.targets[1].id = "replacement";
    await change({ recoverySchedules: [next] });
    await dialog.getByRole("button", { name: `${action === "retry" ? "Retry" : "Cancel"} twitter`, exact: true }).dblclick();
    await browserExpect(dialog).toContainText(`Twitter/X: ${action === "retry" ? "queued" : "cancelled"}`);
    expect(await dialog.getByRole("button", { name: "Retry twitter", exact: true }).count()).toBe(0);
    expect(await dialog.getByRole("button", { name: "Retry linkedin", exact: true }).count()).toBe(0);
    expect(await dialog.getByRole("button", { name: "Cancel linkedin", exact: true }).count()).toBe(0);
    await browserExpect(page.getByTestId("button-publish-now")).toBeDisabled();
    if (action === "retry") {
      await change({ schedules: [schedule(["published", "published"], "published")] });
      await page.clock.runFor(1100);
      await browserExpect(dialog).toContainText("All targets are recorded as published");
    } else expect(await dialog.getByText(/All targets are recorded as published/).count()).toBe(0);
    const writes = (await calls()).filter((call: any) => call.method !== "GET");
    expect(writes.map((call: any) => [call.method, call.url])).toEqual([
      ["POST", "/api/drafts/d/publish-now"],
      [action === "retry" ? "POST" : "DELETE", `/api/drafts/d/schedule/targets/t1${action === "retry" ? "/retry" : ""}`],
    ]);
    const reads = (await calls()).filter((call: any) => call.url.endsWith("/publish-status")).length;
    await page.clock.runFor(5000);
    expect((await calls()).filter((call: any) => call.url.endsWith("/publish-status"))).toHaveLength(reads);
  });
  it.each(["network", "503"])("reconciles a saved retry after a %s response without replaying it", async (recoveryError) => {
    await mount("drafts", { postSchedules: [schedule(["published", "failed"], "failed")] });
    await openPublish(); await page.getByTestId("button-publish-now").click();
    const dialog = page.getByRole("dialog");
    await browserExpect(dialog).toContainText("Twitter/X: failed");
    await change({ recoveryError, recoverySchedules: [schedule(["published", "unknown"], "unknown")] });
    await dialog.getByRole("button", { name: "Retry twitter", exact: true }).click();
    await browserExpect(dialog).toContainText("Twitter/X: unknown");
    await browserExpect(dialog).toContainText("Automatic retry is blocked");
    expect(await dialog.getByRole("button", { name: /^Retry / }).count()).toBe(0);
    expect((await calls()).filter((call: any) => call.method === "POST")).toHaveLength(2);
  });
  it("reconciles mixed-time all-published targets before announcing success", async () => {
    await mount("drafts", { postSchedules: [schedule(["published", "published"], "scheduled")] });
    await openPublish(); await page.getByTestId("button-publish-now").click();
    const dialog = page.getByRole("dialog");
    await browserExpect(dialog).toContainText("Delivery is uncertain");
    expect(await dialog.getByText(/All targets are recorded as published/).count()).toBe(0);
    await change({ schedules: [schedule(["published", "published"], "published")] });
    await page.clock.runFor(1100);
    await browserExpect(dialog).toContainText("All targets are recorded as published");
    expect((await calls()).filter((call: any) => call.method !== "GET")).toHaveLength(1);
  });
  it("keeps reading a missing schedule until actual target evidence arrives", async () => {
    await mount("monitor");
    await browserExpect.poll(async () => (await calls()).length).toBeGreaterThan(0);
    await browserExpect(page.locator("output")).toContainText('"outcome":"unknown"');
    await change({ schedules: [schedule(["published"], "published")] });
    await page.clock.runFor(200);
    await browserExpect(page.locator("output")).toContainText('"outcome":"published"');
    const count = (await calls()).length;
    await change({}, true);
    await page.clock.runFor(130_000);
    expect(await calls()).toHaveLength(count);
    expect(await page.locator("output").textContent()).not.toContain("Still awaiting");
  });
  it("stops after three failed status reads and resumes only on explicit recovery", async () => {
    await mount("monitor", { scheduleError: true });
    await browserExpect(page.locator("output")).toContainText("could not be verified");
    await browserExpect.poll(async () => {
      await page.clock.runFor(200);
      return (await calls()).length;
    }).toBe(3);
    await change({ scheduleError: false, schedules: [schedule(["cancelled"], "cancelled")] });
    await page.clock.runFor(130_000);
    expect(await calls()).toHaveLength(3);
    await page.getByRole("button", { name: "Recover draft", exact: true }).click();
    await browserExpect(page.locator("output")).toContainText('"outcome":"attention"');
    expect(await calls()).toHaveLength(4);
    expect((await calls()).every((call: any) => call.method === "GET")).toBe(true);
  });
  it.each([false, true])("bounds unconfirmed reconciliation, including hung reads (%s)", async (deferStatus) => {
    await mount("monitor", { schedules: [schedule(["published"], "scheduled")], deferStatus });
    await browserExpect.poll(async () => (await calls()).length).toBeGreaterThan(0);
    await page.clock.runFor(121_000);
    await browserExpect(page.locator("output")).toContainText("Still awaiting delivery confirmation");
    expect(await page.locator("output").textContent()).not.toContain('"outcome":"published"');
    const count = (await calls()).length;
    await page.clock.runFor(10_000);
    expect(await calls()).toHaveLength(count);
    if (deferStatus) {
      await page.evaluate(() => (window as any).__pending.shift()());
      await browserExpect(page.locator("output")).toContainText("Still awaiting delivery confirmation");
    }
  });
  it.each(["Recover draft", "Switch draft"])("aborts and ignores an old status response on %s", async (action) => {
    await mount("monitor", { schedules: [schedule(["published"], "published")], deferStatus: true });
    await browserExpect.poll(async () => (await calls()).length).toBe(1);
    await page.getByRole("button", { name: "Recover unrelated", exact: true }).click();
    expect(await calls()).toHaveLength(1);
    await change({ deferStatus: false, schedules: [schedule(["unknown"], "unknown", action === "Switch draft" ? "other" : "d")] });
    await page.getByRole("button", { name: action, exact: true }).click();
    await browserExpect(page.locator("output")).toContainText('"outcome":"attention"');
    await browserExpect.poll(async () => (await calls()).length).toBeGreaterThan(1);
    await page.evaluate(() => (window as any).__pending.shift()());
    await browserExpect(page.locator("output")).toContainText('"status":"unknown"');
    expect((await calls())[0].aborted).toBe(true);
    await page.locator("#leave-content").click();
    const count = (await calls()).length;
    await page.clock.runFor(150_000);
    expect(await calls()).toHaveLength(count);
  });
  it("shows polling failure without exposing a second publish action", async () => {
    await mount(); await openPublish();
    await change({ scheduleError: true });
    await page.getByTestId("button-publish-now").click();
    await browserExpect(page.getByRole("dialog")).toContainText("Delivery status could not be verified");
    await page.clock.runFor(2500);
    await browserExpect(page.getByTestId("button-publish-now")).toBeDisabled();
    expect((await calls()).filter((call: any) => call.method === "POST")).toHaveLength(1);
  });
  it("separates manual copy/open from direct publishing and handles clipboard failures", async () => {
    await mount("drafts", { drafts: [draft("d", "draft", "medium")], clipboardError: true });
    await page.getByTestId("button-post-d").click();
    await browserExpect(page.getByTestId("button-publish-now")).toBeDisabled();
    await browserExpect(page.getByRole("dialog")).toContainText("you must publish there yourself");
    await page.getByTestId("button-copy-and-post").click();
    expect(await page.evaluate(() => (window as any).__opens)).toEqual([]);
    await change({ clipboardError: false });
    await page.getByTestId("button-copy-and-post").click();
    expect(await page.evaluate(() => (window as any).__copies)).toHaveLength(1);
    expect((await calls()).filter((call: any) => call.method !== "GET")).toEqual([]);
  });
  it("uses profile zone and preferred time for modal scheduling despite a different browser zone", async () => {
    await mount("modal");
    await browserExpect(page.getByLabel("Publication Time (Asia/Kolkata)")).toHaveValue("18:45");
    await page.getByLabel("Publication Date").fill("2026-09-20");
    await page.getByRole("button", { name: "Schedule Article", exact: true }).click();
    await browserExpect.poll(async () => (await calls()).filter((call: any) => call.method === "POST").length).toBe(1);
    expect((await calls()).find((call: any) => call.method === "POST").body).toEqual({ publishAt: "2026-09-20T13:15:00.000Z", platforms: ["twitter"] });
  });
  it("uses the same timezone/defaults in bulk scheduling", async () => {
    await mount();
    await page.getByLabel("Select LinkedIn draft", { exact: true }).click();
    await page.getByRole("button", { name: "Schedule 1 selected" }).click();
    await browserExpect(page.getByLabel("Time (Asia/Kolkata)", { exact: true })).toHaveValue("18:45");
    await page.getByLabel("Date", { exact: true }).fill("2026-09-20");
    await page.getByRole("button", { name: "Schedule 1 drafts", exact: true }).click();
    await browserExpect.poll(async () => (await calls()).filter((call: any) => call.method === "POST").length).toBe(1);
    expect((await calls()).find((call: any) => call.method === "POST").body).toMatchObject({ publishAt: "2026-09-20T13:15:00.000Z", draftIds: ["d"] });
  });
  it("honors Calendar defaults, allows available Bluesky, and prevents a fifth target or manual schedule", async () => {
    await mount("calendar");
    await page.getByRole("button", { name: "Schedule draft", exact: true }).click();
    await browserExpect(page.getByLabel("Time (Asia/Kolkata)", { exact: true })).toHaveValue("18:45");
    await browserExpect(page.getByRole("checkbox", { name: "Twitter/X", exact: true })).toBeChecked();
    for (const name of ["LinkedIn", "Bluesky", "Mastodon"]) await page.getByRole("checkbox", { name, exact: true }).check();
    await browserExpect(page.getByRole("checkbox", { name: "Dev.to", exact: true })).toBeDisabled();
    await browserExpect(page.getByRole("checkbox", { name: /Medium/ })).toBeDisabled();
    await page.getByLabel("Date", { exact: true }).fill("2026-09-20");
    await page.getByRole("button", { name: "Schedule 4 platforms", exact: true }).click();
    await browserExpect.poll(async () => (await calls()).filter((call: any) => call.method === "POST").length).toBe(1);
    expect((await calls()).find((call: any) => call.method === "POST").body.platforms).toEqual(["twitter", "linkedin", "bluesky", "mastodon"]);
  });
  it("disables Calendar submission when readiness changes to globally unavailable", async () => {
    await mount("calendar");
    await page.getByRole("button", { name: "Schedule draft", exact: true }).click();
    await browserExpect(page.getByRole("checkbox", { name: "Twitter/X", exact: true })).toBeChecked();
    // Explicitly select it so background preference hydration cannot replace it.
    await page.getByRole("checkbox", { name: "LinkedIn", exact: true }).check();
    await change({ integrations: fixture().integrations.map((item) => ({ ...item, enabled: item.key !== "twitter" })) }, true);
    await browserExpect(page.getByRole("alert")).toContainText("Unavailable platform-wide");
    await browserExpect(page.getByRole("button", { name: "Schedule 2 platforms" })).toBeDisabled();
    expect((await calls()).filter((call: any) => call.method === "POST")).toHaveLength(0);
  });
  it("keeps recovery visible in list/month and provides keyboard rescheduling", async () => {
    await mount("calendar", { drafts: [draft("d", "scheduled")], schedules: [schedule(["scheduled"])] });
    await page.getByRole("button", { name: "list", exact: true }).click();
    await browserExpect(page.getByRole("button", { name: "Cancel linkedin", exact: true })).toBeVisible();
    const rescheduleButton = page.getByRole("button", { name: /^Reschedule Review/ });
    await rescheduleButton.focus(); await page.keyboard.press("Enter");
    await browserExpect(page.getByRole("dialog")).toBeVisible();
    await browserExpect(page.getByLabel("Publication Time (Asia/Kolkata)")).toHaveValue("14:30");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "month", exact: true }).click();
    await browserExpect(page.getByRole("button", { name: "Cancel linkedin", exact: true })).toBeVisible();
  });
  it("stops terminal/skipped job polling and ignores an old job's late response", async () => {
    await mount("jobs", { deferJob: true });
    await browserExpect.poll(async () => (await calls()).length).toBe(1);
    await page.getByRole("button", { name: "Switch job" }).click();
    await browserExpect(page.locator("output")).toContainText('"id":"new"');
    await page.evaluate(() => (window as any).__pending.shift()());
    await page.clock.runFor(1000);
    await browserExpect(page.locator("output")).toContainText('"id":"new"');
    expect((await calls()).filter((call: any) => call.url.includes("/api/jobs/"))).toHaveLength(2);
    expect((await calls())[0].aborted).toBe(true);
  });
  it("fits mobile cards and scheduling dialog with named keyboard controls", async () => {
    await mount("drafts", {}, 375);
    await browserExpect(page.getByLabel("Search drafts", { exact: true })).toBeVisible();
    await browserExpect(page.getByRole("button", { name: "Actions for LinkedIn draft" })).toBeVisible();
    await browserExpect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByTestId("button-schedule-d").click();
    await browserExpect(page.getByRole("dialog")).toBeVisible();
    expect(await page.getByRole("dialog").evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.getByRole("button", { name: "Cancel", exact: true }).focus(); await page.keyboard.press("Enter");
    await browserExpect(page.getByRole("dialog")).toHaveCount(0);
  });
});