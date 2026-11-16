import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { chromium, expect as browserExpect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { readFileSync } from "node:fs";
import postcss from "postcss";
import tailwindcss from "tailwindcss";

const CLASSIC_KEY = "tsp-app-tour:v3:user:a";
const INBOX_KEY = "tsp-app-tour:inbox-v1:user:a";

let server: Server;
let browser: Browser;
let context: BrowserContext;
let page: Page;
let origin: string;
let browserErrors: string[];

// Real Inbox tour, routing and geometry. The composer is a fixture that reports the same events
// as the Inbox composer; no AI, OAuth, publishing or database calls are made.
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
        import { AppTourProvider, useAppTour, useAppTourReporter } from "@/components/app-tour";
        import { Button } from "@/components/ui/button";
        import { useLocation, useSearch } from "wouter";
        function ComposerControls() {
          const report = useAppTourReporter();
          return <div className="flex w-64 flex-col gap-2">
            <Button onClick={() => report?.("draft-saved")}>Save without draft id</Button>
            <Button onClick={() => report?.("draft-saved", "draft-a")}>Save draft</Button>
            <Button onClick={() => report?.("publishing-result", "draft-b", "published")}>Post another draft</Button>
            <Button onClick={() => report?.("publishing-result", "draft-a")}>Result without outcome</Button>
            {["scheduled", "published", "simulated", "attention"].map(outcome =>
              <Button key={outcome} onClick={() => report?.("publishing-result", "draft-a", outcome)}>Result: {outcome}</Button>)}
          </div>;
        }
        function Inbox() {
          const { openTour, startTourAt } = useAppTour();
          const report = useAppTourReporter();
          const [location] = useLocation();
          const search = useSearch();
          const [composing, setComposing] = useState(false);
          const compose = () => { setComposing(true); report?.("create-opened"); };
          return <div className="flex gap-6 p-6">
            <nav aria-label="Folders" className="flex w-40 flex-col gap-2">
              <Button data-testid="button-inbox-compose" onClick={compose}>Compose</Button>
              <Button variant="ghost" data-testid="nav-folder-drafts">Drafts</Button>
              <Button variant="ghost" data-testid="nav-folder-scheduled">Scheduled</Button>
              <Button variant="ghost" data-testid="nav-folder-posted">Posted</Button>
            </nav>
            <main className="flex flex-col items-start gap-4">
              <Button onClick={openTour}>Reopen tour</Button>
              <Button onClick={() => startTourAt(10)}>Show me publishing</Button>
              <output data-testid="route">{location + (search ? "?" + search : "")}</output>
              {location === "/dashboard/settings" && <Button data-testid="button-connect-linkedin" onClick={() => report?.("connected")}>Connect account</Button>}
              {composing ? <ComposerControls /> : location === "/dashboard" && <Button data-testid="button-generate-story" onClick={compose}>Draft my take</Button>}
            </main>
            {composing && <section aria-label="Compose" className="fixed bottom-4 right-4 flex w-[28rem] flex-col gap-2 border bg-card p-3">
              <textarea data-testid="compose-body" aria-label="Post text" className="h-24 border p-2" />
              <Button data-testid="button-compose-post">Post</Button>
            </section>}
          </div>;
        }
        function Fixture() {
          const [variant, setVariant] = useState("inbox");
          return <>
            <Button className="fixed right-4 top-4" onClick={() => setVariant(variant === "inbox" ? "classic" : "inbox")}>Switch layout</Button>
            <AppTourProvider variant={variant} scope="user:a" enabled><Inbox /></AppTourProvider>
          </>;
        }
        createRoot(document.getElementById("root")).render(<StrictMode><Fixture /></StrictMode>);
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
  if (!address || typeof address === "string") throw new Error("Tour fixture did not bind");
  origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
}, 60000);

