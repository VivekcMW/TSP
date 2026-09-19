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
let suggestions: unknown;
let suggestionStatus: number;
let completionStatus: number;
let completions: Array<Record<string, unknown>>;
let analyses: Array<Record<string, unknown>>;
let completeGate: Promise<void> | undefined;

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
  errors = []; completions = []; analyses = [];
  suggestionStatus = 200; completionStatus = 200; completeGate = undefined;
  suggestions = {
    publications: ["AI Publication"],
    keywords: [{ keyword: "Cloud", weight: 0, category: "Infrastructure" }, { keyword: "Models", weight: 0.95, category: "AI" }, "Legacy"],
    personalities: ["AI Leader"], companies: ["AI Company"], recommendedEngine: { industry: "technology_saas" },
  };
  context = await browser.newContext();
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { errors.push(`External request blocked: ${url.origin}`); await route.abort(); return; }
    if (!url.pathname.startsWith("/api/")) { await route.continue(); return; }
    const reply = (data: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
    if (url.pathname === "/api/me") return reply({ id: "fixture-user", industry: "technology-saas", country: "India" });
    if (url.pathname === "/api/ai/analyze-identity") {
      analyses.push(route.request().postDataJSON());
      return reply(suggestions, suggestionStatus);
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

async function generate() {
  await page.getByRole("button", { name: "Suggest preferences with AI", exact: true }).click();
  await browserExpect(page.getByText("Step 2 of 4: News Sources", { exact: true })).toBeVisible();
}

describe("original onboarding weighted preferences", () => {
  it("retains unverified URL metadata through deselection/reselection and completion retry", async () => {
    suggestions = {
      publications: ["AI Publication", "Name only", "Invalid URL", "Remove me"],
      publicationCandidates: [
        null, { name: "AI Publication", url: "https://publication.invalid/news#fragment" },
        { name: "Invalid URL", url: "not a URL" },
        { name: "Remove me", url: "https://removed.invalid/" },
        { name: " ", url: "https://blank.invalid/" },
      ],
      keywords: [{ keyword: "Cloud", weight: 0, category: "Infrastructure" }],
    };
    await open(); await generate();
    const selected = page.getByRole("list", { name: "Selected publication URLs", exact: true });
    await browserExpect(selected.getByRole("listitem").filter({ hasText: "AI Publication:" })).toHaveText("AI Publication: https://publication.invalid/news — Unverified URL");
    await browserExpect(selected.getByRole("listitem").filter({ hasText: "Invalid URL:" })).toHaveText("Invalid URL: URL needed");
    await browserExpect(selected.getByRole("listitem").filter({ hasText: "Name only:" })).toHaveText("Name only: URL needed");
    await browserExpect(selected.getByRole("link")).toHaveCount(0);
    await page.getByRole("button", { name: "Remove source AI Publication", exact: true }).click();
    await browserExpect(selected.getByText("https://publication.invalid/news", { exact: false })).toHaveCount(0);
    await page.getByRole("button", { name: "Select source AI Publication", exact: true }).click();
    await browserExpect(selected).toContainText("https://publication.invalid/news — Unverified URL");
    await page.getByRole("button", { name: "Remove source Remove me", exact: true }).click();
    await page.getByTestId("button-continue").click();
    await page.getByTestId("button-continue").click();
    completionStatus = 500;
    await page.getByTestId("button-complete-onboarding").click();
    await browserExpect(page.getByText("Something went wrong", { exact: true })).toBeVisible();
    await page.getByTestId("button-back").click();
    await page.getByTestId("button-back").click();
    await browserExpect(selected).toContainText("https://publication.invalid/news — Unverified URL");
    await browserExpect(page.getByRole("button", { name: "Select source Remove me", exact: true })).toHaveAttribute("aria-pressed", "false");
    await page.getByTestId("button-continue").click();
    await page.getByTestId("button-continue").click();
    completionStatus = 200;
    await page.getByTestId("button-complete-onboarding").click();
    await browserExpect(page).toHaveURL(`${origin}/dashboard`);
    expect(completions).toHaveLength(2);
    expect(completions[0]).toEqual(completions[1]);
    expect(completions[1].publications).toEqual(["Name only", "Invalid URL", "AI Publication"]);
    expect(completions[1].publicationCandidates).toEqual([{ name: "AI Publication", url: "https://publication.invalid/news" }]);
    expect(completions[1].keywords).toEqual([{ keyword: "Cloud", weight: 0, category: "Infrastructure" }]);
  });

  it("caps valid publication selections and candidate payloads at 20 while preserving malformed-URL names", async () => {
    suggestions = {
      publications: [null, " ", "x".repeat(101), "Legacy"],
      publicationCandidates: [
        { name: "Broken", url: "garbage" }, { name: "Script", url: "javascript:alert(1)" },
        { name: "Credentials", url: "https://user:pass@site.invalid" },
        ...Array.from({ length: 25 }, (_, i) => ({ name: `Publication ${i}`, url: `https://source${i}.invalid/` })),
      ],
    };
    await open(); await generate();
    await browserExpect(page.getByRole("button", { name: /^Remove source / })).toHaveCount(20);
    await browserExpect(page.getByRole("button", { name: "Select source TechCrunch", exact: true })).toBeDisabled();
    await browserExpect(page.getByRole("button", { name: "Remove source Broken", exact: true })).toBeVisible();
    await page.getByTestId("button-continue").click();
    await page.getByTestId("button-continue").click();
    await page.getByTestId("button-complete-onboarding").click();
    await browserExpect(page).toHaveURL(`${origin}/dashboard`);
    expect(completions[0].publications).toHaveLength(20);
    expect(completions[0].publicationCandidates).toHaveLength(16);
    expect((completions[0].publicationCandidates as Array<{ name: string }>).at(-1)?.name).toBe("Publication 15");
  });

  it("keeps metadata after a failed AI retry but omits it when all candidate sources are deselected", async () => {
    suggestions = { publications: ["Candidate", "Plain name"], publicationCandidates: [{ name: "Candidate", url: "https://candidate.invalid/" }] };
    await open(); await generate();
    await page.getByTestId("button-back").click();
    suggestionStatus = 502;
    await page.getByRole("button", { name: "Suggest preferences with AI", exact: true }).click();
    await browserExpect(page.getByText("Suggestions unavailable", { exact: true })).toBeVisible();
    await page.getByTestId("button-continue").click();
    await browserExpect(page.getByRole("list", { name: "Selected publication URLs", exact: true })).toContainText("https://candidate.invalid/ — Unverified URL");
    await page.getByRole("button", { name: "Remove source Candidate", exact: true }).click();
    await page.getByTestId("button-continue").click();
    await page.getByTestId("button-continue").click();
    await page.getByTestId("button-complete-onboarding").click();
    await browserExpect(page).toHaveURL(`${origin}/dashboard`);
    expect(completions[0].publications).toEqual(["Plain name"]);
    expect(completions[0]).not.toHaveProperty("publicationCandidates");
  });

  it.each(["Infrastructure", "primary"])("keeps all four steps and completes with weighted metadata after deselection/reselection (%s)", async (category) => {
    suggestions = {
      publications: ["AI Publication"],
      keywords: [{ keyword: "Cloud", weight: 0, category }, { keyword: "Models", weight: 0.95 }, "Legacy"],
      personalities: ["AI Leader"], companies: ["AI Company"], recommendedEngine: { industry: "technology_saas" },
    };
    await open();
    expect(analyses).toEqual([]);
    await generate();
    await page.getByRole("button", { name: "Remove source AI Publication", exact: true }).click();
    await page.getByTestId("button-continue").click();
    await browserExpect(page.getByText("Step 3 of 4: Topics", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Remove topic Cloud", exact: true }).click();
    await browserExpect(page.getByRole("button", { name: "Select topic Cloud", exact: true })).toHaveAttribute("aria-pressed", "false");
    await page.getByRole("button", { name: "Select topic Cloud", exact: true }).click();
    await page.getByRole("button", { name: "Remove topic Models", exact: true }).click();
    await page.getByLabel("Custom topic").fill("Custom topic");
    await page.getByTestId("button-add-keyword").click();
    await page.getByTestId("button-continue").click();
    await browserExpect(page.getByText("Step 4 of 4: Inspiration", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Remove company AI Company", exact: true }).click();
    await page.getByTestId("button-back").click();
    await browserExpect(page.getByRole("button", { name: "Remove topic Cloud", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("button-continue").click();
    await page.getByTestId("button-complete-onboarding").click();
    await browserExpect(page).toHaveURL(`${origin}/dashboard`);
    expect(completions).toEqual([{
      focusDescription: "I build reliable cloud infrastructure.", publications: [],
      keywords: [{ keyword: "Legacy", weight: 0.7 }, { keyword: "Cloud", weight: 0, category }, { keyword: "Custom topic", weight: 0.7 }],
      influencers: ["AI Leader"], companies: [], recommendedIndustry: "technology_saas",
    }]);
    expect(analyses).toHaveLength(1);
  });

  it("filters mixed invalid suggestions and limits the selected weighted payload to 20", async () => {
    suggestions = { keywords: [null, {}, { keyword: "Bad", weight: 2 }, "x".repeat(101),
      { keyword: "Cloud", weight: 0, category: "Infrastructure" }, " cloud ", "Legacy",
      ...Array.from({ length: 25 }, (_, i) => ({ keyword: `Topic ${i}`, weight: 0.4, category: "AI" })),
    ] };
    await open(); await generate();
    await page.getByTestId("button-continue").click();
    await browserExpect(page.getByRole("button", { name: /^Remove topic / })).toHaveCount(20);
    await browserExpect(page.getByRole("button", { name: "Select topic Cloud Computing", exact: true })).toBeDisabled();
    await browserExpect(page.getByRole("button", { name: /topic Bad$/, exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Remove topic Topic 17", exact: true }).click();
    await page.getByRole("button", { name: "Select topic Cloud Computing", exact: true }).click();
    await page.getByTestId("button-continue").click();
    await page.getByTestId("button-complete-onboarding").click();
    await browserExpect(page).toHaveURL(`${origin}/dashboard`);
    const keywords = completions[0].keywords as Array<{ keyword: string; weight: number; category?: string }>;
    expect(keywords).toHaveLength(20);
    expect(keywords[0]).toEqual({ keyword: "Cloud", weight: 0, category: "Infrastructure" });
    expect(keywords[1]).toEqual({ keyword: "Legacy", weight: 0.7 });
    expect(keywords[19]).toEqual({ keyword: "Cloud Computing", weight: 0.7 });
    expect(keywords.some(({ keyword }) => keyword === "Topic 17")).toBe(false);
  });

  it("retains weighted selections after a failed completion and disables actions during retry", async () => {
    completionStatus = 500;
    await open(); await generate();
    await page.getByTestId("button-continue").click();
    await page.getByTestId("button-continue").click();
    await page.getByTestId("button-complete-onboarding").click();
    await browserExpect(page.getByText("Something went wrong", { exact: true })).toBeVisible();
    await browserExpect(page).toHaveURL(`${origin}/onboarding`);
    await page.getByTestId("button-back").click();
    await browserExpect(page.getByRole("button", { name: "Remove topic Cloud", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("button-continue").click();
    completionStatus = 200;
    let release!: () => void;
    completeGate = new Promise<void>((resolve) => { release = resolve; });
    try {
      await page.getByTestId("button-complete-onboarding").click();
      await browserExpect(page.getByTestId("button-complete-onboarding")).toBeDisabled();
      await browserExpect(page.getByTestId("button-back")).toBeDisabled();
      await browserExpect(page.getByRole("button", { name: "Remove leader AI Leader", exact: true })).toBeDisabled();
      await browserExpect.poll(() => completions.length).toBe(2);
      expect(completions[1]).toEqual(completions[0]);
      expect(completions[1].keywords).toEqual([
        { keyword: "Cloud", weight: 0, category: "Infrastructure" }, { keyword: "Models", weight: 0.95, category: "AI" }, { keyword: "Legacy", weight: 0.7 },
      ]);
    } finally { release(); }
    await browserExpect(page).toHaveURL(`${origin}/dashboard`);
  });

  it.each(["Cancel suggestions", "Continue without AI"])("discards late AI results after %s and retains manual choices", async (action) => {
    // Delay JSON decoding after fetch succeeds, deliberately ignoring abort,
    // to exercise the wizard's own late-result guard after response.json().
    await page.addInitScript(() => {
      const originalFetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        if (String(input) !== "/api/ai/analyze-identity") return originalFetch(input, init);
        const response = new Response("{}", { status: 200 });
        response.json = () => new Promise((resolve) => {
          (window as unknown as { resolveSuggestions: () => void }).resolveSuggestions = () => resolve({
            keywords: [{ keyword: "Late topic", weight: 0, category: "Infrastructure" }],
          });
        });
        return Promise.resolve(response);
      };
    });
    await open();
    await page.getByTestId("button-continue").click();
    await page.getByTestId("button-continue").click();
    await page.getByRole("button", { name: "Select topic Cloud Computing", exact: true }).click();
    await page.getByTestId("button-back").click();
    await page.getByTestId("button-back").click();
    await page.getByRole("button", { name: "Suggest preferences with AI", exact: true }).click();
    await browserExpect(page.getByRole("button", { name: "Cancel suggestions", exact: true })).toBeVisible();
    await page.getByRole("button", { name: action, exact: true }).click();
    await page.evaluate(() => (window as unknown as { resolveSuggestions: () => void }).resolveSuggestions());
    if (action === "Cancel suggestions") {
      await browserExpect(page.getByTestId("section-identity")).toBeVisible();
      await page.getByTestId("button-continue").click();
    }
    await page.getByTestId("button-continue").click();
    await browserExpect(page.getByRole("button", { name: "Remove topic Cloud Computing", exact: true })).toHaveAttribute("aria-pressed", "true");
    await browserExpect(page.getByRole("button", { name: /topic Late topic$/ })).toHaveCount(0);
    await page.getByTestId("button-continue").click();
    await page.getByTestId("button-complete-onboarding").click();
    await browserExpect(page).toHaveURL(`${origin}/dashboard`);
    expect(completions[0].keywords).toEqual([{ keyword: "Cloud Computing", weight: 0.7 }]);
  });

  it.each(["request failure", "invalid envelope"])("keeps prior weighted selections on AI %s and allows optional-step completion", async (failure) => {
    await open(); await generate();
    await page.getByTestId("button-back").click();
    if (failure === "request failure") { suggestionStatus = 502; suggestions = { message: "AI unavailable" }; }
    else suggestions = null;
    await page.getByRole("button", { name: "Suggest preferences with AI", exact: true }).click();
    await browserExpect(page.getByText("Suggestions unavailable", { exact: true })).toBeVisible();
    await browserExpect(page.getByTestId("section-identity")).toBeVisible();
    await browserExpect(page.getByLabel("Professional focus")).toHaveValue("  I build reliable cloud infrastructure.  ");
    await page.getByRole("button", { name: "Skip optional preferences and finish", exact: true }).click();
    await browserExpect(page).toHaveURL(`${origin}/dashboard`);
    expect(completions[0].keywords).toEqual([
      { keyword: "Cloud", weight: 0, category: "Infrastructure" }, { keyword: "Models", weight: 0.95, category: "AI" }, { keyword: "Legacy", weight: 0.7 },
    ]);
  });

  it("allows the original no-AI four-step skip path without selecting hidden defaults", async () => {
    await open();
    await page.getByRole("button", { name: "Continue without AI", exact: true }).click();
    await page.getByRole("button", { name: "Skip sources", exact: true }).click();
    await page.getByRole("button", { name: "Skip topics", exact: true }).click();
    await page.getByRole("button", { name: "Skip inspiration and finish", exact: true }).click();
    await browserExpect(page).toHaveURL(`${origin}/dashboard`);
    expect(analyses).toEqual([]);
    expect(completions).toEqual([{
      focusDescription: "I build reliable cloud infrastructure.", publications: [], keywords: [], influencers: [], companies: [],
    }]);
  });
});