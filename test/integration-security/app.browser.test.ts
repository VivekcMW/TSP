import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect } from "vitest";
import { chromium, expect as browserExpect, type Browser, type Page } from "@playwright/test";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";
import path from "node:path";

let browser: Browser;
let server: Server;
let origin: string;
let page: Page;
let account: string;
let failures: Map<string, number>;
let errors: string[];

beforeAll(async () => {
  const root = path.resolve(import.meta.dirname, "../..");
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
  server = createServer((req, res) => {
    res.setHeader("Content-Type", req.url === "/fixture.js" ? "text/javascript" : "text/html");
    res.end(req.url === "/fixture.js" ? result.outputFiles[0].text : '<html><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture failed to bind");
  origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => { await browser?.close(); await new Promise<void>(resolve => server?.close(() => resolve())); });

beforeEach(async () => {
  account = "a"; failures = new Map(); errors = [];
  page = await browser.newPage({ reducedMotion: "reduce" });
  page.setDefaultTimeout(5000);
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { errors.push(`External request: ${url.origin}`); return route.abort(); }
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const reply = (data: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
    const failure = failures.get(url.pathname);
    if (failure === 0) return route.abort("internetdisconnected");
    if (failure) return reply({ message: "Fixture unavailable" }, failure);
    if (url.pathname === "/api/me") return reply({ id: account, name: `Person ${account}`, registrationCompleted: "2026-01-01", platformRole: null });
    if (url.pathname === "/api/profile") return reply({ id: `profile-${account}`, userId: account, tenantId: `tenant-${account}`, onboardingStatus: "completed", focusDescription: `Voice ${account}`, enabledPlatforms: ["linkedin"], defaultPlatform: "linkedin", defaultTone: "professional", timezone: "UTC", preferredPublishTime: "09:00", publications: [], companies: [], keywords: [], influencers: [] });
    if (["/api/integrations", "/api/inbox", "/api/sources", "/api/sources/suggestions", "/api/sources/publications", "/api/profile/social-links", "/api/publishing-rules"].includes(url.pathname)) return reply([]);
    if (url.pathname === "/api/analytics/summary") return reply({ connected: {}, linkedin: null, twitter: null });
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
    const voice = page.getByLabel("Voice & focus");
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
    await browserExpect(page.getByRole("button", { name: /Generate/i }).last()).toBeDisabled();
    failures.clear();
    await refetch("/api/profile");
    await browserExpect(input).toHaveValue("https://example.invalid/story");
  });

  it.each([401, 403])("does not render cached authenticated data after a background %s", async status => {
    await open();
    failures.set("/api/profile", status);
    await refetch("/api/profile");
    await browserExpect(page.getByTestId("shell")).toHaveCount(0);
    await browserExpect(page.getByLabel("Voice & focus")).toHaveCount(0);
  });

  it("does not render the shell when initial account data fails", async () => {
    failures.set("/api/me", 500);
    await page.goto(origin + "/dashboard");
    await browserExpect(page.getByTestId("shell")).toHaveCount(0);
    await browserExpect(page.getByTestId("button-auth-error-retry")).toBeVisible();
  });

  it("clears before rendering another identity and ignores old in-flight completion", async () => {
    await open();
    await page.getByLabel("Voice & focus").fill("Private A work");
    await page.evaluate(() => { (window as any).security.seed(); (window as any).security.startOld(); });
    account = "b";
    await page.evaluate(() => (window as any).security.setSession("b"));
    await browserExpect(page.getByLabel("Voice & focus")).toHaveValue("Voice b");
    await page.evaluate(() => (window as any).security.finishOld());
    const cache = await page.evaluate(() => (window as any).security.cache());
    expect(JSON.stringify(cache)).not.toContain("private-a");
    expect(JSON.stringify(cache)).not.toContain("tenant-a");
    await browserExpect(page.getByLabel("Voice & focus")).toHaveValue("Voice b");
  });

  it("does not reset work for same-user session refresh", async () => {
    await open();
    await page.getByLabel("Voice & focus").fill("Retained work");
    await page.evaluate(() => (window as any).security.setSession("a"));
    await browserExpect(page.getByLabel("Voice & focus")).toHaveValue("Retained work");
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

  it("preserves the old Published view while the destination view wins", async () => {
    await open("/dashboard/published?view=drafts&provider=twitter");
    await browserExpect(page.getByTestId("route-page")).toHaveText("@/pages/drafts");
    const url = new URL(page.url());
    expect(url.pathname).toBe("/dashboard/content");
    expect(url.searchParams.get("view")).toBe("published");
    expect(url.searchParams.get("provider")).toBe("twitter");
  });
});