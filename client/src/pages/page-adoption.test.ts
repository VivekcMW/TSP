import { readFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import { chromium, expect as browserExpect, type Browser, type Page } from "@playwright/test";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

// Actual owned pages, Account form, shared primitives and CSS. The provider
// boundary records delegation only: explicit-new guards belong to its tests.
// Unowned embedded Settings sections are placeholders, not adoption coverage.
// Everything is bundled in memory; requests are mocked and external loads abort.
const fixture = `
  import React from "react";
  import { createRoot } from "react-dom/client";
  import { QueryClientProvider } from "@tanstack/react-query";
  import { queryClient } from "@/lib/queryClient";
  import Overview from "@/pages/overview";
  import Discover from "@/pages/dashboard";
  import { SettingsShell } from "@/components/settings/settings-shell";
  window.__calls = []; window.__createCalls = []; window.__toasts = []; window.__pendingAccount = []; window.__unexpectedRequests = [];
  window.__refresh = () => queryClient.invalidateQueries();
  window.__refreshState = value => queryClient.setQueryData(["inbox-refresh-job"], { progress: {}, ...value });
  queryClient.setDefaultOptions({ ...queryClient.getDefaultOptions(), queries: { ...queryClient.getDefaultOptions().queries, retry: false, refetchOnWindowFocus: false } });
  const unexpected = (method, url) => {
    const message = "Unmocked request: " + method + " " + url;
    window.__unexpectedRequests.push(message);
    throw new Error(message);
  };
  window.fetch = async (input, options = {}) => {
    const url = String(input), state = window.__state, method = options.method || "GET";
    window.__calls.push({ url, method, body: options.body ? JSON.parse(options.body) : null });
    if (method === "POST" && url === "/api/account/update-name") {
      if (state.deferAccount) await new Promise(resolve => window.__pendingAccount.push(resolve));
      return new Response(JSON.stringify(state.accountError ? { message: "Account service unavailable" } : { saved: true }), { status: state.accountError ? 503 : 200 });
    }
    if (method !== "GET") return unexpected(method, url);
    const parsed = new URL(url, location.origin);
    if (parsed.origin !== location.origin || parsed.hash) return unexpected(method, url);
    if (parsed.pathname === "/api/inbox") {
      const keys = [...parsed.searchParams.keys()];
      const status = parsed.searchParams.get("status");
      if (keys.some(key => key !== "status") || keys.length > 1 || (status !== null && !["active", "saved", "dismissed"].includes(status))) return unexpected(method, url);
      if (state.inboxError) return new Response(JSON.stringify({ message: typeof state.inboxError === "string" ? state.inboxError : "Inbox unavailable" }), { status: 503 });
      return new Response(JSON.stringify(status === null ? state.inbox : state.inbox.filter(item => item.status === status)));
    }
    if (url === "/api/drafts" && state.draftsError) return new Response(JSON.stringify({ message: "Drafts unavailable" }), { status: 503 });
    const responses = {
      "/api/drafts": state.drafts, "/api/drafts/published": [], "/api/profile": { onboardingStatus: "completed" },
      "/api/me": state.user, "/api/drafts/scheduled": { items: state.schedules }, "/api/trends": [],
      "/api/analytics/summary": { connected: { linkedin: false, twitter: false }, combined: {}, availability: {}, linkedin: null, twitter: null, lastSync: null },
      "/api/team/context": { tenantId: "t", tenantName: "Personal", tenantKind: "personal", role: "owner", memberships: [] },
    };
    if (!Object.hasOwn(responses, url)) return unexpected(method, url);
    return new Response(JSON.stringify(responses[url]));
  };
  const Surface = { home: Overview, discover: Discover, settings: SettingsShell }[window.__state.surface];
  createRoot(document.getElementById("root")).render(<QueryClientProvider client={queryClient}>
    <div className="flex h-svh min-h-0"><aside aria-label="Fixture sidebar" className="hidden w-64 shrink-0 md:block" />
      <div className="h-full min-w-0 flex-1"><Surface /></div>
    </div>
  </QueryClientProvider>);
`;

let browser: Browser;
let page: Page;
let script: string;
let css: string;

beforeAll(async () => {
  const root = path.resolve(import.meta.dirname, "../../..");
  const bundle = await build({
    stdin: { contents: fixture, resolveDir: root, loader: "tsx" }, absWorkingDir: root,
    alias: { "@": path.join(root, "client/src"), "@shared": path.join(root, "shared") },
    bundle: true, write: false, format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"test"' },
    plugins: [{ name: "page-adoption-boundaries", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/(auth|dev-auth)$/ }, () => ({ path: "auth", namespace: "adoption" }));
      builder.onResolve({ filter: /create-post-provider$/ }, () => ({ path: "create", namespace: "adoption" }));
      builder.onResolve({ filter: /use-toast$/ }, () => ({ path: "toast", namespace: "adoption" }));
      // Supply stress-test copy, but render the actual shared empty-state component.
      builder.onResolve({ filter: /\/components\/dashboard\/empty-state(?:\.tsx)?$/ }, args => {
        if (args.namespace === "adoption-empty") return;
        return { path: "empty", namespace: "adoption-empty" };
      });
      builder.onLoad({ filter: /.*/, namespace: "adoption-empty" }, () => ({ contents: `
        import React from "react";
        import { DashboardEmptyState as Empty } from ${JSON.stringify(path.join(root, "client/src/components/dashboard/empty-state.tsx"))};
        export const DashboardEmptyState = props => <Empty {...props} description={window.__state.emptyDescription ?? props.description} />;
      `, loader: "tsx", resolveDir: root }));
      builder.onResolve({ filter: /^@\/pages\/(profile-settings|plugins|analytics|billing)$/ }, () => ({ path: "default", namespace: "adoption-child" }));
      builder.onResolve({ filter: /^\.\/(notification-settings|editorial-voice-settings|invitation-settings|team-settings)$/ }, ({ path: name }) => ({ path: name, namespace: "adoption-child" }));
      builder.onLoad({ filter: /.*/, namespace: "adoption-child" }, () => ({ contents: `
        const Section = () => "Unowned embedded section fixture";
        export default Section;
        export const NotificationSettings = Section, EditorialVoiceSettings = Section, InvitationSettings = Section, TeamSettings = Section;
      `, loader: "js" }));
      builder.onLoad({ filter: /.*/, namespace: "adoption" }, ({ path: name }) => ({ contents: {
        auth: "export const useAuth = () => ({ user: window.__state.user }); export const useIsSignedIn = () => true;",
        create: "export const useCreatePost = () => ({ hasCreation: window.__state.hasCreation, openCreate: item => window.__createCalls.push({ action: 'resume', id: item?.id }), startNewCreate: () => window.__createCalls.push({ action: 'new' }) });",
        toast: "export const useToast = () => ({ toast: value => window.__toasts.push(value) });",
      }[name], loader: "js" }));
    } }],
  });
  script = bundle.outputFiles[0].text;
  const stylesheet = readFileSync(path.join(root, "client/src/index.css"), "utf8")
    .replace('@import "./design/tokens.generated.css";', readFileSync(path.join(root, "client/src/design/tokens.generated.css"), "utf8"));
  css = (await postcss([tailwindcss(path.join(root, "tailwind.config.ts"))]).process(stylesheet, { from: path.join(root, "client/src/index.css") })).css;
  browser = await chromium.launch({ headless: true });
}, 60_000);
afterEach(async () => {
  if (!page || page.isClosed()) return;
  try {
    // React Query catches rejected fetches. Do not let an error pane hide a missing mock.
    expect(await page.evaluate(() => (window as any).__unexpectedRequests ?? [])).toEqual([]);
  } finally { await page.close(); }
});
afterAll(async () => { await browser?.close(); });

