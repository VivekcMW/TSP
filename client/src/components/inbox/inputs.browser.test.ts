import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { chromium, expect as browserExpect, type Browser, type Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
import postcss from "postcss";
import tailwindcss from "tailwindcss";

// The real Inputs panel at the side-panel width, with an in-memory /api/inputs fake; no server or real requests.
const root = path.resolve(import.meta.dirname, "../../../..");
const ADDRESS = "k3v9q2m8x7c4b1n6z5l0p2r8tw@in.thesocialpundit.test";
const ROTATED = "q7w2e9r4t1y6u3i8o5p0a2s7dz@in.thesocialpundit.test";
const TOKEN = `tsp_cap_${"A1b2C3d4E5".repeat(4)}xYz`;
let browser: Browser;
let page: Page;
let bundle: string;
let css: string;

beforeAll(async () => {
  const result = await build({
    absWorkingDir: root,
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { QueryClientProvider } from "@tanstack/react-query";
      import { queryClient } from "@/lib/queryClient";
      import { InputsPanel } from "@/components/inbox/inputs-panel";
      window.__calls = []; window.__toasts = []; window.__copied = [];
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async text => { window.__copied.push(text); } } });
      const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
      const now = () => new Date("2026-11-16T09:00:00Z").toISOString();
      window.fetch = async (url, options = {}) => {
        const method = options.method || "GET";
        const body = options.body ? JSON.parse(options.body) : undefined;
        window.__calls.push({ url, method, body });
        const state = window.__state;
        if (method === "GET" && url === "/api/inputs") return json(state);
        if (method === "POST" && url === "/api/inputs/address") {
          state.forwarding.address = { email: window.__address, hint: window.__address.slice(22, 26), createdAt: now(), rotatedAt: null, disabled: false };
          return json(state.forwarding.address, 201);
        }
        if (method === "POST" && url === "/api/inputs/address/rotate") {
          state.forwarding.address = { ...state.forwarding.address, email: window.__rotated, hint: window.__rotated.slice(22, 26), rotatedAt: now() };
          return json(state.forwarding.address);
        }
        if (method === "POST" && url === "/api/inputs/capture-tokens") {
          const key = { id: "key-" + window.__calls.length, label: body.label, hint: window.__token.slice(-4), createdAt: now(), lastUsedAt: null };
          state.capture.tokens = [key, ...state.capture.tokens];
          return json({ ...key, token: window.__token }, 201);
        }
        const revoke = url.match(/^\\/api\\/inputs\\/capture-tokens\\/([^/]+)$/);
        if (method === "DELETE" && revoke) {
          state.capture.tokens = state.capture.tokens.filter(key => key.id !== revoke[1]);
          return json({ revoked: true });
        }
        throw new Error("Unexpected request " + method + " " + url);
      };
      createRoot(document.getElementById("root")).render(
        <QueryClientProvider client={queryClient}>
          <aside aria-label="More connectors" className="flex w-80 flex-col border" data-testid="panel"><div className="space-y-3 p-4 text-sm"><InputsPanel /></div></aside>
        </QueryClientProvider>);
    ` },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", logLevel: "silent",
    define: { "process.env.NODE_ENV": '"test"' },
    plugins: [{ name: "mock-auth-and-toasts", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/dev-auth$|^@\/hooks\/use-toast$/ }, args => ({ path: args.path, namespace: "mock" }));
      builder.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents: args.path.endsWith("dev-auth")
        ? "export const useIsSignedIn = () => true; export const devAuthEnabled = false;"
        : "export const useToast = () => ({ toast: toast => { window.__toasts.push(toast); return { id: String(window.__toasts.length), dismiss() {}, update() {} }; } });", loader: "js" }));
    } }],
  });
  bundle = result.outputFiles[0].text;
  css = (await postcss([tailwindcss({ content: [path.join(root, "client/src/components/inbox/inputs-panel.tsx"), path.join(root, "client/src/components/ui/*.tsx")] })])
    .process("@tailwind base; @tailwind utilities;", { from: undefined })).css;
  browser = await chromium.launch({ headless: true });
}, 60_000);
afterEach(async () => { await page?.close(); });
afterAll(async () => { await browser?.close(); });

const emptyState = (overrides: { forwarding?: Record<string, unknown>; capture?: Record<string, unknown> } = {}) => ({
  forwarding: { available: true, domain: "in.thesocialpundit.test", dailyLimit: 30, address: null, recent: [], ...overrides.forwarding },
  capture: { tokens: [], limit: 5, hourlyLimit: 60, ...overrides.capture },
});

async function mount(state = emptyState(), viewport = { width: 390, height: 900 }) {
  page = await browser.newPage({ viewport });
  page.setDefaultTimeout(5000);
  await page.route("**/*", route => route.abort());
  await page.route("https://app.thesocialpundit.test/**", route => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
  await page.goto("https://app.thesocialpundit.test/dashboard");
  await page.evaluate(([state, address, rotated, token]) => Object.assign(window, { __state: state, __address: address, __rotated: rotated, __token: token }),
    [state, ADDRESS, ROTATED, TOKEN] as const);
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: bundle });
}
type Call = { url: string; method: string; body?: unknown };
const calls = (method: string): Promise<Call[]> => page.evaluate(method => (window as any).__calls.filter((call: Call) => call.method === method), method);
const toasts = (): Promise<string[]> => page.evaluate(() => (window as any).__toasts.map((toast: { title: string }) => toast.title));
const copied = (): Promise<string[]> => page.evaluate(() => (window as any).__copied);
async function expectNoHorizontalScroll() {
  const overflow = await page.evaluate(() => {
    const panel = document.querySelector('[data-testid="panel"]')!;
    return { page: document.documentElement.scrollWidth - document.documentElement.clientWidth, panel: panel.scrollWidth - panel.clientWidth };
  });
  expect(overflow).toEqual({ page: 0, panel: 0 });
}

describe("Inputs panel", () => {
  it("keeps the LinkedIn note and says plainly when forwarding is not available here", async () => {
    await mount(emptyState({ forwarding: { available: false, domain: null } }));
    await browserExpect(page.getByText("LinkedIn is the focus today.", { exact: false })).toBeVisible();
    await browserExpect(page.getByRole("link", { name: "Open integrations" })).toHaveAttribute("href", "/dashboard/settings?tab=integrations");
    await browserExpect(page.getByTestId("text-forwarding-unavailable")).toHaveText("Newsletter forwarding is not available in this environment.");
    await browserExpect(page.getByTestId("button-create-forwarding-address")).toHaveCount(0);
    await browserExpect(page.getByRole("heading", { name: "Save from any page" })).toBeVisible();
  }, 20_000);

  it("creates a forwarding address, copies it, and replaces it only after confirming", async () => {
    await mount();
    await page.getByRole("button", { name: "Create address" }).click();
    const address = page.getByTestId("text-forwarding-address");
    await browserExpect(address).toHaveText(ADDRESS);
    await page.getByRole("button", { name: "Copy forwarding address" }).click();
    await browserExpect.poll(copied).toEqual([ADDRESS]);
    expect(await toasts()).toContain("Address copied");

    await page.getByTestId("button-rotate-forwarding-address").click();
    await browserExpect(page.getByText("Your current address stops working right away.")).toBeVisible();
    expect((await calls("POST")).map(call => call.url)).toEqual(["/api/inputs/address"]);
    await page.getByTestId("button-confirm-forwarding-change").click();
    await browserExpect(address).toHaveText(ROTATED);
    expect((await calls("POST")).map(call => call.url)).toEqual(["/api/inputs/address", "/api/inputs/address/rotate"]);
    expect(await toasts()).toContain("New address ready");
    await expectNoHorizontalScroll();
  }, 20_000);

  it("lists recent forwards with sender, subject, links added and Gmail's confirmation code", async () => {
    await mount(emptyState({ forwarding: {
      address: { email: ADDRESS, hint: "r8tw", createdAt: "2026-11-01T00:00:00Z", rotatedAt: null, disabled: false },
      recent: [
        { id: "f1", fromName: "Morning Brew", fromAddress: "crew@morningbrew.com", subject: "Ad money moves", receivedAt: "2026-11-16T06:00:00Z", linksFound: 6, itemsCreated: 4, status: "processed", confirmationCode: null },
        { id: "f2", fromName: "Gmail Team", fromAddress: "forwarding-noreply@google.com", subject: "(#482913507) Gmail Forwarding Confirmation", receivedAt: "2026-11-15T06:00:00Z", linksFound: 0, itemsCreated: 0, status: "confirmation", confirmationCode: "482913507" },
        { id: "f3", fromName: null, fromAddress: "news@retail.site", subject: "Weekly", receivedAt: "2026-11-14T06:00:00Z", linksFound: 2, itemsCreated: 0, status: "processed", confirmationCode: null },
      ],
    } }));
    await browserExpect(page.getByTestId("forward-f1")).toContainText("Morning Brew");
    await browserExpect(page.getByTestId("forward-f1")).toContainText("Ad money moves");
    await browserExpect(page.getByTestId("forward-f1")).toContainText("4 links added to Shortlist");
    await browserExpect(page.getByTestId("forward-f2")).toContainText("Gmail confirmation code 482913507");
    await browserExpect(page.getByTestId("forward-f3")).toContainText("news@retail.site");
    await browserExpect(page.getByTestId("forward-f3")).toContainText("No new links. They were already saved.");
    await expectNoHorizontalScroll();
  }, 20_000);

  it("shows a new key once with its bookmarklet, then lists and revokes it", async () => {
    await mount();
    await page.getByLabel("Key name").fill("Work laptop");
    await page.getByRole("button", { name: "Create key" }).click();
    const keyText = page.getByTestId("text-new-capture-key");
    await browserExpect(keyText).toHaveText(TOKEN);
    expect((await calls("POST")).at(-1)).toEqual({ url: "/api/inputs/capture-tokens", method: "POST", body: { label: "Work laptop" } });
    await browserExpect(page.getByText("Copy your key now. It is shown only once.")).toBeVisible();
    await browserExpect(page.getByText("Anyone with this key or bookmarklet can add pages to your Shortlist.", { exact: false })).toBeVisible();

    const href = await page.getByTestId("link-bookmarklet").getAttribute("href");
    expect(href!.startsWith("javascript:")).toBe(true);
    const code = decodeURIComponent(href!.slice("javascript:".length));
    expect(code).toContain(JSON.stringify(TOKEN));
    expect(code).toContain('"https://app.thesocialpundit.test"');
    await page.getByTestId("link-bookmarklet").click();
    expect(await toasts()).toContain("Drag it to your bookmarks bar");
    expect(await page.evaluate(() => location.href)).toBe("https://app.thesocialpundit.test/dashboard");

    await page.getByRole("button", { name: "Copy key" }).click();
    await browserExpect.poll(copied).toEqual([TOKEN]);
    await expectNoHorizontalScroll();

    await page.getByRole("button", { name: "Done" }).click();
    await browserExpect(keyText).toHaveCount(0);
    expect(await page.content()).not.toContain(TOKEN.slice(8));
    const row = page.getByTestId(/^capture-key-/);
    await browserExpect(row).toContainText("Work laptop");
    await browserExpect(row).toContainText(`…${TOKEN.slice(-4)}`);
    await browserExpect(row).toContainText("Not used yet");

    await page.getByRole("button", { name: "Revoke key Work laptop" }).click();
    await browserExpect(page.getByText("No keys yet.")).toBeVisible();
    expect((await calls("DELETE")).map(call => call.url)).toEqual([expect.stringMatching(/^\/api\/inputs\/capture-tokens\/key-\d+$/)]);
    expect(await toasts()).toContain("Key revoked");
  }, 20_000);

  it("stops offering new keys at the limit", async () => {
    const tokens = Array.from({ length: 5 }, (_, i) => ({ id: `k${i}`, label: `Key ${i}`, hint: "Ab_9", createdAt: "2026-11-01T00:00:00Z", lastUsedAt: "2026-11-10T00:00:00Z" }));
    await mount(emptyState({ capture: { tokens } }));
    await browserExpect(page.getByTestId("list-capture-keys").getByRole("listitem")).toHaveCount(5);
    await browserExpect(page.getByRole("button", { name: "Create key" })).toBeDisabled();
    await browserExpect(page.getByText("You have 5 keys. Revoke one to create another.")).toBeVisible();
  }, 20_000);
});