beforeEach(async () => {
  context = await browser.newContext();
  page = await context.newPage();
  page.setDefaultTimeout(5000);
  browserErrors = [];
  page.on("pageerror", error => browserErrors.push(error.message));
  await page.goto(origin);
});
afterEach(async () => { await context.close(); expect(browserErrors).toEqual([]); });
afterAll(async () => {
  await browser?.close();
  if (server?.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

describe("inbox app tour", () => {
  it("completes Find a story when a child reports the composer opened, storing progress under its own key", async () => {
    await assertStep("Connect an account (optional)");
    await page.getByRole("button", { name: "Continue without connecting" }).click();
    await nextStep();
    await assertStep("Find a story in your Inbox");
    await browserExpect(page.getByTestId("route")).toHaveText("/dashboard");
    await browserExpect(page.getByRole("button", { name: "Use my own idea" })).toHaveCount(0);
    await browserExpect(page.getByText("Step 5 of 8")).toBeVisible();
    await assertSpotlight('[data-testid="button-generate-story"]');
    await assertDone(false);
    await page.getByRole("button", { name: "Draft my take", exact: true }).click();
    await assertDone(true);
    await assertSpotlight('[data-testid="compose-body"]');
    await nextStep();
    await assertStep("Draft your take");
    expect(await storedProgress(INBOX_KEY)).toMatchObject({ step: 5, ready: false, dismissed: false, completed: false });
    expect(await storedProgress(CLASSIC_KEY)).toBeNull();
  });

  it("binds Draft your take only to a save that carries a draft id", async () => {
    await reloadWith({ [INBOX_KEY]: { step: 5, dismissed: false, completed: false } });
    await assertStep("Draft your take");
    await page.getByRole("button", { name: "Compose", exact: true }).click();
    await assertSpotlight('[data-testid="compose-body"]');
    await page.getByRole("button", { name: "Save without draft id" }).click();
    await assertStep("Draft your take");
    await assertDone(false);
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await assertDone(true);
    expect(await storedProgress(INBOX_KEY)).toMatchObject({ step: 5, ready: true, draftId: "draft-a" });
    await nextStep();
    await assertStep("Post in one click, or schedule");
    await assertSpotlight('[data-testid="button-compose-post"]');
  });

  it("ignores publishing results for another draft or without an outcome, then accepts the bound draft", async () => {
    await saveDraftAndContinue();
    await page.getByRole("button", { name: "Post another draft" }).click();
    await assertStep("Post in one click, or schedule");
    await assertDone(false);
    await page.getByRole("button", { name: "Result without outcome" }).click();
    await assertDone(false);
    await page.getByRole("button", { name: "Result: published", exact: true }).click();
    await assertDone(true);
    expect(await storedProgress(INBOX_KEY)).toMatchObject({ step: 6, ready: true, draftId: "draft-a", outcome: "published" });
  });

  for (const [outcome, folder, message] of [
    ["scheduled", "scheduled", "not published yet. Find it in the Scheduled folder"],
    ["published", "posted", "Publication confirmed by the app's live delivery status. Find the post and its receipt in the Posted folder"],
    ["simulated", "posted", "Demo only"],
    ["attention", "posted", "do not send a duplicate"],
  ] as const) {
    it(`opens the ${folder} folder and explains a ${outcome} result on the final step`, async () => {
      await saveDraftAndContinue();
      await page.getByRole("button", { name: `Result: ${outcome}`, exact: true }).click();
      await nextStep();
      await assertStep("Find it in your folders");
      await browserExpect(page.getByTestId("route")).toHaveText(`/dashboard?folder=${folder}`);
      await browserExpect(page.getByTestId("app-tour-outcome")).toContainText(message);
      if (outcome === "simulated" || outcome === "attention") await browserExpect(page.getByTestId("app-tour-outcome")).not.toContainText(/published/i);
      await assertSpotlight('[data-testid="nav-folder-posted"]');
      await browserExpect(page.getByTestId("button-app-tour-next")).toHaveCount(0);
      await page.reload();
      await assertStep("Find it in your folders");
      await browserExpect(page.getByTestId("route")).toHaveText(`/dashboard?folder=${folder}`);
      await browserExpect(page.getByTestId("app-tour-outcome")).toContainText(message);
      await page.getByRole("button", { name: "Finish tour" }).click();
      await page.reload();
      await browserExpect(page.getByTestId("dialog-app-tour")).toHaveCount(0);
    });
  }

  it("points to Drafts when the post step was skipped without a result", async () => {
    await reloadWith({ [INBOX_KEY]: { step: 6, dismissed: false, completed: false } });
    await assertStep("Post in one click, or schedule");
    await nextStep();
    await assertStep("Find it in your folders");
    await browserExpect(page.getByTestId("route")).toHaveText("/dashboard?folder=drafts");
    await browserExpect(page.getByTestId("app-tour-outcome")).toHaveCount(0);
  });

  it("does not auto-open when the classic tour was dismissed, and resumes at Find a story", async () => {
    await reloadWith({ [CLASSIC_KEY]: { step: 8, draftId: "draft-x", dismissed: true, completed: false } });
    await browserExpect(page.getByTestId("route")).toHaveText("/dashboard/settings?tab=integrations");
    await browserExpect(page.getByTestId("dialog-app-tour")).toHaveCount(0);
    expect(await storedProgress(INBOX_KEY)).toEqual({ step: 4, ready: false, dismissed: true, completed: false });
    await page.getByRole("button", { name: "Reopen tour" }).click();
    await assertStep("Find a story in your Inbox");
    await browserExpect(page.getByTestId("route")).toHaveText("/dashboard");
  });

  it("does not auto-open when the classic tour was completed", async () => {
    await reloadWith({ [CLASSIC_KEY]: { step: 12, draftId: "draft-x", outcome: "published", dismissed: true, completed: true } });
    await browserExpect(page.getByRole("button", { name: "Reopen tour" })).toBeVisible();
    await browserExpect(page.getByTestId("dialog-app-tour")).toHaveCount(0);
    await page.getByRole("button", { name: "Reopen tour" }).click();
    await assertStep("Connect an account (optional)");
    expect(await storedProgress(CLASSIC_KEY)).toMatchObject({ step: 12, completed: true });
  });

  it("resumes at the classic step while the classic tour is still at Connect an account", async () => {
    await reloadWith({ [CLASSIC_KEY]: { step: 3, ready: true, dismissed: false, completed: false } });
    await assertStep("Connect an account (optional)");
    await assertDone(true);
    expect(await storedProgress(INBOX_KEY)).toEqual({ step: 3, ready: true, dismissed: false, completed: false });
    await nextStep();
    await assertStep("Find a story in your Inbox");
    expect(await storedProgress(CLASSIC_KEY)).toEqual({ step: 3, ready: true, dismissed: false, completed: false });
  });

  it("starts at Find a story when classic progress is past Connect an account, and adopts it only once", async () => {
    await reloadWith({ [CLASSIC_KEY]: { step: 8, draftId: "draft-x", dismissed: false, completed: false } });
    await assertStep("Find a story in your Inbox");
    await browserExpect(page.getByTestId("route")).toHaveText("/dashboard");
    expect(await storedProgress(INBOX_KEY)).toEqual({ step: 4, ready: false, dismissed: false, completed: false });
    await page.evaluate(key => localStorage.setItem(key, JSON.stringify({ step: 3, dismissed: false, completed: false })), CLASSIC_KEY);
    await page.reload();
    await assertStep("Find a story in your Inbox");
  });

  it("re-initializes from each variant's own progress when the layout switches", async () => {
    await reloadWith({ [INBOX_KEY]: { step: 6, draftId: "draft-a", dismissed: false, completed: false } });
    await assertStep("Post in one click, or schedule");
    await page.getByRole("button", { name: "Switch layout" }).click();
    await assertStep("Connect an account (optional)");
    await nextStep();
    await assertStep("Find a story in Discover");
    await page.getByRole("button", { name: "Switch layout" }).click();
    await assertStep("Post in one click, or schedule");
    await browserExpect(page.getByTestId("route")).toHaveText("/dashboard");
    expect(await storedProgress(INBOX_KEY)).toMatchObject({ step: 6, draftId: "draft-a" });
    expect(await storedProgress(CLASSIC_KEY)).toMatchObject({ step: 4 });
  });

  it("maps help Show me steps to the equivalent Inbox step", async () => {
    await page.getByRole("button", { name: "Show me publishing" }).click();
    await assertStep("Post in one click, or schedule");
    await browserExpect(page.getByTestId("route")).toHaveText("/dashboard");
  });

  it("keeps a tour dismissed in the Inbox closed after switching to the classic layout", async () => {
    await reloadWith({ [CLASSIC_KEY]: { step: 3, dismissed: false, completed: false } });
    await assertStep("Connect an account (optional)");
    await page.getByRole("button", { name: "Close tour" }).click();
    await browserExpect(page.getByTestId("dialog-app-tour")).toHaveCount(0);
    await page.getByRole("button", { name: "Switch layout" }).click();
    await page.waitForTimeout(300);
    await browserExpect(page.getByTestId("dialog-app-tour")).toHaveCount(0);
    expect(await storedProgress(CLASSIC_KEY)).toMatchObject({ step: 3, dismissed: true, completed: false });
  });
});

async function reloadWith(entries: Record<string, unknown>) {
  await page.evaluate(values => {
    localStorage.clear();
    for (const [key, value] of Object.entries(values)) localStorage.setItem(key, JSON.stringify(value));
  }, entries);
  await page.reload();
}

async function storedProgress(key: string) {
  return page.evaluate(storageKey => {
    const raw = localStorage.getItem(storageKey);
    return raw === null ? null : JSON.parse(raw);
  }, key);
}

async function saveDraftAndContinue() {
  await reloadWith({ [INBOX_KEY]: { step: 5, dismissed: false, completed: false } });
  await assertStep("Draft your take");
  await page.getByRole("button", { name: "Compose", exact: true }).click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await nextStep();
  await assertStep("Post in one click, or schedule");
}

async function assertStep(title: string) {
  await browserExpect(page.getByTestId("dialog-app-tour").getByRole("heading", { name: title, exact: true })).toBeVisible();
}

async function assertDone(done: boolean) {
  await browserExpect(page.getByTestId("dialog-app-tour").getByText("Done. Select Next to continue.")).toHaveCount(done ? 1 : 0);
}

async function nextStep() {
  const next = page.getByTestId("button-app-tour-next");
  await browserExpect(next).toBeEnabled();
  await next.click();
}

async function assertSpotlight(selector: string) {
  await browserExpect(page.getByTestId("app-tour-arrow")).toBeVisible();
  await browserExpect.poll(async () => {
    const target = await page.locator(selector).boundingBox();
    const spotlight = await page.getByTestId("app-tour-spotlight").boundingBox();
    if (!target || !spotlight) return false;
    return Math.abs(spotlight.x - Math.max(4, target.x - 6)) < 2 && Math.abs(spotlight.y - Math.max(4, target.y - 6)) < 2;
  }).toBe(true);
}
