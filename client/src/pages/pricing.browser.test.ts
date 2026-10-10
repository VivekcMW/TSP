import { readFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import config from "../../../tailwind.config";

// The real pricing page with the app's CSS and query client, signed out. The plan catalog is
// served by the test; production's shape: rupee plans on sale, US dollar plans listed but not yet.
const fixture = `
  import React from "react";
  import { createRoot } from "react-dom/client";
  import { QueryClientProvider } from "@tanstack/react-query";
  import { queryClient } from "@/lib/queryClient";
  import Pricing from "@/pages/pricing";
  createRoot(document.getElementById("root")).render(
    React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(Pricing)));
`;
const features = ["Unlimited AI post generations", "All supported platforms"];
const plan = (key: string, name: string, amount: number, currency: string, interval: string, available = true) =>
  ({ id: key, key, name, description: `${name} description`, amount, currency, interval, features, recurringAvailable: true, available });
const catalog = [
  plan("free", "Free", 0, "INR", "monthly"),
  plan("pro_monthly_inr", "Pro Monthly", 99900, "INR", "monthly"),
  plan("pro_yearly_inr", "Pro Yearly", 999900, "INR", "annual"),
  plan("pro_monthly", "Pro Monthly", 2000, "USD", "monthly", false),
  plan("pro_yearly", "Pro Yearly", 20000, "USD", "annual", false),
];

let browser: Browser;
let script: string;
let css: string;

beforeAll(async () => {
  const root = path.resolve(import.meta.dirname, "../../..");
  const bundle = await build({
    stdin: { contents: fixture, resolveDir: root, loader: "tsx" },
    absWorkingDir: root,
    alias: { "@": path.join(root, "client/src"), "@shared": path.join(root, "shared") },
    bundle: true, write: false, format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"' },
    plugins: [{ name: "stub-app-boundaries", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/(auth|dev-auth)$|^@\/components\/seo$/ }, args => ({ path: args.path, namespace: "stub" }));
      builder.onLoad({ filter: /.*/, namespace: "stub" }, args => ({ loader: "js", contents:
        args.path.endsWith("/seo") ? "export const SEO = () => null;" :
        "export const useIsSignedIn = () => false; export const useAuth = () => ({ user: null }); export const signOut = () => {};" }));
    } }],
  });
  script = bundle.outputFiles[0].text;
  const source = readFileSync(path.join(root, "client/src/index.css"), "utf8")
    .replace('@import "./design/tokens.generated.css";', readFileSync(path.join(root, "client/src/design/tokens.generated.css"), "utf8"));
  css = (await postcss([tailwindcss(config)]).process(source, { from: path.join(root, "client/src/index.css") })).css;
  browser = await chromium.launch({ headless: true });
}, 90_000);

afterAll(async () => { await browser?.close(); });

async function newVisitor(timezoneId: string, locale: string, width = 1280, failCatalog = false): Promise<BrowserContext> {
  const context = await browser.newContext({ timezoneId, locale, viewport: { width, height: 900 }, reducedMotion: "reduce" });
  await context.route("https://pricing.test/api/public/billing/plans", route => failCatalog
    ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Plan catalog is unavailable" }) })
    : route.fulfill({ contentType: "application/json", body: JSON.stringify({ plans: catalog }) }));
  await context.route("https://pricing.test/", route => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
  await context.route("**/*", route => route.request().url().startsWith("https://pricing.test/") ? route.fallback() : route.abort());
  return context;
}
async function open(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  page.setDefaultTimeout(5_000);
  await page.goto("https://pricing.test/");
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: script });
  await page.getByRole("heading", { level: 1 }).waitFor();
  return page;
}
const plans = (page: Page) => page.getByTestId("pricing-plans");
const picker = (page: Page) => page.getByRole("combobox", { name: "Prices for" });
async function chooseCountry(page: Page, search: string, country: string) {
  await picker(page).click();
  await page.getByPlaceholder("Search countries").fill(search);
  await page.getByRole("option", { name: country, exact: true }).click();
}

