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
type Reply = { status?: number; data?: unknown; raw?: string };
type Path = "understand" | "agent" | "suggestions";
let handlers: Record<Path, (body: Body) => Reply>;
let calls: Array<{ path: Path; body: Body }>;
let completionStatus: number;
let completions: Body[];
let completeGate: Promise<void> | undefined;

const focus = "I build reliable cloud infrastructure.";
const understanding = { role: "Platform engineer", industry: "Cloud infrastructure", focusAreas: ["Site reliability", "Kubernetes"], region: "India", audience: "Engineering leaders", question: null };
const sources = { step: "publications", grounded: true, note: "I picked reliability-focused trade press.", picks: ["Cloud Weekly", "SRE Digest"], items: [
  { name: "Cloud Weekly", url: "https://cloudweekly.invalid/", reason: "Covers cloud reliability", evidence: { count: 3, headline: "Outage lessons from 2026" } },
  { name: "SRE Digest", url: null, reason: "Practitioner newsletter", evidence: { count: 1, headline: "On-call without burnout" } },
  { name: "Infra Daily", url: "https://infradaily.invalid/", reason: "Daily infrastructure news", evidence: { count: 2, headline: "Kubernetes ships a major release" } },
] };
const topics = { step: "topics", grounded: true, note: "Topics from your sources' headlines.", picks: ["Incident response"], items: [
  { name: "Incident response", weight: 0.9, evidence: { count: 2, headline: "Outage lessons from 2026" } }, { name: "Chaos engineering", weight: 0.6 },
] };
const people = { step: "people", grounded: true, note: "People named in recent cloud news.", picks: ["Ana Rao", "Acme Cloud"],
  people: [{ name: "Ana Rao", reason: "SRE lead at Acme Cloud", evidence: { count: 1, headline: "Ana Rao on resilience" } }, { name: "Jane Leader", reason: "Founder of a cloud company", aiOnly: true }],
  companies: [{ name: "Acme Cloud", reason: "Cloud provider", evidence: { count: 2, headline: "Acme Cloud outage" } }, { name: "Beta Hosting", reason: "Hosting company" }],
};
const results: Record<string, object> = { publications: sources, topics, people };
const preview = { step: "preview", grounded: true, headlines: [
  { title: "Outage lessons from 2026", source: "Cloud Weekly", link: "https://news.google.com/rss/articles/outage", publishedAt: "2026-09-22T10:00:00.000Z", topic: "Incident response" },
] };
const sse = (events: object[]) => events.map(event => `data: ${JSON.stringify(event)}\n\n`).join("");
const agentStream = (steps: string[]) => sse([...steps.flatMap(step => [
  { type: "progress", step, message: `Searching Google News for ${step}` }, { type: "result", ...results[step] },
]), { type: "done" }]);
const defaults: Record<Path, (body: Body) => Reply> = {
  understand: body => ({ data: body.clarification ? { ...understanding, region: (body.clarification as { answer: string }).answer } : understanding }),
  agent: body => ({ raw: agentStream(body.steps as string[]) }),
  suggestions: body => body.step === "preview" ? { data: preview }
    : { data: { step: body.step, grounded: true, picks: [], note: "", items: [{ name: "Ops Weekly", url: null, reason: "" }], people: [], companies: [] } },
};
const sent = (path: Path) => calls.filter(call => call.path === path).map(call => call.body);

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
  errors = []; completions = []; calls = [];
  completionStatus = 200; completeGate = undefined; handlers = { ...defaults };
  context = await browser.newContext();
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { errors.push(`External request blocked: ${url.origin}`); await route.abort(); return; }
    if (!url.pathname.startsWith("/api/")) { await route.continue(); return; }
    // The page may abandon a request before its reply arrives.
    const reply = (data: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) }).catch(() => undefined);
    if (url.pathname === "/api/me") return reply({ id: "fixture-user", industry: "technology-saas", country: "India" });
    const path = url.pathname.replace("/api/onboarding/", "") as Path;
    if (path in defaults) {
      const body = route.request().postDataJSON() as Body;
      calls.push({ path, body });
      const { status = 200, data, raw } = handlers[path](body);
      if (raw !== undefined) return route.fulfill({ status, contentType: "text/event-stream", body: raw }).catch(() => undefined);
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

const chip = (name: string) => page.getByRole("button", { name, exact: true });
const card = () => page.getByRole("region", { name: "What the agent understood" });
const agentPanel = () => page.getByRole("region", { name: "Agent" });

async function open() {
  await page.goto(`${origin}/onboarding`);
  await browserExpect(page.getByText("Step 1 of 4: About You", { exact: true })).toBeVisible();
  await page.getByLabel("Professional focus").fill(`  ${focus}  `);
}

async function buildSetup() {
  await page.getByRole("button", { name: "Build my setup", exact: true }).click();
  await browserExpect(page.getByText("Step 2 of 4: News Sources", { exact: true })).toBeVisible();
  await browserExpect(agentPanel()).toContainText("I picked reliability-focused trade press.");
}

async function finishToDashboard() {
  await browserExpect(page.getByRole("heading", { name: "Your Discover is ready" })).toBeVisible();
  await page.getByRole("button", { name: "Go to dashboard", exact: true }).click();
  await browserExpect(page).toHaveURL(`${origin}/dashboard`);
}

describe("step 1: the agent understands you", () => {
  it("reads the focus after a pause and lets the user edit what it understood", async () => {
    await open();
    await browserExpect(card().getByLabel("Role")).toHaveValue("Platform engineer");
    await browserExpect(card().getByLabel("Region")).toHaveValue("India");
    expect(sent("understand")).toEqual([{ focusDescription: focus, industry: "technology-saas" }]);
    await card().getByLabel("Role").fill("SRE manager");
    await card().getByRole("button", { name: "Remove focus area Kubernetes", exact: true }).click();
    await card().getByLabel("Add a focus area").fill("Observability");
    await card().getByRole("button", { name: "Add focus area", exact: true }).click();
    await buildSetup();
    expect(sent("agent")).toEqual([{
      focusDescription: focus, industry: "technology-saas", searchEdition: "en-IN",
      understanding: { role: "SRE manager", industry: "Cloud infrastructure", focusAreas: ["Site reliability", "Observability"], region: "India", audience: "Engineering leaders" },
      publications: [], topics: [], exclude: [], steps: ["publications", "topics", "people"],
    }]);
  });

  it("asks one follow-up question for a vague focus and refines the summary with the answer", async () => {
    handlers.understand = body => body.clarification
      ? { data: { ...understanding, region: (body.clarification as { answer: string }).answer } }
      : { data: { ...understanding, region: null, question: { text: "Which region do you mainly cover?", options: ["India", "Global"] } } };
    await open();
    await card().getByRole("button", { name: "India", exact: true }).click();
    await browserExpect(card().getByLabel("Region")).toHaveValue("India");
    await browserExpect(card().getByText("Which region do you mainly cover?")).toHaveCount(0);
    expect(sent("understand")[1]).toEqual({ focusDescription: focus, industry: "technology-saas", clarification: { question: "Which region do you mainly cover?", answer: "India" } });
  });
});

describe("the agent builds your setup", () => {
  it("builds every step, explains itself and pre-selects its picks with reasons, with no static lists", async () => {
    await open(); await buildSetup();
    await agentPanel().getByText("Show what I did").click();
    await browserExpect(agentPanel()).toContainText("Searching Google News for publications");
    await browserExpect(chip("Remove source Cloud Weekly")).toHaveAttribute("aria-pressed", "true");
    await browserExpect(chip("Remove source Cloud Weekly")).toContainText("Covers cloud reliability");
    await browserExpect(chip("Remove source Cloud Weekly")).toContainText("3 recent articles");
    await browserExpect(chip("Remove source SRE Digest")).toHaveAttribute("aria-pressed", "true");
    await browserExpect(chip("Select source Infra Daily")).toHaveAttribute("aria-pressed", "false");
    await browserExpect(page.getByRole("button", { name: /^Select source (TechCrunch|The Verge|Wired)$/ })).toHaveCount(0);
    await page.getByTestId("button-continue").click();
    await browserExpect(agentPanel()).toContainText("Topics from your sources' headlines.");
    await browserExpect(chip("Remove topic Incident response")).toHaveAttribute("aria-pressed", "true");
    await browserExpect(chip("Select topic Chaos engineering")).toHaveAttribute("aria-pressed", "false");
    await browserExpect(page.getByRole("button", { name: /^Select topic (Cloud Computing|Machine Learning)$/ })).toHaveCount(0);
    await page.getByTestId("button-continue").click();
    await browserExpect(chip("Remove leader Ana Rao")).toHaveAttribute("aria-pressed", "true");
    await browserExpect(chip("Remove company Acme Cloud")).toHaveAttribute("aria-pressed", "true");
    await browserExpect(chip("Select leader Jane Leader")).toContainText("AI suggestion");
    await browserExpect(page.getByText("People marked “AI suggestion” come from the AI's general knowledge, not recent news.", { exact: true })).toBeVisible();
    await browserExpect(page.getByRole("button", { name: /^Select leader (Satya Nadella|Sam Altman)$/ })).toHaveCount(0);
    expect(sent("agent")).toHaveLength(1);
    expect(sent("suggestions")).toEqual([]);
  });

  it("steers a step: keeps the user's picks, replaces untouched agent picks and never brings back removals", async () => {
    handlers.agent = body => body.instruction ? { raw: sse([
      { type: "progress", step: "publications", message: "Searching for Kubernetes news" },
      { type: "result", step: "publications", grounded: true, note: "I focused on Kubernetes news.", picks: ["K8s Weekly", "SRE Digest"], items: [
        { name: "K8s Weekly", url: "https://k8s.invalid/", reason: "Kubernetes news" }, { name: "SRE Digest", url: null, reason: "" }, { name: "Cloud Weekly", url: "https://cloudweekly.invalid/", reason: "" },
      ] }, { type: "done" }]) } : defaults.agent(body);
    await open(); await buildSetup();
    await chip("Remove source SRE Digest").click();
    await chip("Select source Infra Daily").click();
    await page.getByLabel("Tell the agent what to change").fill("more about Kubernetes");
    await page.getByRole("button", { name: "Ask the agent", exact: true }).click();
    await browserExpect(agentPanel()).toContainText("I focused on Kubernetes news.");
    await browserExpect(chip("Remove source Infra Daily")).toHaveAttribute("aria-pressed", "true");
    await browserExpect(chip("Remove source K8s Weekly")).toHaveAttribute("aria-pressed", "true");
    await browserExpect(chip("Select source Cloud Weekly")).toHaveAttribute("aria-pressed", "false");
    await browserExpect(page.getByRole("button", { name: /source SRE Digest$/ })).toHaveCount(0);
    expect(sent("agent")[1]).toMatchObject({ steps: ["publications"], instruction: "more about Kubernetes", exclude: ["SRE Digest"] });
  });

  it("adds more like the user's picks after they pick something", async () => {
    await open();
    await browserExpect(card().getByLabel("Role")).toHaveValue("Platform engineer");
    await buildSetup();
    await chip("Select source Infra Daily").click();
    await browserExpect(page.getByText("1 new suggestion based on your picks", { exact: true })).toBeVisible();
    await browserExpect(chip("Select source Ops Weekly")).toBeVisible();
    expect(sent("suggestions")[0]).toMatchObject({ step: "publications", understanding: { role: "Platform engineer" } });
    expect(sent("suggestions")[0].exclude).toEqual(expect.arrayContaining(["Cloud Weekly", "SRE Digest", "Infra Daily"]));
  });

  it("reports a failed step with Try again while the other steps still arrive", async () => {
    let failed = false;
    handlers.agent = body => {
      if (failed || (body.steps as string[])[0] !== "publications" || (body.steps as string[]).length === 1) return defaults.agent(body);
      failed = true;
      return { raw: sse([{ type: "progress", step: "publications", message: "Searching" }, { type: "error", step: "publications", code: "ai_unavailable" },
        { type: "result", ...topics }, { type: "result", ...people }, { type: "done" }]) };
    };
    await open();
    await page.getByRole("button", { name: "Build my setup", exact: true }).click();
    await browserExpect(page.getByRole("alert")).toContainText("The AI service didn't respond. Add your own below or try again.");
    await browserExpect(page.getByLabel("Source name")).toBeVisible();
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await browserExpect(chip("Remove source Cloud Weekly")).toHaveAttribute("aria-pressed", "true");
    expect(sent("agent")[1]).toMatchObject({ steps: ["publications"] });
    await page.getByTestId("button-continue").click();
    await browserExpect(chip("Remove topic Incident response")).toHaveAttribute("aria-pressed", "true");
  });

  it("says when the AI service is busy and tries later failed steps again together", async () => {
    let first = true;
    handlers.agent = body => {
      if (!first) return defaults.agent(body);
      first = false;
      return { raw: sse([{ type: "result", ...sources },
        { type: "error", step: "topics", code: "ai_quota", retryAfterSeconds: 60 }, { type: "error", step: "people", code: "ai_quota", retryAfterSeconds: 60 }, { type: "done" }]) };
    };
    await open(); await buildSetup();
    await page.getByTestId("button-continue").click();
    await browserExpect(page.getByRole("alert")).toContainText("The AI service is busy right now. Try again in about a minute.");
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await browserExpect(chip("Remove topic Incident response")).toHaveAttribute("aria-pressed", "true");
    expect(sent("agent")[1]).toMatchObject({ steps: ["topics", "people"] });
    await page.getByTestId("button-continue").click();
    await browserExpect(chip("Remove leader Ana Rao")).toHaveAttribute("aria-pressed", "true");
  });

  it("saves URLs and weights from the agent's picks and shows the Discover preview", async () => {
    await open(); await buildSetup();
    const urls = page.getByRole("list", { name: "Selected publication URLs", exact: true });
    await browserExpect(urls.getByRole("listitem").filter({ hasText: "Cloud Weekly:" })).toHaveText("Cloud Weekly: https://cloudweekly.invalid/ — Unverified URL");
    await browserExpect(urls.getByRole("listitem").filter({ hasText: "SRE Digest:" })).toHaveText("SRE Digest: URL needed");
    await chip("Remove source Cloud Weekly").click();
    await chip("Select source Cloud Weekly").click();
    await page.getByTestId("button-continue").click();
    await chip("Select topic Chaos engineering").click();
    await page.getByTestId("button-continue").click();
    await browserExpect(chip("Remove leader Ana Rao")).toBeVisible();
    completionStatus = 500;
    await page.getByTestId("button-complete-onboarding").click();
    await browserExpect(page.getByText("Something went wrong", { exact: true })).toBeVisible();
    completionStatus = 200;
    await page.getByTestId("button-complete-onboarding").click();
    await browserExpect(page.getByRole("region", { name: "Discover preview" }).getByRole("link", { name: "Outage lessons from 2026" })).toBeVisible();
    await finishToDashboard();
    expect(completions).toHaveLength(2);
    expect(completions[1]).toEqual({
      focusDescription: focus, publications: ["SRE Digest", "Cloud Weekly"],
      publicationCandidates: [{ name: "Cloud Weekly", url: "https://cloudweekly.invalid/" }],
      keywords: [{ keyword: "Incident response", weight: 0.9 }, { keyword: "Chaos engineering", weight: 0.6 }],
      influencers: ["Ana Rao"], companies: ["Acme Cloud"],
    });
  });

  it("starts over when the focus changes, keeping what the user already picked", async () => {
    await open(); await buildSetup();
    await page.getByTestId("button-back").click();
    await page.getByLabel("Professional focus").fill("I run growth marketing for B2B SaaS.");
    await buildSetup();
    expect(sent("agent")).toHaveLength(2);
    expect(sent("agent")[1]).toMatchObject({ focusDescription: "I run growth marketing for B2B SaaS.", publications: [{ name: "Cloud Weekly", url: "https://cloudweekly.invalid/" }, { name: "SRE Digest" }] });
    await browserExpect(chip("Remove source Cloud Weekly")).toHaveAttribute("aria-pressed", "true");
  });
});

describe("setting up manually", () => {
  it("adds the user's own sources, topics, people and companies without the agent, and disables actions while saving", async () => {
    await open();
    await page.getByRole("button", { name: "Set up manually", exact: true }).click();
    await browserExpect(page.getByText("Step 2 of 4: News Sources", { exact: true })).toBeVisible();
    await page.getByLabel("Source name").fill("My Blog");
    await page.getByLabel("Source website (optional)").fill("myblog.test/news");
    await page.getByRole("button", { name: "Add source", exact: true }).click();
    await browserExpect(chip("Remove source My Blog")).toHaveAttribute("aria-pressed", "true");
    await browserExpect(page.getByRole("list", { name: "Selected publication URLs", exact: true })).toContainText("My Blog: https://myblog.test/news — Unverified URL");
    await page.getByTestId("button-continue").click();
    await page.getByLabel("Custom topic").fill("Platform engineering");
    await page.getByTestId("button-add-keyword").click();
    await page.getByTestId("button-continue").click();
    await page.getByLabel("Custom leader").fill("Kelsey Hightower");
    await page.getByTestId("button-add-influencer").click();
    await page.getByLabel("Custom company").fill("HashiCorp");
    await page.getByTestId("button-add-company").click();
    let release!: () => void;
    completeGate = new Promise<void>((resolve) => { release = resolve; });
    try {
      await page.getByTestId("button-complete-onboarding").click();
      await browserExpect(page.getByTestId("button-complete-onboarding")).toBeDisabled();
      await browserExpect(page.getByTestId("button-back")).toBeDisabled();
    } finally { release(); }
    await finishToDashboard();
    expect(completions).toEqual([{
      focusDescription: focus, publications: ["My Blog"], publicationCandidates: [{ name: "My Blog", url: "https://myblog.test/news" }],
      keywords: [{ keyword: "Platform engineering", weight: 0.7 }], influencers: ["Kelsey Hightower"], companies: ["HashiCorp"],
    }]);
    expect(sent("agent")).toEqual([]);
  });

  it("lets the agent take over from a manual step", async () => {
    await open();
    await page.getByRole("button", { name: "Set up manually", exact: true }).click();
    await page.getByRole("button", { name: "Skip sources", exact: true }).click();
    await page.getByRole("button", { name: "Let the agent help", exact: true }).click();
    await browserExpect(chip("Remove topic Incident response")).toHaveAttribute("aria-pressed", "true");
    expect(sent("agent")).toEqual([expect.objectContaining({ steps: ["topics", "people"] })]);
  });

  it("allows the four-step skip path without the agent or hidden defaults", async () => {
    await open();
    await page.getByRole("button", { name: "Set up manually", exact: true }).click();
    await page.getByRole("button", { name: "Skip sources", exact: true }).click();
    await page.getByRole("button", { name: "Skip topics", exact: true }).click();
    await page.getByRole("button", { name: "Skip inspiration and finish", exact: true }).click();
    await browserExpect(page.getByText("Pick a few topics in Settings so Discover knows what to look for.", { exact: true })).toBeVisible();
    await finishToDashboard();
    expect(sent("agent")).toEqual([]);
    expect(sent("suggestions")).toEqual([]);
    expect(completions).toEqual([{ focusDescription: focus, publications: [], keywords: [], influencers: [], companies: [] }]);
  });
});
