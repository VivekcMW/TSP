import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { chromium, expect as browserExpect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { readFileSync } from "node:fs";
import postcss from "postcss";
import tailwindcss from "tailwindcss";

let server: Server;
let browser: Browser;
let context: BrowserContext;
let page: Page;
let origin: string;
let browserErrors: string[];

// Real Help panel, tour provider, routing and Radix layering; no network calls are made.
beforeAll(async () => {
  const root = path.resolve(import.meta.dirname, "../../..");
  const css = await postcss([tailwindcss({ config: path.join(root, "tailwind.config.ts") })])
    .process(readFileSync(path.join(root, "client/src/index.css"), "utf8"), { from: path.join(root, "client/src/index.css") });
  const result = await build({
    absWorkingDir: root, bundle: true, write: false, format: "esm", platform: "browser", jsx: "automatic",
    define: { "import.meta.env.DEV": "false", "import.meta.env.PROD": "false", "import.meta.env.BASE_URL": '"/"' },
    alias: { "@": path.join(root, "client/src"), "@shared": path.join(root, "shared") },
    stdin: {
      resolveDir: root, loader: "tsx", contents: `
        import { StrictMode, useState } from "react";
        import { createRoot } from "react-dom/client";
        import { useLocation, useSearch } from "wouter";
        import { AppTourProvider } from "@/components/app-tour";
        import { HelpProvider, HelpButton, HelpLink } from "@/components/help-panel";
        import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
        window.__events = [];
        window.gtag = (_type, name, params) => window.__events.push({ name, ...params });
        function Page() {
          const [location] = useLocation();
          const search = useSearch();
          const [open, setOpen] = useState(false);
          return <div className="p-6 space-y-4">
            <HelpButton />
            <output data-testid="route">{location}{search ? "?" + search : ""}</output>
            <input aria-label="Notes" />
            <button onClick={() => setOpen(true)}>Open publishing</button>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogContent>
                <div className="flex items-center gap-1 pr-10"><DialogTitle>Publishing options</DialogTitle><HelpLink section="publishing" label="Publishing a post" /></div>
                <DialogDescription>Fixture dialog.</DialogDescription>
              </DialogContent>
            </Dialog>
          </div>;
        }
        const phase = location.pathname === "/onboarding" ? "setup" : "workspace";
        createRoot(document.getElementById("root")).render(<StrictMode>
          <AppTourProvider phase={phase} scope="help-fixture" enabled><HelpProvider phase={phase}><Page /></HelpProvider></AppTourProvider>
        </StrictMode>);
      `,
    },
  });
  server = createServer((req, res) => {
    if (req.url === "/fixture.js") { res.setHeader("Content-Type", "text/javascript"); res.end(result.outputFiles[0].text); return; }
    res.setHeader("Content-Type", "text/html");
    res.end('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css.css + '</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Help fixture did not bind");
  origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
}, 60000);

beforeEach(async () => {
  context = await browser.newContext();
  page = await context.newPage();
  page.setDefaultTimeout(5000);
  browserErrors = [];
  page.on("pageerror", error => browserErrors.push(error.message));
  // Start with the automatic tour paused so it doesn't redirect the fixture.
  await context.addInitScript(() => {
    if (!localStorage.getItem("tsp-app-tour:v3:help-fixture")) localStorage.setItem("tsp-app-tour:v3:help-fixture",
      JSON.stringify({ step: 3, dismissed: true, completed: false }));
    localStorage.setItem("tsp-analytics-consent", "granted");
  });
});
afterEach(async () => { await context.close(); expect(browserErrors).toEqual([]); });
afterAll(async () => {
  await browser?.close();
  if (server?.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

const panel = () => page.getByTestId("help-panel");
const section = (id: string) => page.getByTestId(`help-section-${id}`);

describe("help panel", { timeout: 20_000 }, () => {
  it("opens from the navbar with the current page's features expanded first", async () => {
    await page.goto(`${origin}/dashboard/content`);
    await page.getByTestId("button-navbar-help").click();
    await browserExpect(panel().getByRole("heading", { name: "Help" })).toBeVisible();
    await browserExpect(panel().locator("h3").first()).toHaveText("On this page");
    await browserExpect(section("content")).toHaveAttribute("data-state", "open");
    await browserExpect(section("publishing")).toHaveAttribute("data-state", "open");
    await browserExpect(section("billing")).toHaveAttribute("data-state", "closed");
    await section("billing").getByRole("button", { name: "Plans and billing" }).click();
    await browserExpect(section("billing")).toContainText("Payment Method");
    await page.keyboard.press("Escape");
    await browserExpect(panel()).toHaveCount(0);
    await browserExpect(page.getByTestId("button-navbar-help")).toBeFocused();
  });

  it("matches Settings tabs", async () => {
    await page.goto(`${origin}/dashboard/settings?tab=integrations`);
    await page.getByTestId("button-navbar-help").click();
    await browserExpect(section("connections")).toHaveAttribute("data-state", "open");
    await browserExpect(panel().locator('[data-state="open"][data-testid^="help-section-"]')).toHaveCount(1);
  });

  it("searches features and reports when nothing matches", async () => {
    await page.goto(`${origin}/dashboard`);
    await page.getByTestId("button-navbar-help").click();
    await page.getByTestId("input-help-search").fill("reconnect");
    await browserExpect(panel().getByRole("status")).toHaveText("2 results");
    await browserExpect(section("connections")).toHaveAttribute("data-state", "open");
    await browserExpect(section("troubleshooting")).toHaveAttribute("data-state", "open");
    await browserExpect(section("home")).toHaveCount(0);
    await page.getByTestId("input-help-search").fill("zzzz");
    await browserExpect(panel().getByRole("status")).toContainText("No results");
  });

  it("opens from a deep link and removes only the help parameter", async () => {
    await page.goto(`${origin}/dashboard/settings?tab=team&help=scheduling`);
    await browserExpect(section("scheduling")).toHaveAttribute("data-state", "open");
    await browserExpect(page.getByTestId("route")).toHaveText("/dashboard/settings?tab=team");
    await page.reload();
    await browserExpect(panel()).toHaveCount(0);
  });

  it("opens with the ? shortcut, except while typing", async () => {
    await page.goto(`${origin}/dashboard/create`);
    await page.getByRole("textbox", { name: "Notes" }).press("Shift+?");
    await browserExpect(panel()).toHaveCount(0);
    await browserExpect(page.getByRole("textbox", { name: "Notes" })).toHaveValue("?");
    await page.locator("body").click({ position: { x: 600, y: 400 } });
    await page.keyboard.press("Shift+?");
    await browserExpect(section("create")).toHaveAttribute("data-state", "open");
    await browserExpect(section("platform-versions")).toHaveAttribute("data-state", "open");
  });

  it("Show me closes Help and starts the tour at that feature", async () => {
    await page.goto(`${origin}/dashboard/content`);
    await page.getByTestId("button-navbar-help").click();
    await section("discover").getByRole("button", { name: "Discover stories" }).click();
    await page.getByTestId("button-help-show-discover").click();
    await browserExpect(panel()).toHaveCount(0);
    await browserExpect(page.getByTestId("dialog-app-tour").getByRole("heading", { name: "Find a story in Discover" })).toBeVisible();
    await browserExpect(page.getByTestId("route")).toHaveText("/dashboard/discover");
  });

  it("only offers setup walkthroughs and no workspace links during onboarding", async () => {
    await page.goto(`${origin}/onboarding`);
    await page.getByTestId("button-navbar-help").click();
    await browserExpect(section("getting-started")).toHaveAttribute("data-state", "open");
    await browserExpect(page.getByTestId("button-help-show-getting-started")).toBeVisible();
    await browserExpect(section("getting-started").getByRole("link")).toHaveCount(0);
    await section("discover").getByRole("button", { name: "Discover stories" }).click();
    await browserExpect(page.getByTestId("button-help-show-discover")).toHaveCount(0);
  });

  it("opens from an inline ? inside a dialog and closes back to it", async () => {
    await page.goto(`${origin}/dashboard/content`);
    await page.getByRole("button", { name: "Open publishing" }).click();
    await page.getByRole("button", { name: "Help: Publishing a post" }).click();
    await browserExpect(section("publishing")).toHaveAttribute("data-state", "open");
    await browserExpect(panel().locator('[data-state="open"][data-testid^="help-section-"]')).toHaveCount(1);
    await section("publishing").getByRole("button", { name: /Yes, .* was helpful/ }).click();
    await browserExpect(section("publishing").getByRole("status")).toHaveText("Thanks for your feedback.");
    await page.keyboard.press("Escape");
    await browserExpect(panel()).toHaveCount(0);
    await browserExpect(page.getByRole("dialog", { name: "Publishing options" })).toBeVisible();
    await browserExpect(page.getByRole("button", { name: "Help: Publishing a post" })).toBeFocused();
    const events = await page.evaluate(() => (window as unknown as { __events: { name: string }[] }).__events);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "help_opened", source: "inline", section: "publishing" }),
      expect.objectContaining({ name: "help_feedback", section: "publishing", helpful: true }),
    ]));
  });

  it("fills a phone screen and scrolls long content", async () => {
    await page.setViewportSize({ width: 390, height: 700 });
    await page.goto(`${origin}/dashboard/content`);
    await page.getByTestId("button-navbar-help").click();
    const box = await panel().boundingBox();
    expect(box?.width).toBe(390);
    await section("troubleshooting").scrollIntoViewIfNeeded();
    await browserExpect(section("troubleshooting")).toBeInViewport();
    await browserExpect(page.getByTestId("link-help-support")).toBeInViewport();
  });
});
