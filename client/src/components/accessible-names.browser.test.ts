import { readFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import { chromium, type Browser, type Page } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import config from "../../../tailwind.config";

// Real public and dashboard chrome at phone width, bundled in memory with the app's CSS.
// Auth, toasts, SEO and the composer are stubbed; nothing leaves the page.
const fixture = `
  import React from "react";
  import { createRoot } from "react-dom/client";
  import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
  import Resources from "@/pages/resources";
  import { DashboardNavbar } from "@/components/dashboard/navbar";
  import { PlatformStrip } from "@/components/landing/platform-strip";
  import { DecorativeIcons } from "@/components/decorative-icons";
  const h = React.createElement;
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false } } });
  createRoot(document.getElementById("root")).render(
    h(QueryClientProvider, { client }, h(DecorativeIcons, null, h(DashboardNavbar), h(PlatformStrip), h(Resources))));
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
    bundle: true,
    write: false,
    format: "iife",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"' },
    plugins: [{ name: "stub-app-boundaries", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/(auth|dev-auth)$|^@\/hooks\/use-toast$|^@\/components\/seo$|\/create-post-provider$/ }, args => ({ path: args.path, namespace: "stub" }));
      builder.onLoad({ filter: /.*/, namespace: "stub" }, args => ({ loader: "js", contents:
        args.path.endsWith("dev-auth") ? "export const useIsSignedIn = () => false;" :
        args.path.endsWith("/auth") ? "export const useAuth = () => ({ user: null }); export const useIsSignedIn = () => false; export const signOut = () => {};" :
        args.path.endsWith("use-toast") ? "export const useToast = () => ({ toast: () => {} });" :
        args.path.endsWith("/seo") ? "export const SEO = () => null;" :
        "export const useCreatePost = () => ({ openCreate: () => {} });" }));
    } }],
  });
  script = bundle.outputFiles[0].text;
  const source = readFileSync(path.join(root, "client/src/index.css"), "utf8")
    .replace('@import "./design/tokens.generated.css";', readFileSync(path.join(root, "client/src/design/tokens.generated.css"), "utf8"));
  css = (await postcss([tailwindcss(config)]).process(source, { from: path.join(root, "client/src/index.css") })).css;
  browser = await chromium.launch({ headless: true });
}, 60_000);

afterAll(async () => { await browser?.close(); });

async function openFixture(): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(5_000);
  await page.route("**/*", route => route.abort());
  await page.setContent('<div id="root"></div>');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: script });
  await page.getByTestId("section-platform-strip").waitFor();
  return page;
}

describe("accessible names at phone width", () => {
  it("names the public menu button for its current action", async () => {
    const page = await openFixture();
    try {
      const menu = page.getByTestId("button-mobile-menu");
      await expect(menu.getAttribute("aria-label")).resolves.toBe("Open menu");
      await menu.click();
      await expect(menu.getAttribute("aria-label")).resolves.toBe("Close menu");
    } finally { await page.close(); }
  });

  it("names the dashboard logo link when its wordmark is hidden", async () => {
    const page = await openFixture();
    try {
      await expect(page.getByTestId("link-navbar-logo").locator("span").isVisible()).resolves.toBe(false);
      await expect(page.getByRole("link", { name: "TheSocialPundit dashboard" }).count()).resolves.toBe(1);
    } finally { await page.close(); }
  });

  it("keeps brand icons out of the accessibility tree", async () => {
    const page = await openFixture();
    try {
      const icons = page.getByTestId("section-platform-strip").locator('svg[role="img"]');
      expect(await icons.count()).toBeGreaterThan(0);
      expect(await icons.evaluateAll(svgs => svgs.filter(svg => svg.getAttribute("aria-hidden") !== "true").length)).toBe(0);
    } finally { await page.close(); }
  });

  it("lets keyboard users focus and scroll each template preview", async () => {
    const page = await openFixture();
    try {
      const previews = page.getByTestId("section-resources-templates").locator("pre");
      const count = await previews.count();
      expect(count).toBeGreaterThan(0);
      for (let index = 0; index < count; index++) {
        const preview = previews.nth(index);
        const name = await preview.getAttribute("aria-label");
        expect(name).toMatch(/ template$/);
        await expect(page.getByRole("region", { name: name! }).count()).resolves.toBe(1);
        await preview.focus();
        expect(await preview.evaluate(element => element === document.activeElement)).toBe(true);
      }
    } finally { await page.close(); }
  });
});
