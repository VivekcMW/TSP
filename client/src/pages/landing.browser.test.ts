import { readFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import { chromium, type Browser, type Page } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import config from "../../../tailwind.config";
import { PLATFORMS } from "@/lib/platforms";
import { SEARCH_EDITIONS } from "@shared/search-editions";

// The real landing page, header and footer with the app's CSS, signed out. Images resolve
// to stand-in paths and every network request is refused, so nothing leaves the page.
const fixture = `
  import React from "react";
  import { createRoot } from "react-dom/client";
  import LandingPage from "@/pages/landing";
  createRoot(document.getElementById("root")).render(React.createElement(LandingPage));
`;

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
      builder.onResolve({ filter: /\.webp$/ }, args => ({ path: path.basename(args.path), namespace: "image" }));
      builder.onLoad({ filter: /.*/, namespace: "image" }, args => ({ loader: "js", contents: `export default "/images/${args.path}";` }));
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

async function openLanding(width: number, height = 900, hash = ""): Promise<Page> {
  const page = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" });
  page.setDefaultTimeout(5_000);
  await page.route("https://landing.test/**", route => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
  await page.route("**/*", route => route.request().url().startsWith("https://landing.test/") ? route.fallback() : route.abort());
  await page.goto(`https://landing.test/${hash}`);
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: script });
  await page.getByRole("heading", { level: 1 }).waitFor();
  return page;
}

const networks = PLATFORMS.filter(platform => platform.value !== "slack").length;

