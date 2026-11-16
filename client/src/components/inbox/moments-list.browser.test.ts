import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { chromium, expect as browserExpect, type Browser, type Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
import postcss from "postcss";
import tailwindcss from "tailwindcss";

// UpcomingMoments and WatchAlertsList with a strict in-memory fetch; no app server or real requests.
const root = path.resolve(import.meta.dirname, "../../../..");
let browser: Browser;
let page: Page;
let bundle: string;
let css: string;

beforeAll(async () => {
  const result = await build({
    absWorkingDir: root,
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import React, { useState } from "react";
      import { createRoot } from "react-dom/client";
      import { QueryClientProvider } from "@tanstack/react-query";
      import { queryClient } from "@/lib/queryClient";
      import { UpcomingMoments } from "@/components/inbox/moments-list";
      import { WatchAlertsList } from "@/components/inbox/watch-alerts";
      import { WatchlistSettings } from "@/components/settings/watchlist-settings";
      window.__calls = [];
      const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
      window.fetch = async (url, options = {}) => {
        const method = options.method || "GET";
        const body = options.body ? JSON.parse(options.body) : undefined;
        window.__calls.push({ url, method, body });
        if (method === "GET" && url.startsWith("/api/moments?")) return window.__momentsStatus ? json({ message: "Unavailable" }, window.__momentsStatus) : json(window.__moments);
        if (method === "GET" && url === "/api/watch-alerts") return json(window.__alerts);
        if (method === "POST" && url === "/api/watch-alerts/seen") {
          window.__alerts = window.__alerts.map(alert => body.all || body.ids.includes(alert.id) ? { ...alert, seenAt: alert.seenAt || "2026-11-16T10:00:00.000Z" } : alert);
          return json({ updated: 1 });
        }
        if (method === "GET" && url === "/api/watchlist") return json(window.__watchlist);
        if (method === "PUT" && url === "/api/watchlist") { window.__watchlist = { ...window.__watchlist, terms: body.terms }; return json(window.__watchlist); }
        throw new Error("Unexpected request " + method + " " + url);
      };
      function Harness() {
        const [angle, setAngle] = useState("");
        const [opened, setOpened] = useState("");
        return <div style={{ width: 320, padding: 8 }}>
          <UpcomingMoments days={window.__days} limit={window.__limit} onDraft={setAngle} />
          <output data-testid="angle">{angle}</output>
          {window.__withAlerts && <WatchAlertsList onOpenStory={setOpened} />}
          <output data-testid="opened">{opened}</output>
          {window.__withWatchlist && <WatchlistSettings />}
        </div>;
      }
      createRoot(document.getElementById("root")).render(<QueryClientProvider client={queryClient}><Harness /></QueryClientProvider>);
    ` },
    alias: { "@": path.join(root, "client/src"), "@shared": path.join(root, "shared") },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"' },
  });
  bundle = result.outputFiles[0].text;
  css = (await postcss([tailwindcss({ content: [path.join(root, "client/src/components/inbox/{moments-list,watch-alerts}.tsx"), path.join(root, "client/src/components/settings/watchlist-settings.tsx"), path.join(root, "client/src/components/ui/*.tsx")] })])
    .process("@tailwind base; @tailwind utilities;", { from: undefined })).css;
  browser = await chromium.launch({ headless: true });
}, 60_000);
afterEach(async () => { await page?.close(); });
afterAll(async () => { await browser?.close(); });

const pad = (value: number) => String(value).padStart(2, "0");
const local = (offset: number) => { const date = new Date(); date.setDate(date.getDate() + offset); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; };
const moment = (id: string, offset: number, extra: Record<string, unknown> = {}) => ({ id, title: `Moment ${id}`, date: local(offset), endDate: null, leadDays: 14,
  category: "retail", url: null, description: null, suggestedAngle: `What Moment ${id} means for your clients`, inLeadWindow: false, ...extra });

async function mount(state: Record<string, unknown>) {
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(4000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => route.abort());
  await page.route("https://inbox.test/**", route => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
  await page.goto("https://inbox.test/dashboard");
  await page.evaluate(values => Object.assign(window, values), state);
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: bundle });
  return errors;
}
type Call = { url: string; method: string; body?: unknown };
const calls = (): Promise<Call[]> => page.evaluate(() => (window as unknown as { __calls: Call[] }).__calls);

describe("UpcomingMoments", () => {
  it("lists the next moments with when, the posting badge, links and Draft a post", async () => {
    const errors = await mount({ __days: 30, __limit: 2, __moments: [
      moment("a", 5, { inLeadWindow: true, url: "https://example.test/a" }),
      moment("b", 1, { endDate: local(3) }),
      moment("c", 20),
    ] });
    const list = page.getByRole("region", { name: "Coming up" });
    await browserExpect(list.getByRole("listitem")).toHaveCount(2);
    expect((await calls())[0]).toEqual({ url: `/api/moments?from=${local(0)}&to=${local(30)}`, method: "GET" });
    const first = page.getByTestId("moment-a");
    await browserExpect(first).toContainText("In 5 days");
    await browserExpect(first.getByText("Good time to post")).toBeVisible();
    await browserExpect(page.getByTestId("moment-b")).toContainText("Tomorrow");
    await browserExpect(page.getByTestId("moment-b").getByText("Good time to post")).toHaveCount(0);
    const details = first.getByRole("link", { name: "Details about Moment a (opens in a new tab)" });
    await browserExpect(details).toHaveAttribute("target", "_blank");
    await browserExpect(details).toHaveAttribute("rel", "noopener noreferrer");
    await first.getByRole("button", { name: "Draft a post about Moment a" }).click();
    await browserExpect(page.getByTestId("angle")).toHaveText("What Moment a means for your clients");
    await page.getByRole("button", { name: "Draft a post about Moment b" }).focus();
    await page.keyboard.press("Enter");
    await browserExpect(page.getByTestId("angle")).toHaveText("What Moment b means for your clients");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });

  it.each([
    ["there are none", { __moments: [] }],
    ["the API fails", { __momentsStatus: 503 }],
    ["the API is missing", { __momentsStatus: 404 }],
  ])("renders nothing when %s", async (_label, state) => {
    const errors = await mount({ __moments: [], ...state });
    await browserExpect.poll(async () => (await calls()).length).toBe(1);
    await page.waitForTimeout(100);
    await browserExpect(page.getByTestId("upcoming-moments")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

describe("WatchAlertsList", () => {
  const alert = (id: string, seenAt: string | null) => ({ id, inboxItemId: `item-${id}`, term: "Zeta", kind: "company", headline: `Zeta story ${id}`,
    source: "Wire", articleUrl: `https://news.test/${id}`, createdAt: "2026-11-16T09:00:00.000Z", seenAt });

  it("shows unseen alerts first, opens a story and marks alerts seen", async () => {
    const errors = await mount({ __moments: [], __withAlerts: true, __alerts: [alert("1", null), alert("2", null), alert("3", "2026-11-15T09:00:00.000Z")] });
    const section = page.getByRole("region", { name: /Watchlist/ });
    await browserExpect(section.getByRole("heading")).toHaveText("Watchlist (2 new)");
    await section.getByRole("button", { name: "Zeta story 1" }).click();
    await browserExpect(page.getByTestId("opened")).toHaveText("item-1");
    await browserExpect(section.getByRole("heading")).toHaveText("Watchlist (1 new)");
    await section.getByRole("button", { name: "Mark all as seen" }).click();
    await browserExpect(section.getByRole("button", { name: "Mark all as seen" })).toHaveCount(0);
    const posts = (await calls()).filter(call => call.method === "POST");
    expect(posts).toEqual([{ url: "/api/watch-alerts/seen", method: "POST", body: { ids: ["1"] } }, { url: "/api/watch-alerts/seen", method: "POST", body: { all: true } }]);
    expect(errors).toEqual([]);
  });
});

describe("WatchlistSettings", () => {
  it("loads only when opened, offers profile terms by kind and saves the chosen ones", async () => {
    const errors = await mount({ __moments: [], __withWatchlist: true, __watchlist: {
      terms: [{ kind: "company", term: "Zeta" }],
      options: [{ kind: "company", term: "Zeta" }, { kind: "company", term: "Acme Bank" }, { kind: "person", term: "Satya Nadella" }, { kind: "topic", term: "Retail media" }],
    } });
    await page.getByRole("button", { name: "Choose what to watch" }).waitFor();
    expect((await calls()).some(call => call.url === "/api/watchlist")).toBe(false);
    await page.getByRole("button", { name: "Choose what to watch" }).click();
    const dialog = page.getByRole("dialog", { name: "What to watch" });
    await browserExpect(dialog.getByRole("group", { name: "Companies" }).getByRole("checkbox")).toHaveCount(2);
    await browserExpect(dialog.getByRole("checkbox", { name: "Zeta" })).toBeChecked();
    await browserExpect(dialog.getByText("1 of 30 chosen.")).toBeVisible();
    await dialog.getByRole("checkbox", { name: "Satya Nadella" }).check();
    await dialog.getByRole("checkbox", { name: "Zeta" }).uncheck();
    await dialog.getByRole("button", { name: "Save watchlist" }).click();
    await browserExpect(dialog).toHaveCount(0);
    expect((await calls()).filter(call => call.method === "PUT")).toEqual([{ url: "/api/watchlist", method: "PUT", body: { terms: [{ kind: "person", term: "Satya Nadella" }] } }]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
});
