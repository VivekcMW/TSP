import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect } from "vitest";
import { chromium, expect as browserExpect, type Browser, type Locator, type Page } from "@playwright/test";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import tailwindConfig from "../../tailwind.config";
import { installActualAppApi, expectActualAppGeometry, expectReachableAction, expectReadableControls,
  doubleTextSize, expectDoubledText, captureActualApp, deferredResponse, fixtureDraft, LONG_TITLE, LONG_TEXT, LONG_FOCUS,
  type ActualAppApi } from "./actual-app.fixture";

let browser: Browser;
let server: Server;
let origin: string;
let page: Page;
let account: string;
let failures: Map<string, number>;
let errors: string[];
let apiCalls: { method: string; pathname: string }[];

const workspacePages = new Set(["overview", "dashboard", "drafts", "calendar", "settings", "create-post"].map(name => `@/pages/${name}`));

beforeAll(async () => {
  const root = path.resolve(import.meta.dirname, "../..");
  const bundles = new Map<string, string>();
  // Keep the original security fixture; UX tests additionally use the real shell
  // and all six workspace pages, not a component-only layout approximation.
  for (const realWorkspace of [false, true]) {
  const result = await build({
    absWorkingDir: root, entryPoints: [path.join(import.meta.dirname, "app-fixture.tsx")],
    bundle: true, write: false, format: "esm", platform: "browser", jsx: "automatic",
    define: { "import.meta.env.BASE_URL": '"/"', "import.meta.env.DEV": "false", "import.meta.env.PROD": "false" },
    alias: { "@": path.join(root, "client/src"), "@shared": path.join(root, "shared") },
    plugins: [{ name: "mock-app-boundaries", setup(plugin) {
      plugin.onResolve({ filter: /auth-client$/ }, () => ({ path: path.join(import.meta.dirname, "auth-fixture.ts") }));
      plugin.onResolve({ filter: /^@\/(pages\/|components\/(app-sidebar|dashboard\/navbar|admin\/admin-layout|public-routes))/ }, args => {
        // Keep real Settings, its child pages, Create provider, motion and router.
        if (!args.importer.endsWith("/App.tsx")) return;
        if (realWorkspace && (workspacePages.has(args.path) || args.path === "@/components/app-sidebar" || args.path === "@/components/dashboard/navbar")) return;
        if (args.path === "@/pages/settings" || args.path === "@/pages/create-post") return;
        return { path: args.path, namespace: "app-mock" };
      });
      plugin.onLoad({ filter: /.*/, namespace: "app-mock" }, args => {
        let contents: string;
        if (args.path.endsWith("/app-sidebar")) contents = `export const AppSidebar = () => <aside data-testid="shell">Shell</aside>;`;
        else if (args.path.endsWith("/navbar")) contents = `
          import { Link } from "wouter";
          import { useCreatePost } from "@/components/dashboard/create-post-provider";
          export function DashboardNavbar() { const {openCreate} = useCreatePost(); return <nav>
            <button onClick={() => openCreate()}>Open Create</button>
            <Link href="/dashboard/settings?tab=content">Settings link</Link>
            <Link href="/dashboard/calendar">Calendar link</Link>
          </nav>; }`;
        else if (args.path.endsWith("/admin-layout")) contents = `export const AdminLayout = ({children}) => <div data-testid="admin-shell">{children}</div>;`;
        else if (args.path.endsWith("/public-routes")) contents = `export const PublicRoutes = () => <div>Public page</div>;`;
        else if (args.path === "@/pages/auth") contents = `export const SignInPage = () => null; export const SignUpPage = SignInPage; export const VerifyEmailPage = SignInPage;`;
        else contents = `export default function Page() { return <div data-testid="route-page">${args.path}</div>; }`;
        return { contents, loader: "tsx", resolveDir: root };
      });
    } }],
  });
  bundles.set(realWorkspace ? "/workspace.js" : "/fixture.js", result.outputFiles[0].text);
  }
  const cssPath = path.join(root, "client/src/index.css");
  const sourceCss = (await readFile(cssPath, "utf8")).replace('@import "./design/tokens.generated.css";', await readFile(path.join(root, "client/src/design/tokens.generated.css"), "utf8"));
  const css = (await postcss([tailwindcss({ ...tailwindConfig, content: [path.join(root, "client/src/**/*.{ts,tsx}")] })]).process(sourceCss, { from: cssPath })).css;
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://fixture.invalid");
    const bundle = bundles.get(url.pathname);
    if (bundle) { res.setHeader("Content-Type", "text/javascript"); res.end(bundle); return; }
    if (url.pathname === "/workspace.css") { res.setHeader("Content-Type", "text/css"); res.end(css); return; }
    if (!/^\/dashboard(?:\/|$)/.test(url.pathname)) { res.writeHead(404); res.end(); return; }
    const workspace = url.searchParams.get("fixture") === "workspace";
    res.setHeader("Content-Type", "text/html");
    res.end(`<!doctype html><html lang="en" class="light"><head><meta name="viewport" content="width=device-width, initial-scale=1">${workspace ? '<link rel="stylesheet" href="/workspace.css">' : ""}</head><body><div id="root"></div><script type="module" src="/${workspace ? "workspace" : "fixture"}.js"></script></body></html>`);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture failed to bind");
  origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
}, 60_000);
afterAll(async () => { await browser?.close(); await new Promise<void>(resolve => server?.close(() => resolve())); });

beforeEach(async () => {
  account = "a"; failures = new Map(); errors = []; apiCalls = [];
  page = await browser.newPage({ reducedMotion: "reduce", hasTouch: true, serviceWorkers: "block" });
  page.setDefaultTimeout(5000);
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { errors.push(`External request: ${url.origin}`); return route.abort(); }
    if (!url.pathname.startsWith("/api/")) {
      if (["/fixture.js", "/workspace.js", "/workspace.css"].includes(url.pathname) || /^\/dashboard(?:\/|$)/.test(url.pathname)) return route.continue();
      errors.push(`Unmocked asset: ${url.pathname}`);
      return route.abort();
    }
    const method = route.request().method();
    apiCalls.push({ method, pathname: url.pathname });
    if (method !== "GET") { errors.push(`Unexpected API write: ${method} ${url.pathname}`); return route.abort(); }
    const reply = (data: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
    const failure = failures.get(url.pathname);
    if (failure === 0) return route.abort("internetdisconnected");
    if (failure) return reply({ message: "Fixture unavailable" }, failure);
    if (url.pathname === "/api/me") return reply({ id: account, name: `Person ${account}`, registrationCompleted: "2026-01-01", platformRole: null });
    if (url.pathname === "/api/profile") return reply({ id: `profile-${account}`, userId: account, tenantId: `tenant-${account}`, onboardingStatus: "completed", focusDescription: `Voice ${account}`, enabledPlatforms: ["linkedin"], defaultPlatform: "linkedin", defaultTone: "professional", timezone: "UTC", preferredPublishTime: "09:00", publications: [], companies: [], keywords: [], influencers: [] });
    if (["/api/integrations", "/api/inbox", "/api/drafts", "/api/drafts/published", "/api/sources", "/api/sources/suggestions", "/api/sources/publications", "/api/profile/social-links", "/api/publishing-rules"].includes(url.pathname)) return reply([]);
    if (url.pathname === "/api/drafts/scheduled") return reply({ items: [], total: 0, hasMore: false });
    if (url.pathname === "/api/analytics/summary") return reply({ connected: {}, linkedin: null, twitter: null });
    if (url.pathname === "/api/team/context") return reply({ tenantId: `tenant-${account}`, tenantName: "Personal workspace", tenantKind: "personal", role: "owner", memberships: [] });
    if (/\/api\/integrations\/[^/]+\/status/.test(url.pathname)) return reply({ connected: false });
    if (url.pathname === "/api/billing") return reply({ configured: false, plans: [], subscription: null, payments: [], paymentMethods: [] });
    errors.push(`Unmocked API: ${url.pathname}`);
    return reply({ message: "Unmocked API" }, 500);
  });
});
afterEach(async () => { await page?.close(); expect(errors).toEqual([]); });
async function open(route = "/dashboard/settings?tab=content") {
  await page.goto(origin + route);
  await browserExpect(page.getByTestId("shell")).toBeVisible();
}
async function refetch(key: string) { await page.evaluate(key => (window as any).security.refetch(key), key); }

describe("full App integration security (real router, Settings and Create provider)", () => {
  it.each(["/api/profile", "/api/me"])("keeps dirty Settings mounted after a background %s 500 and recovery", async key => {
    await open();
    const voice = page.getByRole("textbox", { name: "Voice & focus", exact: true });
    await browserExpect(voice).toHaveValue("Voice a");
    await voice.fill("Unsaved local voice");
    failures.set(key, 500);
    await refetch(key);
    await browserExpect(page.getByRole("status").filter({ hasText: "Account information" })).toBeVisible();
    await browserExpect(page.getByTestId("shell")).toBeVisible();
    if (key === "/api/profile") {
      await browserExpect(page.getByText("Content preferences could not be loaded.", { exact: false })).toBeVisible();
      await browserExpect(page.getByTestId("button-save-content-preferences")).toBeDisabled();
    } else await browserExpect(voice).toHaveValue("Unsaved local voice");
    failures.clear();
    await page.getByRole("button", { name: "Retry account information" }).click();
    await browserExpect(page.getByRole("status").filter({ hasText: "Account information" })).toHaveCount(0);
    await browserExpect(voice).toHaveValue("Unsaved local voice");
  });

  it("retains Create across route changes and an offline profile refresh, with generation failing closed", async () => {
    await open("/dashboard");
    await page.getByRole("button", { name: "Open Create", exact: true }).click();
    // Source input belongs to the real shared composer, not a fixture substitute.
    const input = page.locator('input[type="url"]').first();
    await input.fill("https://example.invalid/story");
    await page.getByRole("link", { name: "Calendar link" }).click();
    await browserExpect(page.getByTestId("route-page")).toContainText("calendar");
    await browserExpect(input).toHaveCount(0);
    await page.getByRole("button", { name: "Open Create", exact: true }).click();
    await browserExpect(input).toHaveValue("https://example.invalid/story");
    failures.set("/api/profile", 0);
    await refetch("/api/profile");
    await browserExpect(page.getByTestId("shell")).toBeVisible();
    await browserExpect(input).toHaveValue("https://example.invalid/story");
    await browserExpect(page.getByRole("button", { name: /^Generate/i }).last()).toBeDisabled();
    failures.clear();
    await refetch("/api/profile");
    await browserExpect(input).toHaveValue("https://example.invalid/story");
  });

  it.each([401, 403])("does not render cached authenticated data after a background %s", async status => {
    await open();
    failures.set("/api/profile", status);
    await refetch("/api/profile");
    await browserExpect(page.getByTestId("shell")).toHaveCount(0);
    await browserExpect(page.getByRole("textbox", { name: "Voice & focus", exact: true })).toHaveCount(0);
  });

  it("does not render the shell when initial account data fails", async () => {
    failures.set("/api/me", 500);
    await page.goto(origin + "/dashboard");
    await browserExpect(page.getByTestId("shell")).toHaveCount(0);
    await browserExpect(page.getByTestId("button-auth-error-retry")).toBeVisible();
  });

  it("clears before rendering another identity and ignores old in-flight completion", async () => {
    await open();
    await page.getByRole("textbox", { name: "Voice & focus", exact: true }).fill("Private A work");
    await page.evaluate(() => { (window as any).security.seed(); (window as any).security.startOld(); });
    account = "b";
    await page.evaluate(() => (window as any).security.setSession("b"));
    await browserExpect(page.getByRole("textbox", { name: "Voice & focus", exact: true })).toHaveValue("Voice b");
    await page.evaluate(() => (window as any).security.finishOld());
    const cache = await page.evaluate(() => (window as any).security.cache());
    expect(JSON.stringify(cache)).not.toContain("private-a");
    expect(JSON.stringify(cache)).not.toContain("tenant-a");
    await browserExpect(page.getByRole("textbox", { name: "Voice & focus", exact: true })).toHaveValue("Voice b");
  });

  it("does not reset work for same-user session refresh", async () => {
    await open();
    await page.getByRole("textbox", { name: "Voice & focus", exact: true }).fill("Retained work");
    await page.evaluate(() => (window as any).security.setSession("a"));
    await browserExpect(page.getByRole("textbox", { name: "Voice & focus", exact: true })).toHaveValue("Retained work");
  });

  it.each(["success", "error", "throw"])("clears cache on explicit signOut outcome=%s", async outcome => {
    await open();
    await page.evaluate(outcome => { (window as any).security.seed(); (window as any).security.setLogoutResult(outcome); }, outcome);
    const result = await page.evaluate(() => (window as any).security.signOut());
    if (outcome === "success") await browserExpect(page.getByTestId("shell")).toHaveCount(0);
    else { expect(result).toBe(outcome === "error" ? "Rejected" : "Offline"); await browserExpect(page.getByTestId("shell")).toBeVisible(); }
    expect(JSON.stringify(await page.evaluate(() => (window as any).security.cache()))).not.toContain("private-a");
  });

  it("clears on externally observed logout", async () => {
    await open();
    await page.evaluate(() => { (window as any).security.seed(); (window as any).security.setSession(null); });
    await browserExpect(page.getByTestId("shell")).toHaveCount(0);
    await browserExpect(page.getByText("Public page")).toBeVisible();
    // Disabled observers may create empty entries, but no private data survives.
    expect(await page.evaluate(() => (window as any).security.cache().filter((entry: { data?: unknown }) => entry.data !== undefined))).toEqual([]);
  });

  it.each([
    ["/dashboard/connections?connected=twitter&tab=billing", "integrations"],
    ["/dashboard/connections?error=access_denied&provider=linkedin&tab=content", "integrations"],
    ["/dashboard/profile?tab=account", "content"],
    ["/dashboard/profile-setup", "content"],
    ["/dashboard/preferences?tab=account", "publishing"],
    ["/dashboard/billing?tab=account", "billing"],
  ])("redirects %s to the destination tab and lets Settings consume OAuth context", async (route, tab) => {
    await open(route);
    await browserExpect(page.getByRole("tab", { name: tab, exact: true })).toHaveAttribute("aria-selected", "true");
    expect(new URL(page.url()).pathname).toBe("/dashboard/settings");
    expect(new URL(page.url()).searchParams.get("tab")).toBe(tab);
    if (route.includes("connected=")) await browserExpect(page.getByText(/connected successfully/i).first()).toBeVisible();
    if (route.includes("error=")) {
      await browserExpect(page.getByText("Connection Failed", { exact: true })).toBeVisible();
      expect(new URL(page.url()).searchParams.get("provider")).toBe("linkedin");
    }
  });

  it.each([
    "/dashboard/performance",
    "/dashboard/analytics",
    "/dashboard/performance?period=7days",
    "/dashboard/analytics?period=30days",
  ])("redirects paused Performance URL %s to Home", async route => {
    await open(route);
    await browserExpect(page.getByTestId("route-page")).toHaveText("@/pages/overview");
    expect(new URL(page.url()).pathname).toBe("/dashboard");
  });

  it("preserves the old Published view while the destination view wins", async () => {
    await open("/dashboard/published?view=drafts&provider=twitter");
    await browserExpect(page.getByTestId("route-page")).toHaveText("@/pages/drafts");
    const url = new URL(page.url());
    expect(url.pathname).toBe("/dashboard/content");
    expect(url.searchParams.get("view")).toBe("published");
    expect(url.searchParams.get("provider")).toBe("twitter");
  });
});