const article = (index = 0) => ({
  id: `article-${index}`, source: "Example publication", headline: `Research story ${index}: a useful editorial development`,
  articleUrl: `https://example.test/story-${index}`, summary: "A detailed saved excerpt for independent pane scrolling.\n".repeat(50),
  matchedKeywords: ["Research"], createdAt: "2026-09-17T09:00:00Z", status: "active",
});
const savedDraft = { id: "draft-one", content: "A saved draft, not a published post.", platform: "linkedin", publishStatus: "draft" };

async function mount(surface: "home" | "discover" | "settings", width = 1280, overrides: Record<string, unknown> = {}, height = 800, textZoom = 1) {
  page = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" });
  page.setDefaultTimeout(5_000);
  await page.route("**/*", route => route.request().url() === "https://adoption.test/"
    ? route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head></head><body><div id="root"></div></body></html>' }) : route.abort());
  await page.goto("https://adoption.test/");
  await page.evaluate(({ surface, overrides, articles }) => {
    history.replaceState(null, "", surface === "settings" ? "/dashboard/settings?tab=account&keep=context" : `/dashboard/${surface}`);
    (window as any).__state = { surface, inbox: articles, drafts: [], schedules: [], hasCreation: false,
      user: { firstName: "Ada", lastName: "Lovelace", email: "ada@example.test" }, ...overrides };
  }, { surface, overrides, articles: Array.from({ length: 20 }, (_, index) => article(index)) });
  await page.addStyleTag({ content: css });
  if (textZoom !== 1) await page.addStyleTag({ content: `html { font-size: ${16 * textZoom}px; }` });
  await page.addScriptTag({ content: script });
  await page.getByRole("heading", { level: 1 }).waitFor();
  // The actual ready landmark survives the card-personalized-briefing → card-nextaction rename.
  if (surface === "home") await page.getByRole("heading", { name: "Next action", level: 2, exact: true }).waitFor();
  if (surface === "discover") {
    const pane = page.locator("[data-discover-panes]");
    await browserExpect(pane).toHaveAttribute("data-discover-state", overrides.inboxError ? "error" : /^(ready|empty)$/);
    if (await pane.getAttribute("data-discover-state") === "ready") await pane.locator('[aria-current="true"]').waitFor();
  }
}

async function writes() {
  return page.evaluate(() => (window as any).__calls.filter((call: { method: string }) => call.method !== "GET"));
}

const widths = [320, 375, 768, 1024, 1440];
const longGuidance = "Review your interests and sources before trying again. ".repeat(60);
const discoverLayouts = widths.flatMap(width => {
  const views = [
    { viewportWidth: width, height: 360, textZoom: 1, zoom: "100%" },
    { viewportWidth: width, height: 360, textZoom: 2, zoom: "200% text" },
    // Browser zoom halves the CSS viewport; emulate reflow, not screenshot scaling.
    { viewportWidth: Math.ceil(width / 2), height: 400, textZoom: 1, zoom: "200% layout-equivalent" },
  ];
  return views.flatMap(view => ["empty", "error"].map(state => ({ width, ...view, state })));
});

describe("strict page-adoption request fixtures", () => {
  it("parses only inbox status queries and returns the matching saved/dismissed rows", async () => {
    const inbox = [article(0), { ...article(1), status: "saved" }, { ...article(2), status: "dismissed" }];
    await mount("discover", 1280, { inbox });
    const responses = await page.evaluate(async () => Promise.all(["active", "saved", "dismissed"].map(async status => {
      const response = await fetch("/api/inbox?" + new URLSearchParams({ status }));
      return response.json();
    })));
    expect(responses.map(items => items.map((item: { id: string }) => item.id))).toEqual([["article-0"], ["article-1"], ["article-2"]]);
    await page.getByTestId("button-filter-saved").click();
    await browserExpect(page.getByTestId("row-inbox-article-1")).toBeVisible();
    await browserExpect(page.getByTestId("row-inbox-article-0")).toHaveCount(0);
    expect(await writes()).toEqual([]);
  });

  it("rejects and records unknown URLs, query parameters, statuses and methods even during an inbox outage", async () => {
    await mount("discover", 1280, { inboxError: true });
    const rejected = await page.evaluate(async () => {
      const urls = ["/api/unmocked", "/api/inbox/refresh/unknown", "/api/inbox?status=unknown", "/api/inbox?status=saved&extra=1", "/api/inbox?status=active&status=saved", "https://external.test/api/inbox"];
      const failures = await Promise.all(urls.map(url => fetch(url).then(() => "UNEXPECTED SUCCESS", error => error.message)));
      failures.push(await fetch("/api/inbox", { method: "POST" }).then(() => "UNEXPECTED SUCCESS", error => error.message));
      const recorded = (window as any).__unexpectedRequests.slice();
      // Only this negative control consumes its expected failures; normal tests never do.
      (window as any).__unexpectedRequests = [];
      return { failures, recorded };
    });
    expect(rejected.failures).toHaveLength(7);
    expect(rejected.failures.every(message => message.startsWith("Unmocked request: "))).toBe(true);
    expect(rejected.recorded).toEqual(rejected.failures);
  });
});

describe("owned-page layout adoption (authored, not full embedded-section acceptance)", () => {
  it.each((["home", "discover", "settings"] as const).flatMap(surface => [320, 375, 768, 1024, 1440].map(width => ({ surface, width }))))("coordinates $surface header/body with sidebar-reduced space at $width px", async ({ surface, width }) => {
    await mount(surface, width);
    const expectedWidth = surface === "discover" ? "workbench" : "standard";
    const geometry = await page.evaluate(() => {
      const header = document.querySelector<HTMLElement>("[data-page-header]")!;
      const body = document.querySelector<HTMLElement>("[data-page-body]")!;
      const boxes = [header, body].map(element => {
        const container = element.querySelector<HTMLElement>("[data-page-container]")!;
        const box = container.getBoundingClientRect();
        return { x: box.x, width: box.width, max: getComputedStyle(container).maxWidth, preset: container.dataset.pageWidth, gutter: getComputedStyle(element).paddingLeft };
      });
      const clipped = [...document.querySelectorAll<HTMLElement>("[data-page-container], [data-page-toolbar], [data-page-filters], [data-page-actions]")]
        .filter(element => element.scrollWidth > element.clientWidth + 1).map(element => element.outerHTML.slice(0, 150));
      return { boxes, clipped, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    expect(geometry.boxes[0]).toEqual(geometry.boxes[1]);
    expect(geometry.boxes[0]).toMatchObject({ max: surface === "discover" ? "1280px" : "1024px", preset: expectedWidth, gutter: width < 640 ? "16px" : "24px" });
    expect(geometry.clipped).toEqual([]);
    expect(geometry.overflow).toBe(false);
    await browserExpect(page.getByRole("main")).toHaveCount(1);
    await browserExpect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    // Settings keeps its existing horizontal toolbar row only below md (768px);
    // at md and above it switches to the left-side section list (not a toolbar).
    if (surface === "settings" && width >= 768) {
      const nav = page.locator("[data-settings-nav]");
      await browserExpect(nav).toBeVisible();
      const geometrySettings = await page.evaluate(() => {
        const navEl = document.querySelector<HTMLElement>("[data-settings-nav]")!;
        const tabs = [...navEl.querySelectorAll<HTMLElement>('[role="tab"]')];
        const content = navEl.nextElementSibling as HTMLElement;
        return {
          insideBody: Boolean(navEl.closest("[data-page-body]")),
          tabCount: tabs.length,
          tabHeights: tabs.map(tab => tab.getBoundingClientRect().height),
          navTop: navEl.getBoundingClientRect().top,
          contentTop: content.getBoundingClientRect().top,
          navLeft: navEl.getBoundingClientRect().left,
          contentLeft: content.getBoundingClientRect().left,
        };
      });
      expect(geometrySettings.insideBody).toBe(true);
      expect(geometrySettings.tabCount).toBe(8);
      expect(geometrySettings.tabHeights.every(height => height >= 36)).toBe(true);
      expect(geometrySettings.navTop).toBe(geometrySettings.contentTop);
      expect(geometrySettings.navLeft).toBeLessThan(geometrySettings.contentLeft);
    } else if (surface !== "home") {
      const toolbar = page.locator("[data-page-toolbar]");
      expect(await toolbar.evaluate(element => getComputedStyle(element).position)).toBe("static");
      expect(await toolbar.evaluate(element => Boolean(element.closest("[data-page-body]")))).toBe(true);
      const heights = await toolbar.locator('button').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height));
      expect(heights.length).toBeGreaterThan(0);
      expect(heights.every(height => height >= (width < 768 ? 44 : 32))).toBe(true);
      const options = await toolbar.locator('button[aria-pressed], [role="tab"]').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height));
      expect(options.length).toBeGreaterThan(0);
      expect(options.every(height => height === (width < 768 ? 44 : 32))).toBe(true);
    }
    expect(await writes()).toEqual([]);
  });

  it("preserves independent Discover list/detail scrolling without moving filters or sibling panes", async () => {
    await mount("discover", 1440);
    const scrolls = await page.locator("[data-discover-panes]").evaluate(element => {
      const list = element.querySelector<HTMLElement>(":scope > div > div")!;
      const detail = element.querySelector<HTMLElement>(".dashboard-touch-targets > div")!;
      const toolbar = document.querySelector("[data-page-toolbar]")!;
      const body = document.querySelector<HTMLElement>("[data-page-body]")!;
      const toolbarY = toolbar.getBoundingClientRect().y;
      const detailY = detail.getBoundingClientRect().y;
      list.scrollTop = 160;
      const detailBefore = detail.scrollTop;
      detail.scrollTop = 180;
      return { list: list.scrollTop, detail: detail.scrollTop, detailBefore, body: body.scrollTop,
        stable: toolbar.getBoundingClientRect().y === toolbarY && detail.getBoundingClientRect().y === detailY,
        innerOverflow: [list, detail].some(pane => pane.scrollWidth > pane.clientWidth + 1) };
    });
    expect(scrolls).toEqual({ list: 160, detail: 180, detailBefore: 0, body: 0, stable: true, innerOverflow: false });
    await page.getByTestId("button-filter-saved").click();
    await browserExpect(page.getByTestId("button-filter-saved")).toHaveAttribute("aria-pressed", "true");
    await browserExpect(page.locator('[data-workflow-status="neutral"]')).toContainText("No saved articles found");
    await page.getByRole("button", { name: "Show active articles" }).click();
    await browserExpect(page.getByTestId("row-inbox-article-0")).toBeVisible();
  });

  it("keeps all Discover filters visible during a failed read and exposes a real retry", async () => {
    await mount("discover", 320, { inboxError: true });
    await browserExpect(page.getByRole("alert")).toContainText("Discover could not be loaded");
    for (const filter of ["all", "saved", "dismissed"]) await browserExpect(page.getByTestId(`button-filter-${filter}`)).toBeVisible();
    await page.evaluate(() => { (window as any).__state.inboxError = false; });
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await browserExpect(page.getByTestId("row-inbox-article-0")).toBeVisible();
    expect(await writes()).toEqual([]);
  });

  it.each(widths)("marks the current Discover row with Cobalt, pale blue and a visible check at %i px", async width => {
    await mount("discover", width);
    const selected = page.getByTestId("row-inbox-article-0");
    await browserExpect(selected).toHaveAttribute("aria-current", "true");
    await browserExpect(selected.locator("[data-inbox-selected-marker]")).toBeVisible();
    // Selection commits before transition-colors paints its final values; even
    // reduced motion uses a nonzero duration. Missing utilities still fail here.
    await browserExpect.poll(() => selected.evaluate(element => {
      const style = getComputedStyle(element);
      return { border: style.borderLeftColor, background: style.backgroundColor };
    }), { timeout: 1_000, intervals: [25, 50, 100] }).toEqual({ border: "rgb(29, 78, 216)", background: "rgb(239, 246, 255)" });
    await browserExpect(page.getByTestId("row-inbox-article-1")).toHaveAttribute("aria-current", "false");
    await browserExpect(page.getByTestId("row-inbox-article-1").locator("[data-inbox-selected-marker]")).toHaveCount(0);
  });

  it.each(discoverLayouts)("keeps long Discover $state actions reachable at $width px and $zoom zoom with short height", async ({ viewportWidth, height, textZoom, state }) => {
      await mount("discover", viewportWidth, state === "empty"
        ? { inbox: [], emptyDescription: longGuidance + "UnbrokenInterest".repeat(24) }
        : { inboxError: longGuidance }, height, textZoom);
      const pane = page.locator("[data-discover-panes]");
      expect(await pane.evaluate(element => ({ overflow: getComputedStyle(element).overflowY, scrollable: element.scrollHeight > element.clientHeight })))
        .toEqual({ overflow: "auto", scrollable: true });
      const action = state === "empty" ? page.getByTestId("button-refresh-empty") : page.getByRole("button", { name: "Try again", exact: true });
      await action.scrollIntoViewIfNeeded();
      await action.focus();
      await browserExpect(action).toBeFocused();
      // A trial click proves hit-testing/actionability without starting a refresh.
      await action.click({ trial: true });
      await browserExpect(action).toBeInViewport();
      const geometry = await action.evaluate(element => {
        const box = element.getBoundingClientRect();
        const x = box.x + box.width / 2, y = box.y + box.height / 2;
        const pane = document.querySelector<HTMLElement>("[data-discover-panes]")!;
        return { scrolled: pane.scrollTop > 0, reachable: element.contains(document.elementFromPoint(x, y)),
          overflow: [...document.querySelectorAll<HTMLElement>("[data-page-container], [data-discover-panes], .dashboard-touch-targets")].some(node => node.scrollWidth > node.clientWidth + 1) };
      });
      expect(geometry).toEqual({ scrolled: true, reachable: true, overflow: false });
      if (state === "error") {
        await page.evaluate(() => { (window as any).__state.inboxError = false; });
        await action.press("Enter");
        await browserExpect(page.getByTestId("row-inbox-article-0")).toBeVisible();
      }
      expect(await writes()).toEqual([]);
    });
});

