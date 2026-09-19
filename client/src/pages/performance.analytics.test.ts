import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { chromium, expect as browserExpect, type Browser, type Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
import { combineAnalytics, normalizeAnalytics, unavailableAnalytics } from "@shared/analytics-availability";

let browser: Browser;
let page: Page;
let bundle: string;
const root = path.resolve(import.meta.dirname, "../../..");
const instant = "2026-09-18T12:00:00.000Z";
function summary(measured = false) {
  const provider = measured ? normalizeAnalytics({ metrics: { impressions: 0, followers: 10 }, metricAvailability: {
    impressions: { status: "measured", reason: null, supported: true, measuredAt: instant, source: "provider_response", endpoint: "/fixture", sourceField: "impressions", period: null },
  } }) : unavailableAnalytics("unsupported");
  const combined = combineAnalytics([provider]);
  return { connected: { linkedin: true, twitter: false }, combined: combined.metrics, availability: combined.availability, linkedin: { ...provider, account: { id: "fixture", name: "Fixture", handle: "@fixture", lastSync: instant }, topPosts: null, snapshotDate: instant }, twitter: null, lastSync: instant };
}

beforeAll(async () => {
  const result = await build({ absWorkingDir: root, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    stdin: { loader: "tsx", resolveDir: root, contents: `import React from "react"; import { createRoot } from "react-dom/client"; import Performance from "@/pages/performance"; createRoot(document.getElementById("root")).render(<Performance />);` },
    define: { "process.env.NODE_ENV": '"test"' },
    plugins: [{ name: "mock-query-only", setup(builder) {
      builder.onResolve({ filter: /^@tanstack\/react-query$/ }, () => ({ path: "query", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: `export function useQuery({queryKey}) { const key = queryKey[0]; return {...window.__queries[key], refetch: () => { window.__retries.push(key); }}; }`, loader: "js" }));
    } }],
  });
  bundle = result.outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterEach(async () => { await page?.close(); });
afterAll(async () => { await browser?.close(); });

async function mount(drafts: unknown = [], analytics: unknown = summary(), errors: string[] = [], loading = false) {
  page = await browser.newPage({ timezoneId: "America/Los_Angeles", viewport: { width: 390, height: 844 } });
  await page.route("**/*", route => route.abort());
  await page.route("https://analytics.test/", route => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
  await page.goto("https://analytics.test/");
  await page.clock.install({ time: new Date("2026-09-19T12:00:00Z") });
  await page.evaluate(({ drafts, analytics, errors, loading }) => Object.assign(window, { __retries: [], __queries: {
    "/api/drafts": { data: drafts, isError: errors.includes("drafts"), isLoading: loading },
    "/api/analytics/summary": { data: analytics, isError: errors.includes("analytics"), isLoading: loading },
  } }), { drafts, analytics, errors, loading });
  await page.addScriptTag({ content: bundle });
}

describe("Performance analytics with fully mocked responses", () => {
  it("keeps legitimate local zero counts separate from unsupported engagement", async () => {
    await mount();
    await browserExpect(page.getByText("No published records in this period")).toBeVisible();
    await browserExpect(page.getByText("Engagement data unavailable", { exact: true })).toBeVisible();
    await browserExpect(page.getByLabel("Analytics metric availability")).toContainText("impressions: Unavailable");
    expect(await page.locator("time").count()).toBe(0);
    expect(await page.getByText("0%", { exact: true }).count()).toBe(0);
  });
  it("renders verified measured zero with UTC provenance and exact coverage", async () => {
    await mount([], summary(true));
    await browserExpect(page.getByText("Available engagement measurements", { exact: true })).toBeVisible();
    await browserExpect(page.getByLabel("Analytics metric availability")).toContainText("impressions: 0 · Measured");
    await browserExpect(page.getByLabel("Analytics metric availability").locator("time")).toHaveAttribute("datetime", instant);
    await browserExpect(page.getByLabel("Analytics metric availability")).toContainText("(UTC) · 1/1 connected accounts measured");
    await page.getByRole("button", { name: "Last 7 calendar days" }).click();
    await browserExpect(page.getByLabel("Analytics metric availability").locator("time")).toHaveAttribute("datetime", instant);
  });
  it("accepts old partial response shapes only as unverified", async () => {
    await mount([], { connected: { linkedin: true, twitter: false }, combined: { impressions: 0, engagementRate: 0 }, linkedin: { metrics: { impressions: 0 } } });
    await browserExpect(page.getByText("Engagement data unavailable", { exact: true })).toBeVisible();
    await browserExpect(page.getByText(/placeholders, not measured zeroes/)).toBeVisible();
    expect(await page.locator("time").count()).toBe(0);
  });
  it("does not turn a failed activity request into a false empty state", async () => {
    await mount([], summary(true), ["drafts"]);
    await browserExpect(page.getByText(/Counts are unavailable, not zero/)).toBeVisible();
    expect(await page.getByText("No published records in this period").count()).toBe(0);
    await browserExpect(page.getByText("Available engagement measurements", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Retry activity" }).click();
    expect(await page.evaluate(() => (window as any).__retries)).toEqual(["/api/drafts"]);
  });
  it("keeps a summary failure scoped to analytics and allows retry", async () => {
    await mount([], summary(), ["analytics"]);
    await browserExpect(page.getByText(/not a zero-engagement result/)).toBeVisible();
    await browserExpect(page.getByText("No published records in this period")).toBeVisible();
    await page.getByRole("button", { name: "Retry analytics" }).click();
    expect(await page.evaluate(() => (window as any).__retries)).toEqual(["/api/analytics/summary"]);
  });
  it("surfaces a per-provider lookup failure without hiding activity", async () => {
    const data = summary();
    data.linkedin = { ...data.linkedin, ...unavailableAnalytics("fetch_failed") };
    await mount([], data);
    await browserExpect(page.getByRole("alert")).toContainText("Snapshot lookup failed");
    await browserExpect(page.getByText("No published records in this period")).toBeVisible();
  });
  it("still displays a healthy provider's measured zero when the combined total is incomplete", async () => {
    const data = summary(true);
    const unavailable = unavailableAnalytics("fetch_failed");
    const combined = combineAnalytics([data.linkedin, unavailable]);
    await mount([], { ...data, connected: { linkedin: true, twitter: true }, combined: combined.metrics, availability: combined.availability,
      twitter: { ...data.linkedin, ...unavailable } });
    await browserExpect(page.getByLabel("Analytics metric availability")).toContainText("impressions: Unavailable · partial coverage");
    await browserExpect(page.getByLabel("linkedin supported metrics")).toContainText("impressions: 0 · Measured");
    await browserExpect(page.getByRole("alert")).toContainText("Snapshot lookup failed");
  });
  it.each([{ drafts: {}, analytics: {} }, { drafts: [null], analytics: { connected: "bad" } }])("handles malformed response %j without crashing or empty claims", async data => {
    await mount(data.drafts, data.analytics);
    await browserExpect(page.getByText(/Counts are unavailable, not zero/)).toBeVisible();
    await browserExpect(page.getByText(/not a zero-engagement result/)).toBeVisible();
    expect(await page.getByText("No published records in this period").count()).toBe(0);
  });
  it("rejects invalid metric timestamps and negative values at the UI boundary", async () => {
    const data = summary(true);
    data.availability.impressions.measuredAt = "yesterday";
    data.combined.impressions = -1;
    await mount([], data);
    await browserExpect(page.getByLabel("Analytics metric availability")).toContainText("impressions: Unavailable");
    expect(await page.getByLabel("Analytics metric availability").locator("time").count()).toBe(0);
  });
  it("does not show zeroes or empty states during loading", async () => {
    await mount([], summary(), [], true);
    await browserExpect(page.getByText("Loading publishing activity…")).toBeVisible();
    await browserExpect(page.getByText("Checking analytics availability…")).toBeVisible();
    expect(await page.getByText("No published records in this period").count()).toBe(0);
  });
  it("keeps local-calendar live counts excluding simulations, future/invalid dates and outside range", async () => {
    const draft = (publishStatus: string, publishedAt: string | null) => ({ publishStatus, publishedAt, platform: "twitter" });
    await mount([draft("published", "2026-09-13T07:00:00Z"), draft("published", "2026-09-13T06:59:59Z"), draft("published", "2026-09-19T12:00:01Z"), draft("published", "bad"), draft("simulated", "2026-09-19T11:00:00Z")]);
    await page.getByRole("button", { name: "Last 7 calendar days" }).click();
    await browserExpect(page.getByRole("img", { name: "1 published records across the last 7 calendar days" })).toBeVisible();
    await browserExpect(page.getByText(/1 published record has no valid publication date/)).toBeVisible();
    await browserExpect(page.getByText(/Local timezone/)).toBeVisible();
    await browserExpect(page.getByText(/your loaded draft records in this workspace/)).toBeVisible();
  });
});