const workspaceRoutes = [
  { route: "/dashboard", heading: "Home" },
  { route: "/dashboard/discover", heading: "Discover" },
  { route: "/dashboard/content", heading: "Content" },
  { route: "/dashboard/calendar", heading: "Publishing Calendar" },
  { route: "/dashboard/settings", heading: "Settings" },
  { route: "/dashboard/create", heading: "Create post" },
];
const toolbarWidths = [320, 375, 768, 1024, 1440];
const formattingControls = [
  "Bold", "Italic", "Underline", "Strikethrough", "Heading", "Bulleted list", "Numbered list", "Quote", "Add link", "Inline code",
  "Font family", "Font size", "Text color", "Highlight color", "Align left", "Align center", "Align right", "Indent", "Outdent",
  "Superscript", "Subscript", "Undo", "Redo", "Clear formatting",
];

const actualAppRoutes = [
  { key: "home", route: "/dashboard", heading: "Home" },
  { key: "discover", route: "/dashboard/discover", heading: "Discover" },
  { key: "content", route: "/dashboard/content", heading: "Content" },
  { key: "calendar", route: "/dashboard/calendar", heading: "Publishing Calendar" },
  { key: "settings", route: "/dashboard/settings?tab=content", heading: "Settings" },
  { key: "article", route: "/dashboard/create", heading: "Create post" },
  { key: "idea", route: "/dashboard/create", heading: "Create post" },
] as const;
type ActualRoute = typeof actualAppRoutes[number];

async function openLoadedActualApp(api: ActualAppApi, surface: ActualRoute, width: number) {
  // Fix Date only, not timers: real query lifetimes and route transitions remain.
  await page.clock.setFixedTime(new Date("2026-10-01T10:00:00.000Z"));
  await openWorkspace(surface.route, width);
  const main = await expectWorkspaceLandmarks(surface.heading);
  if (surface.key === "home") await browserExpect(main.getByTestId("card-upcoming-publishing")).toContainText(LONG_TEXT.slice(0, 40));
  if (surface.key === "discover") await browserExpect(main.getByTestId("row-inbox-loaded-story")).toBeVisible();
  if (surface.key === "content") await browserExpect(main.getByTestId("button-menu-loaded-ready")).toBeVisible();
  if (surface.key === "calendar") await browserExpect(main.getByRole("article")).toHaveCount(1);
  if (surface.key === "settings") await browserExpect(main.getByRole("textbox", { name: "Voice & focus", exact: true })).toHaveValue(LONG_FOCUS);
  if (surface.key === "article") {
    await expectCreateMode("Article");
    await main.getByRole("combobox", { name: "Story", exact: true }).selectOption(api.state.stories[0].id);
    await browserExpect(main.getByRole("textbox", { name: "Article URL", exact: true })).toHaveValue("https://news.invalid/story");
    await browserExpect(main.getByTestId("button-generate-selected")).toBeEnabled();
    await browserExpect(main.getByTestId("social-preview-linkedin")).toBeVisible();
  }
  if (surface.key === "idea") {
    await main.getByRole("group", { name: "Create from", exact: true }).getByRole("button", { name: "Idea", exact: true }).click();
    await page.getByLabel("Article title", { exact: true }).fill(LONG_TITLE);
    await page.getByRole("textbox", { name: "Article text", exact: true }).fill(LONG_TEXT);
    await browserExpect(main.getByTestId("button-regenerate")).toBeEnabled();
  }
  await browserExpect(main.getByText(/^(Loading stories…|Loading schedules…|Loading publishing preferences…)$/)).toHaveCount(0);
  return main;
}

async function actualRouteActions(surface: ActualRoute) {
  const main = page.getByRole("main");
  const headerAction = surface.key === "home" ? main.getByTestId("button-overview-instant-review")
    : surface.key === "discover" ? main.getByTestId("button-refresh-inbox")
    : surface.key === "calendar" ? main.getByRole("button", { name: "Schedule draft", exact: true })
    : page.getByTestId("button-global-create");
  await expectReachableAction(headerAction);
  if (surface.key === "home") await expectReachableAction(main.getByRole("link", { name: "Open calendar", exact: true }));
  if (surface.key === "discover") await expectReachableAction(main.getByTestId("row-inbox-loaded-story"));
  if (surface.key === "content") await expectReachableAction(main.getByTestId("button-menu-loaded-ready"));
  if (surface.key === "calendar") await expectReachableAction(main.getByRole("button", { name: /^Schedule draft on / }).last());
  if (surface.key === "settings") {
    await main.getByRole("textbox", { name: "Voice & focus", exact: true }).fill(`${LONG_FOCUS} Local edit.`);
    await expectReachableAction(main.getByTestId("button-save-content-preferences"));
  }
  if (surface.key === "article") {
    await expectReachableAction(main.getByTestId("button-generate-selected"));
    await expectReachableAction(main.getByTestId("social-preview-threads").getByRole("button", { name: "Generate Threads", exact: true }));
  }
  if (surface.key === "idea") {
    await expectReachableAction(main.getByRole("button", { name: "Add media", exact: true }));
    await expectReachableAction(main.getByTestId("button-regenerate"));
  }
}

async function actualScreenshot(name: string) {
  // Return the route's own scroll viewport to the top only AFTER reachability
  // assertions. Do not repair styles or hide failing content for evidence.
  await page.locator("main [data-page-body]").evaluateAll(elements => elements.forEach(element => { element.scrollTop = 0; }));
  await captureActualApp(page, name);
}

describe("actual App text-only zoom fixture", () => {
  it("doubles H1, nested/inherited/explicit text and new mounts exactly once without scaling rem layout", async () => {
    await page.setContent(`<!doctype html><html><head><style>
      html { font-size: 16px } body { font-size: 16px; line-height: 24px }
      h1 { font-size: 24px !important; line-height: 30px }
      button { font-size: 14px; line-height: 20px } button.changed { font-size: 12px; line-height: 18px }
      #parent { font-size: 18px; line-height: 24px } .relative { font-size: 1.5em }
      #measure { width: 10rem; height: 40px }
      @media (prefers-reduced-motion: reduce) { * { transition-duration: 0.01ms !important } }
    </style></head><body><h1><span>Actual heading text</span></h1>
      <div id="parent"><span id="inherited">Inherited</span><span id="relative" class="relative">Relative</span></div>
      <button><span data-button-label>Nested button label</span></button>
      <p id="inline" style="font-size:13px !important;line-height:18px">Explicit inline</p>
      <div id="measure"></div><div id="hidden" hidden><span>Later visible</span></div>
    </body></html>`);
    expect(await page.evaluate(() => document.compatMode)).toBe("CSS1Compat");
    const fontSize = (selector: string) => page.locator(selector).evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize));
    await doubleTextSize(page);
    expect(await fontSize("h1")).toBe(48);
    expect(await fontSize("h1 span")).toBe(48);
    expect(await fontSize("#inherited")).toBe(36);
    expect(await fontSize("#relative")).toBe(54);
    expect(await fontSize("[data-button-label]")).toBe(28);
    expect(await fontSize("#inline")).toBe(26);
    await page.evaluate(() => {
      const span = document.createElement("span"); span.id = "late"; span.textContent = "New inherited text";
      document.querySelector("#parent")!.append(span);
      const relative = document.createElement("span"); relative.id = "late-relative"; relative.className = "relative"; relative.textContent = "New em text";
      document.querySelector("#parent")!.append(relative);
      const heading = document.createElement("h1"); heading.innerHTML = "<span>Remounted heading</span>";
      document.querySelector("h1")!.replaceWith(heading);
      const button = document.querySelector("button")!;
      button.classList.add("changed"); button.innerHTML = "<span data-button-label>Replaced button label</span>";
      document.querySelector<HTMLElement>("#hidden")!.hidden = false;
    });
    await expectDoubledText(page);
    expect(await fontSize("h1")).toBe(48);
    expect(await fontSize("h1 span")).toBe(48);
    expect(await fontSize("#late")).toBe(36);
    expect(await fontSize("#late-relative")).toBe(54);
    expect(await fontSize("[data-button-label]")).toBe(24);
    expect(await fontSize("#hidden span")).toBe(32);
    await doubleTextSize(page);
    expect(await fontSize("h1")).toBe(48);
    expect(await fontSize("#late")).toBe(36);
    expect(await fontSize("html")).toBe(16);
    expect(await page.locator("body, body *").evaluateAll(elements => elements.every(element =>
      (element as HTMLElement).style.getPropertyValue("transition-property") === ""))).toBe(true);
    expect(await page.locator("h1").evaluate(element => getComputedStyle(element).transitionProperty)).toBe("all");
    expect(await page.locator("#measure").evaluate(element => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height }))).toEqual({ width: 160, height: 40 });
  });
});

