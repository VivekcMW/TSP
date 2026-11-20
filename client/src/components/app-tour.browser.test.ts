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

// Real tour, routing, Radix modal interaction and geometry; action outcomes are
// controlled fixtures. No AI, OAuth, publishing or database calls are made.
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
        import { AppTourProvider, useAppTour } from "@/components/app-tour";
        import { Button } from "@/components/ui/button";
        import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
        import { useLocation } from "wouter";
        function Controls({ phase, onComplete, switchScope }) {
          const { openTour, report } = useAppTour();
          const [location, navigate] = useLocation();
          const [focus, setFocus] = useState("");
          const [reviewOpen, setReviewOpen] = useState(false);
          const [failed, setFailed] = useState(false);
          return <div className="p-6 space-y-5">
            <Button onClick={openTour}>Reopen tour</Button><Button onClick={switchScope}>Switch workspace</Button>
            <output data-testid="route">{location}</output>
            {phase === "setup" ? <>
              <form onSubmit={e => {e.preventDefault(); if (focus.length >= 10) report("focus-submitted");}}>
                <input aria-label="Message Pundit" value={focus} onChange={e => setFocus(e.target.value)} className="fixed bottom-8 left-4 w-64 border p-3" />
                <Button type="submit">Send</Button>
              </form>
              <Button data-app-tour="setup-build" onClick={() => report("setup-started")}>Build my setup</Button>
              <Button data-testid="button-complete-onboarding" className="hidden lg:block" onClick={() => {report("setup-saved"); onComplete();}}>Start my workspace</Button>
              <Button data-app-tour="setup-tab" className="lg:hidden">Your setup</Button>
            </> : <>
              {location === "/dashboard/settings" && <Button data-testid="button-connect-linkedin" onClick={() => report("connected")}>Connect account</Button>}
              {location === "/dashboard/discover" && <Button data-testid="button-generate-story" onClick={() => {report("create-opened"); navigate("/dashboard/create");}}>Write a post</Button>}
              {location === "/dashboard/create" && <>
                <input aria-label="Message Pundit" className="fixed bottom-8 left-4 w-64 border p-3" />
                <Button onClick={() => report("document-ready")}>Apply reviewed document</Button>
                <Button aria-label="Adapt for platforms" onClick={() => report("platforms-opened")}>Adapt for platforms</Button>
                <Button data-testid="button-generate-selected" onClick={() => report("versions-ready")}>Create platform versions</Button>
                <Button onClick={() => setFailed(true)}>Fail save</Button>
                {failed && <p role="alert">Save failed. Retry explicitly.</p>}
                <Button data-app-tour="save-version" onClick={() => {setFailed(false); report("draft-saved", "draft-a");}}>Save draft</Button>
              </>}
              {location === "/dashboard/content" && <>
                <Button onClick={() => report("draft-opened", "draft-b")}>Open unrelated draft</Button>
                <section aria-label="Post preview" className="w-64 border p-3">
                  <Button onClick={() => report("draft-opened", "draft-a")}>Review exact draft</Button>
                  <Button data-app-tour="draft-publishing-actions" onClick={() => {report("publishing-opened", "draft-a"); setReviewOpen(true);}}>Publishing options</Button>
                </section>
              </>}
              <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
                <DialogContent>
                  <DialogTitle>Confirm draft publication</DialogTitle><DialogDescription>Review text and destination.</DialogDescription>
                  <div data-app-tour="publishing-confirmation">
                    <input aria-label="Publication time" type="time" />
                    <Button onClick={() => setFailed(true)}>Fail publishing</Button>
                    {failed && <p role="alert">Not confirmed. Check status before retrying.</p>}
                    <Button onClick={() => report("publishing-result", "draft-b", "published")}>Unrelated result</Button>
                    {["scheduled", "published", "manual", "simulated", "attention"].map(outcome =>
                      <Button key={outcome} onClick={() => {report("publishing-result", "draft-a", outcome); setReviewOpen(false);}}>Result: {outcome}</Button>)}
                  </div>
                </DialogContent>
              </Dialog>
            </>}
          </div>;
        }
        function Fixture() {
          const [location, navigate] = useLocation();
          const [phase, setPhase] = useState(location === "/onboarding" ? "setup" : "workspace");
          const [workspace, setWorkspace] = useState("a");
          return <AppTourProvider key={phase + workspace} phase={phase} scope={"user:" + workspace} enabled>
            <Controls phase={phase} switchScope={() => setWorkspace(workspace === "a" ? "b" : "a")}
              onComplete={() => {setPhase("workspace"); navigate("/dashboard");}} />
          </AppTourProvider>;
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

describe("interactive app tour", () => {
  it("waits for real setup actions and only continues after setup is saved", async () => {
    await page.goto(`${origin}/onboarding`);
    await assertStep("Start by talking to Pundit");
    await assertSpotlight('[aria-label="Message Pundit"]');
    await page.getByRole("textbox", { name: "Message Pundit" }).fill("I work in cloud infrastructure.");
    await assertStep("Start by talking to Pundit");
    await assertDone(false);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await assertStep("Start by talking to Pundit");
    await nextStep();
    await assertStep("Check what Pundit understood");
    await page.getByRole("button", { name: "Build my setup", exact: true }).click();
    await nextStep();
    await assertStep("Review your curated setup");
    await assertSpotlight('[data-testid="button-complete-onboarding"]');
    await page.getByRole("button", { name: "Start my workspace", exact: true }).click();
    await assertStep("Review your curated setup");
    await nextStep();
    await assertStep("Connect an account (optional)");
  }, 20000);

  it("pauses, resumes across reloads, and isolates workspaces", async () => {
    await page.getByRole("button", { name: "Continue without connecting" }).click();
    await nextStep();
    await assertStep("Find a story in Discover");
    await page.getByRole("button", { name: "Skip tour" }).click();
    await page.reload();
    await browserExpect(page.getByTestId("dialog-app-tour")).toHaveCount(0);
    await page.getByRole("button", { name: "Reopen tour" }).click();
    await assertStep("Find a story in Discover");
    await page.getByRole("button", { name: "Switch workspace" }).click();
    await assertStep("Connect an account (optional)");
    await page.getByRole("button", { name: "Switch workspace" }).click();
    await assertStep("Find a story in Discover");
  }, 20000);

  it("waits for asynchronously appearing controls and follows a confirmed connection", async () => {
    const connection = page.getByTestId("button-connect-linkedin");
    await connection.evaluate(element => element.setAttribute("style", "display: none"));
    await browserExpect(page.getByTestId("dialog-app-tour")).toContainText("Waiting for this control to appear");
    await connection.evaluate(element => element.removeAttribute("style"));
    await assertSpotlight('[data-testid="button-connect-linkedin"]');
    await connection.click();
    await nextStep();
    await assertStep("Find a story in Discover");
    await browserExpect(page.getByTestId("route")).toHaveText("/dashboard/discover");
  });

  it("retains completed actions across reload and pause without advancing automatically", async () => {
    await assertStep("Connect an account (optional)");
    await assertDone(false);
    await page.getByRole("button", { name: "Continue without connecting" }).click();
    await assertStep("Connect an account (optional)");
    await assertDone(true);
    await page.reload();
    await assertStep("Connect an account (optional)");
    await assertDone(true);
    await page.getByRole("button", { name: "Skip tour" }).click();
    await page.getByRole("button", { name: "Reopen tour" }).click();
    await assertStep("Connect an account (optional)");
    await nextStep();
    await assertStep("Find a story in Discover");
    await assertDone(false);
  });

  it("resumes a step reached by skipping, even without a saved draft", async () => {
    await page.addInitScript(() => localStorage.setItem("tsp-app-tour:v3:user:a",
      JSON.stringify({ step: 11, dismissed: false, completed: false })));
    await page.reload();
    await assertStep("Confirm your publishing choice");
    await browserExpect(page.getByTestId("route")).toHaveText("/dashboard/content");
  });

  it("lets the user click Next through every workspace step without entering data", async () => {
    const titles = ["Connect an account (optional)", "Find a story in Discover", "Write your document", "Adapt your reviewed document",
      "Choose platforms and generate", "Review and save a version", "Open your saved draft", "Review before publishing",
      "Confirm your publishing choice", "Review your result"];
    for (const [index, title] of titles.entries()) {
      await assertStep(title);
      await assertDone(false);
      if (index < titles.length - 1) await nextStep();
    }
    await browserExpect(page.getByTestId("button-app-tour-next")).toHaveCount(0);
    await page.getByRole("button", { name: "Finish tour" }).click();
    await page.reload();
    await browserExpect(page.getByTestId("dialog-app-tour")).toHaveCount(0);
  }, 20000);

  it("lets the user skip setup steps and resumes in the workspace after setup is saved", async () => {
    await page.goto(`${origin}/onboarding`);
    await assertStep("Start by talking to Pundit");
    await nextStep();
    await assertStep("Check what Pundit understood");
    await nextStep();
    await assertStep("Review your curated setup");
    await nextStep();
    await browserExpect(page.getByTestId("dialog-app-tour")).toHaveCount(0);
    await page.getByRole("button", { name: "Start my workspace", exact: true }).click();
    await assertStep("Connect an account (optional)");
  }, 20000);

  for (const outcome of ["scheduled", "published", "manual", "simulated", "attention"]) {
    it(`waits for the exact draft and confirmed ${outcome} result, including inside a modal`, async () => {
      await createAndSave();
      await page.getByRole("button", { name: "Open saved draft" }).click();
      await page.getByRole("button", { name: "Open unrelated draft" }).click();
      await assertStep("Open your saved draft");
      await assertDone(false);
      await page.getByRole("button", { name: "Review exact draft" }).click();
      await nextStep();
      await assertStep("Review before publishing");
      await page.getByRole("button", { name: "Publishing options", exact: true }).click();
      await nextStep();
      await assertStep("Confirm your publishing choice");
      await assertSpotlight('[data-app-tour="publishing-confirmation"]');
      await page.getByLabel("Publication time").fill("18:30");
      await page.getByRole("button", { name: "Fail publishing" }).click();
      await assertStep("Confirm your publishing choice");
      await page.getByRole("button", { name: "Unrelated result" }).click();
      await assertStep("Confirm your publishing choice");
      await assertDone(false);
      await page.getByRole("button", { name: `Result: ${outcome}`, exact: true }).click();
      await nextStep();
      await assertStep("Review your result");
      await browserExpect(page.getByTestId("app-tour-outcome")).toContainText({
        scheduled: "not published yet", published: "Publication confirmed", manual: "has not verified publication",
        simulated: "No live publication", attention: "do not send a duplicate",
      }[outcome]!);
      await page.getByRole("button", { name: "Finish tour" }).click();
      await page.reload();
      await browserExpect(page.getByTestId("dialog-app-tour")).toHaveCount(0);
      if (outcome === "scheduled") {
        await page.getByRole("button", { name: "Reopen tour" }).click();
        await assertStep("Connect an account (optional)");
        const progress = await page.evaluate(() => JSON.parse(localStorage.getItem("tsp-app-tour:v3:user:a")!));
        expect(progress.draftId).toBeUndefined();
        expect(progress.outcome).toBeUndefined();
      }
    }, 30000);
  }

  it("keeps mobile callouts in view and lets the user type without dismissing the guide", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${origin}/onboarding`);
    await assertSpotlight('[aria-label="Message Pundit"]');
    await assertCalloutInViewport();
    await page.getByRole("textbox", { name: "Message Pundit" }).fill("I build cloud platforms.");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await nextStep();
    await page.getByRole("button", { name: "Build my setup", exact: true }).click();
    await nextStep();
    await assertSpotlight('[data-app-tour="setup-tab"]');
    await assertCalloutInViewport();
    await page.keyboard.press("Escape");
    await browserExpect(page.getByTestId("dialog-app-tour")).toHaveCount(0);
  }, 20000);
});

async function createAndSave() {
  await page.getByRole("button", { name: "Continue without connecting" }).click();
  await nextStep();
  await page.getByRole("button", { name: "Write a post", exact: true }).click();
  await nextStep();
  await assertStep("Write your document");
  await page.getByRole("button", { name: "Apply reviewed document" }).click();
  await nextStep();
  await assertStep("Adapt your reviewed document");
  await page.getByRole("button", { name: "Adapt for platforms", exact: true }).click();
  await nextStep();
  await assertStep("Choose platforms and generate");
  await page.getByRole("button", { name: "Create platform versions" }).click();
  await nextStep();
  await assertStep("Review and save a version");
  await page.getByRole("button", { name: "Fail save" }).click();
  await assertStep("Review and save a version");
  await assertDone(false);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await nextStep();
  await assertStep("Open your saved draft");
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

async function assertCalloutInViewport() {
  const box = await page.getByTestId("dialog-app-tour").boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) throw new Error("Tour callout or viewport unavailable");
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
}
