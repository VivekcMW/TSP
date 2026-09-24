import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { chromium, expect as browserExpect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";
import path from "node:path";

// Render the real page/wizard and API client. All persistence and AI responses
// are fixtures; no app server, database, .env loader, or external traffic.
let server: Server;
let browser: Browser;
let context: BrowserContext;
let page: Page;
let origin: string;
let errors: string[];
type Body = Record<string, unknown>;
type Reply = { status?: number; data: unknown };
let respond: (body: Body) => Reply;
let requests: Body[];
let completionStatus: number;
let completions: Body[];
let completeGate: Promise<void> | undefined;

const sources = { step: "publications", grounded: true, items: [
  { name: "Cloud Weekly", url: "https://cloudweekly.invalid/", reason: "Covers cloud reliability", evidence: { count: 3, headline: "Outage lessons from 2026" } },
  { name: "SRE Digest", url: null, reason: "Practitioner newsletter", evidence: { count: 1, headline: "On-call without burnout" } },
] };
const moreSources = { step: "publications", grounded: true, items: [{ name: "Infra News", url: "https://infranews.invalid/", reason: "", evidence: { count: 2, headline: "Kubernetes ships a major release" } }] };
const topics = { step: "topics", grounded: true, items: [
  { name: "Incident response", weight: 0.9, evidence: { count: 2, headline: "Outage lessons from 2026" } }, { name: "Chaos engineering", weight: 0.6 },
] };
const people = { step: "people", grounded: true,
  people: [{ name: "Ana Rao", reason: "SRE lead at Acme Cloud", evidence: { count: 1, headline: "Ana Rao on resilience" } }],
  companies: [{ name: "Acme Cloud", reason: "Cloud provider", evidence: { count: 2, headline: "Acme Cloud outage" } }],
};
function defaultRespond(body: Body): Reply {
  if (body.step === "publications") return { data: (body.exclude as string[]).length ? moreSources : sources };
  return { data: body.step === "topics" ? topics : people };
}
const stepRequests = (step: string) => requests.filter(body => body.step === step);

beforeAll(async () => {
  const root = path.resolve(import.meta.dirname, "../../..");
  const result = await build({
    absWorkingDir: root, bundle: true, write: false, format: "esm", platform: "browser", jsx: "automatic",
    define: { "import.meta.env.DEV": "false", "import.meta.env.PROD": "false", "import.meta.env.BASE_URL": '"/"' },
    alias: { "@": path.join(root, "client/src"), "@shared": path.join(root, "shared") },
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import { StrictMode } from "react";
      import { createRoot } from "react-dom/client";
      import { QueryClientProvider } from "@tanstack/react-query";
      import { useLocation } from "wouter";
      import { queryClient } from "@/lib/queryClient";
      import OnboardingPage from "@/pages/onboarding";
      import { Toaster } from "@/components/ui/toaster";
      function Fixture() {
        const [location] = useLocation();
        return <>{location === "/onboarding" ? <OnboardingPage /> : <h1>Dashboard fixture</h1>}<Toaster /></>;
      }
      createRoot(document.getElementById("root")!).render(<StrictMode><QueryClientProvider client={queryClient}><Fixture /></QueryClientProvider></StrictMode>);
    ` },
  });
  server = createServer((req, res) => {
    if (req.url === "/fixture.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(result.outputFiles[0].text);
      return;
    }
    res.setHeader("Content-Type", "text/html");
    res.end('<html><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture did not bind");
  origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
}, 60000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

beforeEach(async () => {
  errors = []; completions = []; requests = [];
  completionStatus = 200; completeGate = undefined; respond = defaultRespond;
  context = await browser.newContext();
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { errors.push(`External request blocked: ${url.origin}`); await route.abort(); return; }
    if (!url.pathname.startsWith("/api/")) { await route.continue(); return; }
    // The page may abandon a superseded prefetch before its reply arrives.
    const reply = (data: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) }).catch(() => undefined);
    if (url.pathname === "/api/me") return reply({ id: "fixture-user", industry: "technology-saas", country: "India" });
    if (url.pathname === "/api/onboarding/suggestions") {
      const body = route.request().postDataJSON() as Body;
      requests.push(body);
      const { status = 200, data } = respond(body);
      return reply(data, status);
    }
    if (url.pathname === "/api/profile/complete-onboarding") {
      completions.push(route.request().postDataJSON());
      await completeGate;
      return reply(completionStatus === 200 ? { onboardingCompleted: true } : { message: "Mock save failure" }, completionStatus);
    }
    errors.push(`Unexpected request: ${url.pathname}`);
    return reply({ message: "Unmocked request" }, 500);
  });
  page = await context.newPage();
  page.setDefaultTimeout(5000);
  page.on("pageerror", (error) => errors.push(error.message));
});

afterEach(async () => {
  await context?.close();
  expect(errors, errors.join("\n")).toEqual([]);
});

async function open() {
  await page.goto(`${origin}/onboarding`);
  await browserExpect(page.getByText("Step 1 of 4: About You", { exact: true })).toBeVisible();
  await page.getByLabel("Professional focus").fill("  I build reliable cloud infrastructure.  ");
}

async function continueWithAi() {
  await page.getByRole("button", { name: "Continue with AI suggestions", exact: true }).click();
  await browserExpect(page.getByText("Step 2 of 4: News Sources", { exact: true })).toBeVisible();
}

const chip = (name: string) => page.getByRole("button", { name, exact: true });

describe("onboarding suggestions from live news", () => {
  it("loads source suggestions on Step 2 with news evidence and selects nothing for the user", async () => {
    await open();
    expect(requests).toEqual([]);
    await continueWithAi();
    await browserExpect(chip("Select source Cloud Weekly")).toHaveAttribute("aria-pressed", "false");
    await browserExpect(chip("Select source Cloud Weekly")).toContainText("3 recent articles");
    await browserExpect(chip("Select source SRE Digest")).toContainText("1 recent article");
    await browserExpect(page.getByText("From news published in the last 30 days. Suggestions update as you pick.", { exact: true })).toBeVisible();
    await browserExpect(page.getByText("0 selected", { exact: true })).toBeVisible();
    expect(stepRequests("publications")).toEqual([{
      step: "publications", focusDescription: "I build reliable cloud infrastructure.", industry: "technology-saas",
      searchEdition: "en-IN", publications: [], topics: [], exclude: [],
    }]);
  });

  it("refreshes from the user's picks and has the next step ready on arrival", async () => {
    await open(); await continueWithAi();
    await chip("Select source Cloud Weekly").click();
    await browserExpect(page.getByText("1 new suggestion based on your picks", { exact: true })).toBeVisible();
    await browserExpect(chip("Select source Infra News")).toBeVisible();
    const picked = [{ name: "Cloud Weekly", url: "https://cloudweekly.invalid/" }];
    expect(stepRequests("publications")[1]).toMatchObject({ publications: picked, exclude: ["Cloud Weekly", "SRE Digest"] });
    await browserExpect.poll(() => stepRequests("topics").at(-1)?.publications).toEqual(picked);
    const prefetched = stepRequests("topics").length;
    await page.getByTestId("button-continue").click();
    await browserExpect(chip("Select topic Incident response")).toContainText("in 2 headlines");
    expect(stepRequests("topics")).toHaveLength(prefetched);
  });

  it("builds each step on earlier picks and saves suggestion URLs and weights", async () => {
    await open(); await continueWithAi();
    await chip("Select source Cloud Weekly").click();
    await chip("Select source SRE Digest").click();
    const selected = page.getByRole("list", { name: "Selected publication URLs", exact: true });
    await browserExpect(selected.getByRole("listitem").filter({ hasText: "Cloud Weekly:" })).toHaveText("Cloud Weekly: https://cloudweekly.invalid/ — Unverified URL");
    await browserExpect(selected.getByRole("listitem").filter({ hasText: "SRE Digest:" })).toHaveText("SRE Digest: URL needed");
    await chip("Remove source Cloud Weekly").click();
    await browserExpect(selected.getByText("https://cloudweekly.invalid/", { exact: false })).toHaveCount(0);
    await chip("Select source Cloud Weekly").click();
    await browserExpect(selected).toContainText("https://cloudweekly.invalid/ — Unverified URL");
    await page.getByTestId("button-continue").click();
    await chip("Select topic Incident response").click();
    await page.getByTestId("button-continue").click();
    await browserExpect(page.getByText("Step 4 of 4: Inspiration", { exact: true })).toBeVisible();
    await chip("Select leader Ana Rao").click();
    await chip("Select company Acme Cloud").click();
    expect(stepRequests("people").at(-1)).toMatchObject({
      topics: ["Incident response"], publications: [{ name: "SRE Digest" }, { name: "Cloud Weekly", url: "https://cloudweekly.invalid/" }],
    });
    completionStatus = 500;
    await page.getByTestId("button-complete-onboarding").click();
    await browserExpect(page.getByText("Something went wrong", { exact: true })).toBeVisible();
    await page.getByTestId("button-back").click();
    await page.getByTestId("button-back").click();
    await browserExpect(selected).toContainText("https://cloudweekly.invalid/ — Unverified URL");
    await page.getByTestId("button-continue").click();
    await page.getByTestId("button-continue").click();
    completionStatus = 200;
    await page.getByTestId("button-complete-onboarding").click();
    await browserExpect(page).toHaveURL(`${origin}/dashboard`);
    expect(completions).toHaveLength(2);
    expect(completions[0]).toEqual(completions[1]);
    expect(completions[1]).toEqual({
      focusDescription: "I build reliable cloud infrastructure.",
      publications: ["SRE Digest", "Cloud Weekly"],
      publicationCandidates: [{ name: "Cloud Weekly", url: "https://cloudweekly.invalid/" }],
      keywords: [{ keyword: "Incident response", weight: 0.9 }],
      influencers: ["Ana Rao"], companies: ["Acme Cloud"],
    });
  });

  it("shows an inline error with Retry, keeps the static list usable, and marks AI-only results", async () => {
    let failed = false;
    respond = (body) => {
      if (body.step === "publications" && !failed) { failed = true; return { status: 503, data: { code: "ai_unavailable", message: "Provider down" } }; }
      return body.step === "publications" ? { data: { ...sources, grounded: false } } : defaultRespond(body);
    };
    await open(); await continueWithAi();
    await browserExpect(page.getByRole("alert")).toContainText("Suggestions are unavailable right now.");
    await chip("Select source TechCrunch").click();
    await browserExpect(chip("Remove source TechCrunch")).toHaveAttribute("aria-pressed", "true");
    await chip("Retry suggestions").click();
    await browserExpect(chip("Select source Cloud Weekly")).toBeVisible();
    await browserExpect(page.getByText("AI suggestions: the news search didn't respond, so these aren't checked against recent coverage.", { exact: true })).toBeVisible();
    expect(stepRequests("publications")[1]).toMatchObject({ publications: [{ name: "TechCrunch", url: "https://techcrunch.com" }], exclude: ["TechCrunch"] });
  });

  it("hides a built-in source that a news suggestion already covers", async () => {
    respond = (body) => body.step === "publications"
      ? { data: { step: "publications", grounded: true, items: [{ name: "techcrunch.com", url: "https://techcrunch.com/", evidence: { count: 4, headline: "AI infra funding" } }] } }
      : defaultRespond(body);
    await open(); await continueWithAi();
    await browserExpect(chip("Select source techcrunch.com")).toBeVisible();
    await browserExpect(chip("Select source TechCrunch")).toHaveCount(0);
    await browserExpect(chip("Select source The Verge")).toBeVisible();
  });

  it("stops refreshing after three rounds of picks on a step", async () => {
    let count = 0;
    respond = (body) => body.step === "publications"
      ? { data: { step: "publications", grounded: true, items: [{ name: `Source ${++count}`, url: null }] } }
      : defaultRespond(body);
    await open(); await continueWithAi();
    await browserExpect(chip("Select source Source 1")).toBeVisible();
    for (const [index, name] of ["TechCrunch", "The Verge", "Wired"].entries()) {
      await chip(`Select source ${name}`).click();
      await browserExpect.poll(() => stepRequests("publications").length).toBe(index + 2);
      await browserExpect(chip(`Select source Source ${index + 2}`)).toBeVisible();
    }
    await chip("Select source Ars Technica").click();
    await page.waitForTimeout(2500);
    expect(stepRequests("publications")).toHaveLength(4);
    await browserExpect(page.getByText("1 new suggestion based on your picks", { exact: true })).toHaveCount(3);
  }, 20_000);

  it("reloads suggestions when the focus changes and keeps earlier picks with their URLs", async () => {
    await open(); await continueWithAi();
    await chip("Select source Cloud Weekly").click();
    await page.getByTestId("button-back").click();
    await page.getByLabel("Professional focus").fill("I run growth marketing for B2B SaaS.");
    await continueWithAi();
    await browserExpect(chip("Select source Infra News")).toBeVisible();
    await browserExpect(chip("Select source SRE Digest")).toHaveCount(0);
    await browserExpect(chip("Remove source Cloud Weekly")).toHaveAttribute("aria-pressed", "true");
    await browserExpect(page.getByRole("list", { name: "Selected publication URLs", exact: true })).toContainText("https://cloudweekly.invalid/ — Unverified URL");
    expect(stepRequests("publications").at(-1)).toMatchObject({
      focusDescription: "I run growth marketing for B2B SaaS.", publications: [{ name: "Cloud Weekly", url: "https://cloudweekly.invalid/" }], exclude: ["Cloud Weekly"],
    });
  });

  it("can turn suggestions on from a later step after continuing without AI", async () => {
    await open();
    await page.getByRole("button", { name: "Continue without AI", exact: true }).click();
    await browserExpect(page.getByText("Step 2 of 4: News Sources", { exact: true })).toBeVisible();
    expect(requests).toEqual([]);
    await page.getByRole("button", { name: "Suggest from recent news", exact: true }).click();
    await browserExpect(chip("Select source Cloud Weekly")).toBeVisible();
    expect(stepRequests("publications")).toHaveLength(1);
  });

  it("allows the no-AI four-step skip path without selecting hidden defaults", async () => {
    await open();
    await page.getByRole("button", { name: "Continue without AI", exact: true }).click();
    await page.getByRole("button", { name: "Skip sources", exact: true }).click();
    await page.getByRole("button", { name: "Skip topics", exact: true }).click();
    await page.getByRole("button", { name: "Skip inspiration and finish", exact: true }).click();
    await browserExpect(page).toHaveURL(`${origin}/dashboard`);
    expect(requests).toEqual([]);
    expect(completions).toEqual([{
      focusDescription: "I build reliable cloud infrastructure.", publications: [], keywords: [], influencers: [], companies: [],
    }]);
  });

  it("keeps custom topics at the default weight and disables actions while saving", async () => {
    await open(); await continueWithAi();
    await page.getByTestId("button-continue").click();
    await chip("Select topic Chaos engineering").click();
    await page.getByLabel("Custom topic").fill("Custom topic");
    await page.getByTestId("button-add-keyword").click();
    await page.getByTestId("button-continue").click();
    await chip("Select leader Ana Rao").click();
    let release!: () => void;
    completeGate = new Promise<void>((resolve) => { release = resolve; });
    try {
      await page.getByTestId("button-complete-onboarding").click();
      await browserExpect(page.getByTestId("button-complete-onboarding")).toBeDisabled();
      await browserExpect(page.getByTestId("button-back")).toBeDisabled();
      await browserExpect.poll(() => completions.length).toBe(1);
      expect(completions[0].keywords).toEqual([{ keyword: "Chaos engineering", weight: 0.6 }, { keyword: "Custom topic", weight: 0.7 }]);
    } finally { release(); }
    await browserExpect(page).toHaveURL(`${origin}/dashboard`);
  });
});