describe("UX26/27 + COLOR11 actualApp (owned loopback, strict mocked APIs)", () => {
  let api: ActualAppApi;
  let decisions: boolean[];
  let confirmations: string[];
  beforeEach(async () => {
    api = await installActualAppApi(page, origin, errors, apiCalls);
    decisions = []; confirmations = [];
    page.on("dialog", async dialog => {
      confirmations.push(dialog.message());
      const accept = decisions.shift();
      if (accept === undefined || dialog.type() !== "confirm") errors.push(`Unexpected native dialog: ${dialog.type()} ${dialog.message()}`);
      if (accept) await dialog.accept(); else await dialog.dismiss();
    });
  });
  afterEach(async () => {
    try {
      await api.assertNoDelivery();
      expect(decisions, "Every planned confirmation must be shown").toEqual([]);
    } finally {
      for (const job of api.state.jobs.values()) { job.gate?.release(); job.resultGate?.release(); }
    }
  });

  it.each(toolbarWidths.flatMap(width => ["light", "os-dark"].flatMap(mode => actualAppRoutes.map(surface => ({ ...surface, width, mode })))))(
    "loaded $key at $width px ($mode): aligned edges, one main/H1, no local/page clipping, reachable actions",
    async ({ width, mode, ...surface }) => {
      await page.emulateMedia({ colorScheme: mode === "os-dark" ? "dark" : "light", reducedMotion: "reduce" });
      const main = await openLoadedActualApp(api, surface, width);
      await browserExpect(page.locator("html")).toHaveClass("light");
      await expectNoNestedInteractive(page.locator("body"));
      await expectActualAppGeometry(page);
      await actualRouteActions(surface);
      await expectActualAppGeometry(page);
      await expectReadableControls(main);
      await browserExpect(page.getByRole("link", { name: /Performance|Analytics/ })).toHaveCount(0);
      api.assertWrites([]);
      if (width === 375 || width === 1440) await actualScreenshot(`loaded-${surface.key}-${width}-${mode}`);
    },
  );

  it.each([375, 1440].flatMap(width => actualAppRoutes.map(surface => ({ ...surface, width }))))(
    "long title/text and 200% text on actual $key at $width px",
    async ({ width, ...surface }) => {
      await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
      const main = await openLoadedActualApp(api, surface, width);
      await doubleTextSize(page);
      await expectWorkspaceLandmarks(surface.heading);
      await expectNoNestedInteractive(page.locator("body"));
      await expectActualAppGeometry(page);
      await actualRouteActions(surface);
      await expectActualAppGeometry(page);
      await expectReadableControls(main);
      api.assertWrites([]);
      await actualScreenshot(`zoom200-${surface.key}-${width}-os-dark`);
    },
  );

  it.each(actualAppRoutes)("reduced motion and forced colors retain readable actual $key controls", async surface => {
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce", forcedColors: "active" });
    const main = await openLoadedActualApp(api, surface, 375);
    expect(await page.evaluate(() => ({ dark: matchMedia("(prefers-color-scheme: dark)").matches,
      reduced: matchMedia("(prefers-reduced-motion: reduce)").matches, forced: matchMedia("(forced-colors: active)").matches }))).toEqual({ dark: true, reduced: true, forced: true });
    await expectActualAppGeometry(page);
    await actualRouteActions(surface);
    await expectReadableControls(main);
    await browserExpect.poll(() => page.evaluate(() => document.getAnimations().filter(animation => {
      const duration = animation.effect?.getComputedTiming().duration;
      return animation.playState === "running" && typeof duration === "number" && duration > 32;
    }).length)).toBe(0);
    const action = page.getByTestId("button-global-create");
    await action.focus(); await page.keyboard.press("Tab"); await page.keyboard.press("Shift+Tab");
    await browserExpect(action).toBeFocused();
    await browserExpect.poll(() => action.evaluate(element => {
      const css = getComputedStyle(element);
      return element.matches(":focus-visible") && css.forcedColorAdjust === "auto" && css.outlineStyle !== "none" && Number.parseFloat(css.outlineWidth) >= 2;
    })).toBe(true);
    api.assertWrites([]);
    await actualScreenshot(`forced-colors-${surface.key}-375`);
  });

  it.each(toolbarWidths.flatMap(width => ["empty", "error"].map(state => ({ width, state }))))(
    "Discover $state at $width px exposes its actual action without hidden-pane clipping",
    async ({ width, state }) => {
      api.state.stories = [];
      if (state === "error") api.state.faults.set("/api/inbox", `The newsroom is temporarily unavailable. ${LONG_TEXT}`);
      await openWorkspace("/dashboard/discover", width);
      const main = await expectWorkspaceLandmarks("Discover");
      const action = state === "empty" ? main.getByTestId("button-refresh-empty") : main.getByRole("button", { name: "Try again", exact: true });
      await browserExpect(action).toBeVisible();
      if (state === "error") await browserExpect(main.getByRole("alert")).toContainText("Discover could not be loaded");
      else await browserExpect(main.getByRole("heading", { name: "No articles yet", exact: true })).toBeVisible();
      await expectActualAppGeometry(page);
      // Deliberately NOT expect.fail/skip: report a real clipping bug to the
      // runtime owner rather than inject a height or waive overflow:hidden.
      await expectReachableAction(action);
      await expectReadableControls(main);
      api.assertWrites([]);
      if (width === 375 || width === 1440) await actualScreenshot(`exception-discover-${state}-${width}`);
    },
  );

  it.each([375, 1440])("long Discover detail at %s px keeps Create/Save/Dismiss vertically reachable", async width => {
    await openLoadedActualApp(api, actualAppRoutes[1], width);
    await page.getByTestId("row-inbox-loaded-story").click();
    const detail = width < 1024 ? page.getByRole("dialog", { name: "Story details", exact: true }) : page.getByRole("main");
    await browserExpect(detail.getByTestId("text-headline-loaded-story")).toHaveText(LONG_TITLE);
    for (const action of ["generate", "save", "dismiss"]) await expectReachableAction(detail.getByTestId(`button-${action}-loaded-story`));
    await expectReadableControls(detail);
    api.assertWrites([]);
    await captureActualApp(page, `loaded-discover-detail-${width}`);
  });

  const sections = ["account", "content", "publishing", "integrations", "notifications", "billing", "invitations"] as const;
  it.each([375, 1440].flatMap(width => [false, true].flatMap(zoom => sections.map(section => ({ width, zoom, section })))))(
    "actual Settings $section at $width px (200%=$zoom) loads its real section and controls",
    async ({ width, zoom, section }) => {
      await openWorkspace(`/dashboard/settings?tab=${section}`, width);
      const main = await expectWorkspaceLandmarks("Settings");
      const tabName = section === "invitations" ? "Invite friends" : section;
      await browserExpect(main.getByRole("tab", { name: tabName, exact: true })).toHaveAttribute("aria-selected", "true");
      const panel = main.getByRole("tabpanel", { name: tabName, exact: true });
      let action: Locator;
      switch (section) {
        case "account":
          await panel.getByLabel("Full Name", { exact: true }).fill(LONG_TITLE);
          action = panel.getByTestId("button-save-account"); break;
        case "content":
          await browserExpect(panel.getByRole("textbox", { name: "Voice & focus", exact: true })).toHaveValue(LONG_FOCUS);
          await panel.getByRole("textbox", { name: "Voice & focus", exact: true }).fill(`${LONG_FOCUS} Local edit.`);
          await browserExpect(panel.getByRole("region", { name: "Optional editorial voice" })).toBeVisible();
          action = panel.getByTestId("button-save-content-preferences"); break;
        case "publishing":
          await browserExpect(panel.getByLabel("Preferred time")).toHaveValue("18:45");
          await panel.getByLabel("Preferred time").fill("19:45");
          await browserExpect(panel.getByTestId("switch-plugin-linkedin")).toBeChecked();
          action = panel.getByTestId("button-save-plugins"); break;
        case "integrations":
          action = panel.getByTestId("button-disconnect-linkedin");
          await browserExpect(action).toBeEnabled(); break;
        case "notifications":
          await browserExpect(panel.getByLabel("Digest timezone (IANA name)")).toHaveValue("Asia/Kolkata");
          await panel.getByLabel("Daily digest time", { exact: true }).fill("10:00");
          action = panel.getByTestId("button-save-notifications"); break;
        case "billing":
          await browserExpect(panel.getByRole("heading", { name: "Billing & Subscription", exact: true })).toBeVisible();
          await expectReachableAction(panel.getByRole("heading", { name: "Payment History", exact: true }));
          action = panel.getByLabel("Payment type", { exact: true }); break;
        case "invitations":
          action = panel.getByRole("button", { name: "Preview invitation", exact: true });
          await action.click();
          await browserExpect(panel.getByRole("region", { name: "Invitation preview" })).toContainText("Your signup link");
          await browserExpect(panel.getByTestId("button-send-invitation")).toBeDisabled(); break;
      }
      if (zoom) await doubleTextSize(page);
      await expectNoNestedInteractive(page.locator("body"));
      await expectActualAppGeometry(page);
      await expectReachableAction(action);
      await expectReadableControls(panel);
      api.assertWrites([]);
      await actualScreenshot(`settings-${section}-${width}-${zoom ? "zoom200" : "loaded"}`);
    },
  );

  it.each([375, 1440])("notification InfoTooltip preserves exact switch names, descriptions and consent without writes at %s px", async width => {
    await openWorkspace("/dashboard/settings?tab=notifications", width);
    await browserExpect(page.getByRole("tab", { name: "notifications", exact: true })).toHaveAttribute("aria-selected", "true");
    const panel = page.getByRole("tabpanel", { name: "notifications", exact: true });
    const digest = panel.getByRole("switch", { name: "Daily Digest", exact: true });
    const help = panel.getByRole("button", { name: "About Daily Digest", exact: true });
    const save = panel.getByRole("button", { name: "Save Notifications", exact: true });
    const marketing = panel.getByRole("switch", { name: "Marketing", exact: true });
    const consent = panel.getByText("Optional offers, independent of other notifications.", { exact: true });
    const essential = panel.getByText("Essential security and billing messages remain enabled.", { exact: true });
    const text = "Receive a daily email with your curated content.";
    await browserExpect(digest).toBeChecked();
    await browserExpect(marketing).not.toBeChecked();
    await browserExpect(marketing).toHaveAccessibleDescription("Optional offers, independent of other notifications.");
    await browserExpect(save).toBeDisabled();
    await browserExpect(panel.getByRole("switch")).toHaveCount(7);
    const checkedStates = () => panel.getByRole("switch").evaluateAll(elements => elements.map(element => (element as HTMLInputElement).checked));
    const initialStates = await checkedStates();
    const descriptionId = (await digest.getAttribute("aria-describedby"))!;
    expect(descriptionId).toBe("dailyDigest-help");
    const description = page.locator(`[id="${descriptionId}"]`);
    const popup = page.locator("[data-info-popup]");
    await browserExpect(help).toHaveAttribute("type", "button");
    await browserExpect(panel.locator("label [data-info-trigger]")).toHaveCount(0);
    await browserExpect(popup).toHaveCount(0);

    async function expectUnchanged() {
      await browserExpect(digest).toHaveAccessibleName("Daily Digest");
      await browserExpect(digest).toHaveAttribute("aria-describedby", descriptionId);
      await browserExpect(digest).toHaveAccessibleDescription(text);
      await browserExpect(description).toHaveCount(1);
      await browserExpect(description).toHaveText(text);
      // Screen-reader-only help has a layout box; toBeHidden would be incorrect.
      await browserExpect(description).toHaveClass(/\bsr-only\b/);
      await browserExpect(description).toHaveCSS("clip", "rect(0px, 0px, 0px, 0px)");
      await browserExpect(digest).toBeChecked();
      await browserExpect(save).toBeDisabled();
      expect(await checkedStates()).toEqual(initialStates);
      for (const notice of [consent, essential]) {
        await browserExpect(notice).toBeVisible();
        await browserExpect(notice).toHaveCSS("clip", "auto");
        expect(await notice.evaluate(element => element.closest("[data-info-description], [data-info-popup], .sr-only"))).toBeNull();
      }
      api.assertWrites([]);
    }

    await expectUnchanged();
    await digest.focus();
    await page.keyboard.press("Shift+Tab");
    await browserExpect(help).toBeFocused();
    await browserExpect(popup).toBeVisible();
    await browserExpect(page.getByRole("tooltip")).toHaveText(text);
    await expectUnchanged();
    await page.keyboard.press("Escape");
    await browserExpect(popup).toHaveCount(0);
    await browserExpect(help).toBeFocused();
    await expectUnchanged();
    for (const key of ["Enter", "Space"]) {
      await page.keyboard.press(key);
      await browserExpect(popup).toBeVisible();
      await browserExpect(page.getByRole("tooltip")).toHaveText(text);
      await expectUnchanged();
      await page.keyboard.press("Escape");
      await browserExpect(popup).toHaveCount(0);
      await expectUnchanged();
    }
    await page.keyboard.press("Tab");
    await browserExpect(digest).toBeFocused();
    await expectUnchanged();
  });

  it.each([375, 1440])("notification checkbox 44px target edges toggle only the local draft, never save, at %s px", async width => {
    await openWorkspace("/dashboard/settings?tab=notifications", width);
    const panel = page.getByRole("tabpanel", { name: "notifications", exact: true });
    const digest = panel.getByRole("switch", { name: "Daily Digest", exact: true });
    const save = panel.getByRole("button", { name: "Save Notifications", exact: true });
    await browserExpect(digest).toBeChecked();
    await browserExpect(panel.getByRole("switch", { name: "Marketing", exact: true })).not.toBeChecked();
    await browserExpect(save).toBeDisabled();
    const switchStates = () => panel.getByRole("switch").evaluateAll(elements => elements.map(element => ({ id: element.id, checked: (element as HTMLInputElement).checked })));
    const initialStates = await switchStates();
    const cachedPreferences = () => page.evaluate(() => (window as any).security.cache()
      .find((entry: { key: unknown[] }) => entry.key[0] === "/api/email-preferences")?.data);
    const savedPreferences = await cachedPreferences();
    expect(savedPreferences).toMatchObject({ dailyDigest: true, marketing: false });
    const target = panel.locator("label").filter({ has: page.getByRole("switch", { name: "Daily Digest", exact: true }) });
    await browserExpect(target).toHaveCount(1);
    const digestId = (await digest.getAttribute("id"))!;
    await browserExpect(target).toHaveAttribute("for", digestId);
    const descriptionId = (await digest.getAttribute("aria-describedby"))!;

    for (const edge of ["left", "right"]) {
      await target.scrollIntoViewIfNeeded();
      const box = (await target.boundingBox())!;
      const checkbox = (await digest.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      const position = { x: edge === "left" ? 2 : box.width - 2, y: box.height / 2 };
      const clickX = box.x + position.x;
      // Click the label's real padded edge, not the small checkbox or a synthetic event.
      expect(clickX < checkbox.x || clickX > checkbox.x + checkbox.width).toBe(true);
      await target.click({ position });
      const checked = edge === "right";
      if (checked) {
        await browserExpect(digest).toBeChecked();
        await browserExpect(save).toBeDisabled();
      } else {
        await browserExpect(digest).not.toBeChecked();
        await browserExpect(save).toBeEnabled();
      }
      expect(await switchStates()).toEqual(initialStates.map(value => value.id === digestId ? { ...value, checked } : value));
      await browserExpect(digest).toHaveAttribute("aria-describedby", descriptionId);
      await browserExpect(page.locator("[data-info-popup]")).toHaveCount(0);
      expect(await cachedPreferences()).toEqual(savedPreferences);
      expect(api.count("PATCH", "/api/email-preferences")).toBe(0);
      api.assertWrites([]);
    }
  });

  it.each([375, 1440])("Source URL keeps stable hidden help and a visible access warning without posting at %s px", async width => {
    await openWorkspace("/dashboard/settings?tab=content", width);
    const panel = page.getByRole("tabpanel", { name: "content", exact: true });
    const sources = panel.getByTestId("card-custom-sources");
    const input = sources.getByRole("textbox", { name: "Source URL", exact: true });
    const help = sources.getByRole("button", { name: "About Source URL", exact: true });
    const add = sources.getByRole("button", { name: "Add", exact: true });
    const empty = sources.getByText("No sources added yet. Add a website or feed URL below.", { exact: true });
    const text = "Paste the publication's actual URL; names alone are not matched to guessed domains. " +
      "Public feeds and readable webpages are supported. Refreshes process up to 30 sources at a time, oldest fetched first.";
    const warningText = "Login, paywall, bot-protected, and JavaScript-only pages may not be accessible.";
    await browserExpect(empty).toBeVisible();
    await browserExpect(input).toHaveAccessibleName("Source URL");
    await browserExpect(input).toHaveValue("");
    await browserExpect(add).toBeDisabled();
    const inputId = (await input.getAttribute("id"))!;
    expect(inputId).toBeTruthy();
    const describedBy = (await input.getAttribute("aria-describedby"))!;
    expect(describedBy).toBe(`${inputId}-help ${inputId}-warning`);
    const description = page.locator(`[id="${inputId}-help"]`);
    const warning = page.locator(`[id="${inputId}-warning"]`);
    const popup = page.locator("[data-info-popup]");
    await browserExpect(help).toHaveAttribute("type", "button");
    await browserExpect(sources.locator("label [data-info-trigger]")).toHaveCount(0);
    await browserExpect(popup).toHaveCount(0);

    async function expectStableHelp() {
      await browserExpect(input).toHaveAccessibleName("Source URL");
      await browserExpect(input).toHaveAttribute("id", inputId);
      await browserExpect(input).toHaveAttribute("aria-describedby", describedBy);
      await browserExpect(input).toHaveAccessibleDescription(`${text} ${warningText}`);
      await browserExpect(description).toHaveCount(1);
      await browserExpect(description).toHaveText(text);
      await browserExpect(description).toHaveClass(/\bsr-only\b/);
      await browserExpect(description).toHaveCSS("clip", "rect(0px, 0px, 0px, 0px)");
      await browserExpect(warning).toHaveCount(1);
      await browserExpect(warning).toHaveText(warningText);
      await browserExpect(warning).toBeVisible();
      await browserExpect(warning).toHaveCSS("clip", "auto");
      expect(await warning.evaluate(element => element.closest("[data-info-description], [data-info-popup], .sr-only"))).toBeNull();
      await browserExpect(empty).toBeVisible();
      await browserExpect(panel.getByRole("button", { name: "Save Content Preferences", exact: true })).toBeDisabled();
      expect(api.count("POST", "/api/sources")).toBe(0);
      api.assertWrites([]);
    }

    await expectStableHelp();
    // Make Add actionable so accidental submission by a help button cannot pass unnoticed.
    const url = "https://publication.invalid/feed";
    await input.fill(url);
    await browserExpect(add).toBeEnabled();
    await expectStableHelp();
    await page.keyboard.press("Shift+Tab");
    await browserExpect(help).toBeFocused();
    await browserExpect(popup).toBeVisible();
    await browserExpect(page.getByRole("tooltip")).toHaveText(text);
    await expectStableHelp();
    await page.keyboard.press("Escape");
    await browserExpect(popup).toHaveCount(0);
    await browserExpect(help).toBeFocused();
    await expectStableHelp();
    await page.keyboard.press("Enter");
    await browserExpect(popup).toBeVisible();
    await browserExpect(page.getByRole("tooltip")).toHaveText(text);
    await expectStableHelp();
    await page.keyboard.press("Escape");
    await browserExpect(popup).toHaveCount(0);
    await page.keyboard.press("Tab");
    await browserExpect(input).toBeFocused();
    await browserExpect(input).toHaveValue(url);
    await browserExpect(add).toBeEnabled();
    await expectStableHelp();
  });

  it.each([375, 1440])("full actualApp batch → Content edit → Create conflict → exact Calendar consent at %s px", async width => {
    api.state.enabledPlatforms = ["linkedin", "twitter"];
    api.state.drafts = [fixtureDraft("unrelated", "A different draft that must never be silently selected.")]; api.state.schedules = [];
    await page.clock.setFixedTime(new Date("2026-10-01T10:00:00.000Z"));
    await openWorkspace("/dashboard/create", width);
    await page.getByRole("combobox", { name: "Story", exact: true }).selectOption("loaded-story");
    const generated = "An isolated LinkedIn post with a precise reviewable source. Nothing is delivered by generation.";
    const otherActive = deferredResponse();
    const firstJob = api.generation("linkedin", { content: generated });
    const secondJob = api.generation("twitter", { gate: otherActive });
    await page.getByTestId("button-generate-selected").click();
    const card = page.getByTestId("social-preview-linkedin");
    const twitter = page.getByTestId("social-preview-twitter");
    await browserExpect(card.getByTestId("text-post-content-linkedin")).toHaveText(generated);
    await browserExpect.poll(() => api.count("GET", `/api/editorial/jobs/${secondJob}`)).toBe(1);
    await browserExpect(twitter).toContainText("Generating…");
    await browserExpect(card.getByRole("button", { name: "Save draft", exact: true })).toBeEnabled();
    expect(api.count("POST", "/api/drafts")).toBe(0);
    expect(api.count("GET", `/api/editorial/jobs/${firstJob}/result`)).toBe(1);
    const saved = { ...fixtureDraft("saved-exact", generated), inboxItemId: "loaded-story" };
    api.plan("POST", "/api/drafts", { platform: "linkedin", tone: "professional", content: generated, media: [], inboxItemId: "loaded-story" }, () => {
      api.state.drafts.push(saved); return { status: 201, body: saved };
    });
    await card.getByRole("button", { name: "Save draft", exact: true }).click();
    await browserExpect(card.getByRole("button", { name: "Saved", exact: true })).toBeDisabled();
    await browserExpect(twitter).toContainText("Generating…");
    await browserExpect(card.getByRole("link", { name: "Go to Content", exact: true })).toHaveAttribute("href", "/dashboard/content?draft=saved-exact");
    otherActive.release();
    await browserExpect(twitter.getByTestId("text-post-content-twitter")).toBeVisible();
    await browserExpect(page.getByRole("main")).toContainText("2 platform posts are ready");
    api.assertWrites([["POST", "/api/instant-review/selected"], ["POST", "/api/instant-review/selected"], ["POST", "/api/drafts"]]);
    await captureActualApp(page, `journey-batch-success-${width}`);

    await card.getByRole("link", { name: "Go to Content", exact: true }).click();
    await browserExpect(page).toHaveURL(`${origin}/dashboard/content?draft=saved-exact`);
    await expectWorkspaceLandmarks("Content");
    const linked = page.locator('[data-linked-draft="true"]');
    await browserExpect(linked).toHaveCount(1);
    await browserExpect(linked).toContainText(generated);
    await browserExpect(linked.getByTestId("button-menu-unrelated")).toHaveCount(0);
    await linked.getByTestId("button-menu-saved-exact").click();
    await page.getByTestId("button-edit-saved-exact").click();
    const remoteText = "Content revised this exact saved draft. The Create card must not silently overwrite this revision.";
    await page.getByLabel("Draft content", { exact: true }).fill(remoteText);
    const remoteRevision = "2026-10-01T08:01:00.000Z";
    api.plan("PATCH", "/api/drafts/saved-exact", { content: remoteText, expectedContent: generated, expectedUpdatedAt: saved.updatedAt }, () => {
      Object.assign(saved, { content: remoteText, updatedAt: remoteRevision, publishApprovedAt: null }); return { body: saved };
    });
    await page.getByTestId("button-save-edit").click();
    await browserExpect(page.getByRole("dialog", { name: "Edit Draft", exact: true })).toHaveCount(0);
    const savedToast = page.locator('li[data-state="open"]').filter({ hasText: "Draft updated" });
    await browserExpect(savedToast).toBeVisible();
    // A visible notification must not intercept the persistent navigation.
    // Do not dismiss it, wait for its timer, or force the subsequent click.
    await expectReachableAction(page.getByTestId("button-global-create"));
    await browserExpect(savedToast).toBeVisible();
    await page.getByTestId("button-global-create").click();
    await expectWorkspaceLandmarks("Create post");
    const revisionReview = card.getByRole("region", { name: "Draft revision review", exact: true });
    await browserExpect(revisionReview.getByRole("alert")).toContainText("Draft changed elsewhere. Nothing was overwritten.");
    await browserExpect(card.getByTestId("latest-draft-content")).toHaveText(remoteText);
    await browserExpect(card.getByTestId("text-post-content-linkedin")).toHaveText(generated);
    expect(api.count("POST", "/api/drafts")).toBe(1);
    expect(api.count("PATCH", "/api/drafts/saved-exact")).toBe(1);
    await card.getByRole("button", { name: "Edit", exact: true }).click();
    const localText = "The human-reviewed local revision resolves the conflict explicitly. This is the exact text approved for Calendar.";
    await card.getByRole("textbox", { name: "LinkedIn post content", exact: true }).fill(localText);
    await revisionReview.getByRole("button", { name: "Keep local text", exact: true }).click();
    await browserExpect(revisionReview).toContainText("Nothing was saved; the conflict still needs review.");
    await browserExpect(card.getByRole("button", { name: "Save changes", exact: true })).toBeDisabled();
    await captureActualApp(page, `exception-create-conflict-${width}`);
    await revisionReview.getByRole("button", { name: "Use reviewed latest as baseline", exact: true }).click();
    await browserExpect(card.getByRole("textbox", { name: "LinkedIn post content", exact: true })).toHaveValue(localText);
    expect(api.count("PATCH", "/api/drafts/saved-exact")).toBe(1);
    const finalRevision = "2026-10-01T08:02:00.000Z";
    api.plan("PATCH", "/api/drafts/saved-exact", { content: localText, expectedContent: remoteText, expectedUpdatedAt: remoteRevision }, () => {
      Object.assign(saved, { content: localText, updatedAt: finalRevision, publishApprovedAt: null }); return { body: saved };
    });
    await card.getByRole("button", { name: "Save changes", exact: true }).click();
    await browserExpect(card.getByRole("link", { name: "Go to Calendar", exact: true })).toHaveAttribute("href", "/dashboard/calendar?draft=saved-exact");
    await card.getByRole("link", { name: "Go to Calendar", exact: true }).click();
    await browserExpect(page).toHaveURL(`${origin}/dashboard/calendar?draft=saved-exact`);
    const dialog = page.getByRole("dialog", { name: "Schedule across platforms", exact: true });
    await browserExpect(dialog.getByRole("combobox", { name: "Draft", exact: true })).toHaveValue(saved.id);
    await browserExpect(dialog.getByTestId("schedule-exact-text")).toHaveText(localText);
    await browserExpect(dialog.getByLabel("Time (Asia/Kolkata)", { exact: true })).toHaveValue("18:45");
    const consent = dialog.getByRole("checkbox", { name: "I confirm this exact text, destinations and timezone.", exact: true });
    // Accessible names normalize the zero-destination label's whitespace.
    const submit = dialog.getByRole("button", { name: /^Schedule(?: [1-9]\d*)? platforms?$/ });
    await browserExpect(submit).toHaveAccessibleName("Schedule platforms");
    await browserExpect(consent).not.toBeChecked();
    await browserExpect(submit).toBeDisabled();
    expect(api.count("POST", "/api/drafts/saved-exact/approve-publishing")).toBe(0);
    expect(api.count("POST", "/api/drafts/saved-exact/schedule")).toBe(0);
    api.plan("POST", "/api/drafts/saved-exact/approve-publishing", { content: localText, updatedAt: finalRevision }, () => {
      Object.assign(saved, { publishApprovedAt: "2026-10-01T10:00:00.000Z", publishApprovedBy: "a" }); return { body: saved };
    });
    await dialog.getByRole("button", { name: "I reviewed this exact draft — approve publishing", exact: true }).click();
    await browserExpect(dialog.getByRole("checkbox", { name: "LinkedIn", exact: true })).toBeChecked();
    await browserExpect(submit).toHaveAccessibleName("Schedule 1 platform");
    await dialog.getByLabel("Date", { exact: true }).fill("2026-10-04");
    await consent.check();
    await browserExpect(submit).toBeEnabled();
    // Consent is bound to the full text/destination/timezone/time tuple. A time
    // edit must revoke it even though approval of the saved draft remains valid.
    await dialog.getByLabel("Time (Asia/Kolkata)", { exact: true }).fill("19:15");
    await browserExpect(consent).not.toBeChecked();
    await browserExpect(submit).toBeDisabled();
    expect(api.count("POST", "/api/drafts/saved-exact/schedule")).toBe(0);
    await consent.check();
    await browserExpect(dialog.getByRole("region", { name: "Confirm scheduled publication", exact: true })).toContainText("2026-10-04 at 19:15 (Asia/Kolkata)");
    await expectReachableAction(submit);
    api.plan("POST", "/api/drafts/saved-exact/schedule", { publishAt: "2026-10-04T13:45:00.000Z", platforms: ["linkedin"],
      consent: { expectedContent: localText, expectedUpdatedAt: finalRevision, expectedSchedule: null } }, () => {
      Object.assign(saved, { publishStatus: "scheduled", scheduledAt: "2026-10-04T13:45:00.000Z" });
      const schedule = { id: "schedule-exact", draftId: saved.id, scheduledPublishAt: saved.scheduledAt!, status: "scheduled", updatedAt: "2026-10-01T10:00:00.000Z", draft: { ...saved },
        targets: [{ id: "target-exact", platform: "linkedin", status: "scheduled", revision: 0, updatedAt: "2026-10-01T10:00:00.000Z", providerPostId: null, receiptKind: null }] };
      api.state.schedules.push(schedule); return { body: { ...schedule, message: "Fixture schedule recorded. Delivery has not occurred." } };
    });
    await submit.click();
    await browserExpect(dialog).toHaveCount(0);
    await browserExpect(page.locator('[data-linked-draft="true"]')).toContainText(localText);
    expect(api.state.drafts.find(draft => draft.id === "unrelated")?.publishStatus).toBe("draft");
    expect(saved.publishedAt).toBeNull();
    expect(api.state.schedules[0].targets[0]).toMatchObject({ status: "scheduled", providerPostId: null, receiptKind: null });
    api.assertWrites([["POST", "/api/instant-review/selected"], ["POST", "/api/instant-review/selected"], ["POST", "/api/drafts"],
      ["PATCH", "/api/drafts/saved-exact"], ["PATCH", "/api/drafts/saved-exact"], ["POST", "/api/drafts/saved-exact/approve-publishing"], ["POST", "/api/drafts/saved-exact/schedule"]]);
    expect(api.count("GET", `/api/editorial/jobs/${secondJob}/result`)).toBe(1);
    expect(confirmations).toEqual([]);
    await actualScreenshot(`journey-calendar-confirmed-${width}`);
  }, 30_000);

  it("keeps terminal failure and not-attempted cards distinct; explicit continuation never regenerates completed/failed cards", async () => {
    api.state.enabledPlatforms = ["linkedin", "twitter", "threads"];
    await openWorkspace("/dashboard/create", 375);
    await page.getByRole("combobox", { name: "Story", exact: true }).selectOption("loaded-story");
    api.generation("linkedin");
    const failedJob = api.generation("twitter", { failed: true });
    await page.getByTestId("button-generate-selected").click();
    await browserExpect(page.getByTestId("social-preview-linkedin").getByTestId("text-post-content-linkedin")).toBeVisible();
    await browserExpect(page.getByTestId("social-preview-twitter")).toContainText("Needs retry");
    await browserExpect(page.getByTestId("social-preview-twitter")).toContainText("Fixture terminal generation failure");
    await browserExpect(page.getByTestId("social-preview-threads")).toContainText("Not attempted");
    await browserExpect(page.getByTestId("social-preview-threads")).toContainText("No request was sent for this card");
    expect(api.count("GET", `/api/editorial/jobs/${failedJob}/result`)).toBe(0);
    api.assertWrites([["POST", "/api/instant-review/selected"], ["POST", "/api/instant-review/selected"]]);
    await expectReachableAction(page.getByTestId("button-generate-selected"));
    await captureActualApp(page, "exception-batch-terminal-not-attempted-375");
    api.generation("threads");
    await page.getByRole("button", { name: "Continue 1 not attempted", exact: true }).click();
    await browserExpect(page.getByTestId("text-post-content-threads")).toBeVisible();
    await browserExpect(page.getByTestId("social-preview-twitter")).toContainText("Needs retry");
    expect(api.state.calls.filter(call => call.method === "POST").map(call => call.body.selectedPlatforms)).toEqual([["linkedin"], ["twitter"], ["threads"]]);
    api.assertWrites(Array.from({ length: 3 }, () => ["POST", "/api/instant-review/selected"] as [string, string]));
    expect(api.count("POST", "/api/drafts")).toBe(0);
  });

  it.each([375, 1440].flatMap(width => ["navbar", "home"].map(entry => ({ width, entry }))))(
    "actual $entry New cancels/accepts, while both Home and navbar Resume retain the Idea at $width px",
    async ({ width, entry }) => {
      await openLoadedActualApp(api, actualAppRoutes[6], width);
      await page.getByTestId("link-navbar-logo").click();
      await expectWorkspaceLandmarks("Home");
      await browserExpect(page.getByTestId("button-global-create")).toHaveText("Resume creation");
      await page.getByRole("main").getByRole("button", { name: "Resume creation", exact: true }).click();
      await expectCreateMode("Idea");
      await browserExpect(page.getByLabel("Article title", { exact: true })).toHaveValue(LONG_TITLE);
      await browserExpect(page.getByRole("textbox", { name: "Article text", exact: true })).toHaveText(LONG_TEXT);
      if (entry === "home") await page.getByTestId("link-navbar-logo").click();
      const newPost = entry === "home" ? page.getByTestId("button-overview-instant-review") : page.getByTestId("button-global-create");
      await browserExpect(newPost).toHaveText("New post");
      decisions.push(false); await newPost.click();
      expect(confirmations).toHaveLength(1);
      expect(confirmations[0]).toContain("Start a new post?");
      expect(new URL(page.url()).pathname).toBe(entry === "home" ? "/dashboard" : "/dashboard/create");
      if (entry === "home") await page.getByTestId("button-global-create").click();
      await expectCreateMode("Idea");
      await browserExpect(page.getByRole("textbox", { name: "Article text", exact: true })).toHaveText(LONG_TEXT);
      if (entry === "home") await page.getByTestId("link-navbar-logo").click();
      decisions.push(true); await newPost.click();
      await expectFreshArticle();
      expect(confirmations).toHaveLength(2);
      expect(api.state.drafts.map(draft => draft.id)).toEqual(["loaded-ready", "loaded-scheduled"]);
      api.assertWrites([]);
    },
  );

  it("a same-user tenant boundary drops an old deferred actual generation result without saving, cancelling or replaying", async () => {
    api.state.enabledPlatforms = ["linkedin"];
    await openWorkspace("/dashboard/create", 1440);
    await page.getByRole("combobox", { name: "Story", exact: true }).selectOption("loaded-story");
    const resultGate = deferredResponse();
    const privateText = "Private tenant A generated text must never enter tenant B's composer or cache.";
    const job = api.generation("linkedin", { resultGate, content: privateText });
    const resultPath = `/api/editorial/jobs/${job}/result`;
    const finished = new Set<string>();
    page.on("requestfinished", request => finished.add(new URL(request.url()).pathname));
    page.on("requestfailed", request => finished.add(new URL(request.url()).pathname));
    await page.getByTestId("button-generate-selected").click();
    await browserExpect.poll(() => api.count("GET", `/api/editorial/jobs/${job}/result`)).toBe(1);
    api.state.tenantId = "tenant-b"; api.state.stories = []; api.state.drafts = []; api.state.schedules = [];
    await refetch("/api/profile");
    await expectFreshArticle();
    resultGate.release();
    await browserExpect.poll(() => api.state.settled.filter(call => call.pathname === resultPath).length).toBe(1);
    await browserExpect.poll(() => finished.has(resultPath)).toBe(true);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await browserExpect(page.getByRole("main")).not.toContainText(privateText);
    await browserExpect(page.getByTestId("text-post-content-linkedin")).toHaveCount(0);
    await browserExpect(page.getByTestId("button-generate-selected")).toBeDisabled();
    expect(JSON.stringify(await page.evaluate(() => (window as any).security.cache()))).not.toContain(privateText);
    expect(await page.evaluate(() => JSON.stringify(sessionStorage))).not.toContain("tenant-a");
    api.assertWrites([["POST", "/api/instant-review/selected"]]);
    expect(api.count("GET", `/api/editorial/jobs/${job}/result`)).toBe(1);
    // Do not clear/refetch the cache in the fixture to hide a tenant leak.
    await browserExpect(page.getByRole("main")).toContainText("No saved stories available");
    expect(JSON.stringify(await page.evaluate(() => (window as any).security.cache()))).not.toContain("tenant-a");
    await captureActualApp(page, "exception-tenant-boundary-deferred-result-1440");
  });
});

async function openWorkspace(route: string, width: number) {
  await page.setViewportSize({ width, height: 900 });
  // Essential-only consent: never load analytics or fonts from the network.
  await page.addInitScript(() => localStorage.setItem("tsp-analytics-consent", "denied"));
  const url = new URL(route, origin);
  url.searchParams.set("fixture", "workspace");
  await page.goto(url.href);
  await browserExpect(page.getByTestId("link-navbar-logo")).toBeVisible();
  await browserExpect(page.getByRole("heading", { level: 1, name: workspaceRoutes.find(item => item.route === url.pathname)!.heading, exact: true })).toBeVisible();
  await browserExpect(page.getByTestId("route-page")).toHaveCount(0);
}

async function expectOnScreen(control: Locator, minSize = 0) {
  await browserExpect(control).toBeVisible();
  await browserExpect.poll(() => control.evaluate((element, minimum) => {
    const box = element.getBoundingClientRect();
    return { onScreen: box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight && box.width >= minimum && box.height >= minimum,
      rect: box.toJSON(), minimum };
  }, minSize)).toMatchObject({ onScreen: true });
}

async function openIdea(width: number) {
  await openWorkspace("/dashboard/create", width);
  await page.getByRole("main").getByRole("group", { name: "Create from", exact: true }).getByRole("button", { name: "Idea", exact: true }).click();
  const toolbar = page.getByRole("group", { name: "Article formatting toolbar" });
  await browserExpect(toolbar).toBeVisible();
  await browserExpect(toolbar).toHaveAccessibleDescription(/Swipe or scroll sideways/);
  await toolbar.scrollIntoViewIfNeeded();
  return toolbar;
}

async function toolbarGeometry(toolbar: Locator) {
  return toolbar.evaluate(element => {
    const box = element.getBoundingClientRect();
    const parent = element.parentElement!.getBoundingClientRect();
    const ancestors = [];
    for (let node = element.parentElement; node; node = node.parentElement) ancestors.push(node.scrollLeft);
    return { left: box.left, right: box.right, width: box.width, parentLeft: parent.left, parentRight: parent.right,
      clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, scrollLeft: element.scrollLeft, ancestors,
      pageWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth };
  });
}

async function expectLocalToolbar(toolbar: Locator) {
  const geometry = await toolbarGeometry(toolbar);
  expect(geometry.left).toBeGreaterThanOrEqual(geometry.parentLeft);
  expect(geometry.right).toBeLessThanOrEqual(geometry.parentRight);
  expect(geometry.clientWidth).toBeLessThan(geometry.scrollWidth);
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.ancestors.every(offset => offset === 0)).toBe(true);
  return geometry;
}

