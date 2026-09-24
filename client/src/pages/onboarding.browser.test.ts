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

const focus = "I build reliable cloud infrastructure.";
const understanding = { role: "Platform engineer", industry: "Cloud infrastructure", focusAreas: ["Site reliability", "Kubernetes"], region: "India", audience: "Engineering leaders", question: null };
const sources = { step: "publications", grounded: true, note: "I picked reliability-focused trade press.", picks: ["Cloud Weekly", "SRE Digest"], followUps: ["More India-focused", "Less vendor news"], items: [
  { name: "Cloud Weekly", url: "https://cloudweekly.invalid/", reason: "Covers cloud reliability", evidence: { count: 3, headline: "Outage lessons from 2026", headlines: ["Outage lessons from 2026", "Why SLOs matter", "Chaos days at scale"] } },
  { name: "SRE Digest", url: null, reason: "Practitioner newsletter", evidence: { count: 1, headline: "On-call without burnout" } },
  { name: "Infra Daily", url: "https://infradaily.invalid/", reason: "Daily infrastructure news", evidence: { count: 2, headline: "Kubernetes ships a major release" } },
] };
const topics = { step: "topics", grounded: true, note: "Topics from your sources' headlines.", picks: ["Incident response"], followUps: ["Add platform engineering"], items: [
  { name: "Incident response", weight: 0.9, evidence: { count: 2, headline: "Outage lessons from 2026" } }, { name: "Chaos engineering", weight: 0.6 },
] };
const people = { step: "people", grounded: true, note: "People named in recent cloud news.", picks: ["Ana Rao", "Acme Cloud"], followUps: [],
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
    : { data: { step: body.step, grounded: true, picks: [], note: "", followUps: [], items: [{ name: "Ops Weekly", url: null, reason: "" }], people: [], companies: [] } },
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
  completionStatus = 200; handlers = { ...defaults };
  context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { errors.push(`External request blocked: ${url.origin}`); await route.abort(); return; }
    if (!url.pathname.startsWith("/api/")) { await route.continue(); return; }
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
const pundit = () => page.getByRole("region", { name: "Pundit" });
const setup = () => page.getByRole("region", { name: "Your setup" });
const section = (name: string) => setup().getByRole("region", { name });
const card = () => page.getByRole("region", { name: "What the agent understood" });

async function say(text: string) {
  await page.getByRole("textbox", { name: "Message Pundit" }).fill(text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
}

async function start() {
  await page.goto(`${origin}/onboarding`);
  await browserExpect(pundit()).toContainText("Hi, I'm Pundit.");
  await say(`  ${focus}  `);
  await browserExpect(card().getByRole("textbox", { name: "Role", exact: true })).toHaveValue("Platform engineer");
}

async function buildSetup() {
  await chip("Build my setup").click();
  await browserExpect(pundit()).toContainText("I picked reliability-focused trade press.");
  await browserExpect(pundit()).toContainText("People named in recent cloud news.");
}

describe("talking to Pundit", () => {
  it("starts a conversation and shows an editable summary of what Pundit understood", async () => {
    await start();
    await browserExpect(pundit().getByRole("list", { name: "Conversation" })).toContainText(focus);
    expect(sent("understand")).toEqual([{ focusDescription: focus, industry: "technology-saas" }]);
    await card().getByRole("textbox", { name: "Role", exact: true }).fill("SRE manager");
    await card().getByRole("button", { name: "Remove focus area Kubernetes", exact: true }).click();
    await card().getByLabel("Add a focus area").fill("Observability");
    await card().getByRole("button", { name: "Add focus area", exact: true }).click();
    await buildSetup();
    expect(sent("agent")[0]).toEqual({
      focusDescription: focus, industry: "technology-saas", searchEdition: "en-IN",
      understanding: { role: "SRE manager", industry: "Cloud infrastructure", focusAreas: ["Site reliability", "Observability"], region: "India", audience: "Engineering leaders" },
      publications: [], topics: [], exclude: [], steps: ["publications", "topics", "people"],
    });
  });

  it("asks one question for a vague focus and takes the answer from a quick reply or the composer", async () => {
    handlers.understand = body => body.clarification
      ? { data: { ...understanding, region: (body.clarification as { answer: string }).answer } }
      : { data: { ...understanding, region: null, question: { text: "Which region do you mainly cover?", options: ["India", "Global"] } } };
    await page.goto(`${origin}/onboarding`);
    await say(focus);
    await browserExpect(card()).toContainText("Which region do you mainly cover?");
    await say("Asia-Pacific");
    await browserExpect(card().getByRole("textbox", { name: "Region", exact: true })).toHaveValue("Asia-Pacific");
    expect(sent("understand")[1]).toEqual({ focusDescription: focus, industry: "technology-saas", clarification: { question: "Which region do you mainly cover?", answer: "Asia-Pacific" } });
  });

  it("asks for more when the first message is too short to work with", async () => {
    await page.goto(`${origin}/onboarding`);
    await say("SRE");
    await browserExpect(pundit()).toContainText("Could you tell me a bit more");
    expect(sent("understand")).toEqual([]);
  });
});

describe("Pundit builds your setup", () => {
  it("fills every section live with reasons and evidence, shows its progress and notes, and has no static lists", async () => {
    await start(); await buildSetup();
    const progress = pundit().getByRole("list", { name: "Pundit's progress" });
    await browserExpect(progress).toContainText("Picked 2 sources");
    await browserExpect(progress).toContainText("Picked 1 topic");
    await browserExpect(section("Sources").getByRole("button", { name: "Remove source Cloud Weekly", exact: true })).toContainText("Covers cloud reliability");
    await browserExpect(section("Sources").getByRole("button", { name: "Remove source Cloud Weekly", exact: true })).toContainText("3 recent articles");
    await browserExpect(section("Sources").getByRole("button", { name: "Select source Infra Daily", exact: true })).toBeVisible();
    await browserExpect(section("Topics").getByRole("button", { name: "Remove topic Incident response", exact: true })).toBeVisible();
    await browserExpect(section("People and companies").getByRole("button", { name: "Remove leader Ana Rao", exact: true })).toBeVisible();
    await browserExpect(section("People and companies").getByRole("button", { name: "Select leader Jane Leader", exact: true })).toContainText("AI suggestion");
    await browserExpect(pundit().getByRole("button", { name: "More India-focused", exact: true })).toBeVisible();
    await browserExpect(page.getByRole("button", { name: /^Select source (TechCrunch|The Verge|Wired)$/ })).toHaveCount(0);
    await pundit().getByText("Show what I did").click();
    await browserExpect(pundit()).toContainText("Searching Google News for topics");
  });

  it("shows the headlines behind a source", async () => {
    await start(); await buildSetup();
    await section("Sources").getByRole("button", { name: "Why Cloud Weekly?", exact: true }).click();
    await browserExpect(section("Sources").getByRole("list", { name: "Headlines behind Cloud Weekly" })).toContainText("Chaos days at scale");
  });

  it("steers with a suggested request or the composer, keeping the user's picks and never re-adding removals", async () => {
    handlers.agent = body => body.instruction === "More India-focused" ? { raw: sse([
      { type: "progress", step: "publications", message: "Searching for India news" },
      { type: "result", step: "publications", grounded: true, note: "I focused on Indian outlets.", picks: ["India Cloud Times", "SRE Digest"], followUps: [], items: [
        { name: "India Cloud Times", url: "https://ict.invalid/", reason: "Indian cloud news" }, { name: "SRE Digest", url: null, reason: "" }, { name: "Cloud Weekly", url: "https://cloudweekly.invalid/", reason: "" },
      ] }, { type: "done" }]) } : defaults.agent(body);
    await start(); await buildSetup();
    await section("Sources").getByRole("button", { name: "Remove source SRE Digest", exact: true }).click();
    await section("Sources").getByRole("button", { name: "Select source Infra Daily", exact: true }).click();
    await pundit().getByRole("button", { name: "More India-focused", exact: true }).click();
    await browserExpect(pundit()).toContainText("I focused on Indian outlets.");
    await browserExpect(section("Sources").getByRole("button", { name: "Remove source Infra Daily", exact: true })).toBeVisible();
    await browserExpect(section("Sources").getByRole("button", { name: "Remove source India Cloud Times", exact: true })).toBeVisible();
    await browserExpect(section("Sources").getByRole("button", { name: "Select source Cloud Weekly", exact: true })).toBeVisible();
    await browserExpect(page.getByRole("button", { name: /source SRE Digest$/ })).toHaveCount(0);
    expect(sent("agent")[1]).toMatchObject({ steps: ["publications"], instruction: "More India-focused", exclude: ["SRE Digest"] });
    await section("Topics").getByRole("button", { name: "Select topic Chaos engineering", exact: true }).click();
    await browserExpect(page.getByRole("combobox", { name: "About" })).toHaveValue("topics");
    await say("fewer event topics");
    await browserExpect(pundit().getByRole("list", { name: "Conversation" })).toContainText("fewer event topics");
    await browserExpect.poll(() => sent("agent").length).toBe(3);
    expect(sent("agent")[2]).toMatchObject({ steps: ["topics"], instruction: "fewer event topics" });
  });

  it("adds more like the user's picks", async () => {
    await start(); await buildSetup();
    await section("Sources").getByRole("button", { name: "Select source Infra Daily", exact: true }).click();
    await browserExpect(section("Sources")).toContainText("1 new suggestion based on your picks");
    await browserExpect(section("Sources").getByRole("button", { name: "Select source Ops Weekly", exact: true })).toBeVisible();
  });

  it("says when the AI is busy and tries later failed steps again together", async () => {
    let first = true;
    handlers.agent = body => {
      if (!first) return defaults.agent(body);
      first = false;
      return { raw: sse([{ type: "result", ...sources },
        { type: "error", step: "topics", code: "ai_quota", retryAfterSeconds: 60 }, { type: "error", step: "people", code: "ai_quota", retryAfterSeconds: 60 }, { type: "done" }]) };
    };
    await start();
    await chip("Build my setup").click();
    await browserExpect(section("Topics").getByRole("alert")).toContainText("The AI service is busy right now. Try again in about a minute.");
    await browserExpect(pundit()).toContainText("The AI service is busy right now.");
    await section("Topics").getByRole("button", { name: "Try again", exact: true }).click();
    await browserExpect(section("Topics").getByRole("button", { name: "Remove topic Incident response", exact: true })).toBeVisible();
    await browserExpect(section("People and companies").getByRole("button", { name: "Remove leader Ana Rao", exact: true })).toBeVisible();
    expect(sent("agent")[1]).toMatchObject({ steps: ["topics", "people"] });
  });
});

describe("setting up manually", () => {
  it("adds the user's own entries, refuses a bad website, and lets Pundit take over", async () => {
    await start();
    await chip("Set up manually").click();
    await section("Sources").getByLabel("Source name").fill("My Blog");
    await section("Sources").getByLabel("Source website (optional)").fill("myblog.test/news");
    await section("Sources").getByRole("button", { name: "Add source", exact: true }).click();
    await browserExpect(section("Sources").getByRole("list", { name: "Selected publication URLs" })).toContainText("My Blog: https://myblog.test/news — Unverified URL");
    await section("Sources").getByLabel("Source name").fill("Bad Site");
    await section("Sources").getByLabel("Source website (optional)").fill("not a website!");
    await section("Sources").getByRole("button", { name: "Add source", exact: true }).click();
    await browserExpect(section("Sources").getByText("Enter a valid website, or leave it empty.", { exact: true })).toBeVisible();
    await section("Topics").getByLabel("Custom topic").fill("Platform engineering");
    await section("Topics").getByTestId("button-add-keyword").click();
    await section("People and companies").getByLabel("Custom leader").fill("Kelsey Hightower");
    await section("People and companies").getByTestId("button-add-influencer").click();
    await section("People and companies").getByLabel("Custom company").fill("HashiCorp");
    await section("People and companies").getByTestId("button-add-company").click();
    expect(sent("agent")).toEqual([]);
    await pundit().getByRole("button", { name: "Let Pundit help", exact: true }).click();
    await browserExpect(section("Topics").getByRole("button", { name: "Remove topic Incident response", exact: true })).toBeVisible();
    await browserExpect(section("Topics").getByRole("button", { name: "Remove topic Platform engineering", exact: true })).toBeVisible();
    expect(sent("agent")[0]).toMatchObject({ steps: ["publications", "topics", "people"], topics: ["Platform engineering"], publications: [{ name: "My Blog", url: "https://myblog.test/news" }] });
  });

  it("can finish with just the focus, without the agent or hidden defaults", async () => {
    await start();
    await chip("Finish setup").click();
    await browserExpect(page.getByRole("heading", { name: "Your Discover is ready" })).toBeVisible();
    expect(sent("agent")).toEqual([]);
    expect(completions).toEqual([{ focusDescription: focus, publications: [], keywords: [], influencers: [], companies: [] }]);
  });
});

describe("finishing", () => {
  it("saves URLs and weights, shows today's headlines, and Write a post opens Create with the story", async () => {
    await start(); await buildSetup();
    await section("Topics").getByRole("button", { name: "Select topic Chaos engineering", exact: true }).click();
    completionStatus = 500;
    await chip("Finish setup").click();
    await browserExpect(page.getByText("Something went wrong", { exact: true })).toBeVisible();
    await browserExpect(section("Sources").getByRole("button", { name: "Remove source Cloud Weekly", exact: true })).toBeVisible();
    completionStatus = 200;
    await chip("Finish setup").click();
    await browserExpect(page.getByRole("heading", { name: "Your Discover is ready" })).toBeVisible();
    expect(completions[1]).toEqual({
      focusDescription: focus, publications: ["Cloud Weekly", "SRE Digest"],
      publicationCandidates: [{ name: "Cloud Weekly", url: "https://cloudweekly.invalid/" }],
      keywords: [{ keyword: "Incident response", weight: 0.9 }, { keyword: "Chaos engineering", weight: 0.6 }],
      influencers: ["Ana Rao"], companies: ["Acme Cloud"],
    });
    await browserExpect(pundit()).toContainText("All set.");
    const story = page.getByRole("region", { name: "Discover preview" }).getByRole("link", { name: "Outage lessons from 2026" });
    await browserExpect(story).toHaveAttribute("href", "https://news.google.com/rss/articles/outage");
    await page.getByRole("button", { name: "Write a post about Outage lessons from 2026", exact: true }).click();
    await browserExpect(page).toHaveURL(`${origin}/dashboard/create`);
    expect(await page.evaluate(() => window.history.state?.createFromUrl)).toBe("https://news.google.com/rss/articles/outage");
  });
});
