import path from "node:path";
import { build } from "esbuild";
import { chromium, type Browser } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Real wouter + framer-motion in Chromium, with motion enabled so the exit fade runs.
const fixture = `
  import React, { useEffect, useState } from "react";
  import { createRoot } from "react-dom/client";
  import { Link, Route, Switch } from "wouter";
  import { RouteTransition } from "@/components/route-transition";
  const h = React.createElement;
  window.__mounts = 0;
  function Form() {
    const [value, setValue] = useState("");
    useEffect(() => { window.__mounts++; }, []);
    return h("input", { "aria-label": "Full name", value, onChange: event => setValue(event.target.value) });
  }
  function App() {
    return h(RouteTransition, { transitionKey: location => location },
      location => h(Switch, { location },
        h(Route, { path: "/" }, h(Link, { href: "/form" }, "Start")),
        h(Route, { path: "/form" }, h(Form))));
  }
  createRoot(document.getElementById("root")).render(h(App));
`;

let browser: Browser;
let script: string;

beforeAll(async () => {
  const root = path.resolve(import.meta.dirname, "../../..");
  const bundle = await build({
    stdin: { contents: fixture, resolveDir: root, loader: "tsx" },
    absWorkingDir: root,
    alias: { "@": path.join(root, "client/src") },
    bundle: true, write: false, format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"' },
  });
  script = bundle.outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
}, 30_000);

afterAll(async () => { await browser?.close(); });

describe("route transitions", () => {
  it("mounts the next page once, so input typed during the fade is kept", async () => {
    const page = await browser.newPage({ reducedMotion: "no-preference" });
    try {
      await page.route("https://transition.test/**", route => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
      await page.goto("https://transition.test/");
      await page.addScriptTag({ content: script });
      await page.getByRole("link", { name: "Start" }).click();
      await page.getByLabel("Full name").fill("Priya Raman");
      await page.waitForTimeout(800);
      await expect(page.getByLabel("Full name").inputValue()).resolves.toBe("Priya Raman");
      await expect(page.evaluate(() => (window as unknown as { __mounts: number }).__mounts)).resolves.toBe(1);
    } finally { await page.close(); }
  });
});