async function expectControlUnclipped(control: Locator) {
  // Geometry and hit testing catch a clipped inner toolbar even when the app's
  // overflow:hidden/clip ancestors make document.scrollWidth look healthy.
  await browserExpect.poll(() => control.evaluate(element => {
    const box = element.getBoundingClientRect();
    const viewport = element.closest("fieldset")!;
    const outer = viewport.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    const unclipped = box.left >= outer.left + 2 && box.right <= outer.left + viewport.clientWidth - 2 &&
      box.top >= outer.top + 2 && box.bottom <= outer.top + viewport.clientHeight - 2 &&
      box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight &&
      (hit === element || element.contains(hit));
    return unclipped ? "unclipped" : JSON.stringify({ name: element.getAttribute("aria-label"), box: box.toJSON(), viewport: outer.toJSON(),
      clientWidth: viewport.clientWidth, clientHeight: viewport.clientHeight, scrollLeft: viewport.scrollLeft,
      hit: hit?.outerHTML.slice(0, 300) });
  })).toBe("unclipped");
}

describe("UX-01 real App navigation (mocked APIs, Chromium touch emulation)", () => {
  it.each([320, 375, 767].flatMap(width => workspaceRoutes.map(item => ({ ...item, width }))))(
    "opens and dismisses navigation from $route at $width px, restoring focus",
    async ({ route, width }) => {
      await openWorkspace(route, width);
      const trigger = page.getByTestId("button-navbar-navigation");
      const sheet = page.getByRole("dialog", { name: "Sidebar", exact: true });
      await expectOnScreen(trigger, 44);
      await browserExpect(trigger).toHaveAccessibleName("Open navigation");
      await browserExpect(trigger).toHaveAttribute("aria-expanded", "false");
      // The persistent opener is the first keyboard stop on every workspace page.
      await page.keyboard.press("Tab");
      await browserExpect(trigger).toBeFocused();
      await page.keyboard.press("Enter");
      await browserExpect(sheet).toBeVisible();
      await browserExpect(trigger).toHaveAttribute("aria-expanded", "true");
      expect(await sheet.evaluate(element => element.contains(document.activeElement))).toBe(true);
      await browserExpect(sheet.getByRole("link")).toHaveCount(4);
      await browserExpect(sheet.getByRole("link", { name: /Performance|Analytics/ })).toHaveCount(0);
      await page.keyboard.press("Escape");
      await browserExpect(sheet).toHaveCount(0);
      await browserExpect(trigger).toBeFocused();
      await browserExpect(trigger).toHaveAttribute("aria-expanded", "false");

      await trigger.tap();
      const close = sheet.getByRole("button", { name: "Close", exact: true });
      await expectOnScreen(close, 44);
      await close.tap();
      await browserExpect(sheet).toHaveCount(0);
      await browserExpect(trigger).toBeFocused();

      await trigger.tap();
      const destination = route === "/dashboard" ? "discover" : "home";
      await sheet.getByTestId(`nav-${destination}`).tap();
      await browserExpect(page).toHaveURL(origin + (destination === "home" ? "/dashboard" : "/dashboard/discover"));
      await browserExpect(sheet).toHaveCount(0);
      await browserExpect(trigger).toBeFocused();
      await browserExpect(trigger).toHaveAttribute("aria-expanded", "false");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(apiCalls.every(call => call.method === "GET")).toBe(true);
    },
  );

  it.each([768, 1440])("preserves desktop collapse and all workspace navigation at %s px", async width => {
    await openWorkspace("/dashboard", width);
    const sidebar = page.locator('[data-slot="sidebar-container"]');
    const toggle = page.getByTestId("button-navbar-navigation");
    await browserExpect(toggle).toHaveAccessibleName("Expand or collapse sidebar");
    const expandedWidth = (await sidebar.boundingBox())!.width;
    await browserExpect(toggle).toHaveAttribute("aria-expanded", "true");
    await toggle.click();
    await browserExpect(toggle).toHaveAttribute("aria-expanded", "false");
    await browserExpect.poll(async () => (await sidebar.boundingBox())!.width).toBeLessThan(expandedWidth);
    await toggle.click();
    await browserExpect(toggle).toHaveAttribute("aria-expanded", "true");
    await browserExpect.poll(async () => (await sidebar.boundingBox())!.width).toBe(expandedWidth);
    for (const destination of ["discover", "content", "calendar", "home"]) {
      await page.getByTestId(`nav-${destination}`).click();
      const target = destination === "home" ? "/dashboard" : `/dashboard/${destination}`;
      await browserExpect(page).toHaveURL(origin + target);
    }
    await page.getByTestId("button-navbar-account").click();
    await page.getByTestId("link-navbar-settings").click();
    await browserExpect(page.getByRole("heading", { name: "Settings", exact: true, level: 1 })).toBeVisible();
    await page.getByTestId("button-global-create").click();
    await browserExpect(page.getByRole("heading", { name: "Create post", exact: true, level: 1 })).toBeVisible();
    await browserExpect(page.getByRole("dialog", { name: "Sidebar", exact: true })).toHaveCount(0);
    await browserExpect(sidebar.getByRole("link", { name: /Performance|Analytics/ })).toHaveCount(0);
    expect(apiCalls.every(call => call.method === "GET")).toBe(true);
  });
});