describe("Home's contextual action and semantic statuses", () => {
  it.each([
    { label: "Resume creation", overrides: { hasCreation: true, drafts: [savedDraft] }, action: "resume" },
    { label: "Review drafts", overrides: { drafts: [savedDraft] }, href: "/dashboard/content" },
    { label: "Explore story", overrides: {}, href: "/dashboard/discover" },
    { label: "Create post", overrides: { inbox: [] }, action: "new" },
  ])("shows one primary: $label", async ({ label, overrides, action, href }) => {
    await mount("home", 375, overrides);
    const primary = page.locator("main button.bg-primary, main a.bg-primary");
    await browserExpect(primary).toHaveCount(1);
    await browserExpect(primary).toHaveText(label);
    if (href) await browserExpect(primary).toHaveAttribute("href", href);
    else {
      await primary.click();
      expect(await page.evaluate(() => (window as any).__createCalls)).toEqual([{ action }]);
    }
    const nextActionHeading = page.getByRole("heading", { name: "Next action", level: 2, exact: true });
    await browserExpect(nextActionHeading).toBeVisible();
    await browserExpect(nextActionHeading.locator("svg")).toHaveCount(0);
    await browserExpect(page.getByRole("heading", { name: "Upcoming publishing", level: 2 })).toBeVisible();
    expect(await writes()).toEqual([]);
  });

  it("delegates explicit New post separately from resume; it does not clear or recreate provider state", async () => {
    await mount("home", 1280, { hasCreation: true });
    await page.getByRole("button", { name: "Resume creation" }).click();
    await page.getByTestId("button-overview-instant-review").click();
    expect(await page.evaluate(() => (window as any).__createCalls)).toEqual([{ action: "resume" }, { action: "new" }]);
    expect(await page.evaluate(() => (window as any).__state.hasCreation)).toBe(true);
    expect(await writes()).toEqual([]);
  });

  it.each([
    { status: "unavailable", tone: "warning", role: "status" },
    { status: "failed", tone: "error", role: "alert" },
    { status: "completed", tone: "success", role: "status" },
    { status: "queued", tone: "info", role: "status" },
  ])("uses $tone for $status without turning a refresh into saved/published content", async ({ status, tone, role }) => {
    await mount("home");
    await page.evaluate(status => (window as any).__refreshState({ status, message: "Refresh result" }), status);
    const notice = page.locator(`[data-workflow-status="${tone}"]`);
    await browserExpect(notice.locator(`[role="${role}"]`)).toBeVisible();
    expect(await writes()).toEqual([]);
  });
});