describe("landing page", () => {
  it("leads with the promise and two ways in", async () => {
    const page = await openLanding(1440);
    try {
      await expect(page.getByRole("heading", { level: 1 }).innerText()).resolves.toBe("Be the voice your industry listens to.");
      const hero = page.getByTestId("section-hero");
      await expect(hero.getByRole("link", { name: "Start free" }).getAttribute("href")).resolves.toBe("/sign-up");
      await expect(hero.getByRole("link", { name: "See how it works" }).getAttribute("href")).resolves.toBe("/how-it-works");
    } finally { await page.close(); }
  });

  it("states only what the product does, with counts taken from the product itself", async () => {
    const page = await openLanding(1440);
    try {
      const facts = (await page.getByTestId("section-facts").innerText()).replace(/\s+/g, " ");
      expect(facts).toContain(`${networks} networks, one voice`);
      expect(facts).toContain(`${SEARCH_EDITIONS.length} regional news editions`);
      expect(facts).toContain("4 tones that sound like you");
      const text = await page.locator("body").innerText();
      for (const banned of [/\[[^\]]*\]/, /lorem/i, /\d+\+ comments/i, /80\+/, /\bRSS\b/, /2025/]) expect(text, String(banned)).not.toMatch(banned);
      const footerLinks = await page.locator("footer a").evaluateAll(links => links.map(link => link.getAttribute("href")));
      expect(footerLinks).not.toContain("/case-studies");
      expect(footerLinks).not.toContain("/careers");
    } finally { await page.close(); }
  });

  it("gives every photo and screenshot alt text, sizes and reserved space; only the hero loads eagerly", async () => {
    const page = await openLanding(1440);
    try {
      const images = await page.locator("img").evaluateAll(list => list.map(image => ({
        alt: image.getAttribute("alt"), width: image.getAttribute("width"), height: image.getAttribute("height"),
        srcset: image.getAttribute("srcset"), loading: image.getAttribute("loading"), priority: image.getAttribute("fetchpriority"),
      })));
      expect(images.length).toBeGreaterThanOrEqual(3);
      for (const image of images) {
        expect(image.alt?.trim(), JSON.stringify(image)).toBeTruthy();
        expect(Number(image.width) > 0 && Number(image.height) > 0, JSON.stringify(image)).toBe(true);
        expect(image.srcset, JSON.stringify(image)).toMatch(/ \d+w/);
      }
      expect(images.filter(image => image.loading === "eager")).toEqual([expect.objectContaining({ priority: "high" })]);
    } finally { await page.close(); }
  });

  it("switches product tabs to the matching screenshot, and opens the one named in the address", async () => {
    const page = await openLanding(1440);
    try {
      const product = page.getByTestId("section-product");
      await product.getByRole("tab", { name: "Create" }).click();
      await expect(product.getByRole("tabpanel").locator("img").getAttribute("alt")).resolves.toMatch(/Create/);
    } finally { await page.close(); }
    const linked = await openLanding(1440, 900, "#product-content");
    try {
      await expect(linked.getByTestId("section-product").getByRole("tab", { selected: true }).innerText()).resolves.toBe("Content");
    } finally { await linked.close(); }
  });

  it("shows each region's networks and news editions", async () => {
    const page = await openLanding(1440);
    try {
      const markets = page.getByTestId("section-markets");
      await markets.getByRole("tab", { name: "Greater China" }).click();
      const china = await markets.getByRole("tabpanel").innerText();
      for (const name of ["WeChat", "Weibo", "Xiaohongshu", "Maimai"]) expect(china).toContain(name);
      await markets.getByRole("tab", { name: "Europe" }).click();
      const europe = await markets.getByRole("tabpanel").innerText();
      for (const name of ["Xing", "German (Germany)", "French (France)"]) expect(europe).toContain(name);
    } finally { await page.close(); }
  });

  it("opens the Product menu with a link to each product area", async () => {
    const page = await openLanding(1440);
    try {
      await page.getByRole("button", { name: "Product" }).click();
      for (const [name, href] of [["Discover", "/#product-discover"], ["Create", "/#product-create"], ["Pundit setup agent", "/#product-pundit"]]) {
        await expect(page.getByRole("link", { name: new RegExp(`^${name}`) }).first().getAttribute("href")).resolves.toBe(href);
      }
    } finally { await page.close(); }
  });

  it("fits a phone without sideways scrolling and pins Start free once the hero button scrolls away", async () => {
    const page = await openLanding(390, 844);
    try {
      const wide = await page.evaluate(() => [...document.querySelectorAll("body *")]
        .filter(element => element.getBoundingClientRect().right > window.innerWidth + 1 && getComputedStyle(element).position !== "fixed")
        // Chips inside a sideways-scrolling strip are clipped by it, not by the page.
        .filter(element => { for (let parent = element.parentElement; parent; parent = parent.parentElement) if (getComputedStyle(parent).overflowX !== "visible") return false; return true; })
        .filter(element => ![...element.children].some(child => child.getBoundingClientRect().right > window.innerWidth + 1))
        .slice(0, 5).map(element => `${element.tagName}.${String(element.className).slice(0, 80)}`));
      expect(wide).toEqual([]);
      await expect(page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).resolves.toBeLessThanOrEqual(0);
      const pinned = page.getByTestId("sticky-mobile-cta");
      await expect(pinned.isVisible()).resolves.toBe(false);
      await page.evaluate(() => window.scrollTo(0, 2400));
      await expect.poll(() => pinned.isVisible()).toBe(true);
      await expect(pinned.getByRole("link", { name: "Start free" }).getAttribute("href")).resolves.toBe("/sign-up");
      // Rendered straight into <body>: the app's page-transition wrapper animates a transform, which
      // would otherwise pin this bar to the page instead of the screen.
      await expect(pinned.evaluate(element => element.parentElement === document.body)).resolves.toBe(true);
      // It gives way to the cookie banner rather than stacking on top of it.
      await page.evaluate(() => { document.body.dataset.cookieBanner = "open"; });
      await expect.poll(() => pinned.isVisible()).toBe(false);
    } finally { await page.close(); }
  });

  it("opens the phone menu with the product areas and sign-up", async () => {
    const page = await openLanding(390, 844);
    try {
      await page.getByRole("button", { name: "Open menu" }).click();
      const menu = page.getByTestId("mobile-menu");
      await expect(menu.getByRole("link", { name: "Discover" }).getAttribute("href")).resolves.toBe("/#product-discover");
      await expect(menu.getByRole("link", { name: "Start free" }).getAttribute("href")).resolves.toBe("/sign-up");
    } finally { await page.close(); }
  });

  it("signs a visitor up for the newsletter and asks them to confirm by email", async () => {
    const page = await openLanding(1440);
    try {
      const bodies: unknown[] = [];
      await page.route("https://landing.test/api/public/newsletter", route => {
        bodies.push(route.request().postDataJSON());
        return route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ message: "Check your inbox and click the link to confirm your subscription." }) });
      });
      const banner = page.getByTestId("section-newsletter");
      await expect(banner.innerText()).resolves.toMatch(/one email a month/i);
      await expect(banner.getByRole("link", { name: "Privacy Policy" }).getAttribute("href")).resolves.toBe("/privacy");
      await banner.getByLabel("Email address").fill("not an email");
      await banner.getByRole("button", { name: "Subscribe" }).click();
      await banner.getByText("Enter a valid email address.").waitFor();
      expect(bodies).toEqual([]);
      await banner.getByLabel("Email address").fill("reader@example.com");
      await banner.getByRole("button", { name: "Subscribe" }).click();
      await banner.getByText("Check your inbox and click the link to confirm your subscription.").waitFor();
      expect(bodies).toEqual([{ email: "reader@example.com", source: "landing" }]);
    } finally { await page.close(); }
  });

  it("tells the visitor when sign-up is busy, and lets them try again", async () => {
    const page = await openLanding(390, 844);
    try {
      await page.route("https://landing.test/api/public/newsletter", route => route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ message: "Too many sign-ups from here. Please try again later." }) }));
      const banner = page.getByTestId("section-newsletter");
      await banner.getByLabel("Email address").fill("reader@example.com");
      await banner.getByRole("button", { name: "Subscribe" }).click();
      await banner.getByText("Too many sign-ups from here. Please try again later.").waitFor();
      await expect(banner.getByRole("button", { name: "Subscribe" }).isEnabled()).resolves.toBe(true);
    } finally { await page.close(); }
  });
});