describe("UX-02 real App Idea toolbar (local clipping, not just document width)", () => {
  it.each(toolbarWidths)("reveals all 24 controls through sequential Tab and Shift+Tab at %s px", async width => {
    const toolbar = await openIdea(width);
    const original = await expectLocalToolbar(toolbar);
    await page.getByLabel("Article title", { exact: true }).focus();
    const controls = toolbar.locator("button, select, input");
    expect(await controls.evaluateAll(elements => elements.map(element => element.getAttribute("aria-label")))).toEqual(formattingControls);
    await page.keyboard.press("Tab");
    await browserExpect(page.getByRole("button", { name: "About Article formatting", exact: true })).toBeFocused();
    for (let index = 0; index < formattingControls.length; index++) {
      await page.keyboard.press("Tab");
      await browserExpect(controls.nth(index)).toBeFocused();
      await expectControlUnclipped(controls.nth(index));
    }
    const end = await expectLocalToolbar(toolbar);
    expect(end.scrollLeft).toBeGreaterThan(0);
    expect(end.left).toBe(original.left);
    expect(end.width).toBe(original.width);
    for (let index = formattingControls.length - 2; index >= 0; index--) {
      await page.keyboard.press("Shift+Tab");
      await browserExpect(controls.nth(index)).toBeFocused();
      await expectControlUnclipped(controls.nth(index));
    }
    expect((await expectLocalToolbar(toolbar)).scrollLeft).toBeLessThanOrEqual(1);
  });

  it.each(toolbarWidths)("reaches every control by horizontal wheel emulation and taps both ends at %s px", async width => {
    const toolbar = await openIdea(width);
    const original = await expectLocalToolbar(toolbar);
    const controls = toolbar.locator("button, select, input");
    await expectControlUnclipped(controls.first());
    await controls.first().tap();
    // Horizontal wheel/trackpad emulation, with touch-capable Chromium taps.
    // This is NOT real-device swipe validation. Never use locator auto-scroll
    // to hide a broken viewport: prove local geometry before each tap.
    for (let index = 0; index < formattingControls.length; index++) {
      const control = controls.nth(index);
      const movement = await control.evaluate(element => {
        const box = element.getBoundingClientRect();
        const viewport = element.closest("fieldset")!.getBoundingClientRect();
        return { delta: Math.max(0, box.right - viewport.right + 10), x: viewport.x + viewport.width / 2, y: viewport.y + viewport.height / 2 };
      });
      if (movement.delta > 0) {
        await page.mouse.move(movement.x, movement.y);
        await page.mouse.wheel(movement.delta, 0);
      }
      await expectControlUnclipped(control);
    }
    await controls.last().tap();
    const end = await expectLocalToolbar(toolbar);
    expect(end.scrollLeft).toBeGreaterThan(0);
    expect(end.left).toBe(original.left);
    expect(end.width).toBe(original.width);
    await toolbar.hover();
    await page.mouse.wheel(-10000, 0);
    await browserExpect.poll(async () => (await toolbarGeometry(toolbar)).scrollLeft).toBe(0);
    await expectControlUnclipped(controls.first());
  });

  it("preserves execCommand editing and the Idea plain-text contract across navigation without generation or saving", async () => {
    const toolbar = await openIdea(1440);
    const editor = page.getByTestId("editor-manual-article");
    const text = "A source idea with enough text for generation, kept as plain text.";
    await page.getByLabel("Article title", { exact: true }).fill("Retained idea");
    await editor.fill(text);
    await editor.press("ControlOrMeta+a");
    await toolbar.getByRole("button", { name: "Bold", exact: true }).click();
    await browserExpect(editor.locator("b, strong")).toHaveText(text);
    await toolbar.getByLabel("Font family", { exact: true }).selectOption("Georgia");
    await browserExpect(toolbar.getByLabel("Font family", { exact: true })).toHaveValue("");
    await toolbar.getByRole("button", { name: "Clear formatting", exact: true }).click();
    await browserExpect(editor).toHaveText(text);
    await browserExpect(editor.locator("b, strong, font")).toHaveCount(0);
    await editor.fill("");
    await editor.evaluate(element => {
      const data = new DataTransfer();
      data.setData("text/plain", "Pasted plain text is still the source, not formatted HTML.");
      data.setData("text/html", "<b>Unwanted rich clipboard data</b>");
      element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    });
    const pasted = "Pasted plain text is still the source, not formatted HTML.";
    await browserExpect(editor).toHaveText(pasted);
    await page.getByTestId("nav-content").click();
    await browserExpect(page.getByRole("heading", { name: "Content", exact: true, level: 1 })).toBeVisible();
    await page.getByTestId("button-global-create").click();
    await browserExpect(page.getByLabel("Article title", { exact: true })).toHaveValue("Retained idea");
    await browserExpect(editor).toHaveText(pasted);
    await browserExpect(editor.locator("b, strong, font")).toHaveCount(0);
    await browserExpect(page.getByTestId("button-regenerate")).toBeEnabled();
    expect(apiCalls.every(call => call.method === "GET")).toBe(true);
    expect(apiCalls.some(call => /generation|instant-review|media\/upload/.test(call.pathname))).toBe(false);
  });
});

