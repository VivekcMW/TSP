import { readFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import { chromium, expect as browserExpect, type Browser, type Page } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import config from "../../../tailwind.config";

// Real primitives, bundled entirely in memory. No application bootstrap, API,
// credentials, environment files, external requests, or persistent fixtures.
const fixture = `
  import React, { useState } from "react";
  import { createRoot } from "react-dom/client";
  import { Inbox } from "lucide-react";
  import { PageHeader, PageBody, PageToolbar } from "@/components/dashboard/page-header";
  import { DashboardEmptyState } from "@/components/dashboard/empty-state";
  import { AppFooter } from "@/components/dashboard/app-footer";
  import { InboxDetail } from "@/components/dashboard/inbox-detail";
  import { RichArticleEditor } from "@/components/dashboard/rich-article-editor";
  import { Sidebar, SidebarProvider, SidebarContent, SidebarGroup, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarTrigger } from "@/components/ui/sidebar";
  import { Sheet, SheetContent } from "@/components/ui/sheet";
  import { Button } from "@/components/ui/button";
  import { Field } from "@/components/ui/field";
  import { InfoTooltip } from "@/components/ui/info-tooltip";
  import { Input } from "@/components/ui/input";
  import { Textarea } from "@/components/ui/textarea";
  import { NativeSelect, Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
  import { SegmentedControl, SegmentedControlItem } from "@/components/ui/segmented-control";
  import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
  import { Calendar } from "@/components/ui/calendar";
  import { NewsletterSignup } from "@/components/newsletter-signup";
  import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
  import { Form, FormField, FormItem, FormLabel, FormControl, FormDescription, FormMessage } from "@/components/ui/form";
  import { useForm } from "react-hook-form";
  const options = globalThis.__foundationOptions || {};
  const h = React.createElement;
  function Fixture() {
    const [open, setOpen] = useState(false);
    const [saved, setSaved] = useState(false);
    const item = { id: "article", source: "Example publication", headline: "A real article headline", articleUrl: "https://example.com/article", summary: "Visible article content", matchedKeywords: ["Research"], createdAt: null, status: saved ? "saved" : "active" };
    return h(SidebarProvider, { className: "h-svh min-h-0" },
      h(Sidebar, { collapsible: "icon" },
        h(SidebarContent, null, h(SidebarGroup, null, h(SidebarMenu, null,
          h(SidebarMenuItem, null, h(SidebarMenuButton, { asChild: true, tooltip: "Discover" },
            h("a", { href: "#discover", "aria-label": "Discover", "aria-current": "page", className: "bg-sidebar-accent text-sidebar-accent-foreground" }, h(Inbox), h("span", null, "Discover")))))))),
      h("main", { className: "flex min-w-0 flex-1 flex-col overflow-hidden" },
        h(PageHeader, { title: "Foundation checks", subtitle: "Shared gutters and visible data", width: "reading", stats: 0,
          actions: h(React.Fragment, null, h(SidebarTrigger), h(Button, { onClick: () => setOpen(true) }, "Read article")) }),
        h(PageBody, { as: "div", width: "reading" }, h(DashboardEmptyState, { icon: Inbox, title: "Nothing to review", description: "This message never waits for scrolling.", action: h(Button, null, "Refresh articles") })),
        h(AppFooter)),
      h(Sheet, { open, onOpenChange: setOpen }, h(SheetContent, { "aria-describedby": undefined, className: "w-full p-0 sm:max-w-lg" },
        h(InboxDetail, { item, inSheet: true, onSave: () => setSaved(true), onGeneratePost: () => {}, onDismiss: () => setOpen(false) }))));
  }
  function HookFormFixture() {
    const form = useForm({ defaultValues: { name: "" } });
    return <Form {...form}>
      <form onSubmit={form.handleSubmit(() => {})} className="space-y-4">
        <FormField control={form.control} name="name" rules={{ required: "Enter a name" }} render={({ field }) =>
          <FormItem>
            <FormLabel>Profile name</FormLabel>
            <FormControl aria-describedby="form-extra"><Input {...field} aria-describedby="external-help" /></FormControl>
            <FormDescription>Use a recognizable name.</FormDescription>
            <FormMessage />
          </FormItem>
        } />
        <p id="form-extra">Form-specific guidance.</p>
        <Button type="submit">Validate profile</Button>
      </form>
    </Form>;
  }
  function PrimitiveFixture() {
    const [loading, setLoading] = useState(false);
    const [mode, setMode] = useState("article");
    const [error, setError] = useState(true);
    const [navigations, setNavigations] = useState(0);
    const [article, setArticle] = useState({ title: "", content: "", media: [] });
    const title = options.longText ? "Long page title with translated words and a verylongunbrokenword".repeat(3) : "Primitive contracts";
    return <div className="flex h-svh min-h-0">
      <aside aria-label="Fixture sidebar" className="hidden w-64 shrink-0 md:block" />
      <main className={"flex min-h-0 min-w-0 flex-1 flex-col " + (options.scrollable === false ? "overflow-y-auto" : "overflow-hidden")}>
        <PageHeader width={options.width} title={title} help="Help for this page." subtitle="A shared identity region" actions={<Button>Primary action</Button>} />
        <PageBody as="div" width={options.width} scrollable={options.scrollable} contentClassName="space-y-6">
          <PageToolbar aria-label="Content filters" actions={<Button variant="secondary">Apply filters</Button>}>
            <Field label="Search posts" render={(props) => <Input {...props} type="search" />} />
            <SegmentedControl aria-label="Creation mode">
              <SegmentedControlItem selected={mode === "article"} onClick={() => setMode("article")}>Article</SegmentedControlItem>
              <SegmentedControlItem selected={mode === "idea"} onClick={() => setMode("idea")}>{options.longText ? "Idea with a longer translated label" : "Idea"}</SegmentedControlItem>
              <SegmentedControlItem selected={false} disabled>Unavailable</SegmentedControlItem>
            </SegmentedControl>
          </PageToolbar>
          <div className="flex flex-wrap items-center gap-3">
            <Button data-testid="size-standard" size="standard">Standard</Button>
            <Button data-testid="size-default">Default</Button>
            <Button data-testid="size-sm" size="sm">Small label</Button>
            <Button data-testid="size-icon" size="icon" aria-label="Refresh"><Inbox /></Button>
            <Button data-testid="size-compact" size="compact">Bold</Button>
            <Button data-testid="size-lg" size="lg">Large action</Button>
            <Button data-testid="icon-gap"><Inbox className="mr-2" />With icon</Button>
            <Button data-testid="size-destructive" variant="destructive">Delete</Button>
            <Button data-testid="size-outline" variant="outline">Cancel</Button>
            <Button data-testid="touch-override" size="sm" className="h-6 min-h-6 min-w-6 p-0">X</Button>
            <Button data-testid="neutral" variant="secondary">Secondary</Button>
            <Button data-testid="selected" variant="selected" aria-pressed="true">Selected</Button>
            <Button data-testid="disabled" disabled>Blocked action</Button>
            <Button data-testid="loading-action" loading={loading} onClick={() => setLoading(true)}>Save changes</Button>
            <Button variant="outline" onClick={() => setLoading(false)}>Finish saving</Button>
            <Button asChild loading={loading} data-testid="navigation">
              <a href="#drafts" onClick={(event) => { event.preventDefault(); setNavigations((count) => count + 1); }}>Open drafts</a>
            </Button>
            <output data-testid="navigation-count">{navigations}</output>
          </div>
          <p id="external-help">Existing external help.</p>
          <Field label="Post title" help="Describe the story." error={error ? "A title is required." : undefined} counter={0}
            controlProps={{ "aria-describedby": "external-help external-help" }} render={(props) => <Input {...props} />} />
          <Button variant="outline" onClick={() => setError((value) => !value)}>Toggle field error</Button>
          <Field label="Post content" help="Review before saving." counter="0 of 500" render={(props) => <Textarea {...props} />} />
          <Field label="Native tone" help="Choose a voice." render={(props) => <NativeSelect {...props} defaultValue="neutral"><option value="neutral">Neutral</option><option value="practical">Practical</option></NativeSelect>} />
          <Field label="Radix tone" help="Choose a voice." render={(props) => <Select defaultValue="neutral"><SelectTrigger {...props}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="neutral">Neutral</SelectItem><SelectItem value="practical">Practical</SelectItem></SelectContent></Select>} />
          <Field label="Read-only copy" render={(props) => <Input {...props} readOnly value="Copy this text" />} />
          <Field label="Disabled field" help="Complete setup first." render={(props) => <Input {...props} disabled />} />
          <InfoTooltip label="Detailed guidance">{"Helpful context stays readable on narrow screens and remains available to keyboard and touch users. ".repeat(5)}</InfoTooltip>
          <HookFormFixture />
          <Card data-testid="comfortable-card">
            <CardHeader data-testid="comfortable-header"><CardTitle help="Help for this section." ref={(node) => { if (node) node.dataset.refTag = node.tagName; }}>Section heading</CardTitle><CardDescription>Readable helper text.</CardDescription></CardHeader>
            <CardContent>Exact content remains readable.</CardContent><CardFooter><Button variant="outline">Review section</Button></CardFooter>
          </Card>
          <Card density="compact" data-testid="compact-card"><CardHeader data-testid="compact-header"><CardTitle as="h3" ref={(node) => { if (node) node.dataset.refTag = node.tagName; }}>Nested heading</CardTitle></CardHeader><CardContent>Compact content.</CardContent></Card>
          <RichArticleEditor value={article} onChange={setArticle} isPending={false} onUploadingChange={() => {}} />
          <Tabs defaultValue="first"><TabsList aria-label="Sizing tabs"><TabsTrigger value="first">First</TabsTrigger><TabsTrigger value="second">Second</TabsTrigger></TabsList><TabsContent value="first">First panel</TabsContent><TabsContent value="second">Second panel</TabsContent></Tabs>
          <NewsletterSignup source="newsletter-page" />
          <Calendar mode="single" defaultMonth={new Date(2026, 9, 1)} />
          <div className="h-96" aria-hidden="true" />
        </PageBody>
      </main>
    </div>;
  }
  createRoot(document.getElementById("root")).render(h(options.primitives ? PrimitiveFixture : Fixture));
`;

let browser: Browser;
let script: string;
let css: string;

// Reduced motion still assigns every element a nonzero 0.01ms transition.
// DOM state can change before Chromium samples its final color/shadow; keep
// exact assertions, but allow the real stylesheet to finish painting.
const paintOptions = { timeout: 1_000, intervals: [16, 32, 50] };

beforeAll(async () => {
  const root = path.resolve(import.meta.dirname, "../../..");
  const bundle = await build({
    stdin: { contents: fixture, resolveDir: root, loader: "tsx" },
    absWorkingDir: root,
    alias: { "@": path.join(root, "client/src") },
    bundle: true,
    write: false,
    format: "iife",
    jsx: "automatic",
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

interface FixtureOptions {
  primitives?: boolean;
  width?: "reading" | "standard" | "workbench";
  scrollable?: boolean;
  longText?: boolean;
  hasTouch?: boolean;
}

async function openFixture(width = 1280, reducedMotion: "reduce" | "no-preference" = "reduce", options: FixtureOptions = {}) {
  const page = await browser.newPage({ viewport: { width, height: 800 }, reducedMotion, hasTouch: options.hasTouch ?? false });
  page.setDefaultTimeout(5_000);
  await page.route("**/*", (route) => route.abort());
  // Match the real document: quirks mode restricts bare :hover matching on
  // non-links even while compound CSS hover rules paint the expected state.
  await page.setContent('<!doctype html><html><head></head><body><div id="root"></div></body></html>');
  await page.addStyleTag({ content: css });
  await page.evaluate((value) => { (globalThis as typeof globalThis & { __foundationOptions?: FixtureOptions }).__foundationOptions = value; }, options);
  await page.addScriptTag({ content: script });
  await page.getByTestId("text-page-title").waitFor();
  return page;
}

async function targetSize(page: Page, selector: string) {
  return page.locator(selector).evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { width: box.width, height: box.height };
  });
}

async function tokenColor(page: Page, token: string) {
  return page.evaluate((name) => {
    const probe = document.createElement("span");
    probe.style.color = `hsl(var(--${name}))`;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, token);
}

async function expectNoLocalClipping(page: Page) {
  await browserExpect.poll(() => page.locator("[data-page-container], [data-page-toolbar], [data-page-filters], [data-page-actions], [data-segmented-control], [data-button-label], [data-density], [data-density] > div, form, form > div").evaluateAll((elements) =>
    elements.filter((element) => element.scrollWidth > element.clientWidth + 1).map((element) => ({
      html: element.outerHTML.slice(0, 200), width: element.clientWidth, scrollWidth: element.scrollWidth,
      overflowingChildren: Array.from(element.children).filter(child => child.getBoundingClientRect().right > element.getBoundingClientRect().right + 1).map(child => child.outerHTML.slice(0, 200)),
    })),
  ), paintOptions).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
}

describe("UX10–14 shared primitive contracts (not page-adoption acceptance)", () => {
  it("opens contextual help by hover/focus, preserves field descriptions, and never nests help in a label", async () => {
    const page = await openFixture(1280, "reduce", { primitives: true });
    try {
      const input = page.getByRole("textbox", { name: "Post title", exact: true });
      const help = page.getByRole("button", { name: "About Post title", exact: true });
      const popup = page.locator("[data-info-popup]");
      await browserExpect(popup).toHaveCount(0);
      await browserExpect(input).toHaveAccessibleDescription("Existing external help. Describe the story. A title is required. 0");
      await browserExpect(help).toHaveAttribute("type", "button");
      await browserExpect(page.locator("label [data-info-trigger], h1 [data-info-trigger], h2 [data-info-trigger]")).toHaveCount(0);
      await page.locator("label").filter({ hasText: /^Post title$/ }).click();
      await browserExpect(input).toBeFocused();
      await browserExpect(popup).toHaveCount(0);
      await help.hover();
      await browserExpect(popup).toBeVisible();
      await browserExpect(popup).toContainText("Describe the story.");
      await popup.hover();
      await browserExpect(popup).toBeVisible();
      await page.keyboard.press("Escape");
      await browserExpect(popup).toHaveCount(0);
      await page.mouse.move(0, 0);
      await help.focus();
      await browserExpect(popup).toBeVisible();
      await browserExpect(page.getByRole("tooltip")).toHaveText("Describe the story.");
      await page.keyboard.press("Tab");
      await browserExpect(input).toBeFocused();
      await browserExpect(popup).toHaveCount(0);
      await browserExpect(page.getByRole("alert")).toContainText("A title is required.");
      await browserExpect(page.getByRole("button", { name: "About Disabled field", exact: true })).toBeEnabled();
    } finally { await page.close(); }
  });

  it.each([320, 375, 1440])("supports tap-to-toggle and non-overlapping 44px help targets at %spx", async viewport => {
    const page = await openFixture(viewport, "reduce", { primitives: true, hasTouch: true });
    try {
      const help = page.getByRole("button", { name: "About Detailed guidance", exact: true });
      const popup = page.locator("[data-info-popup]");
      await help.tap();
      await browserExpect(popup).toBeVisible();
      await browserExpect(popup).toHaveCSS("animation-name", "none");
      expect(await popup.evaluate(element => {
        const box = element.getBoundingClientRect();
        return box.left >= 0 && box.right <= innerWidth && element.scrollWidth <= element.clientWidth + 1;
      })).toBe(true);
      expect(await page.locator("[data-info-trigger]").evaluateAll(elements => elements.every(element => {
        const box = element.getBoundingClientRect();
        const label = element.parentElement!.querySelector(":scope > label");
        return box.width >= 44 && box.height >= 44 && (!label || label.getBoundingClientRect().right <= box.left);
      }))).toBe(true);
      await help.tap();
      await browserExpect(popup).toHaveCount(0);
      await help.tap();
      await browserExpect(popup).toBeVisible();
      await page.keyboard.press("Escape");
      await browserExpect(popup).toHaveCount(0);
      await browserExpect(help).toBeFocused();
      await page.keyboard.press("Space");
      await browserExpect(popup).toBeVisible();
      await page.getByRole("textbox", { name: "Profile name", exact: true }).tap();
      await browserExpect(popup).toHaveCount(0);
    } finally { await page.close(); }
  });

  const layouts = (["reading", "standard", "workbench"] as const).flatMap((width) =>
    [320, 375, 768, 1024, 1440].map((viewport) => ({ width, viewport })),
  );

  it.each(layouts)("coordinates $width header/body at $viewport px with sidebar-reduced space", async ({ width, viewport }) => {
    const page = await openFixture(viewport, "reduce", { primitives: true, width });
    try {
      const geometry = await page.evaluate(() => {
        const header = document.querySelector<HTMLElement>("[data-page-header]")!;
        const body = document.querySelector<HTMLElement>("[data-page-body]")!;
        const headContent = header.querySelector("[data-page-container]")!;
        const bodyContent = body.querySelector("[data-page-container]")!;
        const heading = getComputedStyle(header.querySelector("h1")!);
        return {
          header: { x: headContent.getBoundingClientRect().x, width: headContent.getBoundingClientRect().width },
          body: { x: bodyContent.getBoundingClientRect().x, width: bodyContent.getBoundingClientRect().width },
          maxWidth: getComputedStyle(headContent).maxWidth,
          widths: [header, body, headContent, bodyContent].map((element) => element.getAttribute("data-page-width")),
          gutters: [getComputedStyle(header).paddingLeft, getComputedStyle(body).paddingLeft],
          fontSize: heading.fontSize, fontWeight: heading.fontWeight,
        };
      });
      expect(geometry.header).toEqual(geometry.body);
      expect(geometry.maxWidth).toBe(`${{ reading: 768, standard: 1024, workbench: 1280 }[width]}px`);
      expect(geometry.widths).toEqual([width, width, width, width]);
      expect(geometry.gutters).toEqual(viewport < 640 ? ["16px", "16px"] : ["24px", "24px"]);
      expect(geometry.fontSize).toBe("24px");
      expect(geometry.fontWeight).toBe("600");
      expect(await page.getByRole("main").count()).toBe(1);
      expect(await page.getByRole("main").getByRole("heading", { level: 1 }).count()).toBe(1);
      await expectNoLocalClipping(page);
    } finally { await page.close(); }
  });

  it("scrolls secondary filters with the body, not the sticky identity", async () => {
    const page = await openFixture(1024, "reduce", { primitives: true });
    try {
      const positions = await page.evaluate(() => {
        const body = document.querySelector<HTMLElement>("[data-page-body]")!;
        const header = document.querySelector("[data-page-header]")!;
        const toolbar = document.querySelector("[data-page-toolbar]")!;
        const before = { header: header.getBoundingClientRect().y, toolbar: toolbar.getBoundingClientRect().y };
        body.scrollTop = 200;
        return { before, after: { header: header.getBoundingClientRect().y, toolbar: toolbar.getBoundingClientRect().y }, scrollTop: body.scrollTop, position: getComputedStyle(toolbar).position };
      });
      expect(positions.scrollTop).toBe(200);
      expect(positions.position).toBe("static");
      expect(positions.after.header).toBe(positions.before.header);
      expect(positions.after.toolbar).toBe(positions.before.toolbar - 200);
    } finally { await page.close(); }
  });

  it("allows a parent to own scrolling without an additional body scroller", async () => {
    const page = await openFixture(1024, "reduce", { primitives: true, scrollable: false });
    try {
      expect(await page.locator("[data-page-body]").getAttribute("data-page-scroll")).toBe("parent");
      expect(await page.locator("[data-page-body]").evaluate((element) => getComputedStyle(element).overflowY)).toBe("visible");
      expect(await page.getByRole("main").evaluate((element) => getComputedStyle(element).overflowY)).toBe("auto");
    } finally { await page.close(); }
  });

  it.each([
    { viewport: 320, hasTouch: false }, { viewport: 375, hasTouch: true },
    { viewport: 767, hasTouch: false }, { viewport: 768, hasTouch: false },
    { viewport: 1440, hasTouch: false }, { viewport: 1440, hasTouch: true },
  ])("uses the approved scale at $viewport px, touch=$hasTouch, without overlapping targets", async ({ viewport, hasTouch }) => {
    const page = await openFixture(viewport, "reduce", { primitives: true, hasTouch });
    try {
      const touch = viewport < 768 || hasTouch;
      expect(await page.evaluate(() => matchMedia("(any-pointer: coarse)").matches)).toBe(hasTouch);
      for (const [size, desktop] of [["standard", 36], ["default", 36], ["sm", 32], ["lg", 40], ["icon", 36], ["compact", 32]] as const) {
        const target = await targetSize(page, `[data-testid="size-${size}"]`);
        expect(target.height, size).toBe(touch ? 44 : desktop);
        expect(target.width, size).toBeGreaterThanOrEqual(touch ? 44 : desktop);
        if (size === "icon") expect(target.width).toBe(touch ? 44 : desktop);
        const styles = await page.getByTestId(`size-${size}`).evaluate(element => {
          const style = getComputedStyle(element);
          return { radius: style.borderRadius, font: style.fontSize, padding: style.paddingLeft };
        });
        expect(styles.radius).toBe("6px");
        expect(styles.font).toBe(size === "sm" || size === "compact" ? "13px" : "14px");
        expect(styles.padding).toBe(`${{ standard: 12, default: 12, sm: 10, lg: 16, icon: 6, compact: 8 }[size]}px`);
      }
      for (const id of ["size-destructive", "size-outline", "neutral", "selected", "disabled", "navigation"]) {
        expect((await targetSize(page, `[data-testid="${id}"]`)).height).toBe(touch ? 44 : 36);
      }
      if (touch) expect(await targetSize(page, '[data-testid="touch-override"]')).toEqual({ width: 44, height: 44 });
      expect(await page.getByTestId("icon-gap").evaluate(element => {
        const label = element.querySelector("[data-button-label]")!;
        const icon = label.querySelector("svg")!;
        return { gap: getComputedStyle(label).columnGap, margin: getComputedStyle(icon).marginRight, icon: icon.getBoundingClientRect().width };
      })).toEqual({ gap: "6px", margin: "0px", icon: 16 });
      const group = page.getByRole("group", { name: "Creation mode" });
      expect(await group.getByRole("button").count()).toBe(3);
      expect(await group.evaluate((element, minimum) => {
        const boxes = Array.from(element.querySelectorAll("button"), button => button.getBoundingClientRect());
        const container = element.getBoundingClientRect();
        return boxes.every((box, i) => box.height >= minimum && box.left >= container.left && box.right <= container.right && box.top >= container.top && box.bottom <= container.bottom &&
          boxes.slice(i + 1).every(other => box.right <= other.left || other.right <= box.left || box.bottom <= other.top || other.bottom <= box.top));
      }, touch ? 44 : 32)).toBe(true);
      if (viewport === 1440) expect((await group.boundingBox())!.height).toBe(touch ? 52 : 40);
      if (hasTouch) {
        await group.getByRole("button", { name: "Idea", exact: true }).tap();
        expect(await group.getByRole("button", { name: "Idea", exact: true }).getAttribute("aria-pressed")).toBe("true");
      }
      const tools = page.getByRole("group", { name: "Article formatting toolbar" });
      const controls = tools.locator("button, select, input");
      expect(await controls.count()).toBe(24);
      const boxes = await controls.evaluateAll(elements => elements.map(element => {
        const target = element.matches('input[type="color"]') ? element.closest("label")! : element;
        const box = target.getBoundingClientRect();
        return { height: box.height, left: box.left, right: box.right };
      }));
      for (const [index, box] of boxes.entries()) {
        expect(box.height).toBe(touch ? 44 : 32);
        if (index) expect(box.left).toBeGreaterThanOrEqual(boxes[index - 1].right);
      }
      const tabs = page.getByRole("tablist", { name: "Sizing tabs" });
      for (const tab of await tabs.getByRole("tab").all()) expect((await tab.boundingBox())!.height).toBe(touch ? 44 : 32);
      expect((await tabs.boundingBox())!.height).toBe(touch ? 52 : 40);
      await tabs.getByRole("tab", { name: "First", exact: true }).focus();
      await page.keyboard.press("ArrowRight");
      await browserExpect(tabs.getByRole("tab", { name: "Second", exact: true })).toBeFocused();
      expect((await page.getByRole("button", { name: "Subscribe", exact: true }).boundingBox())!.height).toBe(touch ? 44 : 40);
      expect((await page.getByRole("textbox", { name: "Email address", exact: true }).boundingBox())!.height).toBe(44);
      const calendar = page.locator(".calendar-picker");
      const dates = await calendar.locator("td button").evaluateAll(elements => elements.map(element => {
        const box = element.getBoundingClientRect(), cell = element.closest("td")!.getBoundingClientRect();
        return { x: box.x, y: box.y, right: box.right, bottom: box.bottom, width: box.width, height: box.height, cellWidth: cell.width, cellHeight: cell.height };
      }));
      expect(dates.length).toBeGreaterThanOrEqual(28);
      for (const [index, date] of dates.entries()) {
        for (const size of [date.width, date.height, date.cellWidth, date.cellHeight]) expect(size).toBe(touch ? 44 : 36);
        expect(dates.slice(index + 1).every(other => date.right <= other.x || other.right <= date.x || date.bottom <= other.y || other.bottom <= date.y)).toBe(true);
      }
      await expectNoLocalClipping(page);
    } finally { await page.close(); }
  });

  it.each(["reduce", "no-preference"] as const)("uses explicit primary hover/active, neutral secondary and separate selected states with motion=%s", async (motion) => {
    const page = await openFixture(1280, motion, { primitives: true });
    try {
      const primary = page.getByTestId("size-default");
      expect(await primary.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(await tokenColor(page, "primary"));
      await primary.hover();
      await browserExpect.poll(() => primary.evaluate((element) => element.matches(":hover")), paintOptions).toBe(true);
      await browserExpect.poll(() => primary.evaluate((element) => getComputedStyle(element).backgroundColor), paintOptions).toBe(await tokenColor(page, "primary-hover"));
      await page.mouse.down();
      try {
        await browserExpect.poll(() => primary.evaluate((element) => element.matches(":active")), paintOptions).toBe(true);
        await browserExpect.poll(() => primary.evaluate((element) => getComputedStyle(element).backgroundColor), paintOptions).toBe(await tokenColor(page, "primary-active"));
      } finally { await page.mouse.up(); }
      await browserExpect.poll(() => primary.evaluate((element) => getComputedStyle(element).backgroundColor), paintOptions).toBe(await tokenColor(page, "primary-hover"));
      await page.mouse.move(0, 0);
      await browserExpect.poll(() => primary.evaluate((element) => getComputedStyle(element).backgroundColor), paintOptions).toBe(await tokenColor(page, "primary"));
      for (const [id, background, foreground] of [["neutral", "secondary", "secondary-foreground"], ["selected", "accent", "accent-foreground"], ["disabled", "muted", "muted-foreground"]]) {
        const control = page.getByTestId(id);
        expect(await control.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(await tokenColor(page, background));
        expect(await control.evaluate((element) => getComputedStyle(element).color)).toBe(await tokenColor(page, foreground));
      }
      await primary.focus();
      await page.keyboard.press("Tab");
      const focused = page.getByTestId("size-sm");
      const ring = await focused.evaluate((element) => {
        const styles = getComputedStyle(element);
        return { visible: element.matches(":focus-visible"), offset: styles.getPropertyValue("--tw-ring-offset-width") };
      });
      expect(ring.visible).toBe(true);
      expect(ring.offset).toBe("2px");
      await browserExpect.poll(() => focused.evaluate((element) => getComputedStyle(element).boxShadow), paintOptions).toContain(await tokenColor(page, "ring"));
      await browserExpect.poll(() => focused.evaluate((element) => getComputedStyle(element).boxShadow), paintOptions).toContain(await tokenColor(page, "background"));
    } finally { await page.close(); }
  });

  it("keeps loading labels/geometry stable and navigation a single guarded link", async () => {
    const page = await openFixture(1280, "reduce", { primitives: true });
    try {
      const save = page.getByRole("button", { name: "Save changes", exact: true });
      const link = page.getByRole("link", { name: "Open drafts", exact: true });
      const before = await targetSize(page, '[data-testid="loading-action"]');
      const linkBefore = await targetSize(page, '[data-testid="navigation"]');
      await link.click();
      expect(await page.getByTestId("navigation-count").textContent()).toBe("1");
      await save.click();
      expect(await save.getAttribute("aria-busy")).toBe("true");
      expect(await save.isDisabled()).toBe(true);
      expect(await targetSize(page, '[data-testid="loading-action"]')).toEqual(before);
      expect(await targetSize(page, '[data-testid="navigation"]')).toEqual(linkBefore);
      expect(await link.getAttribute("aria-disabled")).toBe("true");
      // Native activation and keyboard paths must not invoke the child link handler while busy.
      await link.evaluate((element: HTMLAnchorElement) => element.click());
      await link.focus();
      await page.keyboard.press("Enter");
      expect(await page.getByTestId("navigation-count").textContent()).toBe("1");
      expect(await page.locator("a button, button a, button button, a a").count()).toBe(0);
      await page.getByRole("button", { name: "Finish saving" }).click();
      await link.click();
      expect(await page.getByTestId("navigation-count").textContent()).toBe("2");
    } finally { await page.close(); }
  });

  it.each(["reduce", "no-preference"] as const)("associates unique labels/help/errors/counters with native and Radix controls with motion=%s", async (motion) => {
    const page = await openFixture(1280, motion, { primitives: true });
    try {
      const associations = await page.locator("[data-field]").evaluateAll((fields) => fields.map((field) => {
        const label = field.querySelector("label")!;
        const control = document.getElementById(label.htmlFor)!;
        const described = control.getAttribute("aria-describedby")?.split(/\s+/) ?? [];
        return { id: control.id, label: label.textContent, labelled: control.getAttribute("aria-labelledby")?.includes(label.id), resolved: described.every((id) => document.getElementById(id)), unique: new Set(described).size === described.length, height: control.getBoundingClientRect().height };
      }));
      expect(new Set(associations.map((field) => field.id)).size).toBe(associations.length);
      for (const field of associations) {
        expect(field.labelled, field.label ?? "field").toBe(true);
        expect(field.resolved).toBe(true);
        expect(field.unique).toBe(true);
        expect(field.height).toBeGreaterThanOrEqual(44);
      }
      const title = page.getByRole("textbox", { name: "Post title", exact: true });
      expect(await title.getAttribute("aria-invalid")).toBe("true");
      expect(await title.evaluate((element) => getComputedStyle(element).borderTopColor)).toBe(await tokenColor(page, "destructive"));
      const descriptions = (await title.getAttribute("aria-describedby"))!.split(" ");
      expect(descriptions).toHaveLength(4);
      expect(await page.locator(`[id="${descriptions.at(-1)}"]`).textContent()).toBe("0");
      await page.getByRole("button", { name: "Toggle field error" }).click();
      expect(await title.getAttribute("aria-invalid")).toBe("false");
      expect((await title.getAttribute("aria-describedby"))!.split(" ")).toHaveLength(3);
      expect(await page.getByRole("alert").count()).toBe(0);
      await browserExpect.poll(() => title.evaluate((element) => getComputedStyle(element).borderTopColor), paintOptions).toBe(await tokenColor(page, "input"));
      expect(await title.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(await tokenColor(page, "card"));
      // Reapplying and clearing the error must update paint as well as ARIA.
      for (const invalid of [true, false]) {
        await page.getByRole("button", { name: "Toggle field error" }).click();
        expect(await title.getAttribute("aria-invalid")).toBe(String(invalid));
        await browserExpect.poll(() => title.evaluate((element) => getComputedStyle(element).borderTopColor), paintOptions).toBe(await tokenColor(page, invalid ? "destructive" : "input"));
      }
      await title.focus();
      expect(await title.evaluate((element) => getComputedStyle(element).getPropertyValue("--tw-ring-offset-width"))).toBe("2px");
      await browserExpect.poll(() => title.evaluate((element) => getComputedStyle(element).boxShadow), paintOptions).toContain(await tokenColor(page, "ring"));
      await page.getByRole("combobox", { name: "Native tone" }).selectOption("practical");
      const radix = page.getByRole("combobox", { name: "Radix tone" });
      await radix.focus();
      await page.keyboard.press("ArrowDown");
      await page.getByRole("option", { name: "Practical", exact: true }).click();
      expect(await radix.textContent()).toContain("Practical");
      expect(await page.getByRole("textbox", { name: "Read-only copy" }).inputValue()).toBe("Copy this text");
      expect(await page.getByRole("textbox", { name: "Read-only copy" }).isDisabled()).toBe(false);
    } finally { await page.close(); }
  });

  it("preserves React Hook Form validation and merges external description IDs", async () => {
    const page = await openFixture(1280, "reduce", { primitives: true });
    try {
      await page.getByRole("button", { name: "Validate profile" }).click();
      await page.getByText("Enter a name", { exact: true }).waitFor();
      const input = page.getByRole("textbox", { name: "Profile name", exact: true });
      expect(await input.getAttribute("aria-invalid")).toBe("true");
      const descriptions = (await input.getAttribute("aria-describedby"))!.split(" ");
      expect(descriptions).toHaveLength(4);
      expect(descriptions).toEqual(expect.arrayContaining(["form-extra", "external-help"]));
      expect(await input.evaluate((element) => element.getAttribute("aria-describedby")!.split(" ").every((id) => document.getElementById(id)))).toBe(true);
      await input.fill("Updated profile");
      await page.getByRole("button", { name: "Validate profile" }).click();
      await page.getByText("Enter a name", { exact: true }).waitFor({ state: "hidden" });
      expect(await input.getAttribute("aria-invalid")).toBe("false");
    } finally { await page.close(); }
  });

  it("announces selection and supports native keyboard activation without tab roles", async () => {
    const page = await openFixture(375, "reduce", { primitives: true });
    try {
      const group = page.getByRole("group", { name: "Creation mode" });
      const article = group.getByRole("button", { name: "Article", exact: true });
      const idea = group.getByRole("button", { name: "Idea", exact: true });
      expect(await article.getAttribute("aria-pressed")).toBe("true");
      await article.focus();
      await page.keyboard.press("Tab");
      expect(await idea.evaluate((element) => element === document.activeElement)).toBe(true);
      await page.keyboard.press("Space");
      expect(await idea.getAttribute("aria-pressed")).toBe("true");
      expect(await article.getAttribute("aria-pressed")).toBe("false");
      expect(await group.locator('[aria-pressed="true"]').count()).toBe(1);
      expect(await group.getByRole("tab").count()).toBe(0);
    } finally { await page.close(); }
  });

  it.each([375, 1024])("uses neutral token-radius cards, 12/16/24px densities and heading refs at %spx", async (viewport) => {
    const page = await openFixture(viewport, "reduce", { primitives: true });
    try {
      expect(await page.getByRole("heading", { name: "Section heading", level: 2 }).getAttribute("data-ref-tag")).toBe("H2");
      expect(await page.getByRole("heading", { name: "Nested heading", level: 3 }).getAttribute("data-ref-tag")).toBe("H3");
      expect(await page.getByTestId("compact-header").evaluate((element) => getComputedStyle(element).paddingLeft)).toBe("12px");
      expect(await page.getByTestId("comfortable-header").evaluate((element) => getComputedStyle(element).paddingLeft)).toBe(viewport < 640 ? "16px" : "24px");
      for (const id of ["comfortable-card", "compact-card"]) {
        const style = await page.getByTestId(id).evaluate((element) => {
          const styles = getComputedStyle(element);
          return { radius: styles.borderRadius, borders: [styles.borderTopColor, styles.borderRightColor, styles.borderBottomColor, styles.borderLeftColor] };
        });
        expect(style.radius).toBe("6px");
        expect(style.borders).toEqual(Array(4).fill(await tokenColor(page, "card-border")));
      }
    } finally { await page.close(); }
  });

  it.each([320, 768, 1440])("does not locally clip long labels at 200% text zoom at %spx", async (viewport) => {
    const page = await openFixture(viewport, "reduce", { primitives: true, longText: true });
    try {
      // Text zoom/reflow, not a device-scale-factor screenshot (which cannot expose clipping).
      await page.addStyleTag({ content: "html { font-size: 200%; }" });
      // Do not accept the still-unzoomed frame while reduced-motion transitions settle.
      await browserExpect(page.locator("html")).toHaveCSS("font-size", "32px");
      await browserExpect(page.getByTestId("text-page-title")).toHaveCSS("font-size", "48px");
      await expectNoLocalClipping(page);
      expect(await page.getByTestId("text-page-title").evaluate((element) => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
    } finally { await page.close(); }
  });
});

describe("shared visual and accessibility foundations in Chromium", () => {
  it.each([320, 375, 768, 1024, 1440])("aligns header/body and avoids horizontal overflow at %spx", async (width) => {
    const page = await openFixture(width);
    try {
      const geometry = await page.evaluate(() => {
        const header = document.querySelector("[data-page-header] [data-page-container]")!.getBoundingClientRect();
        const body = document.querySelector("[data-page-body] [data-page-container]")!.getBoundingClientRect();
        return { headerX: header.x, bodyX: body.x, headerWidth: header.width, bodyWidth: body.width, overflow: document.documentElement.scrollWidth > innerWidth };
      });
      expect(geometry.headerX).toBe(geometry.bodyX);
      expect(geometry.headerWidth).toBe(geometry.bodyWidth);
      expect(geometry.overflow).toBe(false);
      for (const selector of ['[data-sidebar="trigger"]', '[data-testid="button-app-footer-legal"]', '[data-testid="link-app-footer-contact"]']) {
        const size = await targetSize(page, selector);
        const minimum = width < 768 || selector.includes("sidebar") ? 44 : 32;
        expect(size.width).toBeGreaterThanOrEqual(minimum);
        expect(size.height).toBeGreaterThanOrEqual(minimum);
      }
    } finally { await page.close(); }
  });

  it("opens legal links by keyboard and restores focus on Escape", async () => {
    const page = await openFixture(390);
    try {
      const trigger = page.getByRole("button", { name: "Legal" });
      await trigger.focus();
      await page.keyboard.press("Enter");
      const menu = page.getByRole("menu", { name: "Legal" });
      await menu.waitFor({ timeout: 5_000 });
      // Radix's opening scale transform briefly shrinks the visual box; measure
      // the settled target rather than sampling an arbitrary animation frame.
      await menu.evaluate(async (element) => {
        await Promise.all(element.getAnimations().map((animation) => animation.finished));
      });
      const links = await menu.getByRole("menuitem").evaluateAll((items) => items.map((item) => ({ href: item.getAttribute("href"), height: item.getBoundingClientRect().height })));
      // The last item reopens the cookie consent banner rather than linking anywhere.
      expect(links.map((link) => link.href)).toEqual(["/privacy", "/terms", "/refund-policy", "/cookies", "/data-retention", "/ai-data-processing", null]);
      for (const link of links) expect(link.height, link.href ?? "legal link").toBeGreaterThanOrEqual(44);
      await page.keyboard.press("ArrowDown");
      expect(await menu.evaluate((element) => element.contains(document.activeElement))).toBe(true);
      await page.keyboard.press("Escape");
      await menu.waitFor({ state: "hidden", timeout: 5_000 });
      expect(await trigger.evaluate((element) => element === document.activeElement)).toBe(true);
    } finally { await page.close(); }
  });

  it("names the inbox sheet with its visible headline and keeps actions working", async () => {
    const page = await openFixture(390);
    const errors: string[] = [];
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    try {
      await page.getByRole("button", { name: "Read article" }).click();
      const dialog = page.getByRole("dialog", { name: "A real article headline" });
      await dialog.waitFor();
      expect(await dialog.getByRole("heading", { name: "A real article headline" }).count()).toBe(1);
      expect(await dialog.getByRole("link", { name: "Open original (opens in a new tab)" }).getAttribute("rel")).toBe("noopener noreferrer");
      for (const selector of ['[data-testid="button-generate-article"]', '[data-testid="button-save-article"]', '[data-testid="button-dismiss-article"]']) {
        expect((await targetSize(page, selector)).height).toBeGreaterThanOrEqual(44);
      }
      const save = dialog.getByTestId("button-save-article");
      await save.click();
      expect(await save.isDisabled()).toBe(true);
      await dialog.getByRole("button", { name: "Dismiss", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      expect(errors.filter((message) => /DialogTitle|accessible name/i.test(message))).toEqual([]);
    } finally { await page.close(); }
  });

  it.each(["reduce", "no-preference"] as const)("renders the empty state immediately with motion=%s", async (motion) => {
    const page = await openFixture(1280, motion);
    try {
      const heading = page.getByRole("heading", { name: "Nothing to review" });
      expect(await heading.isVisible()).toBe(true);
      const styles = await heading.evaluate((element) => {
        const ancestors: string[] = [];
        for (let node: Element | null = element; node; node = node.parentElement) ancestors.push(getComputedStyle(node).opacity);
        return ancestors;
      });
      expect(styles.every((opacity) => opacity === "1")).toBe(true);
      expect(await page.locator("body").evaluate((element) => getComputedStyle(element).fontVariantNumeric)).toBe("tabular-nums");
    } finally { await page.close(); }
  });

  it("preserves selected sidebar ink and 44px targets when collapsed", async () => {
    const page = await openFixture();
    try {
      const link = page.getByRole("link", { name: "Discover", exact: true });
      const before = await link.evaluate((element) => getComputedStyle(element).color);
      expect(await link.getAttribute("aria-current")).toBe("page");
      await page.getByRole("button", { name: "Toggle Sidebar" }).click();
      await page.locator('[data-slot="sidebar"][data-state="collapsed"]').waitFor();
      const size = await targetSize(page, '[data-sidebar="menu-button"]');
      expect(size.width).toBeGreaterThanOrEqual(44);
      expect(size.height).toBeGreaterThanOrEqual(44);
      expect(await link.evaluate((element) => getComputedStyle(element).color)).toBe(before);
      await page.keyboard.press("Tab");
      await link.focus();
      expect(await link.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe("solid");
      expect(await page.locator('[data-sidebar="content"]').evaluate((element) => getComputedStyle(element).overflowY)).toBe("auto");
    } finally { await page.close(); }
  });
});