describe("Settings shell and Account form adoption", () => {
  it.each([320, 375])("keeps Email help described while closed and its 44px label-edge click separate from form submission at %i px", async width => {
    await mount("settings", width);
    const fullName = page.getByRole("textbox", { name: "Full Name", exact: true });
    const email = page.getByRole("textbox", { name: "Email", exact: true });
    const help = page.getByRole("button", { name: "About Email", exact: true });
    const save = page.getByRole("button", { name: "Save Account", exact: true });
    const description = page.locator('[data-info-description][id="email-help"]');
    const popup = page.locator("[data-info-popup]");
    await browserExpect(fullName).toHaveAccessibleName("Full Name");
    await browserExpect(email).toHaveAccessibleName("Email");
    await browserExpect(help).toHaveAttribute("data-info-trigger", "");
    await browserExpect(description).toHaveText("Email cannot be changed here.");
    await browserExpect(description).toHaveClass(/\bsr-only\b/);
    await browserExpect(email).toHaveAttribute("aria-describedby", "email-help");
    await browserExpect(email).toHaveAccessibleDescription("Email cannot be changed here.");
    await browserExpect(popup).toHaveCount(0);

    // An untouched form would hide an accidental submit behind the dirty guard.
    await fullName.fill("Ada unsaved help check");
    await browserExpect(save).toBeEnabled();
    const callsBefore = await page.evaluate(() => (window as any).__calls);
    await help.scrollIntoViewIfNeeded();
    expect(await help.evaluate(element => {
      const box = element.getBoundingClientRect();
      return { width: box.width, height: box.height, insideLabel: Boolean(element.closest("label")) };
    })).toEqual({ width: 44, height: 44, insideLabel: false });
    // Use the label-facing edge, not the centre icon, to catch overlapping targets.
    await help.click({ position: { x: 1, y: 22 } });
    await browserExpect(popup).toBeVisible();
    await browserExpect(popup).toContainText("Email cannot be changed here.");
    await browserExpect(help).toBeFocused();
    await browserExpect(email).not.toBeFocused();
    await help.press("Escape");
    await browserExpect(popup).toHaveCount(0);
    await browserExpect(description).toHaveText("Email cannot be changed here.");
    await browserExpect(email).toHaveAccessibleDescription("Email cannot be changed here.");
    await browserExpect(email).toHaveValue("ada@example.test");
    await browserExpect(fullName).toHaveValue("Ada unsaved help check");
    await browserExpect(save).toBeEnabled();
    expect(await page.evaluate(() => (window as any).__calls)).toEqual(callsBefore);
    expect(await page.evaluate(() => (window as any).__toasts)).toEqual([]);
    expect(await writes()).toEqual([]);
  });

  it("keeps Account heading help separately named and available on hover, focus and keyboard activation", async () => {
    await mount("settings", 375);
    const heading = page.getByRole("heading", { name: "Account information", level: 2, exact: true });
    const help = page.getByRole("button", { name: "About Account information", exact: true });
    const popup = page.locator("[data-info-popup]");
    const guidance = "Update your name. Email and profile photo are managed by your sign-in provider.";
    await browserExpect(page.getByRole("heading", { name: "Settings", level: 1, exact: true })).toBeVisible();
    await browserExpect(heading).toHaveAccessibleName("Account information");
    await browserExpect(heading.locator("[data-info-trigger]")).toHaveCount(0);
    await browserExpect(help).toHaveAttribute("data-info-trigger", "");
    await browserExpect(help).toHaveAccessibleDescription(guidance);
    await browserExpect(popup).toHaveCount(0);
    const callsBefore = await page.evaluate(() => (window as any).__calls);

    await help.hover();
    await browserExpect(popup).toBeVisible();
    await browserExpect(popup).toContainText(guidance);
    await page.mouse.move(0, 0, { steps: 10 });
    await browserExpect(popup).toHaveCount(0);
    await help.focus();
    await browserExpect(popup).toBeVisible();
    await help.press("Escape");
    await browserExpect(popup).toHaveCount(0);
    await help.press("Enter");
    await browserExpect(popup).toBeVisible();
    await browserExpect(popup).toContainText(guidance);
    await help.press("Escape");
    await browserExpect(popup).toHaveCount(0);
    await browserExpect(help).toBeFocused();
    await browserExpect(help).toHaveAccessibleDescription(guidance);
    await browserExpect(heading).toHaveAccessibleName("Account information");
    await browserExpect(page.getByRole("button", { name: "Save Account", exact: true })).toBeDisabled();
    expect(await page.evaluate(() => (window as any).__calls)).toEqual(callsBefore);
    expect(await writes()).toEqual([]);
  });

  it("associates native fields, keeps email readable and retains dirty edits across sections and background reads", async () => {
    await mount("settings", 320);
    const email = page.getByRole("textbox", { name: "Email", exact: true });
    await browserExpect(email).toHaveValue("ada@example.test");
    await browserExpect(email).not.toBeDisabled();
    await browserExpect(email).toHaveAttribute("readonly", "");
    expect(await email.evaluate(element => getComputedStyle(element).opacity)).toBe("1");
    expect(await email.evaluate(element => (element.getAttribute("aria-describedby") ?? "").split(" ").every(id => document.getElementById(id)?.textContent?.includes("Email cannot be changed")))).toBe(true);
    await browserExpect(page.getByRole("heading", { name: "Account information", level: 2, exact: true })).toBeVisible();
    await page.getByRole("textbox", { name: "Full Name", exact: true }).fill("Ada working copy");
    await page.getByTestId("tab-content-preferences").click();
    await page.getByTestId("tab-account").click();
    await page.evaluate(() => (window as any).__refresh());
    await browserExpect(page.getByRole("textbox", { name: "Full Name", exact: true })).toHaveValue("Ada working copy");
    expect(new URL(page.url()).searchParams.get("keep")).toBe("context");
    expect(await writes()).toEqual([]);
  });

  it("distinguishes pending, failed and saved persistence while retaining local account text", async () => {
    await mount("settings", 375, { deferAccount: true });
    await page.getByRole("textbox", { name: "Full Name", exact: true }).fill("Ada revised");
    await page.getByTestId("button-save-account").click();
    await browserExpect(page.locator('[data-workflow-status="info"]')).toContainText("Saving account changes");
    await browserExpect(page.getByRole("textbox", { name: "Full Name", exact: true })).toBeDisabled();
    await page.evaluate(() => { (window as any).__state.accountError = true; (window as any).__pendingAccount.shift()(); });
    await browserExpect(page.getByRole("alert")).toContainText("Account changes were not saved");
    await browserExpect(page.getByRole("textbox", { name: "Full Name", exact: true })).toHaveValue("Ada revised");
    await browserExpect(page.getByRole("textbox", { name: "Full Name", exact: true })).toBeEnabled();
    await page.evaluate(() => { (window as any).__state.accountError = false; (window as any).__state.deferAccount = false; });
    await page.getByTestId("button-save-account").click();
    await browserExpect(page.locator('[data-workflow-status="success"]')).toContainText("Account changes saved");
    await browserExpect(page.getByTestId("button-save-account")).toBeDisabled();
    await page.getByRole("textbox", { name: "Full Name", exact: true }).fill("Another unsaved change");
    await browserExpect(page.locator('[data-workflow-status="success"]')).toHaveCount(0);
    expect((await writes()).map((call: { url: string; body: unknown }) => ({ url: call.url, body: call.body }))).toEqual([
      { url: "/api/account/update-name", body: { fullName: "Ada revised" } },
      { url: "/api/account/update-name", body: { fullName: "Ada revised" } },
    ]);
  });
});