const ux03Widths = [320, 375, 768, 1440];
const interactiveSelector = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [contenteditable="true"], [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="switch"], [role="combobox"]';
// A tabindex on a tabpanel/menu/scroll region is not itself an interactive
// ancestor, but a focusable child inside a button or link must still be caught.
const interactiveDescendantSelector = `${interactiveSelector}, [tabindex]:not([tabindex="-1"])`;

async function expectWorkspaceLandmarks(heading: string) {
  // Count hidden duplicates too: a clipped/nested main or H1 is still a defect.
  await browserExpect(page.locator("main")).toHaveCount(1);
  await browserExpect(page.getByRole("main", { includeHidden: true })).toHaveCount(1);
  await browserExpect(page.locator("h1")).toHaveCount(1);
  await browserExpect(page.getByRole("heading", { level: 1, includeHidden: true })).toHaveCount(1);
  const main = page.getByRole("main");
  await browserExpect(main.locator("h1")).toHaveCount(1);
  await browserExpect(main.getByRole("heading", { level: 1, name: heading, exact: true })).toBeVisible();
  return main;
}

async function expectNoNestedInteractive(scope: Locator) {
  expect(await scope.locator(interactiveSelector).evaluateAll((elements, selector) => elements.flatMap(element => {
    const nested = element.querySelector(selector);
    return nested ? [{ outer: element.outerHTML.slice(0, 400), inner: nested.outerHTML.slice(0, 250) }] : [];
  }), interactiveDescendantSelector)).toEqual([]);
}

