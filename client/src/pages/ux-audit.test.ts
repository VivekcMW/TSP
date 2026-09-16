import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { chromium, expect as browserExpect, type Browser, type Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
import postcss from "postcss";
import tailwindcss from "tailwindcss";

let browser: Browser;
let page: Page;
let bundle: string;
let css: string;
const root = path.resolve(import.meta.dirname, "../../..");
const progress = { articlesProcessed: 8, articlesMatched: 4, articlesCreated: 2 };
const suggestions = { publications: ["Unlisted AI source"], keywords: ["Unlisted AI topic"], personalities: ["Unlisted AI leader"], companies: ["Unlisted AI company"] };

beforeAll(async () => {
  const result = await build({
    absWorkingDir: root,
    stdin: { resolveDir: root, sourcefile: "ux-audit-harness.tsx", loader: "tsx", contents: `
      import React, { useState } from "react";
      import { createRoot } from "react-dom/client";
      import { QueryClientProvider } from "@tanstack/react-query";
      import { queryClient } from "@/lib/queryClient";
      import Home from "@/pages/overview";
      import { CreatePostProvider } from "@/components/dashboard/create-post-provider";
      import Performance from "@/pages/performance";
      import Onboarding from "@/pages/onboarding";
      import Registration from "@/pages/complete-registration";
      import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
      import { useInboxRefreshJob, refreshJobMessage } from "@/hooks/use-inbox-refresh-job";
      window.__calls = []; window.__completed = []; window.__pending = []; window.__toasts = []; window.__settled = 0;
      window.fetch = async (url, options = {}) => {
        window.__calls.push({ url, method: options.method || "GET", body: options.body ? JSON.parse(options.body) : null, signal: options.signal });
        const targeted = String(url).includes("/refresh") || String(url).includes("analyze-identity");
        const next = targeted ? (window.__responses.shift() || { body: { status: "active", progress: { articlesProcessed: 0, articlesMatched: 0, articlesCreated: 0 } } }) : (window.__errors[url] ? { status: 500, body: { message: "Fixture error" } } : { body: window.__data[url] ?? {} });
        if (next.defer) await new Promise(resolve => window.__pending.push(resolve));
        if (next.networkError) throw new TypeError("Fixture network error");
        const response = new Response(next.rawBody ?? JSON.stringify(next.body), { status: next.status || 200, headers: { "Content-Type": "application/json" } });
        if (next.deferBody) response.json = async () => { await new Promise(resolve => window.__pending.push(resolve)); return next.body; };
        return response;
      };
      for (const [key, value] of Object.entries(window.__data)) if (!window.__errors[key]) queryClient.setQueryData([key], value);
      function RefreshObserver() { const job = useInboxRefreshJob(); return <><output data-testid="shared-refresh" data-status={job.status} data-loading={job.isLoading}>{job.status === "idle" ? "Idle" : refreshJobMessage(job)}</output><button onClick={() => void job.startRefresh().then(() => window.__settled++)}>Start refresh fixture</button><button onClick={job.checkAgain}>Check refresh fixture</button></>; }
      function App() {
        const [surface, setSurface] = useState(window.__surface);
        window.__setSurface = setSurface;
        return <QueryClientProvider client={queryClient}><CreatePostProvider><div style={{ height: "100vh" }}>{surface === "home" ? <Home /> : surface === "performance" ? <Performance /> : surface === "onboarding" ? <Onboarding /> : surface === "registration" ? <Registration existingFirstName="Taylor" existingLastName="Lee" /> : surface === "refresh" ? <RefreshObserver /> : <OnboardingWizard onComplete={data => window.__completed.push(data)} />}</div></CreatePostProvider></QueryClientProvider>;
      }
      createRoot(document.getElementById("root")).render(<App />);
    ` },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"' },
    plugins: [{ name: "mock-ux-boundaries", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/(auth|dev-auth)$|^@\/hooks\/use-toast$|\/instant-review-panel$/ }, args => ({ path: args.path, namespace: "mock" }));
      builder.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents:
        args.path.endsWith("dev-auth") ? "export const useIsSignedIn = () => true;" :
        args.path.endsWith("/auth") ? 'export const useAuth = () => ({user: {firstName: "Taylor"}});' :
        args.path.endsWith("use-toast") ? "export const useToast = () => ({toast: value => window.__toasts.push(value)});" :
        'import React from "react"; export const InstantReviewPanel = ({isOpen, onClose}) => isOpen ? React.createElement("button", {onClick: onClose}, "Close composer fixture") : null;', loader: "js", resolveDir: root }));
    } }],
  });
  bundle = result.outputFiles[0].text;
  css = (await postcss([tailwindcss({ content: [path.join(root, "client/src/pages/{overview,performance,complete-registration}.tsx"), path.join(root, "client/src/components/{onboarding,ui,dashboard}/**/*.tsx")], corePlugins: { preflight: true } })]).process("@tailwind base; @tailwind utilities;", { from: undefined })).css;
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterEach(async () => { await page?.close(); });
afterAll(async () => { await browser?.close(); });

