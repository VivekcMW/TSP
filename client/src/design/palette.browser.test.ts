import { readFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import { chromium, expect as browserExpect, type Browser } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import config from "../../../tailwind.config";

// Real owned primitives only. No app bootstrap, auth, server, env files, APIs,
// provider actions or persisted fixtures. Every network request is blocked.
const fixture = `
  import React, { useState } from "react";
  import { createRoot } from "react-dom/client";
  import { Badge } from "@/components/ui/badge";
  import { Progress } from "@/components/ui/progress";
  import { Slider } from "@/components/ui/slider";
  import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
  import { Sheet, SheetTrigger, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
  import { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
  import { ToastProvider, Toast, ToastTitle, ToastDescription, ToastClose, ToastViewport } from "@/components/ui/toast";
  import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select";
  function Fixture() {
    const [selected, setSelected] = useState(["Research"]);
    const [notice, setNotice] = useState(false);
    return <main className="space-y-6 p-8">
      <h1>Palette fixture</h1>
      <div data-testid="legacy-dark" className="bg-card text-card-foreground dark:bg-black dark:text-white">Always light</div>
      <button data-testid="primary" className="rounded-md bg-primary text-primary-foreground px-4 py-3 hover:bg-primary-hover active:bg-primary-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card">Primary states</button>
      <div className="flex gap-2"><Badge variant="secondary">Neutral</Badge><Badge variant="selected">Selected</Badge><Badge variant="success">Saved</Badge><Badge variant="warning">Check delivery</Badge><Badge variant="info">Generating</Badge><Badge variant="error">Failed</Badge></div>
      <Progress value={40} aria-label="Known progress" />
      <Slider aria-label="Scale" defaultValue={[40]} />
      <Tabs defaultValue="one"><TabsList aria-label="Views"><TabsTrigger value="one">First view</TabsTrigger><TabsTrigger value="two">Second view</TabsTrigger></TabsList><TabsContent value="one">First</TabsContent><TabsContent value="two">Second</TabsContent></Tabs>
      <SearchableMultiSelect aria-label="Topics" options={[{ value: "Research" }, { value: "Policy" }]} selected={selected} onChange={setSelected} placeholder="Choose topics" searchPlaceholder="Search topics" />
      <Sheet><SheetTrigger>Open sheet</SheetTrigger><SheetContent><SheetTitle>Light sheet</SheetTitle><SheetDescription>Readable sheet helper</SheetDescription><input aria-label="Native date" type="date" /></SheetContent></Sheet>
      <Dialog><DialogTrigger>Open dialog</DialogTrigger><DialogContent><DialogTitle>Light dialog</DialogTitle><DialogDescription>Readable dialog helper</DialogDescription></DialogContent></Dialog>
      <ToastProvider duration={60000}><button onClick={() => setNotice(true)}>Show error</button><Toast open={notice} onOpenChange={setNotice} variant="destructive"><ToastTitle>Save failed</ToastTitle><ToastDescription>Your text is still available.</ToastDescription><ToastClose /></Toast><ToastViewport /></ToastProvider>
    </main>;
  }
  createRoot(document.getElementById("root")).render(<Fixture />);
`;

let browser: Browser;
let script: string;
let css: string;
let openingHtml: string;

// The global reduced-motion rule gives even bare buttons/cmdk items a 0.01ms
// transition. Attribute/pseudo-class updates do not mean color paint has settled.
const paintOptions = { timeout: 1_000, intervals: [16, 32, 50] };

beforeAll(async () => {
  const root = path.resolve(import.meta.dirname, "../../..");
  openingHtml = readFileSync(path.join(root, "client/index.html"), "utf8").match(/<html\b[^>]*>/)![0];
  const bundle = await build({
    stdin: { contents: fixture, resolveDir: root, loader: "tsx" },
    absWorkingDir: root, alias: { "@": path.join(root, "client/src") },
    bundle: true, write: false, format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"' },
  });
  script = bundle.outputFiles[0].text;
  const source = readFileSync(path.join(root, "client/src/index.css"), "utf8")
    .replace('@import "./design/tokens.generated.css";', readFileSync(path.join(root, "client/src/design/tokens.generated.css"), "utf8"));
  css = (await postcss([tailwindcss({ ...config, content: [...config.content, { raw: fixture }] })])
    .process(source, { from: path.join(root, "client/src/index.css") })).css;
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => { await browser?.close(); });

async function openFixture(colorScheme: "light" | "dark" = "dark", reducedMotion: "reduce" | "no-preference" = "reduce") {
  const page = await browser.newPage({ viewport: { width: 1024, height: 900 }, colorScheme, reducedMotion });
  page.setDefaultTimeout(5000);
  await page.route("**/*", (route) => route.abort());
  await page.setContent(`<!doctype html>${openingHtml}<head><meta name="color-scheme" content="light"></head><body><div id="root"></div></body></html>`);
  // The initial HTML policy is effective before CSS or React is available.
  expect(await page.locator("html").evaluate((node) => getComputedStyle(node).colorScheme)).toContain("light");
  expect(await page.locator("html").getAttribute("class")).toBe("light");
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: script });
  await page.getByRole("heading", { name: "Palette fixture" }).waitFor();
  return page;
}