async function expectSingleNavigationLink(link: Locator, href: string) {
  await browserExpect(link).toHaveCount(1);
  await browserExpect(link).toBeVisible();
  await browserExpect(link).toHaveAttribute("href", href);
  expect(await link.evaluate((element, selectors) => ({
    tag: element.tagName, tabIndex: (element as HTMLElement).tabIndex,
    interactiveAncestor: element.parentElement?.closest(selectors.outer)?.outerHTML ?? null,
    interactiveDescendants: element.querySelectorAll(selectors.inner).length,
  }), { outer: interactiveSelector, inner: interactiveDescendantSelector })).toEqual({ tag: "A", tabIndex: 0, interactiveAncestor: null, interactiveDescendants: 0 });
}

function recordDialogs() {
  const dialogs: string[] = [];
  // Native confirms are auto-dismissed by Playwright otherwise, hiding regressions.
  page.on("dialog", async dialog => { dialogs.push(`${dialog.type()}: ${dialog.message()}`); await dialog.dismiss(); });
  return dialogs;
}

function expectNoCreationRequests() {
  expect(apiCalls.filter(call => call.method !== "GET")).toEqual([]);
  expect(apiCalls.filter(call => /generation|instant-review|editorial\/jobs|media\/upload/.test(call.pathname))).toEqual([]);
}

async function expectCreateMode(mode: "Article" | "Idea") {
  // The route owns the single outer main; do not depend on the old nested main.
  const group = page.getByRole("main").getByRole("group", { name: "Create from", exact: true });
  await browserExpect(group).toHaveCount(1);
  await browserExpect(group).toBeVisible();
  expect(await group.evaluate(element => element.tagName)).toBe("FIELDSET");
  await browserExpect(group.getByRole("button")).toHaveCount(2);
  for (const name of ["Article", "Idea"]) {
    await browserExpect(group.getByRole("button", { name, exact: true })).toHaveAttribute("aria-pressed", String(name === mode));
  }
  await browserExpect(group.getByRole("button", { pressed: true })).toHaveCount(1);
  return group;
}

async function expectFreshArticle() {
  await browserExpect(page).toHaveURL(url => url.origin === origin && url.pathname === "/dashboard/create");
  const main = await expectWorkspaceLandmarks("Create post");
  await expectCreateMode("Article");
  // Distinguish the Article board from the old URL-only default and Idea editor.
  await browserExpect(main.getByRole("combobox", { name: "Story", exact: true })).toHaveValue("");
  await browserExpect(main.getByRole("textbox", { name: "Article URL", exact: true })).toHaveValue("");
  await browserExpect(main.getByTestId("button-generate-selected")).toBeDisabled();
  await browserExpect(main.getByTestId("button-regenerate")).toHaveCount(0);
  await browserExpect(main.getByTestId("editor-manual-article")).toHaveCount(0);
}

async function expectEditorFocusPaint(editor: Locator, phase: string) {
  await browserExpect(editor).toBeFocused();
  // These are browser-computed values from /workspace.css (real index.css,
  // generated tokens and Tailwind), never classes or injected test styles.
  const measure = () => editor.evaluate(element => {
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    const layers = style.boxShadow.split(/,(?![^(]*\))/).map(layer => ({
      inset: layer.includes("inset"), lengths: (layer.match(/-?\d+(?:\.\d+)?px/g) ?? []).map(Number.parseFloat),
      color: layer.match(/rgba?\([^)]+\)/)?.[0],
    }));
    const ring = layers.find(layer => layer.inset && layer.lengths[0] === 0 && layer.lengths[1] === 0 && layer.lengths[2] === 0 && layer.lengths[3] >= 2);
    const channels = ring?.color?.match(/[\d.]+/g)?.map(Number) ?? [];
    const ancestors: HTMLElement[] = [];
    for (let node = element.parentElement; node; node = node.parentElement) ancestors.push(node);
    const surface = [element, ...ancestors].map(node => getComputedStyle(node).backgroundColor)
      .find(color => color !== "rgba(0, 0, 0, 0)" && color !== "transparent");
    const identify = (node: Element | null) => node ? { tag: node.tagName, id: node.id, class: node.getAttribute("class"),
      label: node.getAttribute("aria-label"), testId: node.getAttribute("data-testid") } : null;
    const clipping = ancestors.map(node => {
      const bounds = node.getBoundingClientRect();
      const css = getComputedStyle(node);
      const left = bounds.left + node.clientLeft, top = bounds.top + node.clientTop;
      return { element: identify(node), rect: bounds.toJSON(), scrollTop: node.scrollTop, scrollLeft: node.scrollLeft,
        clientWidth: node.clientWidth, clientHeight: node.clientHeight, scrollHeight: node.scrollHeight,
        overflowX: css.overflowX, overflowY: css.overflowY,
        clipsX: /auto|scroll|hidden|clip/.test(css.overflowX) && (box.left < left - 1 || box.right > left + node.clientWidth + 1),
        clipsY: /auto|scroll|hidden|clip/.test(css.overflowY) && (box.top < top - 1 || box.bottom > top + node.clientHeight + 1) };
    });
    const edges = [[box.left + 1, box.y + box.height / 2], [box.right - 1, box.y + box.height / 2],
      [box.x + box.width / 2, box.top + 1], [box.x + box.width / 2, box.bottom - 1]].map(([x, y], index) => {
      const hit = document.elementFromPoint(x, y);
      return { edge: ["left", "right", "top", "bottom"][index], x, y, hit: identify(hit),
        editorHit: hit === element || element.contains(hit) };
    });
    return {
      focused: document.activeElement === element,
      focusVisible: element.matches(":focus-visible"),
      opaqueInsetRing: Boolean(ring?.color && channels.length >= 3 && (channels[3] ?? 1) === 1 && ring.color !== surface),
      paintVisible: [element, ...ancestors].every(node => {
        const css = getComputedStyle(node);
        return css.visibility === "visible" && css.display !== "none" && Number(css.opacity) >= 0.99;
      }),
      usefulSize: box.width >= 160 && box.height >= 240,
      onScreen: box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight,
      unclipped: clipping.every(node => !node.clipsX && !node.clipsY), edgeHits: edges.every(edge => edge.editorHit),
      noAncestorHorizontalScroll: ancestors.every(node => node.scrollLeft === 0),
      noDocumentOverflow: document.documentElement.scrollWidth <= innerWidth,
      shadow: style.boxShadow, rect: box.toJSON(), surface, clipping, edges,
    };
  });
  try {
    await browserExpect.poll(measure).toMatchObject({ focused: true, focusVisible: true, opaqueInsetRing: true, paintVisible: true,
      usefulSize: true, onScreen: true, unclipped: true, edgeHits: true, noAncestorHorizontalScroll: true, noDocumentOverflow: true });
  } catch (error) {
    console.error(`Editor focus geometry (${phase}): ${JSON.stringify(await measure(), null, 2)}`);
    throw error;
  }
}