async function mount(surface: string, responses: unknown[] = [], data: Record<string, unknown> = {}, errors: Record<string, boolean> = {}) {
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.route("**/*", route => route.abort());
  await page.route("https://ux.test/", route => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
  await page.goto("https://ux.test/");
  await page.clock.install();
  await page.evaluate(({ surface, responses, data, errors }) => Object.assign(window, { __surface: surface, __responses: responses, __errors: errors, __data: { "/api/inbox": [], "/api/integrations": [], "/api/drafts": [], "/api/profile": { onboardingStatus: "completed" }, "/api/me": { firstName: "Taylor" }, "/api/drafts/scheduled": { items: [] }, "/api/analytics/summary": { connected: { linkedin: false, twitter: false }, combined: { impressions: 0, engagements: 0, engagementRate: 0 } }, ...data } }), { surface, responses, data, errors });
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: bundle });
}
async function calls() {
  return page.evaluate(() => (window as any).__calls.map((call: any) => ({ url: call.url, method: call.method, body: call.body, aborted: call.signal?.aborted })));
}
async function resolvePending() { await page.evaluate(() => (window as any).__pending.shift()()); }

describe("UX audit screens (fully mocked Chromium)", () => {
  it("requires real focus but can finish without optional choices or AI", async () => {
    await mount("wizard");
    const finish = page.getByRole("button", { name: "Skip optional preferences and finish" });
    await browserExpect(finish).toBeDisabled();
    await page.getByLabel("Professional focus").fill("                    ");
    await browserExpect(finish).toBeDisabled();
    await page.getByLabel("Professional focus").fill("Product strategy for small teams");
    await finish.click();
    expect(await page.evaluate(() => (window as any).__completed[0])).toMatchObject({ publications: [], keywords: [], influencers: [], companies: [] });
    expect(await calls()).toEqual([]);
  });
  it("allows skipping each optional screen without triggering AI", async () => {
    await mount("wizard");
    await page.getByLabel("Professional focus").fill("Product strategy for small teams");
    await page.getByRole("button", { name: "Continue without AI" }).click();
    await page.getByRole("button", { name: "Skip sources" }).click();
    await page.getByRole("button", { name: "Skip topics" }).click();
    await page.getByRole("button", { name: "Skip inspiration and finish" }).click();
    expect(await page.evaluate(() => (window as any).__completed)).toHaveLength(1);
    expect(await calls()).toEqual([]);
  });
  it("renders and removes every out-of-catalog AI choice and custom choice", async () => {
    await mount("wizard", [{ body: suggestions }]);
    await page.getByLabel("Professional focus").fill("Product strategy for small teams");
    await page.getByRole("button", { name: "Suggest preferences with AI" }).click();
    await page.getByRole("button", { name: "Remove source Unlisted AI source" }).click();
    await page.getByRole("button", { name: "Skip sources" }).click();
    await page.getByRole("button", { name: "Remove topic Unlisted AI topic" }).click();
    await page.getByLabel("Custom topic").fill("My own topic");
    await page.getByTestId("button-add-keyword").click();
    await page.getByRole("button", { name: "Remove topic My own topic" }).click();
    await page.getByRole("button", { name: "Skip topics" }).click();
    await page.getByRole("button", { name: "Remove leader Unlisted AI leader" }).click();
    await page.getByRole("button", { name: "Remove company Unlisted AI company" }).click();
    await page.getByRole("button", { name: "Skip inspiration and finish" }).click();
    expect(await page.evaluate(() => (window as any).__completed[0])).toMatchObject({ publications: [], keywords: [], influencers: [], companies: [] });
  });
  it("aborts suggestions and ignores late results after cancellation", async () => {
    await mount("wizard", [{ defer: true, body: suggestions }]);
    await page.getByLabel("Professional focus").fill("Product strategy for small teams");
    await page.getByRole("button", { name: "Suggest preferences with AI" }).click();
    await page.getByRole("button", { name: "Cancel suggestions" }).click();
    expect((await calls())[0].aborted).toBe(true);
    await resolvePending();
    await browserExpect(page.getByTestId("section-identity")).toBeVisible();
    await page.getByRole("button", { name: "Continue without AI" }).click();
    expect(await page.getByRole("button", { name: "Remove source Unlisted AI source" }).count()).toBe(0);
  });
  it("times out AI without auto-selecting defaults or advancing", async () => {
    await mount("wizard", [{ defer: true, body: suggestions }]);
    await page.getByLabel("Professional focus").fill("Product strategy for small teams");
    await page.getByRole("button", { name: "Suggest preferences with AI" }).click();
    await page.clock.runFor(15_100);
    await browserExpect(page.getByTestId("section-identity")).toBeVisible();
    expect((await calls())[0].aborted).toBe(true);
    await resolvePending();
    expect(await page.evaluate(() => (window as any).__toasts.map((toast: any) => toast.title))).toContain("Suggestions took too long");
  });
  it("doesn't demand LinkedIn and collapses the optional Home checklist", async () => {
    await mount("home");
    expect(await page.getByTestId("card-attention-required").count()).toBe(0);
    await browserExpect(page.getByTestId("optional-setup-checklist")).not.toHaveAttribute("open", "");
    await page.getByTestId("button-overview-instant-review").click();
    await browserExpect(page.getByRole("button", { name: "Close composer fixture" })).toBeVisible();
    await page.getByText("Optional setup and shortcuts", { exact: true }).click();
    await browserExpect(page.getByRole("link", { name: "Connect an account for direct publishing (optional)" })).toBeVisible();
  });
  it("aborts on navigation without a late timeout toast", async () => {
    await mount("wizard", [{ defer: true, body: suggestions }]);
    await page.getByLabel("Professional focus").fill("Product strategy for small teams");
    await page.getByRole("button", { name: "Suggest preferences with AI" }).click();
    await page.evaluate(() => (window as any).__setSurface("home"));
    await browserExpect(page.getByTestId("button-overview-refresh")).toBeVisible();
    expect((await calls())[0].aborted).toBe(true);
    await page.clock.runFor(16_000);
    await resolvePending();
    expect(await page.evaluate(() => (window as any).__toasts)).toEqual([]);
  });
  it("keeps AI failure optional and does not claim registration is the last step", async () => {
    await mount("wizard", [{ status: 500, body: { message: "Fixture unavailable" } }]);
    await page.getByLabel("Professional focus").fill("Product strategy for small teams");
    await page.getByRole("button", { name: "Suggest preferences with AI" }).click();
    await browserExpect(page.getByRole("button", { name: "Suggest preferences with AI" })).toBeEnabled();
    await page.getByRole("button", { name: "Skip optional preferences and finish" }).click();
    expect(await page.evaluate(() => (window as any).__completed[0].publications)).toEqual([]);
    await page.evaluate(() => (window as any).__setSurface("registration"));
    await browserExpect(page.getByText("Workspace basics", { exact: true })).toBeVisible();
    expect(await page.getByText(/One last step/).count()).toBe(0);
  });
  it("wraps long selected labels and final onboarding actions at 320px", async () => {
    await mount("wizard", [{ body: { ...suggestions, publications: ["A".repeat(100)] } }]);
    await page.setViewportSize({ width: 320, height: 844 });
    await page.getByLabel("Professional focus").fill("Product strategy for small teams");
    await page.getByRole("button", { name: "Suggest preferences with AI" }).click();
    await browserExpect(page.getByRole("button", { name: `Remove source ${"A".repeat(100)}` })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByTestId("button-continue").click();
    await page.getByTestId("button-continue").click();
    await page.getByRole("button", { name: "Remove leader Unlisted AI leader" }).click();
    await page.getByRole("button", { name: "Remove company Unlisted AI company" }).click();
    await browserExpect(page.getByRole("button", { name: "Skip inspiration and finish" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
  it("sorts upcoming records and reports real target failures only once", async () => {
    const schedule = (id: string, day: number) => ({ id, draftId: id, status: "scheduled", scheduledPublishAt: new Date(2026, 8, day).toISOString(), draft: { content: id, platform: "twitter" } });
    await mount("home", [], { "/api/drafts": [{ id: "failed", publishStatus: "failed" }], "/api/drafts/scheduled": { items: [schedule("Later", 22), schedule("Sooner", 20), { ...schedule("failed", 21), status: "failed", targets: [{ platform: "twitter", status: "failed" }] }] } });
    await browserExpect(page.getByTestId("card-attention-required")).toContainText("Review 1 failed post");
    expect(await page.getByTestId("card-upcoming-publishing").locator("p.font-medium").allTextContents()).toEqual(["Sooner", "Later"]);
  });
  it("waits for async completion, shares progress across mounts, and stops polling", async () => {
    await mount("home", [{ body: { jobId: "job-1" } }, { body: { status: "active", progress } }, { body: { status: "completed", progress } }]);
    await page.getByTestId("button-overview-refresh").click();
    await browserExpect(page.getByRole("status")).toContainText("Refresh queued");
    expect((await calls()).filter((call: any) => call.url === "/api/inbox")).toHaveLength(0);
    expect(await page.evaluate(() => (window as any).__toasts)).toEqual([]);
    await page.evaluate(() => (window as any).__setSurface("refresh"));
    await page.clock.runFor(3200);
    await browserExpect(page.getByTestId("shared-refresh")).toContainText("2 new articles added");
    const count = (await calls()).length;
    await page.clock.runFor(5000);
    expect(await calls()).toHaveLength(count);
  });
  it("shows failed refreshes without a success toast or result invalidation", async () => {
    await mount("home", [{ body: { jobId: "job-2" } }, { body: { status: "failed", progress, error: "Worker failed" } }]);
    await page.getByTestId("button-overview-refresh").click();
    await page.clock.runFor(1700);
    await browserExpect(page.getByRole("alert")).toContainText("Worker failed");
    expect((await calls()).filter((call: any) => call.url === "/api/inbox")).toHaveLength(0);
  });
  it.each([
    { error: "Source processing failed" },
    { errors: ["Source processing failed", "No usable feeds"] },
    {},
  ])("treats Bull completion with success:false as failure (%j)", async (details) => {
    await mount("home", [{ body: { jobId: "job-engine-failure" } }, { body: { status: "completed", progress: { ...progress, success: false, ...details } } }]);
    await page.getByTestId("button-overview-refresh").click();
    await page.clock.runFor(1700);
    await browserExpect(page.getByRole("alert")).toContainText("error" in details || "errors" in details ? "Source processing failed" : "Refresh failed");
    expect(await page.getByText(/new articles added|Refresh finished/).count()).toBe(0);
    expect((await calls()).filter((call: any) => call.url === "/api/inbox")).toHaveLength(0);
    expect(await page.evaluate(() => (window as any).__toasts)).toEqual([]);
    const count = (await calls()).length;
    await page.clock.runFor(5000);
    expect(await calls()).toHaveLength(count);
  });
  it.each(["defer", "deferBody"])("bounds a hung admission %s and ignores its late success", async (defer) => {
    await mount("refresh", [{ [defer]: true, body: { jobId: "late-job" } }]);
    await page.getByRole("button", { name: "Start refresh fixture" }).click();
    await page.clock.runFor(14_000);
    await browserExpect(page.getByTestId("shared-refresh")).toHaveAttribute("data-status", "queued");
    expect(await page.evaluate(() => (window as any).__settled)).toBe(0);
    await page.clock.runFor(1100);
    await browserExpect(page.getByTestId("shared-refresh")).toHaveAttribute("data-status", "unavailable");
    await browserExpect(page.getByTestId("shared-refresh")).toHaveAttribute("data-loading", "false");
    expect(await page.evaluate(() => (window as any).__settled)).toBe(1);
    expect((await calls())[0].aborted).toBe(true);
    await page.getByRole("button", { name: "Start refresh fixture" }).click();
    await page.getByRole("button", { name: "Check refresh fixture" }).click();
    await browserExpect(page.getByTestId("shared-refresh")).toContainText("can't check this refresh's status");
    // The fixture deliberately ignores abort to exercise a late transport response.
    await resolvePending();
    await page.clock.runFor(130_000);
    await browserExpect(page.getByTestId("shared-refresh")).toHaveAttribute("data-status", "unavailable");
    expect((await calls()).filter((call: any) => call.method === "POST")).toHaveLength(1);
    expect((await calls()).filter((call: any) => call.url.includes("/refresh/"))).toEqual([]);
  });
  it("shows timed-out admission on Home and honestly reloads results without re-enqueueing", async () => {
    await mount("home", [{ defer: true, body: { count: 2 } }]);
    await page.getByTestId("button-overview-refresh").click();
    await page.clock.runFor(15_100);
    await browserExpect(page.getByRole("status")).toContainText("no job ID was received");
    await browserExpect(page.getByTestId("button-overview-refresh")).toBeDisabled();
    await browserExpect(page.getByTestId("button-overview-refresh")).toHaveText("Refresh articles");
    await page.getByRole("button", { name: "Check status" }).click();
    await browserExpect(page.getByRole("status")).toContainText("does not confirm completion");
    await browserExpect.poll(async () => (await calls()).filter((call: any) => call.url === "/api/inbox").length).toBe(1);
    await resolvePending();
    await page.clock.runFor(5000);
    await browserExpect(page.getByRole("status")).toContainText("Another refresh remains blocked");
    expect((await calls()).filter((call: any) => call.method === "POST")).toHaveLength(1);
    expect((await calls()).filter((call: any) => call.url === "/api/inbox")).toHaveLength(1);
    expect(await page.evaluate(() => (window as any).__toasts)).toEqual([]);
  });
  it.each([400, 401, 403, 422, 429])("permits an explicit retry after definite admission rejection %s", async (status) => {
    await mount("home", [{ status, body: { message: "Request rejected" } }, { body: { count: 0, needsSetup: true } }]);
    await page.getByTestId("button-overview-refresh").click();
    await browserExpect(page.getByRole("alert")).toContainText("Request rejected");
    await browserExpect(page.getByTestId("button-overview-refresh")).toBeEnabled();
    await page.clock.runFor(16_000);
    expect((await calls())[0].aborted).toBe(false);
    expect((await calls()).filter((call: any) => call.method === "POST")).toHaveLength(1);
    await page.getByTestId("button-overview-refresh").click();
    await browserExpect(page.getByRole("status")).toContainText("Add a source or topic");
    expect((await calls()).filter((call: any) => call.method === "POST")).toHaveLength(2);
  });
  it.each([
    { networkError: true },
    { status: 408, body: { message: "Timed out" } },
    { status: 500, body: { message: "Queue error" } },
    { status: 502, body: { message: "Gateway error" } },
    { status: 503, body: { message: "Unavailable" } },
    { status: 504, body: { message: "Gateway timeout" } },
    { rawBody: "not json" },
    { body: {} },
    { body: null },
    { body: { status: "queued" } },
    { body: { jobId: {}, count: 0 } },
  ])("blocks duplicate enqueue after uncertain admission (%j)", async (response) => {
    await mount("refresh", [response]);
    await page.getByRole("button", { name: "Start refresh fixture" }).click();
    await browserExpect(page.getByTestId("shared-refresh")).toHaveAttribute("data-status", "unavailable");
    await browserExpect(page.getByTestId("shared-refresh")).toContainText("Couldn't confirm whether the refresh started");
    await page.getByRole("button", { name: "Start refresh fixture" }).click();
    await page.getByRole("button", { name: "Check refresh fixture" }).click();
    await page.getByRole("button", { name: "Start refresh fixture" }).click();
    await page.clock.runFor(16_000);
    await browserExpect(page.getByTestId("shared-refresh")).toHaveAttribute("data-status", "unavailable");
    expect((await calls()).filter((call: any) => call.method === "POST")).toHaveLength(1);
    expect((await calls()).filter((call: any) => call.url.includes("/refresh/"))).toEqual([]);
  });
  it("clears the admission timer after acceptance and preserves the job watchdog", async () => {
    await mount("home", [{ body: { jobId: "job-slow" } }]);
    await page.getByTestId("button-overview-refresh").click();
    await page.clock.runFor(16_000);
    expect((await calls())[0].aborted).toBe(false);
    await browserExpect(page.getByRole("status")).toContainText("Checking articles");
    await page.clock.runFor(106_000);
    await browserExpect(page.getByRole("status")).toContainText("taking longer than expected");
    const count = (await calls()).length;
    await page.clock.runFor(5000);
    expect(await calls()).toHaveLength(count);
    await page.evaluate(progress => (window as any).__responses.push({ body: { status: "completed", progress } }), progress);
    await page.getByRole("button", { name: "Check status" }).click();
    await page.clock.runFor(1700);
    await browserExpect(page.getByRole("status")).toContainText("2 new articles added");
    expect((await calls()).filter((call: any) => call.method === "POST")).toHaveLength(1);
    expect((await calls()).filter((call: any) => call.url.includes("/refresh/")).every((call: any) => call.url.endsWith("/job-slow"))).toBe(true);
  });
  it("supports synchronous needs-setup responses without claiming articles exist", async () => {
    await mount("home", [{ body: { count: 0, needsSetup: true } }]);
    await page.getByTestId("button-overview-refresh").click();
    await browserExpect(page.getByRole("status")).toContainText("Add a source or topic");
    await browserExpect(page.getByTestId("button-overview-refresh")).toBeEnabled();
    expect((await calls()).filter((call: any) => call.url.includes("/refresh/"))).toEqual([]);
  });
  it("handles initial numeric progress without inventing completion counts", async () => {
    await mount("home", [{ body: { jobId: "job-numeric" } }, { body: { status: "active", progress: 0 } }, { body: { status: "completed", progress: 0 } }]);
    await page.getByTestId("button-overview-refresh").click();
    await page.clock.runFor(1700);
    await browserExpect(page.getByRole("status")).toContainText("0 processed");
    await page.clock.runFor(1700);
    await browserExpect(page.getByRole("status")).toContainText("detailed counts are unavailable");
    expect(await page.getByText(/0 new articles added/).count()).toBe(0);
  });
  it("stops on an expired status lookup and checks the same job without requeuing", async () => {
    await mount("home", [{ body: { jobId: "job-expired" } }, { status: 404, body: { message: "Expired" } }, { body: { status: "completed", progress } }]);
    await page.getByTestId("button-overview-refresh").click();
    await page.clock.runFor(1700);
    await browserExpect(page.getByRole("status")).toContainText("may still be running");
    await browserExpect(page.getByTestId("button-overview-refresh")).toBeDisabled();
    const count = (await calls()).length;
    await page.clock.runFor(5000);
    expect(await calls()).toHaveLength(count);
    await page.getByRole("button", { name: "Check status" }).click();
    await page.clock.runFor(1700);
    await browserExpect(page.getByRole("status")).toContainText("2 new articles added");
    expect((await calls()).filter((call: any) => call.method === "POST")).toHaveLength(1);
  });
  it("shows real zero publishing counts but never measured zero engagement", async () => {
    await mount("performance", [], { "/api/analytics/summary": { connected: { linkedin: true, twitter: false }, linkedin: { metrics: { impressions: 0 } }, combined: { engagementRate: 0 } } });
    await browserExpect(page.getByText("No published records in this period")).toBeVisible();
    await browserExpect(page.getByText("Engagement data unavailable", { exact: true })).toBeVisible();
    expect(await page.getByText("0%", { exact: true }).count()).toBe(0);
    await browserExpect(page.getByText(/placeholders, not measured zeroes/)).toBeVisible();
  });
  it("doesn't turn failed data requests into empty-state zeroes", async () => {
    await mount("performance", [], {}, { "/api/drafts": true, "/api/analytics/summary": true });
    await browserExpect(page.getByText(/Counts are unavailable, not zero/)).toBeVisible();
    await browserExpect(page.getByText(/not a zero-engagement result/)).toBeVisible();
    expect(await page.getByText("No published records in this period").count()).toBe(0);
  });
  it("updates the publishing range and fits the chart within a mobile viewport", async () => {
    const recent = new Date(); recent.setDate(recent.getDate() - 2);
    const older = new Date(); older.setDate(older.getDate() - 20);
    await mount("performance", [], { "/api/drafts": [recent, older].map((date, index) => ({ id: String(index), platform: "twitter", publishStatus: "published", publishedAt: date.toISOString() })) });
    await page.getByRole("button", { name: "Last 7 calendar days" }).click();
    await browserExpect(page.getByRole("img", { name: "1 published records across the last 7 calendar days" })).toBeVisible();
    await browserExpect.poll(async () => page.locator(".recharts-surface").first().getAttribute("width")).not.toBeNull();
    expect(await page.locator(".recharts-surface").first().evaluate(el => el.getBoundingClientRect().right <= window.innerWidth)).toBe(true);
    await page.getByText("View daily counts", { exact: true }).click();
    await browserExpect(page.getByText(/The date filter applies only to publishing activity/)).toBeVisible();
  });
});