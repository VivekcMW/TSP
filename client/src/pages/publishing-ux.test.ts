import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { chromium, expect as browserExpect, type Browser, type Page } from "@playwright/test";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import path from "node:path";
import { readFileSync } from "node:fs";
import { capturePublishingConsent } from "@shared/publishing-consent";

// Real React/Radix/Query and actual Tailwind layout. Every fetch, clipboard write
// and window.open is mocked; Chromium cannot reach any server or provider.
let browser: Browser;
let page: Page;
let bundle: string;
let css: string;
const root = path.resolve(import.meta.dirname, "../../..");
const draft = (id = "d", publishStatus = "draft", platform = "linkedin") => ({ id, publishStatus, platform, content: `Review this ${id} post before publishing.`, tone: "professional", media: [], platformPublishRules: {}, updatedAt: "2026-09-17T09:00:00.000Z" });
const schedule = (states: string[], status = "scheduled", draftId = "d") => ({
  id: `s-${draftId}`, draftId, status, scheduledPublishAt: "2026-09-20T09:00:00Z", updatedAt: "2026-09-17T09:00:00.000Z", draft: draft(draftId),
  targets: states.map((state, index) => ({ id: `t${index}`, platform: ["linkedin", "twitter"][index], status: state, revision: 0, updatedAt: "2026-09-17T09:00:00.000Z", lastError: state === "failed" ? "Reconnect the account" : null })),
});
const consentForFixture = (item = draft(), previous: ReturnType<typeof schedule> | null = null) => capturePublishingConsent(item, previous)!;
const fixture = () => ({
  drafts: [draft()], schedules: [],
  profile: { timezone: "Asia/Kolkata", preferredPublishTime: "18:45", defaultPlatform: "twitter", enabledPlatforms: ["linkedin", "twitter", "bluesky", "mastodon", "devto", "telegram", "medium"] },
  integrations: ["linkedin", "twitter", "bluesky", "mastodon", "devto", "telegram", "medium"].map((key) => ({ key, enabled: true })),
  rules: [], postSchedules: [schedule(["published", "queued"])], scheduleError: false, clipboardError: false, popupBlocked: false, publishError: false,
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
      import { assertPublishingConsent } from "@shared/publishing-consent";
      import { Link, useLocation } from "wouter";
      window.__calls = []; window.__toasts = []; window.__copies = []; window.__opens = []; window.__pending = [];
      window.__handoffs = []; window.__popupCloses = 0; window.__clipboardPending = [];
      window.__directPending = []; window.__detailPending = [];
      window.__refresh = () => queryClient.invalidateQueries();
      window.open = (...args) => {
        window.__opens.push(args);
        if (window.__state.popupThrows) throw new Error("Popup denied");
        if (window.__state.popupBlocked) return null;
        return { opener: {}, closed: false, close() { this.closed = true; window.__popupCloses++; }, document: {
          createElement: () => ({ href: "", target: "", rel: "", referrerPolicy: "", click() { window.__handoffs.push({ href: this.href, rel: this.rel, referrerPolicy: this.referrerPolicy }); } }),
          body: { appendChild() {} },
        } };
      };
      Object.defineProperty(navigator, "clipboard", { value: window.__state.clipboardMissing ? undefined : { writeText: async text => {
        if (window.__state.deferClipboard) await new Promise(resolve => window.__clipboardPending.push(resolve));
        if (window.__state.clipboardError) throw new Error("Clipboard denied"); window.__copies.push(text);
      } } });
      window.fetch = async (url, options = {}) => {
        window.__calls.push({ url, method: options.method || "GET", body: options.body ? JSON.parse(options.body) : null, signal: options.signal });
        const s = window.__state;
        const findDraft = id => [...s.drafts, ...(s.detailDrafts || [])].find(item => item.id === id);
        if (String(url).endsWith("/details")) {
          const current = findDraft(decodeURIComponent(String(url).split("/")[3]));
          if (s.deferDetails) await new Promise(resolve => window.__detailPending.push(resolve));
          if (s.detailsError) return new Response(JSON.stringify({ message: "Details unavailable" }), { status: Number(s.detailsError) || 503 });
          return new Response(JSON.stringify(current || { message: "Draft not found" }), { status: current ? 200 : 404 });
        }
        if ((options.method === "POST" || options.method === "PUT") && (String(url).endsWith("/schedule") || String(url).endsWith("/publish-now"))) {
          const id = decodeURIComponent(String(url).split("/")[3]);
          try { assertPublishingConsent(JSON.parse(options.body || "{}").consent, findDraft(id), s.schedules.find(item => item.draftId === id) || null); }
          catch { return new Response(JSON.stringify({ code: "publishing_reconfirm_required", message: "Draft or publishing targets changed. Refresh and review, then confirm again. Nothing was admitted by this request." }), { status: 409 }); }
        }
        if (String(url).endsWith("/bulk-schedule")) {
          const input = JSON.parse(options.body), scheduled = [], failed = [], errors = {};
          for (const id of input.draftIds) {
            try { assertPublishingConsent(input.consents?.[id], findDraft(id), s.schedules.find(item => item.draftId === id) || null); scheduled.push(id); }
            catch { failed.push(id); errors[id] = { code: "publishing_reconfirm_required", status: 409, message: "Draft or publishing targets changed. Review and confirm again." }; }
          }
          return new Response(JSON.stringify({ scheduled, failed, errors, message: scheduled.length + " scheduled, " + failed.length + " failed" }));
        }
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
          if (s.patchError) return new Response(JSON.stringify({ code: "draft_immutable", message: "Published draft is immutable" }), { status: 409 });
          const current = s.drafts.find(item => item.id === decodeURIComponent(String(url).split("/")[3]));
          const input = JSON.parse(options.body);
          if (!current || input.expectedContent !== current.content || input.expectedUpdatedAt !== current.updatedAt) return new Response(JSON.stringify({ code: "draft_conflict", message: "Draft changed elsewhere" }), { status: 409 });
          Object.assign(current, { content: input.content.trim(), updatedAt: new Date().toISOString() });
          return new Response(JSON.stringify(current));
        }
        if (String(url).endsWith("/editing-snapshot")) {
          if (s.snapshotError) return new Response(JSON.stringify({ message: "Snapshot unavailable" }), { status: 503 });
          const current = s.drafts.find(item => item.id === decodeURIComponent(String(url).split("/")[3]));
          return new Response(JSON.stringify(current || { message: "Draft not found" }), { status: current ? 200 : 404 });
        }
        if (String(url).includes("/api/jobs/")) {
          if (s.deferJob && String(url).includes("old")) await new Promise(resolve => window.__pending.push(resolve));
          return new Response(JSON.stringify({ id: String(url).includes("old") ? "old" : "new", state: "completed", progress: { platform: "linkedin", status: "skipped" } }));
        }
        if (String(url).includes("publish-now")) {
          if (s.deferPublish) await new Promise(resolve => window.__directPending.push(resolve));
          s.schedules = s.postSchedules;
          if (s.publishError) throw new TypeError("Failed to fetch");
          return new Response(JSON.stringify({ jobId: "first", jobIds: ["first", "second"], status: "queued" }));
        }
        if (String(url).endsWith("/repetition-check")) return new Response(JSON.stringify({ matches: [] }));
        if (String(url).endsWith("/approve-publishing")) {
          const current = findDraft(decodeURIComponent(String(url).split("/")[3]));
          const expected = JSON.parse(options.body);
          if (s.approvalError || !current || expected.content !== current.content || expected.updatedAt !== current.updatedAt) return new Response(JSON.stringify({ message: "Draft revision changed. Review the current draft." }), { status: 409 });
          current.publishApprovedAt = new Date().toISOString();
          return new Response(JSON.stringify(current));
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
        if (String(url).includes("/status")) return new Response(JSON.stringify(s.connections?.[String(url).split("/")[3]] ?? { connected: true, assessment: { canPublish: true, status: "connected" } }));
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
  const stylesheet = readFileSync(path.join(root, "client/src/index.css"), "utf8")
    .replace('@import "./design/tokens.generated.css";', readFileSync(path.join(root, "client/src/design/tokens.generated.css"), "utf8"));
  css = (await postcss([tailwindcss(path.join(root, "tailwind.config.ts"))]).process(stylesheet, { from: path.join(root, "client/src/index.css") })).css;
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterEach(async () => { await page?.close(); });
afterAll(async () => { await browser?.close(); });

async function mount(surface = "drafts", overrides: Record<string, unknown> = {}, width = 1280, initialPath = "/") {
  page = await browser.newPage({ viewport: { width, height: 850 }, timezoneId: "America/Los_Angeles", reducedMotion: "reduce" });
  await page.route("**/*", route => route.abort());
  await page.route("https://publishing.test/", route => route.fulfill({ contentType: "text/html", body: '<div id="root" style="height:100dvh"></div>' }));
  await page.goto("https://publishing.test/");
  await page.evaluate(initialPath => history.replaceState({ retained: "handoff-context" }, "", initialPath), initialPath);
  await page.clock.install({ time: new Date("2026-09-17T10:00:00Z") });
  await page.evaluate(({ surface, state }) => Object.assign(window, { __surface: surface, __state: state }), { surface, state: { ...fixture(), ...overrides } });
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: bundle });
}
async function calls() {
  // Repetition-check is a read-only, auto-firing advisory (POST only because
  // of body size, not a mutation) — excluded so it doesn't pollute the many
  // "no write happened" assertions below, which predate this background check.
  return page.evaluate(() => (window as any).__calls
    .filter((call: any) => !String(call.url).endsWith("/repetition-check"))
    .map((call: any) => ({ url: call.url, method: call.method, body: call.body, aborted: call.signal?.aborted })));
}
async function change(overrides: Record<string, unknown>, refresh = false) {
  await page.evaluate(async ({ overrides, refresh }) => { Object.assign((window as any).__state, overrides); if (refresh) await (window as any).__refresh(); }, { overrides, refresh });
}
async function openPublish(scheduled = false) {
  if (scheduled) await page.getByTestId("tab-scheduled").click();
  await page.getByTestId("button-post-d").click();
  await browserExpect(page.getByTestId("button-publish-now")).toBeEnabled();
}

async function beginSchedule(surface: "modal" | "calendar", overrides: Record<string, unknown> = {}) {
  await mount(surface, overrides);
  if (surface === "calendar") await page.getByRole("button", { name: "Schedule draft", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const date = dialog.getByLabel(surface === "modal" ? "Publication Date" : "Date", { exact: true });
  const time = dialog.getByLabel(surface === "modal" ? "Publication Time (Asia/Kolkata)" : "Time (Asia/Kolkata)", { exact: true });
  const confirmation = dialog.getByRole("checkbox", { name: "I confirm this exact text, destinations and timezone." });
  const submit = dialog.getByRole("button", { name: surface === "modal" ? "Schedule Article" : /^Schedule \d* platforms?$/, exact: true });
  const hasExistingSchedule = surface === "modal" && Array.isArray(overrides.schedules) && overrides.schedules.length > 0;
  await browserExpect(time).toHaveValue(hasExistingSchedule ? "14:30" : "18:45");
  await date.fill("2026-09-20");
  return { dialog, date, time, confirmation, submit };
}

describe("UX-07 and UX-08 counts and scheduling intent (isolated browser)", () => {
  it.each(["modal", "calendar"] as const)("rejects silent writer B after %s confirmation of A, despite B being approved", async surface => {
    const { dialog, confirmation, submit } = await beginSchedule(surface);
    await confirmation.check();
    const newer = { ...draft(), content: "B was saved and approved in another tab", updatedAt: "2026-09-17T09:30:00.000Z", publishApprovedAt: "2026-09-17T09:31:00.000Z" };
    await change({ drafts: [newer] }); // No refetch before admission.
    await submit.click();
    await browserExpect(dialog).toBeVisible();
    await browserExpect.poll(() => page.evaluate(() => (window as any).__toasts.some((toast: any) => /confirm again/.test(toast.description)))).toBe(true);
    await browserExpect(dialog.getByTestId("schedule-exact-text")).toHaveText(newer.content);
    await browserExpect(confirmation).not.toBeChecked(); await browserExpect(submit).toBeDisabled();
    const writes = (await calls()).filter((call: any) => call.method !== "GET");
    expect(writes).toHaveLength(1); expect(writes[0].body.consent).toEqual(consentForFixture());
    expect(await page.evaluate(() => (window as any).__state.schedules)).toEqual([]);
    await page.clock.runFor(1000);
    expect((await calls()).filter((call: any) => call.method !== "GET")).toHaveLength(1);
  });

  it("rejects a changed reschedule target generation and requires another confirmation", async () => {
    const original = schedule(["scheduled"]);
    const { dialog, confirmation, submit } = await beginSchedule("modal", { drafts: [draft("d", "scheduled")], schedules: [original] });
    await confirmation.check();
    const replacement = { ...original, targets: [{ ...original.targets[0], id: "new-generation", platform: "twitter" }] };
    await change({ schedules: [replacement] });
    await submit.click();
    await browserExpect(dialog).toContainText("Destinations: Twitter/X");
    await browserExpect(confirmation).not.toBeChecked(); await browserExpect(submit).toBeDisabled();
    const writes = (await calls()).filter((call: any) => call.method !== "GET");
    expect(writes).toHaveLength(1); expect(writes[0].body.consent.expectedSchedule.targets[0].id).toBe("t0");
    expect(await page.evaluate(() => (window as any).__state.schedules[0].targets[0].id)).toBe("new-generation");
  });

  it("confirms only retained reschedule destinations while binding consent to cancelled targets too", async () => {
    const original = schedule(["scheduled", "cancelled"]);
    const { dialog, confirmation, submit } = await beginSchedule("modal", {
      drafts: [draft("d", "scheduled")], schedules: [original], rules: [{ platform: "twitter", enabled: false }],
    });
    await browserExpect(dialog).toContainText("Destinations: LinkedIn");
    await browserExpect(dialog).not.toContainText("Twitter/X:");
    await confirmation.check(); await browserExpect(submit).toBeEnabled();
    await submit.click();
    const writes = (await calls()).filter((call: any) => call.method !== "GET");
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ method: "PUT", body: { consent: consentForFixture(draft("d", "scheduled"), original) } });
    expect(writes[0].body.consent.expectedSchedule.targets).toHaveLength(2);
  });

  it("retains only failed bulk selections and their reconfirm errors without adopting/resubmitting B", async () => {
    await mount("drafts", { drafts: [draft(), draft("other", "draft", "twitter")] });
    await page.getByTestId("checkbox-select-d").click(); await page.getByTestId("checkbox-select-other").click();
    await page.getByRole("button", { name: "Schedule 2 selected" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Date", { exact: true }).fill("2026-09-20");
    await dialog.getByRole("checkbox", { name: "I confirm these texts, destinations and timezone." }).check();
    await change({ drafts: [draft(), { ...draft("other", "draft", "twitter"), content: "B", updatedAt: "2026-09-17T09:30:00.000Z", publishApprovedAt: "2026-09-17T09:31:00.000Z" }] });
    await dialog.getByRole("button", { name: "Schedule 2 drafts", exact: true }).click();
    await browserExpect(dialog).toContainText("Selected drafts need another review");
    await browserExpect(dialog.getByRole("button", { name: "Schedule 1 drafts", exact: true })).toBeDisabled();
    const writes = (await calls()).filter((call: any) => call.method !== "GET");
    expect(writes).toHaveLength(1); expect(writes[0].body.consents).toEqual({ d: consentForFixture(), other: consentForFixture(draft("other", "draft", "twitter")) });
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await browserExpect(page.getByTestId("checkbox-select-d")).not.toBeChecked(); await browserExpect(page.getByTestId("checkbox-select-other")).toBeChecked();
    expect((await calls()).filter((call: any) => call.method !== "GET")).toHaveLength(1);
  });

  it("returns explicit publish-now reconfirmation for silent B without a delivery attempt or automatic retry", async () => {
    await mount(); await openPublish();
    await change({ drafts: [{ ...draft(), content: "B", updatedAt: "2026-09-17T09:30:00.000Z", publishApprovedAt: "2026-09-17T09:31:00.000Z" }] });
    await page.getByTestId("button-publish-now").click();
    await browserExpect(page.getByRole("dialog")).toContainText("Confirm the latest draft again");
    await browserExpect(page.getByTestId("button-publish-now")).toBeDisabled(); await browserExpect(page.getByTestId("button-copy-and-post")).toBeDisabled();
    const writes = (await calls()).filter((call: any) => call.method !== "GET");
    expect(writes).toHaveLength(1); expect(writes[0].body).toEqual({ consent: consentForFixture() });
    expect(await page.evaluate(() => (window as any).__state.schedules)).toEqual([]);
  });

  it("uses the shared weighted count in Content, while exposing the independent raw cap", async () => {
    await mount("drafts", { drafts: [draft("d", "draft", "twitter")] });
    await page.getByTestId("button-menu-d").click(); await page.getByTestId("button-edit-d").click();
    const input = page.getByLabel("Draft content");
    const save = page.getByTestId("button-save-edit");
    const text = `${"x".repeat(256)} https://a.test/${"y".repeat(800)}`;
    await input.fill(text);
    await browserExpect(page.getByRole("dialog")).toContainText("280 / 280 platform characters (X links count as 23)");
    await browserExpect(page.getByRole("dialog")).toContainText(`${text.length} / 5000 raw characters`);
    await browserExpect(save).toBeEnabled();
    await input.fill(`${text}!`); await browserExpect(save).toBeDisabled();
    await input.fill("😀".repeat(140)); await browserExpect(save).toBeEnabled();
    await input.fill("😀".repeat(140) + "!"); await browserExpect(save).toBeDisabled();
    await input.fill(" \n\t"); await browserExpect(save).toBeDisabled();
    await input.fill("https://a.test/" + "x".repeat(5000 - "https://a.test/".length)); await browserExpect(save).toBeEnabled();
    await input.fill("https://a.test/" + "x".repeat(5001 - "https://a.test/".length));
    await browserExpect(input).toHaveAttribute("aria-invalid", "true");
    await browserExpect(page.getByRole("alert")).toContainText("Application storage limit exceeded: 5001/5000");
    await browserExpect(save).toBeDisabled();
    await input.fill(text); await save.click();
    expect((await calls()).filter((call: any) => call.method === "PATCH").map((call: any) => call.body)).toEqual([{ content: text, expectedContent: draft().content, expectedUpdatedAt: draft().updatedAt }]);
  });

  it.each(["modal", "calendar"] as const)("shows consistent counts, exact text and explicit consent in %s", async surface => {
    const text = `${"x".repeat(256)} https://a.test/${"y".repeat(800)}`;
    const current = { ...draft("d", "draft", "twitter"), content: text };
    const { dialog, confirmation, submit } = await beginSchedule(surface, { drafts: [current], profile: { ...fixture().profile, defaultPlatform: "linkedin" } });
    await browserExpect(dialog.getByRole("checkbox", { name: "Twitter/X", exact: true })).toBeChecked();
    await browserExpect(dialog.getByRole("checkbox", { name: "LinkedIn", exact: true })).not.toBeChecked();
    await browserExpect(dialog.getByTestId("schedule-exact-text")).toHaveText(text);
    await browserExpect(dialog).toContainText("Twitter/X: 280/280 platform characters (X links count as 23)");
    await browserExpect(dialog).toContainText(`${text.length}/5000 raw characters`);
    await browserExpect(submit).toBeDisabled();
    expect((await calls()).filter((call: any) => call.method !== "GET")).toEqual([]);
    await confirmation.check(); await browserExpect(submit).toBeEnabled();
    await submit.click();
    expect((await calls()).filter((call: any) => call.method !== "GET").map((call: any) => call.body)).toEqual([{ publishAt: "2026-09-20T13:15:00.000Z", platforms: ["twitter"], consent: consentForFixture(current) }]);
  });

  it.each(["modal", "calendar"] as const)("repairs review in %s without auto approval, scheduling, or losing date/time", async surface => {
    const original = draft();
    const { dialog, date, time, confirmation, submit } = await beginSchedule(surface, { profile: { ...fixture().profile, requirePublishReview: true } });
    await time.fill("20:10");
    await browserExpect(dialog).toContainText("No alternative was selected automatically");
    await browserExpect(dialog.getByRole("checkbox", { name: "Twitter/X", exact: true })).not.toBeChecked();
    expect((await calls()).filter((call: any) => call.method !== "GET")).toEqual([]);
    await dialog.getByRole("button", { name: "I reviewed this exact draft — approve publishing" }).click();
    await browserExpect(dialog.getByRole("checkbox", { name: "LinkedIn", exact: true })).toBeChecked();
    await browserExpect(date).toHaveValue("2026-09-20"); await browserExpect(time).toHaveValue("20:10");
    await browserExpect(submit).toBeDisabled();
    expect((await calls()).filter((call: any) => call.method !== "GET").map((call: any) => ({ url: call.url, body: call.body }))).toEqual([{ url: "/api/drafts/d/approve-publishing", body: { content: original.content, updatedAt: original.updatedAt } }]);
    await confirmation.check(); await submit.dblclick();
    const writes = (await calls()).filter((call: any) => call.method !== "GET");
    expect(writes).toHaveLength(2);
    expect(writes[1]).toMatchObject({ url: "/api/drafts/d/schedule", body: { platforms: ["linkedin"], publishAt: "2026-09-20T14:40:00.000Z" } });
  });

  it.each(["modal", "calendar"] as const)("keeps %s context through connection/preference repair and never substitutes the default", async surface => {
    const { dialog, date, time, confirmation, submit } = await beginSchedule(surface, { connections: { linkedin: { connected: false, assessment: { canPublish: false, status: "expired", reason: "Reconnect LinkedIn" } } } });
    await time.fill("20:10");
    await browserExpect(dialog).toContainText("Draft destination LinkedIn is unavailable: Reconnect LinkedIn");
    await browserExpect(dialog.getByRole("checkbox", { name: "Twitter/X", exact: true })).not.toBeChecked();
    const fix = dialog.getByRole("link", { name: "Connect or reconnect LinkedIn (new tab)" });
    await browserExpect(fix).toHaveAttribute("target", "_blank");
    await browserExpect(fix).toHaveAttribute("href", "/dashboard/settings?tab=integrations");
    // Explicit alternative, not a fallback chosen by hydration or reconnection.
    await dialog.getByRole("checkbox", { name: "Twitter/X", exact: true }).check();
    await change({ connections: {}, profile: { ...fixture().profile, timezone: "UTC", preferredPublishTime: "06:00", defaultPlatform: "bluesky" } });
    await dialog.getByRole("button", { name: "Refresh scheduling readiness" }).click();
    await browserExpect(dialog.getByRole("button", { name: "Refresh scheduling readiness" })).toBeEnabled();
    await browserExpect(date).toHaveValue("2026-09-20"); await browserExpect(time).toHaveValue("20:10");
    await browserExpect(dialog.getByRole("checkbox", { name: "Twitter/X", exact: true })).toBeChecked();
    await browserExpect(dialog.getByRole("checkbox", { name: "LinkedIn", exact: true })).not.toBeChecked();
    await browserExpect(dialog).toContainText("One saved draft, identical text on every selected destination");
    await browserExpect(dialog).toContainText("2026-09-20 at 20:10 (Asia/Kolkata)");
    expect((await calls()).filter((call: any) => call.method !== "GET")).toEqual([]);
    await confirmation.check(); await browserExpect(submit).toBeEnabled();
  });

  it("requires explicit re-review after a stale approval response and retains the modal context", async () => {
    const { dialog, date, time, submit } = await beginSchedule("modal", { profile: { ...fixture().profile, requirePublishReview: true } });
    await time.fill("20:10");
    const newer = { ...draft(), content: "A newer saved revision", updatedAt: "2026-09-17T10:00:00.000Z" };
    await change({ drafts: [newer] }); // The open modal is still displaying the previous snapshot.
    await dialog.getByRole("button", { name: "I reviewed this exact draft — approve publishing" }).click();
    await browserExpect(dialog).toContainText("Draft revision changed");
    await browserExpect(submit).toBeDisabled();
    await dialog.getByRole("button", { name: "Refresh scheduling readiness" }).click();
    await browserExpect(dialog.getByTestId("schedule-exact-text")).toHaveText(newer.content);
    await browserExpect(date).toHaveValue("2026-09-20"); await browserExpect(time).toHaveValue("20:10");
    expect((await calls()).filter((call: any) => call.method !== "GET")).toHaveLength(1);
    await dialog.getByRole("button", { name: "I reviewed this exact draft — approve publishing" }).click();
    await browserExpect(dialog.getByRole("checkbox", { name: "LinkedIn", exact: true })).toBeChecked();
    expect((await calls()).filter((call: any) => call.method !== "GET")[1].body).toEqual({ content: newer.content, updatedAt: newer.updatedAt });
    await browserExpect(submit).toBeDisabled(); // Approval is not scheduling consent.
  });

  it("can refresh a failed readiness check without leaving the scheduling context", async () => {
    const { dialog, date, time, confirmation, submit } = await beginSchedule("modal", { scheduleError: true });
    await browserExpect(dialog).toContainText("Schedule status must be checked");
    await time.fill("20:10");
    await browserExpect(submit).toBeDisabled();
    await change({ scheduleError: false });
    await dialog.getByRole("button", { name: "Refresh scheduling readiness" }).click();
    await browserExpect(dialog.getByRole("button", { name: "Refresh scheduling readiness" })).toBeEnabled();
    await browserExpect(date).toHaveValue("2026-09-20"); await browserExpect(time).toHaveValue("20:10");
    await confirmation.check(); await browserExpect(submit).toBeEnabled();
    expect((await calls()).filter((call: any) => call.method !== "GET")).toEqual([]);
  });

  it.each(["modal", "calendar"] as const)("invalidates %s consent when destinations, time or the saved revision changes", async surface => {
    const { dialog, time, confirmation, submit } = await beginSchedule(surface);
    await browserExpect(dialog.getByRole("checkbox", { name: "LinkedIn", exact: true })).toBeChecked();
    await confirmation.check();
    await dialog.getByRole("checkbox", { name: "Twitter/X", exact: true }).check();
    await browserExpect(confirmation).not.toBeChecked(); await browserExpect(submit).toBeDisabled();
    await confirmation.check(); await time.fill("19:00");
    await browserExpect(confirmation).not.toBeChecked();
    await confirmation.check();
    await change({ drafts: [{ ...draft(), content: "Changed externally", updatedAt: "2026-09-17T10:00:00.000Z" }] }, true);
    await browserExpect(dialog.getByTestId("schedule-exact-text")).toHaveText("Changed externally");
    await browserExpect(confirmation).not.toBeChecked(); await browserExpect(submit).toBeDisabled();
    expect((await calls()).filter((call: any) => call.method !== "GET")).toEqual([]);
  });

  it("cross-posts one selected text, while tailored drafts require their own explicit selection", async () => {
    const linkedin = { ...draft(), content: "Tailored LinkedIn text" };
    const twitter = { ...draft("x-version", "draft", "twitter"), content: "Separate tailored X text" };
    const { dialog, date, time, confirmation, submit } = await beginSchedule("calendar", { drafts: [linkedin, twitter] });
    await dialog.getByRole("checkbox", { name: "Twitter/X", exact: true }).check();
    await browserExpect(dialog.getByTestId("schedule-exact-text")).toHaveText(linkedin.content);
    await browserExpect(dialog).toContainText("This does not schedule other tailored drafts");
    await confirmation.check();
    await dialog.getByRole("combobox", { name: "Draft", exact: true }).selectOption(twitter.id);
    await browserExpect(dialog.getByTestId("schedule-exact-text")).toHaveText(twitter.content);
    await browserExpect(dialog.getByRole("checkbox", { name: "Twitter/X", exact: true })).toBeChecked();
    await browserExpect(dialog.getByRole("checkbox", { name: "LinkedIn", exact: true })).not.toBeChecked();
    await browserExpect(confirmation).not.toBeChecked();
    await browserExpect(date).toHaveValue("2026-09-20"); await browserExpect(time).toHaveValue("18:45");
    expect((await calls()).filter((call: any) => call.method !== "GET")).toEqual([]);
    await confirmation.check(); await submit.click();
    expect((await calls()).filter((call: any) => call.method !== "GET").map((call: any) => ({ url: call.url, body: call.body }))).toEqual([{ url: "/api/drafts/x-version/schedule", body: { platforms: ["twitter"], publishAt: "2026-09-20T13:15:00.000Z", consent: consentForFixture(twitter) } }]);
  });

  it("lets a blocked Content draft reach review fixes but never unlocks an uncertain draft", async () => {
    await mount("drafts", { profile: { ...fixture().profile, requirePublishReview: true } });
    await browserExpect(page.getByTestId("button-schedule-d")).toBeDisabled();
    await page.getByRole("button", { name: "Resolve scheduling for LinkedIn draft" }).click();
    await browserExpect(page.getByRole("button", { name: "I reviewed this exact draft — approve publishing" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await change({ schedules: [schedule(["unknown"], "unknown")] }, true);
    await browserExpect(page.getByRole("button", { name: "Resolve scheduling for LinkedIn draft" })).toHaveCount(0);
    expect((await calls()).filter((call: any) => call.method !== "GET")).toEqual([]);
  });

  it.each(["unknown", "publishing", "published", "accepted_unverified"])("keeps %s targets non-replaceable even with confirmation", async state => {
    const { dialog, confirmation, submit } = await beginSchedule("modal", { drafts: [draft("d", "scheduled")], schedules: [schedule([state], "scheduled")] });
    await browserExpect(dialog).toContainText("Use target recovery for this schedule");
    await confirmation.check(); await browserExpect(submit).toBeDisabled();
    expect((await calls()).filter((call: any) => call.method !== "GET")).toEqual([]);
  });

  it("keeps stale draft flags from creating a second Calendar schedule", async () => {
    const { confirmation, submit, dialog } = await beginSchedule("calendar", { schedules: [schedule(["unknown"], "unknown")] });
    await browserExpect(dialog).toContainText("already has a schedule");
    await browserExpect(dialog.getByRole("checkbox", { name: "LinkedIn", exact: true })).toBeChecked();
    await confirmation.check(); await browserExpect(submit).toBeDisabled();
    expect((await calls()).filter((call: any) => call.method !== "GET")).toEqual([]);
  });

  it("turns a Calendar drop into an explicit time/target confirmation, not an immediate PUT", async () => {
    await mount("calendar", { drafts: [draft("d", "scheduled")], schedules: [schedule(["scheduled"])] });
    await page.locator('article[draggable="true"]').dragTo(page.locator('[data-calendar-day="2026-09-21"]'));
    const dialog = page.getByRole("dialog");
    await browserExpect(dialog.getByLabel("Publication Date")).toHaveValue("2026-09-21");
    await browserExpect(dialog.getByLabel("Publication Time (Asia/Kolkata)")).toHaveValue("14:30");
    await browserExpect(dialog).toContainText("Destinations: LinkedIn");
    expect((await calls()).filter((call: any) => call.method !== "GET")).toEqual([]);
    await dialog.getByRole("checkbox", { name: "I confirm this exact text, destinations and timezone." }).check();
    await dialog.getByRole("button", { name: "Schedule Article", exact: true }).click();
    expect((await calls()).filter((call: any) => call.method !== "GET").map((call: any) => ({ method: call.method, body: call.body }))).toEqual([{ method: "PUT", body: { publishAt: "2026-09-21T09:00:00.000Z", consent: consentForFixture(draft("d", "scheduled"), schedule(["scheduled"])) } }]);
  });
});

describe("Content and Calendar page-adoption layout (authored, isolated browser)", () => {
  it.each((["drafts", "calendar"] as const).flatMap(surface => [320, 375, 768, 1024, 1440, 1920].map(width => ({ surface, width }))))("aligns $surface containers and wrapping filter targets at $width px", async ({ surface, width }) => {
    await mount(surface, {}, width);
    // Simulate the space taken by the unowned desktop sidebar, not its internals.
    if (width >= 768) await page.locator("#root").evaluate(element => {
      element.style.marginLeft = "256px"; element.style.width = "calc(100% - 256px)";
    });
    await page.getByRole("heading", { level: 1 }).waitFor();
    const result = await page.evaluate(() => {
      const boxes = ["[data-page-header]", "[data-page-body]"].map(selector => {
        const outer = document.querySelector<HTMLElement>(selector)!;
        const inner = outer.querySelector<HTMLElement>("[data-page-container]")!;
        const outerBounds = outer.getBoundingClientRect(), bounds = inner.getBoundingClientRect();
        return { x: bounds.x, right: bounds.right, width: bounds.width, outerX: outerBounds.x, outerRight: outerBounds.right,
          max: getComputedStyle(inner).maxWidth, preset: inner.dataset.pageWidth,
          gutter: getComputedStyle(outer).paddingLeft, rightGutter: getComputedStyle(outer).paddingRight };
      });
      const clipped = [...document.querySelectorAll<HTMLElement>("[data-page-container], [data-page-toolbar], [data-page-filters], [data-page-actions]")]
        .filter(element => element.scrollWidth > element.clientWidth + 1).map(element => element.outerHTML.slice(0, 150));
      return { boxes, clipped, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    expect(result.boxes[0]).toEqual(result.boxes[1]);
    const gutter = width < 640 ? 16 : 24;
    expect(result.boxes[0]).toMatchObject({ max: "1280px", preset: "workbench", gutter: `${gutter}px`, rightGutter: `${gutter}px` });
    const leftSpace = result.boxes[0].x - result.boxes[0].outerX;
    const rightSpace = result.boxes[0].outerRight - result.boxes[0].right;
    expect(leftSpace).toBeGreaterThanOrEqual(gutter);
    expect(leftSpace).toBe(rightSpace);
    expect(result.clipped).toEqual([]);
    expect(result.overflow).toBe(false);
    await browserExpect(page.getByRole("main")).toHaveCount(1);
    await browserExpect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    const toolbar = page.locator("[data-page-toolbar]");
    expect(await toolbar.evaluate(element => Boolean(element.closest("[data-page-body]")) && getComputedStyle(element).position === "static")).toBe(true);
    const targets = await toolbar.locator('button:not([role="checkbox"]), input:not([type="checkbox"]), select, a').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height));
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.every(height => height >= (width < 768 ? 44 : 32))).toBe(true);
    const fields = await toolbar.locator('input:not([type="checkbox"]), select, [role="combobox"]').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height));
    expect(fields.every(height => height >= 44)).toBe(true);
    expect((await calls()).filter((call: any) => call.method !== "GET")).toEqual([]);
  });

  it.each(["drafts", "calendar"])("scrolls the %s toolbar with its content, not with page identity", async surface => {
    await mount(surface, { drafts: Array.from({ length: 16 }, (_, index) => draft(`draft-${index}`)) }, 375);
    if (surface === "drafts") await page.getByTestId("card-draft-draft-0").waitFor();
    else await page.locator("[data-calendar-day]").first().waitFor();
    const positions = await page.evaluate(() => {
      const body = document.querySelector<HTMLElement>("[data-page-body]")!;
      const toolbar = document.querySelector("[data-page-toolbar]")!;
      const header = document.querySelector("[data-page-header]")!;
      const before = { toolbar: toolbar.getBoundingClientRect().y, header: header.getBoundingClientRect().y };
      body.scrollTop = 160;
      return { before, after: { toolbar: toolbar.getBoundingClientRect().y, header: header.getBoundingClientRect().y }, scroll: body.scrollTop };
    });
    expect(positions.scroll).toBe(160);
    expect(positions.after.header).toBe(positions.before.header);
    expect(positions.after.toolbar).toBe(positions.before.toolbar - 160);
  });
});

describe("page adoption: exact draft handoffs and revision safety (authored, isolated browser)", () => {
  it.each(["drafts", "calendar"])("independently resolves an older %s draft outside the 500-row listing", async surface => {
    const older = { ...draft("older/é + ?", "draft", "twitter"), content: "Older exact saved text", updatedAt: "2025-01-01T00:00:00.000Z" };
    await mount(surface, { drafts: Array.from({ length: 500 }, (_, index) => draft(`new-${index}`)), detailDrafts: [older] }, 1280, `/dashboard/${surface === "drafts" ? "content" : "calendar"}?draft=${encodeURIComponent(older.id)}`);
    if (surface === "drafts") {
      await browserExpect(page.locator('[data-linked-draft="true"]')).toContainText(older.content);
      await browserExpect(page.getByTestId(`checkbox-select-${older.id}`)).not.toBeChecked();
      await page.getByTestId(`button-schedule-${older.id}`).click();
      await browserExpect(page.getByTestId("schedule-exact-text")).toHaveText(older.content);
    } else {
      await browserExpect(page.getByRole("combobox", { name: "Draft", exact: true })).toHaveValue(older.id);
      await browserExpect(page.getByTestId("schedule-exact-text")).toHaveText(older.content);
    }
    expect((await calls()).some((call: any) => call.url === `/api/drafts/${encodeURIComponent(older.id)}/details`)).toBe(true);
    expect((await calls()).filter((call: any) => call.method !== "GET")).toEqual([]);
  });
  it.each(["drafts", "calendar"])("retains receipt-projected legacy delivery on the older %s detail", async surface => {
    const older = draft("older", "legacy_unverified");
    await mount(surface, { detailDrafts: [older] }, 1280, `/dashboard/${surface === "drafts" ? "content" : "calendar"}?draft=older`);
    if (surface === "drafts") {
      await browserExpect(page.getByTestId("tab-attention")).toHaveAttribute("aria-pressed", "true");
      await page.getByTestId("button-post-older").click();
      await browserExpect(page.getByTestId("button-copy-and-post")).toBeDisabled();
      await browserExpect(page.getByTestId("button-publish-now")).toBeDisabled();
    } else {
      await browserExpect(page.getByText("This draft is not ready for a new schedule.", { exact: false })).toBeVisible();
      await browserExpect(page.getByRole("dialog")).toHaveCount(0);
    }
    expect((await calls()).filter((call: any) => call.method !== "GET")).toEqual([]);
  });
  it.each([403, 503])("does not call HTTP %s a missing link or fall back to the cached listed draft", async status => {
    await mount("calendar", { detailsError: status }, 1280, "/dashboard/calendar?draft=d");
    await browserExpect(page.getByText("Linked draft could not be checked", { exact: true })).toBeVisible();
    await browserExpect(page.getByText("Linked draft not found", { exact: true })).toHaveCount(0);
    await browserExpect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "Schedule draft", exact: true }).click();
    await browserExpect(page.getByRole("combobox", { name: "Draft", exact: true })).toHaveValue("");
    expect((await calls()).filter((call: any) => call.method !== "GET")).toEqual([]);
  });
  it("closes the previous Calendar draft when a different exact link is still being checked", async () => {
    await mount("calendar", {}, 1280, "/dashboard/calendar?draft=d");
    await browserExpect(page.getByRole("combobox", { name: "Draft", exact: true })).toHaveValue("d");
    await change({ deferDetails: true });
    await page.evaluate(() => (window as any).__navigate("/dashboard/calendar?draft=missing"));
    await browserExpect(page.getByRole("dialog")).toHaveCount(0);
    await browserExpect.poll(() => page.evaluate(() => (window as any).__detailPending.length)).toBe(1);
    await page.evaluate(() => (window as any).__detailPending.shift()());
    await browserExpect(page.getByText("Linked draft not found", { exact: true })).toBeVisible();
    await browserExpect(page.getByRole("dialog")).toHaveCount(0);
    await change({ deferDetails: false });
    await page.evaluate(() => (window as any).__navigate("/dashboard/calendar?draft=d"));
    await browserExpect(page.getByRole("combobox", { name: "Draft", exact: true })).toHaveValue("d");
    await browserExpect(page.getByRole("checkbox", { name: "I confirm this exact text, destinations and timezone." })).not.toBeChecked();
    expect((await calls()).filter((call: any) => call.method !== "GET")).toEqual([]);
  });

  it("refreshes a linked detail after saving without waiting for the periodic list refresh", async () => {
    await mount("drafts", {}, 1280, "/dashboard/content?draft=d");
    await browserExpect(page.locator('[data-linked-draft="true"]')).toContainText(draft().content);
    const readsBefore = (await calls()).filter((call: any) => call.url.endsWith("/details")).length;
    await page.getByTestId("button-menu-d").click(); await page.getByTestId("button-edit-d").click();
    await page.getByLabel("Draft content").fill("Updated linked draft");
    await page.getByTestId("button-save-edit").click();
    await browserExpect(page.getByRole("dialog")).toHaveCount(0);
    await browserExpect(page.locator('[data-linked-draft="true"]')).toContainText("Updated linked draft");
    expect((await calls()).filter((call: any) => call.url.endsWith("/details")).length).toBeGreaterThan(readsBefore);
    expect((await calls()).filter((call: any) => call.method !== "GET").map((call: any) => call.body)).toEqual([
      { content: "Updated linked draft", expectedContent: draft().content, expectedUpdatedAt: draft().updatedAt },
    ]);
  });
  it("highlights only the exact Content draft, retaining siblings, route context and an unselected bulk queue", async () => {
    const linked = draft("saved/é + ?", "draft", "twitter");
    await mount("drafts", { drafts: [draft("first"), linked] }, 375, `/dashboard/content?keep=context&draft=${encodeURIComponent(linked.id)}`);
    const selected = page.locator('[data-linked-draft="true"]');
    await browserExpect(selected).toHaveCount(1);
    await browserExpect(selected.getByTestId(`card-draft-${linked.id}`)).toBeVisible();
    await browserExpect(page.getByTestId("card-draft-first")).toBeVisible();
    await browserExpect(page.getByTestId(`checkbox-select-${linked.id}`)).not.toBeChecked();
    await browserExpect(page.getByRole("dialog")).toHaveCount(0);
    expect((await calls()).filter((call: any) => call.method !== "GET")).toEqual([]);
    expect(new URL(page.url()).searchParams.get("draft")).toBe(linked.id);
    expect(await page.evaluate(() => history.state.retained)).toBe("handoff-context");
    await page.getByTestId("tab-scheduled").click();
    expect(new URL(page.url()).searchParams.get("keep")).toBe("context");
    expect(new URL(page.url()).searchParams.has("draft")).toBe(false);
    await page.getByTestId("tab-ready").click();
    await browserExpect(page.getByTestId(`card-draft-${linked.id}`)).toBeVisible();
  });

  it.each(["scheduled", "unknown", "published"])("selects a linked %s Content record's actual view without opening publishing", async status => {
    await mount("drafts", { drafts: [draft("first"), draft("linked", status)] }, 1280, "/dashboard/content?view=ready&draft=linked");
    const expected = status === "unknown" ? "attention" : status;
    await browserExpect(page.getByTestId(`tab-${expected}`)).toHaveAttribute("aria-pressed", "true");
    await browserExpect(page.locator('[data-linked-draft="true"]')).toContainText("Review this linked post");
    await browserExpect(page.getByRole("dialog")).toHaveCount(0);
    expect((await calls()).filter((call: any) => call.method !== "GET")).toEqual([]);
  });

  it.each(["drafts", "calendar"])("does not substitute a different draft for a missing %s link", async surface => {
    await mount(surface, {}, 375, `/dashboard/${surface === "drafts" ? "content" : "calendar"}?draft=missing&keep=context`);
    await browserExpect(page.getByText("Linked draft not found", { exact: true })).toBeVisible();
    await browserExpect(page.locator('[data-linked-draft="true"]')).toHaveCount(0);
    await browserExpect(page.getByRole("dialog")).toHaveCount(0);
    if (surface === "calendar") {
      await page.getByRole("button", { name: "Schedule draft", exact: true }).click();
      await browserExpect(page.getByRole("combobox", { name: "Draft", exact: true })).toHaveValue("");
      await browserExpect(page.getByTestId("schedule-exact-text")).toHaveCount(0);
      await browserExpect(page.getByRole("button", { name: /^Schedule\s+platforms$/ })).toBeDisabled();
    } else {
      await browserExpect(page.getByTestId("card-draft-d")).toBeVisible();
      await browserExpect(page.getByTestId("checkbox-select-d")).not.toBeChecked();
    }
    expect((await calls()).filter((call: any) => call.method !== "GET")).toEqual([]);
  });

  it("keeps a failed deep-link read distinct from a missing draft and selects only after retry", async () => {
    await mount("drafts", { detailsError: 503 }, 1280, "/dashboard/content?draft=d");
    await browserExpect(page.getByRole("alert")).toContainText("Linked draft could not be checked");
    await browserExpect(page.getByText("Linked draft not found", { exact: true })).toHaveCount(0);
    await change({ detailsError: false });
    await page.getByRole("button", { name: "Retry linked draft", exact: true }).click();
    await browserExpect(page.locator('[data-linked-draft="true"]')).toContainText(draft().content);
    expect((await calls()).filter((call: any) => call.method !== "GET")).toEqual([]);
  });

  it("opens only the linked Calendar draft and requires destination/text/timezone consent after approval", async () => {
    const linked = { ...draft("target", "draft", "twitter"), content: "Café 🧠 — line one\n#Review https://a.test/a?b=1&c=2" };
    await mount("calendar", { drafts: [draft("first"), linked], profile: { ...fixture().profile, requirePublishReview: true } }, 375, `/dashboard/calendar?draft=${encodeURIComponent(linked.id)}`);
    const dialog = page.getByRole("dialog");
    await browserExpect(dialog.getByRole("combobox", { name: "Draft", exact: true })).toHaveValue(linked.id);
    await browserExpect(dialog.getByTestId("schedule-exact-text")).toHaveText(linked.content);
    await browserExpect(dialog.getByLabel("Time (Asia/Kolkata)", { exact: true })).toHaveValue("18:45");
    expect((await calls()).filter((call: any) => call.method !== "GET")).toEqual([]);
    await dialog.getByLabel("Date", { exact: true }).fill("2026-09-20");
    await dialog.getByRole("button", { name: "I reviewed this exact draft — approve publishing" }).click();
    await browserExpect(dialog.getByRole("checkbox", { name: "Twitter/X", exact: true })).toBeChecked();
    await browserExpect(dialog.getByRole("checkbox", { name: "LinkedIn", exact: true })).not.toBeChecked();
    const submit = dialog.getByRole("button", { name: "Schedule 1 platform", exact: true });
    await browserExpect(submit).toBeDisabled();
    await dialog.getByRole("checkbox", { name: "I confirm this exact text, destinations and timezone." }).check();
    await submit.click();
    const writes = (await calls()).filter((call: any) => call.method !== "GET");
    expect(writes.map((call: any) => call.url)).toEqual([`/api/drafts/${encodeURIComponent(linked.id)}/approve-publishing`, `/api/drafts/${encodeURIComponent(linked.id)}/schedule`]);
    expect(writes[1].body).toEqual({ platforms: ["twitter"], publishAt: "2026-09-20T13:15:00.000Z", consent: consentForFixture(linked) });
  });

  it.each(["scheduled", "unknown"])("highlights an existing %s Calendar schedule rather than creating another", async status => {
    const existing = schedule([status], status, "linked");
    await mount("calendar", { drafts: [draft("first"), draft("linked", status)], schedules: [existing] }, 1280, "/dashboard/calendar?draft=linked");
    await browserExpect(page.getByRole("button", { name: "list", exact: true })).toHaveAttribute("aria-pressed", "true");
    await browserExpect(page.locator('article[data-linked-draft="true"]')).toContainText("Linked draft schedule");
    await browserExpect(page.getByRole("dialog")).toHaveCount(0);
    await browserExpect(page.getByRole("link", { name: "Review linked draft in Content" })).toHaveAttribute("href", "/dashboard/content?draft=linked");
    expect((await calls()).filter((call: any) => call.method !== "GET")).toEqual([]);
  });

  it("never replaces the captured editing baseline with background cache data, including after a failed conflict read", async () => {
    const original = draft();
    const newer = { ...original, content: "Remote saved wording", updatedAt: "2026-09-17T09:30:00.000Z" };
    await mount();
    await page.getByTestId("button-menu-d").click(); await page.getByTestId("button-edit-d").click();
    await page.getByLabel("Draft content").fill("My local wording");
    await change({ drafts: [newer] }, true);
    await browserExpect(page.getByLabel("Draft content")).toHaveValue("My local wording");
    await page.getByTestId("button-save-edit").click();
    await browserExpect(page.getByRole("dialog")).toContainText("Draft changed elsewhere");
    await browserExpect(page.getByTestId("button-save-edit")).toBeDisabled();
    let writes = (await calls()).filter((call: any) => call.method === "PATCH");
    expect(writes.map((call: any) => call.body)).toEqual([{ content: "My local wording", expectedContent: original.content, expectedUpdatedAt: original.updatedAt }]);
    await change({ snapshotError: true });
    await page.getByRole("button", { name: "Check latest draft", exact: true }).click();
    await browserExpect(page.getByRole("dialog")).toContainText("Cached data is not confirmation");
    await browserExpect(page.getByLabel("Draft content")).toHaveValue("My local wording");
    await browserExpect(page.getByTestId("button-save-edit")).toBeDisabled();
    await change({ snapshotError: false });
    await page.getByRole("button", { name: "Check latest draft", exact: true }).click();
    await browserExpect(page.getByRole("dialog")).toContainText(newer.content);
    await browserExpect(page.getByTestId("button-save-edit")).toBeDisabled();
    expect((await calls()).filter((call: any) => call.method === "PATCH")).toHaveLength(1);
    await page.getByRole("button", { name: "Use reviewed latest as baseline", exact: true }).click();
    await page.getByTestId("button-save-edit").click();
    writes = (await calls()).filter((call: any) => call.method === "PATCH");
    expect(writes[1].body).toEqual({ content: "My local wording", expectedContent: newer.content, expectedUpdatedAt: newer.updatedAt });
  });
});

describe("UX-22 shared Content manual handoff (authored, isolated browser)", () => {
  it("synchronously blocks direct POST while clipboard is pending, then permits only the original manual opening", async () => {
    await mount("drafts", { deferClipboard: true }); await openPublish();
    await page.evaluate(() => {
      (document.querySelector('[data-testid="button-copy-and-post"]') as HTMLButtonElement).click();
      (document.querySelector('[data-testid="button-publish-now"]') as HTMLButtonElement).click();
    });
    await browserExpect.poll(() => page.evaluate(() => (window as any).__clipboardPending.length)).toBe(1);
    await browserExpect(page.getByTestId("button-publish-now")).toBeDisabled();
    expect((await calls()).filter((call: any) => call.method !== "GET")).toEqual([]);
    expect(await page.evaluate(() => (window as any).__handoffs)).toEqual([]);
    await page.evaluate(() => (window as any).__clipboardPending.shift()());
    await browserExpect.poll(() => page.evaluate(() => (window as any).__handoffs.length)).toBe(1);
    expect((await calls()).filter((call: any) => call.method !== "GET")).toEqual([]);
  });
  it("blocks same-turn manual opening after direct admission, including after direct delivery completes", async () => {
    await mount("drafts", { deferPublish: true, postSchedules: [schedule(["published"], "published")] }); await openPublish();
    await page.evaluate(() => {
      (document.querySelector('[data-testid="button-publish-now"]') as HTMLButtonElement).click();
      (document.querySelector('[data-testid="button-copy-and-post"]') as HTMLButtonElement).click();
    });
    expect((await calls()).filter((call: any) => call.method !== "GET")).toHaveLength(1);
    expect(await page.evaluate(() => ({ opens: (window as any).__opens, copies: (window as any).__copies }))).toEqual({ opens: [], copies: [] });
    await page.evaluate(() => (window as any).__directPending.shift()());
    await browserExpect(page.getByRole("dialog")).toContainText("All targets are recorded as published");
    await browserExpect(page.getByTestId("button-copy-and-post")).toBeDisabled();
    await page.getByTestId("button-copy-and-post").evaluate((element: HTMLButtonElement) => element.click());
    expect(await page.evaluate(() => (window as any).__handoffs)).toEqual([]);
  });
  it.each([
    { label: "text change", update: { drafts: [{ ...draft(), content: "Changed during permission prompt" }] } },
    { label: "unchanged text with new revision", update: { drafts: [{ ...draft(), updatedAt: "2026-09-17T09:30:00.000Z" }] } },
    { label: "unsafe target state", update: { schedules: [schedule(["unknown"], "unknown")] } },
    { label: "failed status read", update: { scheduleError: true } },
    { label: "refetch of unchanged content", update: {} },
  ])("closes a real fake popup without external handoff after $label while clipboard is pending", async ({ update }) => {
    await mount("drafts", { deferClipboard: true }); await openPublish();
    await page.getByTestId("button-copy-and-post").click();
    await browserExpect.poll(() => page.evaluate(() => (window as any).__clipboardPending.length)).toBe(1);
    await change(update, true);
    await page.evaluate(() => (window as any).__clipboardPending.shift()());
    await browserExpect.poll(() => page.evaluate(() => (window as any).__popupCloses)).toBe(1);
    expect(await page.evaluate(() => (window as any).__handoffs)).toEqual([]);
    await browserExpect(page.getByRole("link", { name: /^Continue to/ })).toHaveCount(0);
    expect((await calls()).filter((call: any) => call.method !== "GET")).toEqual([]);
  });
  it("prevents an old draft's pending clipboard from opening after switching publishing dialogs", async () => {
    await mount("drafts", { drafts: [draft(), draft("other")], deferClipboard: true }); await openPublish();
    await page.getByTestId("button-copy-and-post").click();
    await browserExpect.poll(() => page.evaluate(() => (window as any).__clipboardPending.length)).toBe(1);
    await page.getByTestId("button-cancel-post").click(); await page.getByTestId("button-post-other").click();
    await page.evaluate(() => (window as any).__clipboardPending.shift()());
    await browserExpect.poll(() => page.evaluate(() => (window as any).__popupCloses)).toBe(1);
    expect(await page.evaluate(() => (window as any).__handoffs)).toEqual([]);
    await browserExpect(page.getByTestId("button-publish-now")).toBeEnabled();
    expect((await calls()).filter((call: any) => call.method !== "GET")).toEqual([]);
  });
  it("hands off exact latest Unicode, whitespace, links and hashtags without changing saved media or delivery", async () => {
    const media = [{ id: "asset", type: "image", name: "Review image", url: "/image.png" }];
    await mount("drafts", { drafts: [{ ...draft("d", "draft", "twitter"), media }] });
    await page.getByTestId("button-post-d").click();
    const latest = { ...draft("d", "draft", "twitter"), content: "  Café 🧠 e\u0301\nExact links: https://a.test/a?b=1&c=2 #Review\n", media, updatedAt: "2026-09-17T09:30:00.000Z" };
    await change({ drafts: [latest] }, true);
    await browserExpect(page.getByRole("dialog")).toContainText("image: Review image");
    await browserExpect(page.getByRole("dialog")).toContainText("Media must be attached there separately");
    await page.getByTestId("button-copy-and-post").click();
    await browserExpect(page.getByRole("dialog")).toContainText("Post text copied. Opening Twitter/X");
    const result = await page.evaluate(() => ({ copies: (window as any).__copies, handoffs: (window as any).__handoffs, saved: (window as any).__state.drafts[0] }));
    expect(result.copies).toEqual([latest.content]);
    expect(new URL(result.handoffs[0].href).searchParams.get("text")).toBe(latest.content);
    expect(result.handoffs[0]).toMatchObject({ rel: "noopener noreferrer", referrerPolicy: "no-referrer" });
    expect(result.saved).toEqual(latest);
    expect((await calls()).filter((call: any) => call.method !== "GET")).toEqual([]);
  });

  it.each(["popupBlocked", "popupThrows"])("provides explicit latest-text recovery for %s and resets copied status after edits", async popupFailure => {
    const original = draft("d", "draft", "twitter");
    await mount("drafts", { drafts: [original], [popupFailure]: true });
    await page.getByTestId("button-post-d").click();
    await page.getByTestId("button-copy-and-post").click();
    const recovery = page.getByRole("link", { name: "Continue to Twitter/X", exact: true });
    await browserExpect(recovery).toBeVisible();
    await browserExpect(page.getByRole("dialog")).toContainText("new tab could not be opened");
    expect(new URL((await recovery.getAttribute("href"))!).searchParams.get("text")).toBe(original.content);
    const updated = { ...original, content: "Latest 🧠 revision #Two", updatedAt: "2026-09-17T09:30:00.000Z" };
    await change({ drafts: [updated] }, true);
    await browserExpect(recovery).toHaveCount(0);
    await browserExpect(page.getByRole("dialog").getByText(/Post text copied/)).toHaveCount(0);
    await change({ drafts: [original] }, true); // Returning to old text must not resurrect old copy feedback.
    await browserExpect(recovery).toHaveCount(0);
    await page.getByTestId("button-copy-and-post").click();
    await browserExpect(recovery).toBeVisible();
    expect((await calls()).filter((call: any) => call.method !== "GET")).toEqual([]);
  });

  it.each(["clipboardError", "clipboardMissing"])("keeps %s text selectable and removes stale recovery on a revision change", async clipboardFailure => {
    const original = { ...draft("d", "draft", "medium"), content: "  Exact 🧠 copy\n#Review  " };
    await mount("drafts", { drafts: [original], [clipboardFailure]: true });
    await page.getByTestId("button-post-d").click();
    await page.getByTestId("button-copy-and-post").click();
    const fallback = page.getByRole("textbox", { name: "Text to copy for Medium" });
    await browserExpect(fallback).toHaveValue(original.content);
    await browserExpect(fallback).toHaveAttribute("readonly", "");
    await fallback.focus();
    expect(await fallback.evaluate((element: HTMLTextAreaElement) => element.selectionEnd - element.selectionStart)).toBe(original.content.length);
    expect(await page.evaluate(() => (window as any).__handoffs)).toEqual([]);
    expect(await page.evaluate(() => (window as any).__popupCloses)).toBe(1);
    await change({ drafts: [{ ...original, content: "New exact text" }] }, true);
    await browserExpect(fallback).toHaveCount(0);
    await browserExpect(page.getByRole("link", { name: /Continue to Medium/ })).toHaveCount(0);
    expect((await calls()).filter((call: any) => call.method !== "GET")).toEqual([]);
  });

  it.each(["scheduled", "unknown", "partial", "published"])("disables handoff and removes recovery links when background delivery becomes %s", async state => {
    await mount("drafts", { popupBlocked: true });
    await openPublish(); await page.getByTestId("button-copy-and-post").click();
    await browserExpect(page.getByRole("link", { name: "Continue to LinkedIn", exact: true })).toBeVisible();
    await change({ drafts: [draft("d", state)], schedules: [schedule([state], state)] }, true);
    await browserExpect(page.getByTestId("button-copy-and-post")).toBeDisabled();
    await browserExpect(page.getByRole("link", { name: /^Continue to/ })).toHaveCount(0);
    await page.getByTestId("button-copy-and-post").evaluate((element: HTMLButtonElement) => element.click());
    expect(await page.evaluate(() => (window as any).__copies)).toHaveLength(1);
    expect((await calls()).filter((call: any) => call.method !== "GET")).toEqual([]);
  });

  it("ignores late copy feedback after the current text changes and prevents double handoffs", async () => {
    await mount("drafts", { deferClipboard: true, popupBlocked: true });
    await openPublish();
    await page.getByTestId("button-copy-and-post").evaluate((element: HTMLButtonElement) => { element.click(); element.click(); });
    await browserExpect.poll(() => page.evaluate(() => (window as any).__clipboardPending.length)).toBe(1);
    await change({ drafts: [{ ...draft(), content: "Newer text while clipboard permission is pending" }] }, true);
    await page.evaluate(() => (window as any).__clipboardPending.shift()());
    await browserExpect(page.getByTestId("button-copy-and-post")).toBeEnabled();
    await browserExpect(page.getByRole("link", { name: /^Continue to/ })).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__opens)).toHaveLength(1);
    expect((await calls()).filter((call: any) => call.method !== "GET")).toEqual([]);
  });

  it.each([
    { label: "missing draft", update: { drafts: [] } },
    { label: "failed draft read", update: { draftsError: true } },
    { label: "failed schedule read", update: { scheduleError: true } },
    { label: "stale draft flag with an existing schedule", update: { schedules: [schedule(["unknown"], "unknown")] } },
  ])("blocks clipboard, popup and direct writes for $label while preserving the stale preview", async ({ update }) => {
    await mount(); await openPublish();
    await change(update, true);
    await browserExpect(page.getByTestId("button-copy-and-post")).toBeDisabled();
    await browserExpect(page.getByTestId("button-publish-now")).toBeDisabled();
    await browserExpect(page.getByRole("dialog")).toContainText(draft().content);
    await page.getByTestId("button-copy-and-post").evaluate((element: HTMLButtonElement) => element.click());
    expect(await page.evaluate(() => ({ copies: (window as any).__copies, opens: (window as any).__opens }))).toEqual({ copies: [], opens: [] });
    expect((await calls()).filter((call: any) => call.method !== "GET")).toEqual([]);
  });
});

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
    await mount("drafts", { drafts: [draft("d", "draft", "substack")], clipboardError: true });
    await page.getByTestId("button-post-d").click();
    await browserExpect(page.getByTestId("button-publish-now")).toBeDisabled();
    await browserExpect(page.getByRole("dialog")).toContainText("you must publish there yourself");
    await page.getByTestId("button-copy-and-post").click();
    expect(await page.evaluate(() => (window as any).__handoffs)).toEqual([]);
    expect(await page.evaluate(() => (window as any).__opens)).toEqual([["about:blank", "_blank"]]);
    expect(await page.evaluate(() => (window as any).__popupCloses)).toBe(1);
    await browserExpect(page.getByRole("textbox", { name: "Text to copy for Substack Notes" })).toHaveValue(draft("d", "draft", "substack").content);
    await change({ clipboardError: false });
    await page.getByTestId("button-copy-and-post").click();
    expect(await page.evaluate(() => (window as any).__copies)).toHaveLength(1);
    expect((await calls()).filter((call: any) => call.method !== "GET")).toEqual([]);
  });
  it("uses profile zone and preferred time for modal scheduling despite a different browser zone", async () => {
    await mount("modal");
    await browserExpect(page.getByLabel("Publication Time (Asia/Kolkata)")).toHaveValue("18:45");
    await page.getByLabel("Publication Date").fill("2026-09-20");
    await page.getByRole("checkbox", { name: "I confirm this exact text, destinations and timezone." }).check();
    await page.getByRole("button", { name: "Schedule Article", exact: true }).click();
    await browserExpect.poll(async () => (await calls()).filter((call: any) => call.method === "POST").length).toBe(1);
    expect((await calls()).find((call: any) => call.method === "POST").body).toEqual({ publishAt: "2026-09-20T13:15:00.000Z", platforms: ["linkedin"], consent: consentForFixture() });
  });
  it("uses the same timezone/defaults in bulk scheduling", async () => {
    await mount();
    await page.getByLabel("Select LinkedIn draft", { exact: true }).click();
    await page.getByRole("button", { name: "Schedule 1 selected" }).click();
    await browserExpect(page.getByLabel("Time (Asia/Kolkata)", { exact: true })).toHaveValue("18:45");
    await page.getByLabel("Date", { exact: true }).fill("2026-09-20");
    await page.getByRole("checkbox", { name: "I confirm these texts, destinations and timezone." }).check();
    await page.getByRole("button", { name: "Schedule 1 drafts", exact: true }).click();
    await browserExpect.poll(async () => (await calls()).filter((call: any) => call.method === "POST").length).toBe(1);
    expect((await calls()).find((call: any) => call.method === "POST").body).toMatchObject({ publishAt: "2026-09-20T13:15:00.000Z", draftIds: ["d"] });
  });
  it("honors Calendar defaults, allows available Bluesky, and prevents a fifth target or manual schedule", async () => {
    await mount("calendar");
    await page.getByRole("button", { name: "Schedule draft", exact: true }).click();
    await browserExpect(page.getByLabel("Time (Asia/Kolkata)", { exact: true })).toHaveValue("18:45");
    await browserExpect(page.getByRole("checkbox", { name: "LinkedIn", exact: true })).toBeChecked();
    for (const name of ["Twitter/X", "Bluesky", "Mastodon"]) await page.getByRole("checkbox", { name, exact: true }).check();
    await browserExpect(page.getByRole("checkbox", { name: "Dev.to", exact: true })).toBeDisabled();
    await browserExpect(page.getByRole("checkbox", { name: /Substack/ })).toHaveCount(0);
    await browserExpect(page.getByRole("dialog").locator("details")).toContainText("Substack");
    await page.getByLabel("Date", { exact: true }).fill("2026-09-20");
    await page.getByRole("checkbox", { name: "I confirm this exact text, destinations and timezone." }).check();
    await page.getByRole("button", { name: "Schedule 4 platforms", exact: true }).click();
    await browserExpect.poll(async () => (await calls()).filter((call: any) => call.method === "POST").length).toBe(1);
    expect((await calls()).find((call: any) => call.method === "POST").body.platforms).toEqual(["linkedin", "twitter", "bluesky", "mastodon"]);
  });
  it("disables Calendar submission when readiness changes to globally unavailable", async () => {
    await mount("calendar");
    await page.getByRole("button", { name: "Schedule draft", exact: true }).click();
    await browserExpect(page.getByRole("checkbox", { name: "LinkedIn", exact: true })).toBeChecked();
    // Explicitly select it so background preference hydration cannot replace it.
    await page.getByRole("checkbox", { name: "Twitter/X", exact: true }).check();
    await change({ integrations: fixture().integrations.map((item) => ({ ...item, enabled: item.key !== "twitter" })) }, true);
    await browserExpect(page.getByRole("dialog").locator('[data-workflow-status="warning"]').filter({ hasText: "Cannot schedule yet" })).toContainText("Unavailable platform-wide");
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