describe("pricing by country", () => {
  it("shows a visitor in India rupee prices they can buy, with the yearly saving", async () => {
    const context = await newVisitor("Asia/Kolkata", "en-US");
    try {
      const page = await open(context);
      await expect(picker(page).innerText()).resolves.toBe("India");
      await plans(page).getByText("₹999").waitFor();
      const text = await plans(page).innerText();
      expect(text).toContain("₹9,999");
      expect(text).toContain("Save 17%");
      expect(text).not.toContain("$");
      await expect(page.getByRole("link", { name: "Choose Pro Monthly" }).getAttribute("href")).resolves.toBe("/dashboard/settings?tab=billing");
    } finally { await context.close(); }
  });

  it("shows a visitor elsewhere US dollar prices, says dollar checkout opens soon, and offers Start free", async () => {
    const context = await newVisitor("Europe/Berlin", "de-DE");
    try {
      const page = await open(context);
      await expect(picker(page).innerText()).resolves.toBe("Germany");
      await plans(page).getByText("$200").waitFor();
      const text = await plans(page).innerText();
      expect(text).toMatch(/\$20\s*\/ month/);
      expect(text).toMatch(/\$200\s*\/ year/);
      expect(text).not.toContain("₹");
      await expect(page.getByText("Paying in US dollars opens soon.").first().isVisible()).resolves.toBe(true);
      await expect(page.getByRole("link", { name: /^Choose Pro/ }).count()).resolves.toBe(0);
      const starts = await plans(page).getByRole("link", { name: "Start free" }).evaluateAll(links => links.map(link => link.getAttribute("href")));
      expect(starts.length).toBeGreaterThanOrEqual(3);
      expect(new Set(starts)).toEqual(new Set(["/sign-up"]));
    } finally { await context.close(); }
  });

  it("switches currency with the chosen country and remembers the choice", async () => {
    const context = await newVisitor("Europe/Berlin", "de-DE");
    try {
      let page = await open(context);
      await chooseCountry(page, "ind", "India");
      await plans(page).getByText("₹999").waitFor();
      await expect(page.getByText("Prices in Indian rupees").isVisible()).resolves.toBe(true);
      await page.close();
      page = await open(context);
      await expect(picker(page).innerText()).resolves.toBe("India");
      await plans(page).getByText("₹9,999").waitFor();
    } finally { await context.close(); }
  });

  it("finds a country by typing part of its name, says when nothing matches, and works by keyboard", async () => {
    const context = await newVisitor("Asia/Kolkata", "en-IN");
    try {
      const page = await open(context);
      await picker(page).click();
      const search = page.getByPlaceholder("Search countries");
      await search.fill("kingd");
      await expect(page.getByRole("option").allInnerTexts()).resolves.toEqual(["United Kingdom"]);
      await search.fill("zzz");
      await page.getByText("No country found.").waitFor();
      await search.fill("singa");
      await page.keyboard.press("Enter");
      await expect(picker(page).innerText()).resolves.toBe("Singapore");
      await expect(picker(page).getAttribute("aria-expanded")).resolves.toBe("false");
      await plans(page).getByText("$200").waitFor();
    } finally { await context.close(); }
  });

  it("never invents prices when the catalog can't load", async () => {
    const context = await newVisitor("Asia/Kolkata", "en-IN", 1280, true);
    try {
      const page = await open(context);
      await page.getByRole("alert").waitFor();
      await expect(page.locator("main").innerText()).resolves.not.toMatch(/[₹$]\d/);
    } finally { await context.close(); }
  });

  it("fits a phone without sideways scrolling", async () => {
    const context = await newVisitor("Asia/Kolkata", "en-IN", 390);
    try {
      const page = await open(context);
      await plans(page).getByText("₹999").waitFor();
      await expect(page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).resolves.toBeLessThanOrEqual(0);
    } finally { await context.close(); }
  });
});
