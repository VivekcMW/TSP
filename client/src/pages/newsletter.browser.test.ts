import { readFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import { chromium, type Browser, type Page } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import config from "../../../tailwind.config";

// The page confirmation and unsubscribe emails link to. Acting needs a click, because
// email security scanners open links automatically.
const fixture = `
  import React from "react";
  import { createRoot } from "react-dom/client";
  import NewsletterPage from "@/pages/newsletter";
  createRoot(document.getElementById("root")).render(React.createElement(NewsletterPage));
`;
let browser: Browser; let script: string; let css: string;
beforeAll(async () => {
  const root = path.resolve(import.meta.dirname, "../../..");
  const bundle = await build({
    stdin: { contents: fixture, resolveDir: root, loader: "tsx" }, absWorkingDir: root,
    alias: { "@": path.join(root, "client/src"), "@shared": path.join(root, "shared") },
    bundle: true, write: false, format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"test"' },
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

async function open(query: string, reply: { status: number; body: unknown }, calls: Array<{ url: string; body: unknown }>): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(5_000);
  await page.route("https://news.test/**", route => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
  await page.route("https://news.test/api/public/newsletter/*", route => {
    calls.push({ url: new URL(route.request().url()).pathname, body: route.request().postDataJSON() });
    return route.fulfill({ status: reply.status, contentType: "application/json", body: JSON.stringify(reply.body) });
  });
  await page.goto(`https://news.test/newsletter${query}`);
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: script });
  await page.getByRole("heading", { level: 1 }).waitFor();
  return page;
}

describe("newsletter link page", () => {
  it("confirms only after a click, then says so", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const page = await open("?confirm=sub-1.sig", { status: 200, body: { status: "confirmed" } }, calls);
    try {
      expect(calls).toEqual([]);
      await page.getByRole("button", { name: "Confirm subscription" }).click();
      await page.getByText("You're subscribed").waitFor();
      expect(calls).toEqual([{ url: "/api/public/newsletter/confirm", body: { token: "sub-1.sig" } }]);
    } finally { await page.close(); }
  });

  it("unsubscribes after a click", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const page = await open("?unsubscribe=sub-1.sig", { status: 200, body: { status: "unsubscribed" } }, calls);
    try {
      await page.getByRole("button", { name: "Unsubscribe" }).click();
      await page.getByText("You're unsubscribed").waitFor();
      expect(calls).toEqual([{ url: "/api/public/newsletter/unsubscribe", body: { token: "sub-1.sig" } }]);
    } finally { await page.close(); }
  });

  it("explains an expired or broken link and offers a fresh sign-up", async () => {
    const page = await open("?confirm=sub-1.sig", { status: 400, body: { message: "This link is invalid or has expired." } }, []);
    try {
      await page.getByRole("button", { name: "Confirm subscription" }).click();
      await page.getByText("This link is invalid or has expired.").waitFor();
      await expect(page.getByRole("button", { name: "Subscribe" }).isVisible()).resolves.toBe(true);
    } finally { await page.close(); }
  });

  it("shows the sign-up form when opened without a link", async () => {
    const page = await open("", { status: 202, body: {} }, []);
    try {
      await expect(page.getByRole("button", { name: "Subscribe" }).isVisible()).resolves.toBe(true);
    } finally { await page.close(); }
  });
});