describe("light-only palette in isolated Chromium", () => {
  it.each(["light", "dark"] as const)("keeps canvas, primitives and even legacy classes light with OS=%s", async (scheme) => {
    const page = await openFixture(scheme);
    try {
      expect(await page.locator("body").evaluate((node) => getComputedStyle(node).backgroundColor)).toBe("rgb(248, 250, 252)");
      await page.locator("html").evaluate((node) => node.classList.add("dark"));
      const pair = await page.getByTestId("legacy-dark").evaluate((node) => ({ fill: getComputedStyle(node).backgroundColor, ink: getComputedStyle(node).color }));
      expect(pair).toEqual({ fill: "rgb(255, 255, 255)", ink: "rgb(15, 23, 42)" });
      const tab = page.getByRole("tab", { name: "First view" });
      expect(await tab.getAttribute("aria-selected")).toBe("true");
      expect(await tab.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe("rgb(239, 246, 255)");
      expect(await tab.evaluate((node) => getComputedStyle(node).borderBottomColor)).toBe("rgb(29, 78, 216)");
    } finally { await page.close(); }
  });

  it.each(["reduce", "no-preference"] as const)("renders exact primary hover/pressed colors and a separated 2px keyboard ring with motion=%s", async (motion) => {
    const page = await openFixture("dark", motion);
    try {
      const action = page.getByTestId("primary");
      expect(await action.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe("rgb(29, 78, 216)");
      await action.hover();
      expect(await action.evaluate((node) => node.matches(":hover"))).toBe(true);
      await browserExpect.poll(() => action.evaluate((node) => getComputedStyle(node).backgroundColor), paintOptions).toBe("rgb(30, 64, 175)");
      await page.mouse.down();
      try {
        expect(await action.evaluate((node) => node.matches(":active"))).toBe(true);
        await browserExpect.poll(() => action.evaluate((node) => getComputedStyle(node).backgroundColor), paintOptions).toBe("rgb(30, 58, 138)");
      } finally { await page.mouse.up(); }
      await browserExpect.poll(() => action.evaluate((node) => getComputedStyle(node).backgroundColor), paintOptions).toBe("rgb(30, 64, 175)");
      await page.mouse.move(0, 0);
      await browserExpect.poll(() => action.evaluate((node) => getComputedStyle(node).backgroundColor), paintOptions).toBe("rgb(29, 78, 216)");
      await page.keyboard.press("Tab");
      await action.focus();
      const focus = await action.evaluate((node) => {
        const style = getComputedStyle(node);
        return { visible: node.matches(":focus-visible"), offset: style.getPropertyValue("--tw-ring-offset-width"), radius: style.borderRadius };
      });
      expect(focus.visible).toBe(true);
      expect(focus.offset).toBe("2px");
      await browserExpect.poll(() => action.evaluate((node) => getComputedStyle(node).boxShadow), paintOptions).toContain("rgb(255, 255, 255)");
      await browserExpect.poll(() => action.evaluate((node) => getComputedStyle(node).boxShadow), paintOptions).toContain("rgb(29, 78, 216)");
      expect(focus.radius).toBe("6px");
    } finally { await page.close(); }
  });

  it("keeps sheet, dialog, native controls and destructive toast light under OS dark", async () => {
    const page = await openFixture();
    try {
      for (const kind of ["sheet", "dialog"]) {
        const trigger = page.getByRole("button", { name: `Open ${kind}` });
        await trigger.click();
        const panel = page.getByRole("dialog", { name: `Light ${kind}` });
        await panel.waitFor();
        expect(await panel.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe("rgb(255, 255, 255)");
        expect(await panel.evaluate((node) => getComputedStyle(node).color)).toBe("rgb(15, 23, 42)");
        if (kind === "sheet") expect(await page.getByLabel("Native date").evaluate((node) => getComputedStyle(node).colorScheme)).toContain("light");
        const seconds = await panel.evaluate((node) => Number.parseFloat(getComputedStyle(node).animationDuration));
        expect(seconds).toBeLessThanOrEqual(0.001);
        await page.keyboard.press("Escape");
        await panel.waitFor({ state: "hidden" });
        expect(await trigger.evaluate((node) => node === document.activeElement)).toBe(true);
      }
      await page.getByRole("button", { name: "Show error" }).click();
      const toast = page.locator('[data-state="open"].destructive');
      await toast.waitFor();
      expect(await toast.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe("rgb(254, 242, 242)");
      expect(await toast.evaluate((node) => getComputedStyle(node).color)).toBe("rgb(185, 28, 28)");
      expect(await toast.getByText("Your text is still available.").evaluate((node) => getComputedStyle(node).opacity)).toBe("1");
    } finally { await page.close(); }
  });

  it.each(["reduce", "no-preference"] as const)("shows committed multiselect choices separately from keyboard highlight with motion=%s", async (motion) => {
    const page = await openFixture("dark", motion);
    try {
      await page.getByRole("combobox", { name: "Topics" }).click();
      const chosen = page.getByRole("option", { name: /Research.*Selected/ });
      expect(await chosen.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe("rgb(239, 246, 255)");
      expect(await chosen.evaluate((node) => getComputedStyle(node).borderLeftWidth)).toBe("2px");
      const uncommitted = page.getByRole("option", { name: "Policy", exact: true });
      const search = page.getByRole("combobox", { name: "Search topics" });
      await search.press("ArrowDown");
      expect(await uncommitted.getAttribute("data-selected")).toBe("true");
      await browserExpect.poll(() => uncommitted.evaluate((node) => getComputedStyle(node).backgroundColor), paintOptions).toBe("rgb(241, 245, 249)");
      expect(await chosen.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe("rgb(239, 246, 255)");
      // Moving highlight away must clear neutral paint, not commit a choice or
      // remove the persistent accent from the already-selected option.
      await search.press("ArrowUp");
      expect(await chosen.getAttribute("data-selected")).toBe("true");
      expect(await uncommitted.getAttribute("data-selected")).toBe("false");
      await browserExpect.poll(() => uncommitted.evaluate((node) => getComputedStyle(node).backgroundColor), paintOptions).toBe("rgba(0, 0, 0, 0)");
      expect(await chosen.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe("rgb(239, 246, 255)");
      expect(await page.getByRole("combobox", { name: "Topics", exact: true }).textContent()).toContain("1 selected");
      await search.press("ArrowDown");
      expect(await uncommitted.getAttribute("data-selected")).toBe("true");
      await browserExpect.poll(() => uncommitted.evaluate((node) => getComputedStyle(node).backgroundColor), paintOptions).toBe("rgb(241, 245, 249)");
      await uncommitted.click();
      await page.keyboard.press("Escape");
      await browserExpect(page.getByRole("combobox", { name: "Topics", exact: true })).toContainText("2 selected");
    } finally { await page.close(); }
  });
});