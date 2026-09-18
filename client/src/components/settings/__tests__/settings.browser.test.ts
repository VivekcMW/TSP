import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect } from "vitest";
import { chromium, expect as browserExpect, type Browser, type Page, type BrowserContext } from "@playwright/test";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import postcss from "postcss";
import tailwindcss from "tailwindcss";

// No application server, credentials, database, .env loader or external traffic.
let server: Server;
let browser: Browser;
let context: BrowserContext;
let page: Page;
let origin: string;
let errors: string[];
let profile: Record<string, unknown>;
let user: Record<string, unknown>;
let requests: Array<{ url: string; method: string; body: Record<string, unknown> }>;
let connected: Record<string, boolean>;
let failures: Set<string>;
let subscription: { status: string; cancelAtPeriodEnd: boolean; currentPeriodEnd: string } | null;
let dialogs: string[];
let decisions: boolean[];

beforeAll(async () => {
  const root = path.resolve(import.meta.dirname, "../../../../..");
  const result = await build({
    absWorkingDir: root, entryPoints: [path.join(import.meta.dirname, "fixture.tsx")], bundle: true, write: false,
    format: "esm", platform: "browser", jsx: "automatic", loader: { ".css": "empty" },
    define: { "import.meta.env.DEV": "false", "import.meta.env.PROD": "false", "import.meta.env.BASE_URL": '"/"' },
    alias: { "@": path.join(root, "client/src"), "@shared": path.join(root, "shared") },
  });
  const tokens = await readFile(path.join(root, "client/src/design/tokens.generated.css"), "utf8");
  const css = await postcss([tailwindcss({ content: [path.join(root, "client/src/**/*.tsx")], corePlugins: { preflight: true } })]).process("@tailwind base; @tailwind components; @tailwind utilities;", { from: undefined });
  server = createServer((req, res) => {
    if (req.url === "/fixture.js") { res.setHeader("Content-Type", "text/javascript"); res.end(result.outputFiles[0].text); return; }
    res.setHeader("Content-Type", "text/html");
    res.end(`<html><head><style>${tokens}\n${css.css}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind");
  origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
}, 60000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

beforeEach(async () => {
  profile = { focusDescription: "Original focus", publications: ["Publication"], keywords: ["technology"], influencers: [], companies: [], enabledPlatforms: ["linkedin", "twitter"], defaultPlatform: "linkedin", defaultTone: "professional", preferredPublishTime: "09:00", timezone: "UTC", requirePublishReview: true, dailyDigest: true, contentAlerts: false, productUpdates: true };
  user = { id: "fixture-user", name: "Original Person", firstName: "Original", lastName: "Person", email: "fixture@example.invalid", emailVerified: true, image: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  connected = { twitter: true, slack: true };
  subscription = { status: "active", cancelAtPeriodEnd: true, currentPeriodEnd: "2026-10-17T00:00:00Z" };
  failures = new Set(); requests = []; errors = []; dialogs = []; decisions = [];
  context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { errors.push(`External request blocked: ${url.origin}`); await route.abort(); return; }
    if (!url.pathname.startsWith("/api/")) { await route.continue(); return; }
    const method = route.request().method();
    const body = route.request().postDataJSON() ?? {};
    requests.push({ url: url.pathname, method, body });
    const reply = (data: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
    if (failures.has(`${method} ${url.pathname}`)) return reply({ message: "Fixture request failed" }, 500);
    if (url.pathname === "/api/auth/get-session") return reply({ user, session: { id: "fixture-session", userId: user.id, expiresAt: "2099-01-01T00:00:00Z" } });
    if (url.pathname === "/api/auth/update-user") { user = { ...user, name: body.name }; return reply({ status: true }); }
    if (url.pathname === "/api/auth/update-name") { const fullName = `${body.firstName || ""} ${body.lastName || ""}`.trim(); user = { ...user, name: fullName, firstName: body.firstName, lastName: body.lastName }; return reply(user); }
    if (url.pathname === "/api/me") return reply({ industry: "other", country: "India" });
    if (url.pathname === "/api/profile") { if (method === "PATCH") profile = { ...profile, ...body }; return reply(profile); }
    if (["/api/profile/social-links", "/api/inbox", "/api/sources", "/api/sources/suggestions"].includes(url.pathname)) return reply([]);
    if (url.pathname === "/api/integrations") return reply([{ key: "bluesky", label: "Bluesky", enabled: false }]);
    if (url.pathname === "/api/analytics/summary") return reply({ connected: { linkedin: Boolean(connected.linkedin), twitter: Boolean(connected.twitter) }, linkedin: null, twitter: null, lastSync: null });
    const status = /^\/api\/integrations\/([^/]+)\/status$/.exec(url.pathname);
    if (status) return reply({ connected: Boolean(connected[status[1]]), assessment: { status: "valid" } });
    const disconnect = /^\/api\/social\/disconnect\/([^/]+)$/.exec(url.pathname);
    if (disconnect) { connected[disconnect[1]] = false; return reply({ success: true }); }
    const webhook = /^\/api\/integrations\/(slack|discord)\/webhook$/.exec(url.pathname);
    if (webhook) { connected[webhook[1]] = true; return reply({ success: true }); }
    if (url.pathname === "/api/billing") return reply({ configured: false, keyId: null, plans: [], currentPlan: null, subscription, paymentMethods: [], payments: [] });
    errors.push(`Unexpected API request: ${method} ${url.pathname}`);
    return reply({ message: "Unmocked request" }, 500);
  });
  page = await context.newPage();
  page.setDefaultTimeout(5000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", async (dialog) => {
    dialogs.push(dialog.type());
    const accept = decisions.shift();
    if (accept === undefined) errors.push(`Unexpected ${dialog.type()} prompt`);
    if (accept) await dialog.accept(); else await dialog.dismiss();
  });
});
afterEach(async () => { await context?.close(); expect(errors, errors.join("\n")).toEqual([]); });

async function open(tab = "account") { await page.goto(`${origin}/dashboard/settings?tab=${tab}`); await browserExpect(page.getByRole("tab", { name: tab, exact: true })).toHaveAttribute("aria-selected", "true"); }
async function refetchProfile() { const response = page.waitForResponse((res) => res.url().endsWith("/api/profile") && res.request().method() === "GET"); await page.locator("#fixture-refetch").click(); await response; }
async function reloadBlocked() {
  return page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
}

describe("Settings navigation guard", () => {
  it("preserves drafts on cancelled Back without the Navigation API and releases the fallback after save", async () => {
    await page.addInitScript(() => Object.defineProperty(window, "navigation", { value: undefined, configurable: true }));
    await page.goto(`${origin}/dashboard`);
    await page.getByRole("link", { name: "Open Settings", exact: true }).click();
    await browserExpect(page.getByLabel("First Name")).toHaveValue("Original");
    await page.getByLabel("First Name").fill("Fallback");
    for (let attempt = 0; attempt < 2; attempt++) {
      decisions.push(false);
      await page.evaluate(() => history.back());
      await browserExpect.poll(() => dialogs.length).toBe(attempt + 1);
      await browserExpect(page).toHaveURL(/settings\?tab=account$/);
      await browserExpect(page.getByLabel("First Name")).toHaveValue("Fallback");
    }
    await page.getByTestId("button-save-account").click();
    await browserExpect(page.getByText("Account saved", { exact: true })).toBeVisible();
    expect(await reloadBlocked()).toBe(false);
    await page.goBack();
    await browserExpect(page.getByRole("heading", { name: "Outside Settings" })).toBeVisible();
    expect(dialogs).toEqual(["confirm", "confirm"]);
  });

  it("does not prompt when clean, including after leaving and re-entering Settings", async () => {
    await open();
    await browserExpect(page.getByLabel("First Name")).toHaveValue("Original");
    expect(await reloadBlocked()).toBe(false);
    await page.reload();
    await page.getByRole("link", { name: "Leave Settings", exact: true }).click();
    await browserExpect(page.getByRole("heading", { name: "Outside Settings" })).toBeVisible();
    await page.getByRole("link", { name: "Open Settings", exact: true }).click();
    await browserExpect(page.getByLabel("First Name")).toHaveValue("Original");
    await page.getByRole("button", { name: "Replace route" }).click();
    await browserExpect(page.getByRole("heading", { name: "Outside Settings" })).toBeVisible();
    expect(await reloadBlocked()).toBe(false);
    expect(dialogs).toEqual([]);
  });

  it("preserves hidden account edits on declined links and replace navigation, then leaves once", async () => {
    await open();
    await browserExpect(page.getByLabel("First Name")).toHaveValue("Original");
    await page.getByLabel("First Name").fill("Unsaved");
    await page.getByRole("tab", { name: "billing", exact: true }).click();
    expect(await reloadBlocked()).toBe(true);
    decisions.push(false);
    await page.getByRole("link", { name: "Leave Settings", exact: true }).click();
    await browserExpect(page).toHaveURL(/settings\?tab=billing$/);
    decisions.push(false);
    await page.getByRole("button", { name: "Replace route" }).click();
    await browserExpect(page).toHaveURL(/settings\?tab=billing$/);
    await page.getByRole("tab", { name: "account", exact: true }).click();
    await browserExpect(page.getByLabel("First Name")).toHaveValue("Unsaved");
    decisions.push(true);
    await page.getByRole("link", { name: "Leave Settings", exact: true }).click();
    await browserExpect(page.getByRole("heading", { name: "Outside Settings" })).toBeVisible();
    expect(await reloadBlocked()).toBe(false);
    expect(dialogs).toEqual(["confirm", "confirm", "confirm"]);
    expect(requests.some((request) => request.method === "POST")).toBe(false);
  });

  it("aggregates content and notifications: saving one form cannot clear another form's guard", async () => {
    await open("content");
    await browserExpect(page.getByLabel("Voice & focus")).toHaveValue("Original focus");
    await page.getByLabel("Voice & focus").fill("Unsaved voice");
    await page.getByRole("tab", { name: "notifications", exact: true }).click();
    await page.getByRole("switch", { name: /Daily Digest/ }).uncheck();
    await page.getByTestId("button-save-notifications").click();
    await browserExpect(page.getByTestId("button-save-notifications")).toBeDisabled();
    expect(await reloadBlocked()).toBe(true);
    decisions.push(false);
    await page.getByRole("link", { name: "Leave Settings", exact: true }).click();
    await page.getByRole("tab", { name: "content", exact: true }).click();
    await browserExpect(page.getByLabel("Voice & focus")).toHaveValue("Unsaved voice");
    await page.getByTestId("button-save-content-preferences").click();
    await browserExpect(page.getByTestId("button-save-content-preferences")).toBeDisabled();
    expect(await reloadBlocked()).toBe(false);
    await page.getByRole("link", { name: "Leave Settings", exact: true }).click();
    await browserExpect(page.getByRole("heading", { name: "Outside Settings" })).toBeVisible();
    expect(dialogs).toEqual(["confirm"]);
  });

  it("protects failed publishing saves and clears protection on discard or successful save", async () => {
    await open("publishing");
    await page.getByLabel("Preferred time").fill("12:15");
    failures.add("PATCH /api/profile");
    await page.getByTestId("button-save-plugins").click();
    await browserExpect(page.getByText("Could not save publishing preferences", { exact: true })).toBeVisible();
    expect(await reloadBlocked()).toBe(true);
    decisions.push(false);
    await page.getByRole("link", { name: "Leave Settings", exact: true }).click();
    await browserExpect(page.getByLabel("Preferred time")).toHaveValue("12:15");
    await page.getByRole("button", { name: "Discard changes" }).click();
    expect(await reloadBlocked()).toBe(false);
    failures.clear();
    await page.getByLabel("Preferred time").fill("13:15");
    await page.getByTestId("button-save-plugins").click();
    await browserExpect(page.getByText("Publishing preferences saved", { exact: true })).toBeVisible();
    await browserExpect(page.getByTestId("button-save-plugins")).toBeDisabled();
    expect(await reloadBlocked()).toBe(false);
    await page.getByRole("link", { name: "Leave Settings", exact: true }).click();
    await browserExpect(page.getByRole("heading", { name: "Outside Settings" })).toBeVisible();
    expect(dialogs).toEqual(["confirm"]);
  });

  it("cancels a real reload without losing edits, then reloads after a successful account save without prompting", async () => {
    await open();
    await browserExpect(page.getByLabel("First Name")).toHaveValue("Original");
    await page.getByLabel("First Name").fill("Reload");
    decisions.push(false);
    await page.evaluate(() => { setTimeout(() => location.reload(), 0); });
    await browserExpect.poll(() => dialogs).toEqual(["beforeunload"]);
    await browserExpect(page.getByLabel("First Name")).toHaveValue("Reload");
    expect(dialogs).toEqual(["beforeunload"]);
    expect(await reloadBlocked()).toBe(true);
    await page.getByTestId("button-save-account").click();
    await browserExpect(page.getByText("Account saved", { exact: true })).toBeVisible();
    expect(await reloadBlocked()).toBe(false);
    await page.reload();
    await browserExpect(page.getByLabel("First Name")).toHaveValue("Reload");
    await browserExpect(page.getByLabel("Last Name")).toHaveValue("Person");
    expect(dialogs).toEqual(["beforeunload"]);
  });

  it("allows accepting the native reload warning", async () => {
    await open("content");
    await browserExpect(page.getByLabel("Voice & focus")).toHaveValue("Original focus");
    await page.getByLabel("Voice & focus").fill("Discard on reload");
    decisions.push(true);
    await page.reload();
    await browserExpect(page.getByLabel("Voice & focus")).toHaveValue("Original focus");
    expect(await reloadBlocked()).toBe(false);
    expect(dialogs).toEqual(["beforeunload"]);
  });

  it("keeps dirty tab history free of prompts and restores repeated Back cancellations before Wouter unmounts", async () => {
    await page.goto(`${origin}/dashboard`);
    await page.getByRole("link", { name: "Open Settings", exact: true }).click();
    await browserExpect(page.getByLabel("First Name")).toHaveValue("Original");
    await page.getByLabel("First Name").fill("Back draft");
    await page.getByRole("tab", { name: "billing", exact: true }).click();
    await page.goBack();
    await browserExpect(page.getByLabel("First Name")).toHaveValue("Back draft");
    await page.goForward();
    await browserExpect(page.getByRole("tab", { name: "billing", exact: true })).toHaveAttribute("aria-selected", "true");
    await page.goBack();
    expect(dialogs).toEqual([]);
    const length = await page.evaluate(() => history.length);
    for (let attempt = 0; attempt < 2; attempt++) {
      decisions.push(false);
      await page.evaluate(() => history.back());
      await browserExpect.poll(async () => ({ dialogs: dialogs.length, href: page.url(), dirty: await reloadBlocked() })).toEqual({ dialogs: attempt + 1, href: `${origin}/dashboard/settings?tab=account`, dirty: true });
      await browserExpect(page).toHaveURL(/settings\?tab=account$/);
      await browserExpect(page.getByLabel("First Name")).toHaveValue("Back draft");
    }
    expect(await page.evaluate(() => history.length)).toBe(length);
    decisions.push(true);
    await page.evaluate(() => history.back());
    await browserExpect(page.getByRole("heading", { name: "Outside Settings" })).toBeVisible();
    expect(dialogs).toEqual(["confirm", "confirm", "confirm"]);
    expect(await reloadBlocked()).toBe(false);
  });

  it("restores Forward and multi-entry traversal cancellations without replacing the destination", async () => {
    await open();
    await page.getByRole("link", { name: "Leave Settings", exact: true }).click();
    await browserExpect(page.getByRole("heading", { name: "Outside Settings" })).toBeVisible();
    await page.goBack();
    await browserExpect(page.getByLabel("First Name")).toHaveValue("Original");
    await page.getByLabel("First Name").fill("Forward draft");
    const historyEntries = () => page.evaluate(() => {
      const navigation = (window as unknown as { navigation: { entries: () => Array<{ url: string }>; currentEntry: { index: number; url: string } } }).navigation;
      return { entries: navigation.entries().map((entry) => entry.url), index: navigation.currentEntry.index, url: navigation.currentEntry.url };
    });
    const entriesBefore = await historyEntries();
    decisions.push(false);
    await page.evaluate(() => history.forward());
    await browserExpect.poll(async () => ({ dialogs: dialogs.length, href: page.url(), dirty: await reloadBlocked() })).toEqual({ dialogs: 1, href: `${origin}/dashboard/settings?tab=account`, dirty: true });
    await browserExpect(page).toHaveURL(/settings\?tab=account$/);
    await browserExpect(page.getByLabel("First Name")).toHaveValue("Forward draft");
    expect(await historyEntries()).toEqual(entriesBefore);
    decisions.push(true);
    await page.goForward({ timeout: 5000 });
    await browserExpect.poll(() => ({ dialogs: dialogs.length, href: page.url() })).toEqual({ dialogs: 2, href: `${origin}/dashboard` });
    await browserExpect(page.getByRole("heading", { name: "Outside Settings" })).toBeVisible();
    await page.getByRole("link", { name: "Open Settings", exact: true }).click();
    await browserExpect(page.getByLabel("First Name")).toHaveValue("Original");
    await page.getByLabel("First Name").fill("Jump draft");
    await page.getByRole("tab", { name: "billing", exact: true }).click();
    decisions.push(false);
    await page.evaluate(() => history.go(-2));
    await browserExpect.poll(() => dialogs.length).toBe(3);
    await browserExpect(page).toHaveURL(/settings\?tab=billing$/);
    await page.getByRole("tab", { name: "account", exact: true }).click();
    await browserExpect(page.getByLabel("First Name")).toHaveValue("Jump draft");
    expect(dialogs).toEqual(["confirm", "confirm", "confirm"]);
  });
});

describe("Settings consolidation and trust", () => {
  it("syncs every section with URL/history and never nests page headers or mains", async () => {
    await open();
    for (const section of ["content", "publishing", "integrations", "notifications", "billing"]) {
      await page.getByRole("tab", { name: section, exact: true }).click();
      await browserExpect(page).toHaveURL(new RegExp(`tab=${section}$`));
      await browserExpect(page.locator("h1")).toHaveCount(1);
      await browserExpect(page.locator("main")).toHaveCount(1);
    }
    await page.goBack();
    await browserExpect(page.getByRole("tab", { name: "notifications", exact: true })).toHaveAttribute("aria-selected", "true");
    await page.goForward();
    await browserExpect(page.getByRole("tab", { name: "billing", exact: true })).toHaveAttribute("aria-selected", "true");
    await page.reload();
    await browserExpect(page.getByText("Cancellation scheduled", { exact: true })).toBeVisible();
    await page.goto(`${origin}/dashboard/settings?tab=unknown`);
    await browserExpect(page.getByRole("tab", { name: "account", exact: true })).toHaveAttribute("aria-selected", "true");
  });

  it("persists names via auth and removes the fake photo action", async () => {
    await open();
    await browserExpect(page.getByLabel("First Name")).toHaveValue("Original");
    await browserExpect(page.getByTestId("button-save-account")).toBeDisabled();
    await browserExpect(page.getByLabel("Email", { exact: true })).toHaveAttribute("readonly", "");
    await browserExpect(page.getByRole("button", { name: "Change Photo" })).toHaveCount(0);
    await page.getByLabel("First Name").fill("Updated");
    await page.getByTestId("button-save-account").click();
    await browserExpect(page.getByText("Account saved", { exact: true })).toBeVisible();
    expect(requests.find((req) => req.url === "/api/auth/update-name")?.body).toEqual({ firstName: "Updated", lastName: "Person" });
    await page.reload();
    await browserExpect(page.getByLabel("First Name")).toHaveValue("Updated");
  });

  it("supports keyboard tabs, section aliases, and preserves unrelated query parameters", async () => {
    await page.goto(`${origin}/dashboard/settings?section=content&from=welcome`);
    const content = page.getByRole("tab", { name: "content", exact: true });
    await browserExpect(content).toHaveAttribute("aria-selected", "true");
    await content.focus();
    await page.keyboard.press("ArrowRight");
    await browserExpect(page.getByRole("tab", { name: "publishing", exact: true })).toHaveAttribute("aria-selected", "true");
    const url = new URL(page.url());
    expect(url.searchParams.get("from")).toBe("welcome");
    expect(url.searchParams.has("section")).toBe(false);
    await page.goBack();
    await browserExpect(content).toHaveAttribute("aria-selected", "true");
  });

  it("keeps account edits and reports an auth save failure honestly", async () => {
    failures.add("POST /api/auth/update-name");
    await open();
    await browserExpect(page.getByLabel("First Name")).toHaveValue("Original");
    await page.getByLabel("First Name").fill("Unsaved");
    await page.getByTestId("button-save-account").click();
    await browserExpect(page.getByText("Could not save account", { exact: true })).toBeVisible();
    await browserExpect(page.getByLabel("First Name")).toHaveValue("Unsaved");
    expect(user.name).toBe("Original Person");
    await browserExpect(page.getByText("Account saved", { exact: true })).toHaveCount(0);
  });

  it("preserves dirty content across refetches and section changes, then saves", async () => {
    await open("content");
    await browserExpect(page.getByLabel("Voice & focus")).toHaveValue("Original focus");
    await page.getByLabel("Voice & focus").fill("My unsaved voice");
    profile = { ...profile, focusDescription: "Remote focus", publications: ["Changed remotely"] };
    await refetchProfile();
    await browserExpect(page.getByLabel("Voice & focus")).toHaveValue("My unsaved voice");
    await page.getByRole("tab", { name: "notifications", exact: true }).click();
    await browserExpect(page.getByRole("tab", { name: "notifications", exact: true })).toHaveAttribute("aria-selected", "true");
    await page.getByRole("tab", { name: "content", exact: true }).click();
    await browserExpect(page.getByRole("tab", { name: "content", exact: true })).toHaveAttribute("aria-selected", "true");
    await browserExpect(page.getByLabel("Voice & focus")).toBeVisible();
    await browserExpect(page.getByLabel("Voice & focus")).toHaveValue("My unsaved voice");
    await page.getByTestId("button-save-content-preferences").click();
    await browserExpect(page.getByTestId("button-save-content-preferences")).toBeDisabled();
    expect(profile.focusDescription).toBe("My unsaved voice");
  });

  it("hydrates pristine publishing fields without an enabled-platform change and preserves dirty fields", async () => {
    await open("publishing");
    await browserExpect(page.getByLabel("Preferred time")).toHaveValue("09:00");
    profile = { ...profile, preferredPublishTime: "11:30" };
    await refetchProfile();
    await browserExpect(page.getByLabel("Preferred time")).toHaveValue("11:30");
    await page.getByLabel("Preferred time").fill("12:15");
    profile = { ...profile, preferredPublishTime: "14:45" };
    await refetchProfile();
    await browserExpect(page.getByLabel("Preferred time")).toHaveValue("12:15");
    await page.getByRole("button", { name: "Discard changes" }).click();
    await browserExpect(page.getByLabel("Preferred time")).toHaveValue("14:45");
    await browserExpect(page.getByTestId("button-save-plugins")).toBeDisabled();
  });

  it("has reversible dirty state, valid default selection, and rejects zero platforms/invalid timezone", async () => {
    await open("publishing");
    const save = page.getByTestId("button-save-plugins");
    await browserExpect(save).toBeDisabled();
    await page.getByLabel("Default tone").selectOption("contrarian");
    await browserExpect(save).toBeEnabled();
    await page.getByLabel("Default tone").selectOption("professional");
    await browserExpect(save).toBeDisabled();
    await page.getByTestId("switch-plugin-linkedin").uncheck();
    await browserExpect(page.getByLabel("Default platform", { exact: true })).toHaveValue("twitter");
    await page.getByTestId("switch-plugin-twitter").uncheck();
    await browserExpect(save).toBeDisabled();
    await page.getByTestId("switch-plugin-twitter").check();
    await page.getByLabel("Timezone", { exact: true }).fill("invalid-zone");
    await browserExpect(save).toBeDisabled();
    await page.getByLabel("Timezone", { exact: true }).fill("UTC");
    await save.click();
    await browserExpect(save).toBeDisabled();
    expect(profile.enabledPlatforms).toEqual(["twitter"]);
    expect(profile.defaultPlatform).toBe("twitter");
  });

  it("keeps notification edits on failed save and refetch, then persists", async () => {
    await open("notifications");
    await page.getByRole("switch", { name: /Daily Digest/ }).uncheck();
    profile = { ...profile, productUpdates: false };
    await refetchProfile();
    await browserExpect(page.getByRole("switch", { name: /Daily Digest/ })).not.toBeChecked();
    failures.add("PATCH /api/profile");
    await page.getByTestId("button-save-notifications").click();
    await browserExpect(page.getByText("Could not save notifications", { exact: true })).toBeVisible();
    await browserExpect(page.getByTestId("button-save-notifications")).toBeEnabled();
    failures.clear();
    await page.getByTestId("button-save-notifications").click();
    await browserExpect(page.getByTestId("button-save-notifications")).toBeDisabled();
    expect(profile.dailyDigest).toBe(false);
  });

  it("repairs globally disabled defaults and retains publishing edits after failed saves", async () => {
    profile = { ...profile, enabledPlatforms: ["bluesky", "twitter"], defaultPlatform: "bluesky" };
    await open("publishing");
    await browserExpect(page.getByLabel("Default platform", { exact: true })).toHaveValue("twitter");
    await browserExpect(page.getByTestId("switch-plugin-bluesky")).toBeDisabled();
    await page.getByLabel("Default tone").selectOption("contrarian");
    failures.add("PATCH /api/profile");
    await page.getByTestId("button-save-plugins").click();
    await browserExpect(page.getByText("Could not save publishing preferences", { exact: true })).toBeVisible();
    await browserExpect(page.getByLabel("Default tone")).toHaveValue("contrarian");
    await browserExpect(page.getByTestId("button-save-plugins")).toBeEnabled();
    failures.clear();
    await page.getByTestId("button-save-plugins").click();
    await browserExpect(page.getByTestId("button-save-plugins")).toBeDisabled();
    expect(profile.enabledPlatforms).toEqual(["twitter"]);
    expect(profile.defaultPlatform).toBe("twitter");
  });

  it("retains dirty content after save rejection and does not show success", async () => {
    await open("content");
    await browserExpect(page.getByLabel("Voice & focus")).toHaveValue("Original focus");
    await page.getByLabel("Voice & focus").fill("Unsaved content");
    failures.add("PATCH /api/profile");
    await page.getByTestId("button-save-content-preferences").click();
    await browserExpect(page.getByText("Failed to update profile. Please try again.", { exact: true })).toBeVisible();
    await browserExpect(page.getByLabel("Voice & focus")).toHaveValue("Unsaved content");
    await browserExpect(page.getByTestId("button-save-content-preferences")).toBeEnabled();
    expect(profile.focusDescription).toBe("Original focus");
  });

  it("uses real Connections state and refreshes provider state on disconnect", async () => {
    await open("integrations");
    await browserExpect(page.getByTestId("button-disconnect-twitter")).toBeVisible();
    await browserExpect(page.getByTestId("button-disconnect-slack")).toBeVisible();
    await page.getByTestId("button-disconnect-slack").click();
    await browserExpect(page.getByTestId("button-connect-slack")).toBeVisible();
    expect(connected.slack).toBe(false);
  });

  it("does not present failed status requests as disconnected", async () => {
    failures.add("GET /api/integrations/slack/status");
    await open("integrations");
    await browserExpect(page.getByTestId("card-connection-slack")).toContainText("Connection status unavailable");
    await browserExpect(page.getByTestId("button-connect-slack")).toBeDisabled();
  });

  it("refreshes Slack rather than Discord after a mocked webhook connection", async () => {
    connected.slack = false;
    await open("integrations");
    await page.getByTestId("button-connect-slack").click();
    await page.getByLabel("Paste incoming webhook URL").fill("https://hooks.slack.invalid/test-fixture");
    const discordFetches = requests.filter((request) => request.url === "/api/integrations/discord/status").length;
    await page.getByRole("button", { name: "Test & connect", exact: true }).click();
    await browserExpect(page.getByTestId("button-disconnect-slack")).toBeVisible();
    expect(requests.filter((request) => request.url === "/api/integrations/discord/status")).toHaveLength(discordFetches);
    expect(requests.some((request) => request.url === "/api/integrations/slack/webhook" && request.method === "POST")).toBe(true);
  });

  it("preserves the Settings section when consuming OAuth callback parameters", async () => {
    await page.goto(`${origin}/dashboard/settings?tab=integrations&connected=twitter`);
    await browserExpect(page).toHaveURL(`${origin}/dashboard/settings?tab=integrations`);
    await browserExpect(page.getByTestId("button-disconnect-twitter")).toBeVisible();
  });

  it("never says renews for cancelled or absent subscriptions", async () => {
    await open("billing");
    await browserExpect(page.getByText(/^Ends /)).toBeVisible();
    await browserExpect(page.getByText(/^Renews /)).toHaveCount(0);
    subscription = { ...subscription!, cancelAtPeriodEnd: false };
    await page.reload();
    await browserExpect(page.getByText(/^Renews /)).toBeVisible();
    subscription = null;
    await page.reload();
    await browserExpect(page.getByText("No paid subscription", { exact: true })).toBeVisible();
    await browserExpect(page.getByText(/^Renews /)).toHaveCount(0);
  });

  it("keeps standalone page APIs and mobile control sizes", async () => {
    for (const section of ["connections", "publishing", "billing"]) {
      await page.goto(`${origin}/standalone/${section}`);
      await browserExpect(page.locator("h1")).toHaveCount(1);
      await browserExpect(page.locator("main")).toHaveCount(1);
    }
    await open("publishing");
    await browserExpect(page.getByLabel("Preferred time")).toBeVisible();
    for (const control of [page.getByLabel("Preferred time"), page.getByLabel("Default platform", { exact: true }), page.getByRole("tab", { name: "integrations", exact: true })]) {
      expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  it("acknowledges only submitted edits when newer changes happen during a save", async () => {
    await page.goto(`${origin}/draft-probe`);
    await page.getByLabel("Draft").fill("submitted");
    await page.getByRole("button", { name: "Submit", exact: true }).click();
    await page.getByLabel("Draft").fill("newer edit");
    await page.getByRole("button", { name: "Complete", exact: true }).click();
    await page.getByRole("button", { name: "Refetch", exact: true }).click();
    await browserExpect(page.getByLabel("Draft")).toHaveValue("newer edit");
    await browserExpect(page.locator("output")).toHaveText("dirty");
  });
});