describe("UX-03 real App semantics and Create entry (actual CSS, mocked boundaries)", () => {
  it.each(ux03Widths.flatMap(width => workspaceRoutes.map(item => ({ ...item, width }))))(
    "has one main containing the only H1 and no nested interactive controls on $route at $width px",
    async ({ route, heading, width }) => {
      await openWorkspace(route, width);
      const main = await expectWorkspaceLandmarks(heading);
      await expectNoNestedInteractive(main);
      // Include the real navbar, sidebar and footer, not only route content.
      await expectNoNestedInteractive(page.locator("body"));
      expectNoCreationRequests();
    },
  );

  it.each(ux03Widths)("keeps workspace navigation and account menus free of nested controls at %s px", async width => {
    await openWorkspace("/dashboard", width);
    if (width < 768) {
      await page.getByTestId("button-navbar-navigation").click();
      await browserExpect(page.getByRole("dialog", { name: "Sidebar", exact: true })).toBeVisible();
      await expectNoNestedInteractive(page.locator("body"));
      await page.keyboard.press("Escape");
      await browserExpect(page.getByRole("dialog", { name: "Sidebar", exact: true })).toHaveCount(0);
    } else {
      await browserExpect(page.getByTestId("nav-home")).toBeVisible();
      await expectNoNestedInteractive(page.locator("body"));
    }
    await page.getByTestId("button-navbar-account").click();
    await browserExpect(page.getByTestId("link-navbar-settings")).toBeVisible();
    // Menu items intentionally use a roving tabindex, unlike in-page links.
    await browserExpect(page.getByTestId("link-navbar-settings")).toHaveAttribute("href", "/dashboard/settings");
    expect(await page.getByTestId("link-navbar-settings").evaluate(element => element.tagName)).toBe("A");
    await expectNoNestedInteractive(page.locator("body"));
    await page.keyboard.press("Escape");
    expectNoCreationRequests();
  });

  it.each(ux03Widths)("announces both source modes and gives the multiline Idea textbox a visible keyboard focus ring at %s px", async width => {
    const dialogs = recordDialogs();
    await openWorkspace("/dashboard/create", width);
    await expectFreshArticle();
    let group = await expectCreateMode("Article");
    for (const name of ["Article", "Idea"]) await expectOnScreen(group.getByRole("button", { name, exact: true }), 32);
    await group.getByRole("button", { name: "Idea", exact: true }).focus();
    await page.keyboard.press("Enter");
    group = await expectCreateMode("Idea");
    for (const name of ["Article", "Idea"]) await expectOnScreen(group.getByRole("button", { name, exact: true }), 32);
    await browserExpect(page.getByRole("textbox", { name: "Article title", exact: true })).toHaveValue("");
    await browserExpect(page.getByRole("textbox", { name: "Article text", exact: true })).toBeEmpty();
    // Switching an untouched source is not a destructive action.
    await group.getByRole("button", { name: "Article", exact: true }).focus();
    await page.keyboard.press("Space");
    await expectFreshArticle();
    group = await expectCreateMode("Article");
    await group.getByRole("button", { name: "Idea", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expectCreateMode("Idea");
    await expectWorkspaceLandmarks("Create post");
    expect(dialogs).toEqual([]);

    const editor = page.getByRole("main").getByRole("textbox", { name: "Article text", exact: true });
    await browserExpect(editor).toHaveAttribute("contenteditable", "true");
    await browserExpect(editor).toHaveAttribute("aria-multiline", "true");
    await browserExpect(editor).toHaveAttribute("aria-readonly", "false");
    await browserExpect(editor).toHaveAccessibleName("Article text");
    const labelId = await editor.getAttribute("aria-labelledby");
    expect(labelId).toBeTruthy();
    const label = page.locator(`[id="${labelId}"]`);
    await browserExpect(label).toHaveCount(1);
    await browserExpect(label).toBeVisible();
    await browserExpect(label).toHaveText("Article text");
    await browserExpect(label).toHaveAttribute("for", (await editor.getAttribute("id"))!);
    const helpIds = (await editor.getAttribute("aria-describedby"))?.trim().split(/\s+/) ?? [];
    expect(helpIds.length).toBeGreaterThanOrEqual(2);
    for (const id of helpIds) {
      await browserExpect(page.locator(`[id="${id}"]`)).toHaveCount(1);
      await browserExpect(page.locator(`[id="${id}"]`)).toBeVisible();
    }
    await browserExpect(editor).toHaveAccessibleDescription(/Write or paste your source in plain text or Markdown\..*Formatting controls change this editor preview only.*Only plain text is retained in this creation; Markdown remains literal text\..*Uploaded attachments are retained separately in this session, not inspected as fact-checked evidence\./);
    await browserExpect(editor).toHaveAccessibleDescription(/0 \/ 20,000 characters.*At least 20 characters to generate/);
    const toolbar = page.getByRole("group", { name: "Article formatting toolbar", exact: true });
    // UX-02 covers all 24 toolbar stops; here prove Tab really enters/leaves
    // the textbox and exposes its ring without focus() or scrolling the editor.
    await toolbar.getByRole("button", { name: "Clear formatting", exact: true }).focus();
    const unfocusedShadow = await editor.evaluate(element => getComputedStyle(element).boxShadow);
    const before = (await editor.boundingBox())!;
    await page.keyboard.press("Tab");
    await expectEditorFocusPaint(editor, "forward Tab");
    expect(await editor.evaluate(element => getComputedStyle(element).boxShadow)).not.toBe(unfocusedShadow);
    const after = (await editor.boundingBox())!;
    expect(after.x).toBeCloseTo(before.x, 1);
    expect(after.width).toBeCloseTo(before.width, 1);
    await page.keyboard.type("A keyboard-written idea is retained.");
    await page.keyboard.press("Enter");
    await page.keyboard.type("The second line remains editable.");
    const text = await editor.innerText();
    expect(text).toBe("A keyboard-written idea is retained.\nThe second line remains editable.");
    await browserExpect(editor).toHaveAccessibleDescription(new RegExp(`${text.length} / 20,000 characters`));
    await page.keyboard.press("Tab");
    await browserExpect(page.getByRole("button", { name: "Add media", exact: true })).toBeFocused();
    await browserExpect.poll(() => editor.evaluate(element => getComputedStyle(element).boxShadow)).toBe(unfocusedShadow);
    await page.keyboard.press("Shift+Tab");
    await expectEditorFocusPaint(editor, "reverse Shift+Tab");
    // Scroll correction must not blur/remount the editor or swallow typing.
    // Use keyboard input only: no editor.focus(), locator auto-scroll or DOM scroll.
    const continuation = " Still editable.";
    await page.keyboard.type(continuation);
    await browserExpect(editor).toBeFocused();
    const continuedText = await editor.innerText();
    expect(continuedText).toContain(continuation);
    expect(continuedText.replace(continuation, "")).toBe(text);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    // Let any queued focus reveal finish; it must not steal focus back.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await browserExpect(page.getByRole("button", { name: "Add media", exact: true })).toBeFocused();
    await browserExpect.poll(() => editor.evaluate(element => getComputedStyle(element).boxShadow)).toBe(unfocusedShadow);
    await expectNoNestedInteractive(page.locator("body"));
    expect(dialogs).toEqual([]);
    expectNoCreationRequests();
  });

  it.each([375, 1440].flatMap(width => [
    { entry: "global Create from Content", route: "/dashboard/content", testId: "button-global-create" },
    { entry: "global Create from empty Discover", route: "/dashboard/discover", testId: "button-global-create" },
    { entry: "Home header Create", route: "/dashboard", testId: "button-overview-instant-review" },
    { entry: "Home empty next action", route: "/dashboard", testId: "card-personalized-briefing" },
  ].map(item => ({ ...item, width }))))("opens a fresh Article board through $entry at $width px", async ({ route, testId, width }) => {
    const dialogs = recordDialogs();
    await openWorkspace(route, width);
    expect(new URL(page.url()).pathname).toBe(route);
    await browserExpect(page.getByRole("group", { name: "Create from", exact: true })).toHaveCount(0);
    const entry = testId === "card-personalized-briefing"
      ? page.getByTestId(testId).getByRole("button", { name: "Create post", exact: true })
      : page.getByTestId(testId);
    await entry.click();
    await expectFreshArticle();
    expect(dialogs).toEqual([]);
    expectNoCreationRequests();
  });

  it.each([375, 1440])("routes Home Explore story through Discover before prefilling Article at %s px", async width => {
    const dialogs = recordDialogs();
    const story = { id: "ux03-story", headline: "A fixture story for the Create entry smoke", source: "Fixture newsroom",
      summary: "An isolated source excerpt; opening Create must not generate or save a post.", articleUrl: "https://article.invalid/ux03",
      status: "active", matchedKeywords: [], createdAt: new Date().toISOString() };
    // Opt-in fixture data only for this smoke; the default six-route fixture
    // stays empty. Unknown methods still reach the common fail-closed guard.
    await page.route(url => url.origin === origin && url.pathname === "/api/inbox", async route => {
      if (route.request().method() !== "GET") return route.fallback();
      apiCalls.push({ method: "GET", pathname: "/api/inbox" });
      await route.fulfill({ json: [story] });
    });
    await openWorkspace("/dashboard", width);
    const explore = page.getByRole("main").getByRole("link", { name: "Explore story", exact: true });
    await expectSingleNavigationLink(explore, "/dashboard/discover");
    await explore.click();
    await browserExpect(page).toHaveURL(origin + "/dashboard/discover");
    const discover = await expectWorkspaceLandmarks("Discover");
    await browserExpect(discover.getByRole("group", { name: "Create from", exact: true })).toHaveCount(0);
    await discover.getByTestId(`row-inbox-${story.id}`).click();
    const detail = width < 1024 ? page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: story.headline, exact: true }) }) : discover;
    await browserExpect(detail.getByRole("heading", { name: story.headline, exact: true })).toBeVisible();
    await expectNoNestedInteractive(page.locator("body"));
    await detail.getByRole("button", { name: "Create draft", exact: true }).click();
    await browserExpect(page).toHaveURL(origin + "/dashboard/create");
    const main = await expectWorkspaceLandmarks("Create post");
    await expectCreateMode("Article");
    await browserExpect(main.getByRole("combobox", { name: "Story", exact: true })).toHaveValue(story.id);
    await browserExpect(main.getByRole("textbox", { name: "Article URL", exact: true })).toHaveValue(story.articleUrl);
    await browserExpect(page.getByRole("dialog")).toHaveCount(0);
    expect(dialogs).toEqual([]);
    expectNoCreationRequests();
  });

  it.each([375, 1440])("resumes the selected Idea and its inputs through global Create at %s px", async width => {
    const dialogs = recordDialogs();
    await openIdea(width);
    await expectCreateMode("Idea");
    const title = "Retained UX03 idea";
    const text = "This idea stays in the composer while I visit Home, without generating or saving.";
    await page.getByRole("textbox", { name: "Article title", exact: true }).fill(title);
    await page.getByRole("textbox", { name: "Article text", exact: true }).fill(text);
    await page.getByTestId("link-navbar-logo").click();
    await browserExpect(page).toHaveURL(origin + "/dashboard");
    await expectWorkspaceLandmarks("Home");
    await browserExpect(page.getByTestId("editor-manual-article")).toHaveCount(0);
    await page.getByTestId("button-global-create").click();
    await browserExpect(page).toHaveURL(origin + "/dashboard/create");
    await expectWorkspaceLandmarks("Create post");
    await expectCreateMode("Idea");
    await browserExpect(page.getByRole("textbox", { name: "Article title", exact: true })).toHaveValue(title);
    await browserExpect(page.getByRole("textbox", { name: "Article text", exact: true })).toHaveText(text);
    await browserExpect(page.getByTestId("button-generate-selected")).toHaveCount(0);
    expect(dialogs).toEqual([]);
    expectNoCreationRequests();
  });

  it.each([375, 1440])("makes Calendar Manage drafts one keyboard-operable anchor at %s px", async width => {
    await openWorkspace("/dashboard/calendar", width);
    const main = await expectWorkspaceLandmarks("Publishing Calendar");
    const link = main.getByRole("link", { name: "Manage drafts", exact: true });
    await expectSingleNavigationLink(link, "/dashboard/content");
    await browserExpect(main.getByRole("button", { name: "Manage drafts", exact: true })).toHaveCount(0);
    await main.getByRole("button", { name: "Next period", exact: true }).focus();
    await page.keyboard.press("Tab");
    await browserExpect(main.getByRole("combobox", { name: "Display & scheduling timezone", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await browserExpect(link).toBeFocused();
    await expectOnScreen(link);
    await page.keyboard.press("Enter");
    await browserExpect(page).toHaveURL(origin + "/dashboard/content");
    await expectWorkspaceLandmarks("Content");
    expectNoCreationRequests();
  });

  it.each([375, 1440])("makes empty Discover's setup action one Settings link, not Create, at %s px", async width => {
    // A single fully intercepted refresh reveals the real needsSetup branch.
    // This does not waive the shared fixture's rejection of all other writes.
    await page.route(url => url.origin === origin && url.pathname === "/api/inbox/refresh", async route => {
      if (route.request().method() !== "POST") return route.fallback();
      apiCalls.push({ method: "POST", pathname: "/api/inbox/refresh" });
      await route.fulfill({ json: { count: 0, needsSetup: true } });
    });
    await openWorkspace("/dashboard/discover", width);
    await page.getByTestId("button-refresh-empty").click();
    const main = await expectWorkspaceLandmarks("Discover");
    const link = main.getByRole("link", { name: "Set up your interests", exact: true });
    await expectSingleNavigationLink(link, "/dashboard/settings?tab=content");
    await browserExpect(main.getByRole("button", { name: "Set up your interests", exact: true })).toHaveCount(0);
    await expectNoNestedInteractive(page.locator("body"));
    await link.focus();
    await page.keyboard.press("Tab");
    await browserExpect(page.getByTestId("button-refresh-empty")).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await browserExpect(link).toBeFocused();
    await expectOnScreen(link);
    await page.keyboard.press("Enter");
    await browserExpect(page).toHaveURL(origin + "/dashboard/settings?tab=content");
    await expectWorkspaceLandmarks("Settings");
    await browserExpect(page.getByRole("tab", { name: "content", exact: true })).toHaveAttribute("aria-selected", "true");
    await browserExpect(page.getByRole("group", { name: "Create from", exact: true })).toHaveCount(0);
    expect(apiCalls.filter(call => call.method !== "GET")).toEqual([{ method: "POST", pathname: "/api/inbox/refresh" }]);
    expect(apiCalls.filter(call => /generation|instant-review|editorial\/jobs|media\/upload/.test(call.pathname))).toEqual([]);
  });
});