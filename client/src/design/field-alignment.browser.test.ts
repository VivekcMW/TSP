import { readFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import { chromium, expect as browserExpect, type Browser, type Page } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import config from "../../../tailwind.config";

// Run through the exact-file test/ux-priority/run.mjs allowlist.
// Real primitives + actual index.css/tokens/Tailwind, entirely in memory. No app
// bootstrap, server, APIs, environment loading, persistent fixture or webfonts.
// Limits: Chromium/system fallback fonts, emulated touch and root-font reflow;
// not OS picker internals, real-device gestures, assistive technology or pages.
const inputTypes = ["text", "url", "email", "password", "search", "tel", "number", "date", "time", "datetime-local", "month", "week", "file"] as const;

const fixture = String.raw`
  import React, { useRef, useState } from "react";
  import { createRoot } from "react-dom/client";
  import { ChevronDown } from "lucide-react";
  import { Field, fieldControlClassName as sharedField, fieldTriggerClassName, fieldLabelRowClassName } from "@/components/ui/field";
  import { Input } from "@/components/ui/input";
  import { Textarea } from "@/components/ui/textarea";
  import { Button } from "@/components/ui/button";
  import { NativeSelect, Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
  import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select";
  import { SearchableSelect } from "@/components/ui/searchable-select";
  import { Command, CommandInput, CommandList, CommandGroup, CommandItem, CommandEmpty } from "@/components/ui/command";

  const options = globalThis.__fieldOptions || {};
  const longLabel = "A longer translated label with important explanatory words and " + "verylongunbrokenword".repeat(3);
  const countries = ["India", "Singapore", "Japan", "Bosnia and Herzegovina"];

  function NativeChoice(props) {
    return <NativeSelect defaultValue="neutral" {...props}>
      <option value="neutral">Neutral</option><option value="practical">Practical</option>
    </NativeSelect>;
  }
  function RadixChoice({ disabled, ...props }) {
    const [value, setValue] = useState("neutral");
    return <Select value={value} onValueChange={setValue} disabled={disabled}>
      <SelectTrigger disabled={disabled} {...props}><SelectValue /></SelectTrigger>
      <SelectContent><SelectItem value="neutral">Neutral</SelectItem><SelectItem value="practical">Practical</SelectItem></SelectContent>
    </Select>;
  }
  function PickerButton({ children = "Choose", ...props }) {
    return <Button type="button" variant="outline" className={fieldTriggerClassName} {...props}>
      <span data-picker-text="">{children}</span><ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0" />
    </Button>;
  }
  function Pickers({ long = false }) {
    const [selected, setSelected] = useState([]);
    const [country, setCountry] = useState("India");
    return <>
      <div data-picker-grid="" className="grid min-w-0 grid-cols-1 items-start gap-4 md:grid-cols-2">
        <section data-picker="multi" className="grid min-w-0 gap-2">
          <div data-picker-label="" className={fieldLabelRowClassName}><span className="min-w-0 break-words text-sm font-medium leading-5">{long ? longLabel : "Topics"}</span></div>
          <SearchableMultiSelect options={[{ value: "Research" }, { value: "Policy" }, { value: "Design" }]}
            selected={selected} onChange={setSelected} placeholder="Choose" searchPlaceholder="Search topics"
            aria-label="Topics" allowCustom={false} />
        </section>
        <section data-picker="single" className="min-w-0">
          <SearchableSelect label={long ? longLabel : "Region"} value={country} options={countries}
            onChange={setCountry} searchPlaceholder="Search regions" emptyMessage="No region found." />
        </section>
      </div>
      <output data-testid="topics-value">{JSON.stringify(selected)}</output>
      <output data-testid="region-value">{country}</output>
    </>;
  }
  function Commands() {
    const [chosen, setChosen] = useState("");
    return <>
      <Command data-testid="commands">
        <CommandInput aria-label="Find commands" placeholder="Search" />
        <CommandList><CommandEmpty>No command found.</CommandEmpty><CommandGroup>
          <CommandItem value="alpha" onSelect={() => setChosen("alpha")}>Alpha</CommandItem>
          <CommandItem value="beta" onSelect={() => setChosen("beta")}>Beta</CommandItem>
          <CommandItem value="blocked" disabled>Blocked</CommandItem>
        </CommandGroup></CommandList>
      </Command>
      <output data-testid="command-value">{chosen}</output>
    </>;
  }
  function Catalog() {
    const samples = { text: "OK", url: "https://example.invalid", email: "a@b.test", password: "sample", search: "Query", tel: "12345", number: "42", date: "2026-10-01", time: "09:30", "datetime-local": "2026-10-01T09:30", month: "2026-10", week: "2026-W40" };
    return <>
      <Field label="Shared" render={props => <input {...props} className={sharedField} data-surface="shared" data-testid="shared-field" defaultValue="OK" />} />
      <Field label="Choice" render={props => <PickerButton {...props} data-surface="button" data-testid="picker-button" />} />
      <fieldset className="grid min-w-0 gap-4" aria-describedby="alignment-help">
        <legend>Adjacent fields</legend><p id="alignment-help">Equal columns, with and without contextual help.</p>
        {["input", "native", "radix", "textarea"].map(kind => <div key={kind} data-pair={kind} className="grid min-w-0 grid-cols-2 items-start gap-4">
          {[true, false].map(help => <Field key={String(help)} id={kind + (help ? "-helped" : "-plain")}
            label={{ input: "Name", native: "Tone", radix: "Voice", textarea: "Notes" }[kind]}
            help={help ? "Guidance for this field." : undefined}
            render={props => kind === "input" ? <Input {...props} data-surface="input" defaultValue="OK" />
              : kind === "native" ? <NativeChoice {...props} data-surface="native" />
              : kind === "radix" ? <RadixChoice {...props} data-surface="radix" />
              : <Textarea {...props} data-surface="textarea" defaultValue={"First\nSecond"} />} />)}
        </div>)}
      </fieldset>
      <div data-native-catalog="" className="grid min-w-0 gap-4">
        {${JSON.stringify(inputTypes)}.map(type => <Field key={type} label={type} render={props =>
          <Input {...props} type={type} defaultValue={samples[type]} data-native-type={type} data-surface={type} />} />)}
      </div>
      <Pickers /><Commands />
    </>;
  }
  function States() {
    const [invalid, setInvalid] = useState(true);
    const [title, setTitle] = useState("Draft");
    const [body, setBody] = useState("First line\nSecond line");
    const [blockedCalls, setBlockedCalls] = useState(0);
    const inputRef = useRef(null);
    const textareaRef = useRef(null);
    const wiring = { "aria-describedby": "outside-help group-help outside-help", "aria-labelledby": "outside-name outside-name" };
    return <div data-testid="states" data-invalid={invalid} className="grid min-w-0 gap-4">
      <p id="outside-help">External guidance.</p><span id="outside-name">Editorial</span>
      <fieldset className="grid min-w-0 gap-4" aria-describedby="group-help">
        <legend>Editorial fields</legend><p id="group-help">Review these fields together.</p>
        <Field id="state-input" label="Title" help="Keep it specific." counter={0} error={invalid ? "Title required." : undefined} controlProps={wiring}
          render={props => <Input {...props} data-testid="state-input" data-state-control="" ref={inputRef} value={title} onChange={event => setTitle(event.target.value)} />} />
        <Field id="state-textarea" label="Body" help="Keep both lines." counter={0} error={invalid ? "Body required." : undefined} controlProps={wiring}
          render={props => <Textarea {...props} data-testid="state-textarea" data-state-control="" ref={node => { textareaRef.current = node; if (node) node.dataset.refTag = node.tagName; }} value={body} onChange={event => setBody(event.target.value)} />} />
        <Field label="Native state" error={invalid ? "Choose a native value." : undefined} render={props => <NativeChoice {...props} data-state-control="" />} />
        <Field label="Radix state" error={invalid ? "Choose a Radix value." : undefined} render={props => <RadixChoice {...props} data-state-control="" />} />
        <Field label="Picker state" error={invalid ? "Choose a picker value." : undefined} render={props => <PickerButton {...props} data-state-control="" />} />
        <Field label="Read-only title" render={props => <Input {...props} data-testid="readonly-input" readOnly value="Unchanged" />} />
        <Field label="Read-only body" render={props => <Textarea {...props} data-testid="readonly-textarea" readOnly value={"Fixed first\nFixed second"} />} />
        <Field label="Disabled title" render={props => <Input {...props} data-disabled-field="" disabled defaultValue="Blocked" />} />
        <Field label="Disabled body" render={props => <Textarea {...props} data-disabled-field="" disabled defaultValue="Blocked" />} />
        <Field label="Disabled native" render={props => <NativeChoice {...props} data-disabled-field="" disabled />} />
        <Field label="Disabled Radix" render={props => <RadixChoice {...props} data-disabled-field="" disabled />} />
        <Field label="Disabled picker" render={props => <PickerButton {...props} data-testid="disabled-picker" data-disabled-field="" disabled onClick={() => setBlockedCalls(count => count + 1)} />} />
      </fieldset>
      <fieldset disabled className="grid min-w-0 gap-4" aria-describedby="group-help">
        <legend>Unavailable controls</legend>
        <Field label="Inherited input" render={props => <Input {...props} data-testid="inherited-input" defaultValue="Unchanged" />} />
        <Field label="Inherited textarea" render={props => <Textarea {...props} data-testid="inherited-textarea" defaultValue="Unchanged" />} />
      </fieldset>
      <Command data-testid="disabled-command"><CommandInput aria-label="Disabled search" disabled /><CommandList /></Command>
      <Command data-testid="readonly-command"><CommandInput aria-label="Read-only search" readOnly value="Fixed query" /><CommandList /></Command>
      <Button type="button" data-testid="toggle-errors" onClick={() => setInvalid(value => !value)}>Toggle errors</Button>
      <Button type="button" data-testid="focus-input-ref" onClick={() => inputRef.current.focus()}>Focus title ref</Button>
      <Button type="button" data-testid="focus-textarea-ref" onClick={() => textareaRef.current.focus()}>Focus body ref</Button>
      <output data-testid="body-value">{body}</output><output data-testid="title-value">{title}</output>
      <output data-testid="blocked-calls">{blockedCalls}</output>
    </div>;
  }
  function Reflow() {
    return <>
      <div data-reflow-grid="" className="grid min-w-0 grid-cols-1 items-start gap-4 md:grid-cols-2">
        <Field label={longLabel} help="Supplementary guidance stays separate from the visible label." render={props => <Input {...props} data-reflow-control="" defaultValue="OK" />} />
        <Field label={longLabel} render={props => <input {...props} data-reflow-control="" className={sharedField} defaultValue="OK" />} />
        <Field label={longLabel} render={props => <NativeChoice {...props} data-reflow-control="" />} />
        <Field label={longLabel} render={props => <RadixChoice {...props} data-reflow-control="" />} />
        <Field label={longLabel} render={props => <Textarea {...props} data-reflow-control="" defaultValue={"First\nSecond"} />} />
        <Field label={longLabel} render={props => <PickerButton {...props} data-testid="growing-picker" data-reflow-control="">{longLabel}</PickerButton>} />
      </div>
      <Pickers long /><Commands />
    </>;
  }
  createRoot(document.getElementById("root")).render(
    <main data-testid="fixture" className="mx-auto grid w-full min-w-0 max-w-4xl gap-6 p-4">
      {options.mode === "states" ? <States /> : options.mode === "reflow" ? <Reflow /> : <Catalog />}
    </main>
  );
`;

let browser: Browser | undefined;
let script: string;
let css: string;
// ARIA commits and even reduced-motion CSS paints are not the same frame.
const paint = { timeout: 2_000, intervals: [16, 32, 50, 100] };

beforeAll(async () => {
  const root = path.resolve(import.meta.dirname, "../../..");
  const bundle = await build({
    stdin: { contents: fixture, resolveDir: root, loader: "tsx" },
    absWorkingDir: root, alias: { "@": path.join(root, "client/src") },
    bundle: true, write: false, metafile: true, format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"' },
  });
  script = bundle.outputFiles[0].text;
  // Compile every imported local class, including shared class-name constants,
  // rather than relying on another test's incidental Tailwind scan/safelist.
  const sources = Object.keys(bundle.metafile.inputs)
    .map(file => path.resolve(root, file))
    .filter(file => file.startsWith(path.join(root, "client/src") + path.sep));
  const content = [fixture, ...sources.map(file => readFileSync(file, "utf8"))]
    .map(raw => ({ raw, extension: "tsx" }));
  const source = readFileSync(path.join(root, "client/src/index.css"), "utf8")
    .replace('@import "./design/tokens.generated.css";', readFileSync(path.join(root, "client/src/design/tokens.generated.css"), "utf8"));
  css = (await postcss([tailwindcss({ ...config, content })])
    .process(source, { from: path.join(root, "client/src/index.css") })).css;
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => { await browser?.close(); });

interface FixtureOptions {
  width: number;
  hasTouch?: boolean;
  mode?: "catalog" | "states" | "reflow";
  zoom?: boolean;
}

async function withFixture(options: FixtureOptions, check: (page: Page) => Promise<void>) {
  if (!browser) throw new Error("Owned Chromium browser was not initialized");
  const context = await browser.newContext({
    viewport: { width: options.width, height: 900 }, hasTouch: options.hasTouch ?? false,
    reducedMotion: "reduce", serviceWorkers: "block", locale: "en-US", timezoneId: "UTC",
  });
  const unexpectedRequests: string[] = [];
  const runtimeErrors: string[] = [];
  try {
    // Context-level guards include portals/popups. There are NO allowed URLs,
    // including localhost. Record before aborting so failures cannot go silent.
    await context.route("**/*", async route => {
      unexpectedRequests.push(`${route.request().method()} ${route.request().url()}`);
      await route.abort("blockedbyclient");
    });
    await context.routeWebSocket("**/*", socket => {
      unexpectedRequests.push(`WebSocket ${socket.url()}`);
      socket.close();
    });
    context.on("page", page => page.on("pageerror", error => runtimeErrors.push(error.message)));
    const page = await context.newPage();
    page.setDefaultTimeout(5_000);
    // Standards mode, viewport AND text zoom established before React mounts.
    // No overflow overrides, corrected field dimensions, or forced truncation.
    await page.setContent(`<!doctype html><html lang="en" style="font-size:${options.zoom ? "200%" : "100%"}"><head></head><body><div id="root"></div></body></html>`);
    await page.addStyleTag({ content: css });
    await page.evaluate(value => {
      (globalThis as typeof globalThis & { __fieldOptions?: FixtureOptions }).__fieldOptions = value;
    }, options);
    await page.addScriptTag({ content: script });
    await browserExpect(page.getByTestId("fixture")).toBeVisible();
    await browserExpect(page.locator("html")).toHaveCSS("font-size", options.zoom ? "32px" : "16px");
    await check(page);
  } finally {
    // Also closes any owned popup pages, including on setup/assertion failure.
    await context.close();
    expect.soft(unexpectedRequests, "Unexpected network attempts (all blocked)").toEqual([]);
    expect.soft(runtimeErrors, "Fixture runtime errors").toEqual([]);
  }
}

async function palette(page: Page) {
  return page.evaluate(() => {
    const probe = document.createElement("span");
    // Even reduced motion has a 0.01ms transition. Reusing a probe without
    // disabling it samples an intermediate color, not the authored token.
    probe.style.transition = "none";
    document.body.append(probe);
    const colors: Record<string, string> = {};
    for (const token of ["input", "card", "foreground", "muted", "muted-foreground", "destructive", "ring", "background", "accent", "accent-foreground"]) {
      probe.style.color = `hsl(var(--${token}))`;
      colors[token] = getComputedStyle(probe).color;
    }
    probe.remove();
    return colors;
  });
}

async function expectNoClippingOrOverlap(page: Page) {
  await browserExpect.poll(() => page.evaluate(() => {
    const failures: string[] = [];
    const root = document.querySelector<HTMLElement>('[data-testid="fixture"]')!;
    const visible = (element: HTMLElement) => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return element.getClientRects().length > 0 && style.visibility !== "hidden" &&
        !element.closest(".sr-only, [data-info-description]") &&
        !(style.position === "absolute" && box.width <= 1 && box.height <= 1);
    };
    // Checking the document alone would miss index.css's existing body clip.
    // Inspect inner containers, labels and text too; never fix overflow here.
    for (const element of [root, ...root.querySelectorAll<HTMLElement>("*")]) {
      if (!(element instanceof HTMLElement) || !visible(element)) continue;
      const box = element.getBoundingClientRect();
      const name = element.id || element.getAttribute("data-testid") || element.tagName;
      if (box.left < -1 || box.right > innerWidth + 1) failures.push(`${name}: outside viewport`);
      if (element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1) failures.push(`${name}: local horizontal clipping`);
      if (element.matches("label, [data-field-label], [data-button-label], [data-picker-text]") &&
          element.clientHeight > 0 && element.scrollHeight > element.clientHeight + 1) failures.push(`${name}: label vertically clipped`);
      const parent = element.parentElement;
      if (parent && root.contains(parent) && parent.clientWidth > 0 && visible(parent)) {
        const parentBox = parent.getBoundingClientRect();
        if (box.left < parentBox.left - 1 || box.right > parentBox.right + 1) failures.push(`${name}: escapes parent`);
      }
    }
    const targets = Array.from(root.querySelectorAll<HTMLElement>("button, input, select, textarea"))
      .filter(visible).map(element => ({ name: element.id || element.tagName, box: element.getBoundingClientRect() }))
      .filter(({ box }) => box.width > 1 && box.height > 1);
    targets.forEach(({ name, box }, index) => {
      for (const other of targets.slice(index + 1)) {
        if (Math.min(box.right, other.box.right) - Math.max(box.left, other.box.left) > 1 &&
            Math.min(box.bottom, other.box.bottom) - Math.max(box.top, other.box.top) > 1) failures.push(`${name}/${other.name}: targets overlap`);
      }
    });
    if (document.documentElement.scrollWidth > innerWidth + 1) failures.push("document: horizontal overflow");
    return failures;
  }), paint).toEqual([]);
}

async function expectPickerArrows(page: Page) {
  await browserExpect.poll(() => page.evaluate(() => {
    const failures: string[] = [];
    const buttons = document.querySelectorAll<HTMLElement>('[data-testid="picker-button"], [data-testid="growing-picker"], [data-picker] button[role="combobox"]');
    if (buttons.length !== 3) failures.push(`expected three Button-backed pickers, got ${buttons.length}`);
    for (const button of buttons) {
      const box = button.getBoundingClientRect();
      const style = getComputedStyle(button);
      const wrapper = button.querySelector<HTMLElement>(":scope > [data-button-label]");
      const arrow = wrapper?.querySelector<SVGElement>(":scope > svg");
      const text = wrapper?.querySelector<HTMLElement>(":scope > span");
      if (!wrapper || !arrow || !text) { failures.push("picker: missing label wrapper/text/arrow"); continue; }
      const labelBox = wrapper.getBoundingClientRect(), arrowBox = arrow.getBoundingClientRect(), textBox = text.getBoundingClientRect();
      const right = box.right - Number.parseFloat(style.borderRightWidth) - Number.parseFloat(style.paddingRight);
      if (Math.abs(arrowBox.right - right) > 1 || Math.abs(labelBox.right - right) > 1) failures.push("picker: arrow not at right content edge");
      if (textBox.right + Number.parseFloat(getComputedStyle(wrapper).columnGap) > arrowBox.left + 1) failures.push("picker: text overlaps arrow");
      if (arrowBox.width < 16 || arrowBox.height < 16 || box.height < 44) failures.push("picker: shrunken arrow/target");
      if (Math.abs((arrowBox.top + arrowBox.bottom) / 2 - (box.top + box.bottom) / 2) > 1) failures.push("picker: arrow not vertically centered");
    }
    return failures;
  }), paint).toEqual([]);
}

describe("isolated shared field alignment in Chromium", () => {
  const layouts = [
    { width: 320, hasTouch: false }, { width: 375, hasTouch: true },
    { width: 767, hasTouch: false }, { width: 768, hasTouch: false },
    { width: 1440, hasTouch: false }, { width: 1440, hasTouch: true },
  ];

  it.each(layouts)("aligns native and composed fields at $width px, touch=$hasTouch", async options => {
    await withFixture(options, async page => {
      const colors = await palette(page);
      await browserExpect.poll(() => page.evaluate(({ options, colors, inputTypes }) => {
        const failures: string[] = [];
        const touch = options.width < 768 || options.hasTouch;
        const labelHeight = touch ? 44 : 36;
        const close = (actual: number, expected: number) => Math.abs(actual - expected) <= 0.5;
        if (matchMedia("(any-pointer: coarse)").matches !== options.hasTouch) failures.push("coarse-pointer fixture mismatch");
        const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("[data-native-type]"));
        if (inputs.map(input => input.type).join() !== inputTypes.join()) failures.push("native type inventory changed/fell back");
        const surfaces = document.querySelectorAll<HTMLElement>('[data-surface], [data-picker] button[role="combobox"]');
        if (surfaces.length !== 25) failures.push(`expected 25 field surfaces, got ${surfaces.length}`);
        for (const element of surfaces) {
          const box = element.getBoundingClientRect(), style = getComputedStyle(element);
          const name = element.getAttribute("data-surface") || element.getAttribute("aria-label") || "single picker";
          if (element instanceof HTMLTextAreaElement) {
            if (box.height < 80 || close(box.height, 44)) failures.push(`${name}: textarea flattened`);
          } else if (!close(box.height, 44)) failures.push(`${name}: height ${box.height}, expected 44`);
          if (box.height < 44) failures.push(`${name}: below 44px minimum`);
          if (style.borderRadius !== "6px" || [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth].some(value => value !== "1px") ||
              [style.borderTopColor, style.borderRightColor, style.borderBottomColor, style.borderLeftColor].some(value => value !== colors.input)) failures.push(`${name}: shared boundary changed`);
          if (style.paddingLeft !== "12px" || style.paddingRight !== "12px" || style.paddingTop !== "8px" || style.paddingBottom !== "8px") failures.push(`${name}: shared padding changed`);
          // Native appearance retains the OS picker and Chromium reports its
          // internal line-height as normal. Outer geometry is still exact.
          const lineHeight = element instanceof HTMLSelectElement ? "normal" : options.width < 768 ? "24px" : "20px";
          if (style.fontSize !== (options.width < 768 ? "16px" : "14px") || style.lineHeight !== lineHeight || style.fontWeight !== "400") failures.push(`${name}: shared typography changed`);
        }
        // All relative geometry for a row is sampled together, never across
        // separate scrolling/focus operations or in a stale React frame.
        for (const pair of document.querySelectorAll<HTMLElement>("[data-pair]")) {
          const fields = Array.from(pair.querySelectorAll<HTMLElement>(":scope > [data-field]"));
          if (fields.length !== 2) { failures.push("missing adjacent field"); continue; }
          const measurements = fields.map(field => {
            const row = field.querySelector<HTMLElement>("[data-field-label]")!;
            const label = row.querySelector<HTMLLabelElement>("label")!;
            const control = document.getElementById(label.htmlFor)!;
            const help = row.querySelector<HTMLElement>("[data-info-trigger]");
            const rowBox = row.getBoundingClientRect(), controlBox = control.getBoundingClientRect();
            if (!close(rowBox.height, labelHeight)) failures.push(`${pair.dataset.pair}: label row ${rowBox.height}, expected ${labelHeight}`);
            if (!close(controlBox.top - rowBox.bottom, 8)) failures.push(`${pair.dataset.pair}: label/control gap changed`);
            if (help) {
              const helpBox = help.getBoundingClientRect(), labelBox = label.getBoundingClientRect();
              if (helpBox.width < labelHeight || helpBox.height < labelHeight) failures.push("help target below required minimum");
              if (labelBox.right > helpBox.left || helpBox.bottom > rowBox.bottom + 1) failures.push("help overlaps label or control");
            }
            return { field: field.getBoundingClientRect(), row: rowBox, control: controlBox };
          });
          const [left, right] = measurements;
          if (!close(left.field.width, right.field.width) || !close(left.control.width, right.control.width)) failures.push("unequal columns/control widths");
          if (!close(left.control.top, right.control.top) || !close(left.row.height, right.row.height)) failures.push("help/no-help control y misalignment");
          if (left.field.right > right.field.left || left.control.right > right.control.left) failures.push("adjacent fields overlap");
        }
        const single = document.querySelector<HTMLElement>('[data-picker="single"] button[role="combobox"]')!;
        const singleLabel = document.getElementById(single.getAttribute("aria-labelledby")!.split(/\s+/)[0])!;
        const multiLabel = document.querySelector<HTMLElement>("[data-picker-label]")!;
        if (!close(singleLabel.closest(".field-label-row")!.getBoundingClientRect().height, labelHeight) || !close(multiLabel.getBoundingClientRect().height, labelHeight)) failures.push("picker labels do not reserve the shared row");
        if (options.width >= 768) {
          const multi = document.querySelector<HTMLElement>('[data-picker="multi"] button[role="combobox"]')!;
          const a = single.getBoundingClientRect(), b = multi.getBoundingClientRect();
          if (!close(a.top, b.top) || !close(a.width, b.width)) failures.push("picker columns misaligned");
        }
        const command = document.querySelector<HTMLElement>('[data-testid="commands"] [cmdk-input-wrapper]')!;
        const commandInput = command.querySelector<HTMLInputElement>("input")!;
        const commandBox = command.getBoundingClientRect(), inputBox = commandInput.getBoundingClientRect();
        const wrapperStyle = getComputedStyle(command), inputStyle = getComputedStyle(commandInput);
        // CommandInput is a borderless inner input in a 44px bordered search
        // surface, not a second nested field border (43px + 1px separator).
        if (!close(commandBox.height, 44) || commandBox.height < 44 || !close(inputBox.height, 43)) failures.push("command search surface must be 44px including its separator");
        if (wrapperStyle.paddingLeft !== "12px" || wrapperStyle.paddingRight !== "12px" || wrapperStyle.borderBottomWidth !== "1px" || wrapperStyle.borderBottomColor !== colors.input || wrapperStyle.backgroundColor !== colors.card) failures.push("command wrapper boundary/padding changed");
        if (inputStyle.fontSize !== (options.width < 768 ? "16px" : "14px") || inputStyle.lineHeight !== (options.width < 768 ? "24px" : "20px") || inputStyle.paddingTop !== "8px" || inputStyle.paddingBottom !== "8px") failures.push("command typography/padding changed");
        if (inputBox.left < commandBox.left || inputBox.right > commandBox.right || inputBox.bottom > commandBox.bottom) failures.push("command input escapes wrapper");
        return failures;
      }, { options, colors, inputTypes }), paint).toEqual([]);
      await expectPickerArrows(page);
      await expectNoClippingOrOverlap(page);
    });
  });

  it.each([{ width: 375, hasTouch: true }, { width: 1440, hasTouch: false }])("keeps search/select keyboard state local at $width px", async options => {
    await withFixture(options, async page => {
      const single = page.locator('[data-picker="single"] button[role="combobox"]');
      await browserExpect(single).toHaveAccessibleName("Region India");
      await single.focus();
      await page.keyboard.press("Enter");
      await browserExpect(single).toHaveAttribute("aria-expanded", "true");
      const search = page.getByRole("combobox", { name: "Search regions", exact: true });
      await browserExpect(search).toBeFocused();
      await search.fill("singa");
      await browserExpect(page.getByRole("option", { name: "Singapore", exact: true })).toBeVisible();
      await browserExpect(page.getByRole("option", { name: "Bosnia and Herzegovina", exact: true })).toHaveCount(0);
      await page.keyboard.press("ArrowDown");
      await browserExpect(page.getByRole("option", { name: "Singapore", exact: true })).toHaveAttribute("aria-selected", "true");
      await page.keyboard.press("Enter");
      await browserExpect(page.getByTestId("region-value")).toHaveText("Singapore");
      await browserExpect(single).toHaveAccessibleName("Region Singapore");
      await browserExpect(single).toHaveAttribute("aria-expanded", "false");
      await browserExpect(single).toBeFocused();
      await page.keyboard.press("Space");
      await browserExpect(search).toBeFocused();
      await search.fill("no-such-region");
      await browserExpect(page.getByText("No region found.", { exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await browserExpect(single).toBeFocused();
      await browserExpect(page.getByTestId("region-value")).toHaveText("Singapore");

      const multi = page.getByRole("combobox", { name: "Topics", exact: true });
      await multi.focus();
      await page.keyboard.press("Enter");
      const topicSearch = page.getByRole("combobox", { name: "Search topics", exact: true });
      await browserExpect(topicSearch).toBeFocused();
      await topicSearch.fill("Research");
      const research = page.getByRole("option", { name: /^Research/ });
      const topicList = page.getByRole("listbox").filter({ has: research });
      await browserExpect(topicList.getByRole("option")).toHaveCount(1);
      await page.keyboard.press("ArrowDown");
      await browserExpect(research).toHaveAttribute("aria-selected", "true");
      await page.keyboard.press("Enter");
      await browserExpect(page.getByTestId("topics-value")).toHaveText('["Research"]');
      await browserExpect(multi).toContainText("1 selected");
      await browserExpect(research).toHaveAccessibleName("Research Selected");
      const colors = await palette(page);
      await browserExpect.poll(() => research.evaluate(element => {
        const style = getComputedStyle(element);
        return { background: style.backgroundColor, color: style.color };
      }), paint).toEqual({ background: colors.accent, color: colors["accent-foreground"] });
      await page.keyboard.press("Enter");
      await browserExpect(page.getByTestId("topics-value")).toHaveText("[]");
      await browserExpect(research).toHaveAccessibleName("Research");
      await page.keyboard.press("Escape");
      await browserExpect(multi).toHaveAttribute("aria-expanded", "false");
      await browserExpect(multi).toBeFocused();

      const native = page.locator("#native-plain");
      await native.selectOption("practical");
      await browserExpect(native).toHaveValue("practical");
      const radix = page.locator("#radix-plain");
      await radix.focus();
      await page.keyboard.press("Enter");
      const radixList = page.getByRole("listbox").filter({ has: page.getByRole("option", { name: "Neutral", exact: true }) });
      await browserExpect(radixList.getByRole("option", { name: "Neutral", exact: true })).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await browserExpect(radixList.getByRole("option", { name: "Practical", exact: true })).toBeFocused();
      await page.keyboard.press("Enter");
      await browserExpect(radix).toContainText("Practical");
      await browserExpect(radix).toHaveAttribute("aria-expanded", "false");
      await browserExpect(radix).toBeFocused();

      const command = page.getByRole("combobox", { name: "Find commands", exact: true });
      await command.fill("Beta");
      await browserExpect(page.getByTestId("commands").getByRole("option")).toHaveCount(1);
      await page.keyboard.press("ArrowDown");
      await browserExpect(page.getByTestId("commands").getByRole("option", { name: "Beta", exact: true })).toHaveAttribute("aria-selected", "true");
      await page.keyboard.press("Enter");
      await browserExpect(page.getByTestId("command-value")).toHaveText("beta");
      await browserExpect.poll(() => page.locator('[data-testid="commands"] [cmdk-input-wrapper]').evaluate(element => getComputedStyle(element).boxShadow), paint).toContain(colors.ring);
      await command.fill("Blocked");
      await browserExpect(page.getByTestId("commands").getByRole("option", { name: "Blocked", exact: true })).toHaveAttribute("aria-disabled", "true");
      await page.keyboard.press("Enter");
      await browserExpect(page.getByTestId("command-value")).toHaveText("beta");
      await expectPickerArrows(page);
      await expectNoClippingOrOverlap(page);
    });
  });

  it("preserves read-only/disabled paint and reversible error/focus states", async () => {
    await withFixture({ width: 1440, mode: "states" }, async page => {
      const colors = await palette(page);
      for (const [id, value] of [["readonly-input", "Unchanged"], ["readonly-textarea", "Fixed first\nFixed second"]]) {
        const control = page.getByTestId(id);
        await browserExpect(control).toBeEnabled();
        await browserExpect(control).toHaveAttribute("readonly", "");
        await control.focus();
        await page.keyboard.press("End");
        await page.keyboard.press("x");
        await browserExpect(control).toHaveValue(value);
        await browserExpect.poll(() => control.evaluate(element => getComputedStyle(element).backgroundColor), paint).toBe(colors.muted);
      }
      const disabled = page.locator("[data-disabled-field]");
      await browserExpect(disabled).toHaveCount(5);
      for (const control of await disabled.all()) await browserExpect(control).toBeDisabled();
      await browserExpect.poll(() => disabled.evaluateAll(elements => elements.map(element => {
        const style = getComputedStyle(element);
        return { background: style.backgroundColor, color: style.color, cursor: style.cursor };
      })), paint).toEqual(Array.from({ length: 5 }, () => ({ background: colors.muted, color: colors["muted-foreground"], cursor: "not-allowed" })));
      await page.getByTestId("disabled-picker").evaluate((element: HTMLButtonElement) => element.click());
      await browserExpect(page.getByTestId("blocked-calls")).toHaveText("0");
      await browserExpect(page.getByRole("combobox", { name: "Disabled search" })).toBeDisabled();
      await browserExpect(page.getByRole("combobox", { name: "Disabled search" })).toHaveCSS("opacity", "0.5");
      const readOnlySearch = page.getByRole("combobox", { name: "Read-only search" });
      await readOnlySearch.focus();
      await page.keyboard.press("x");
      await browserExpect(readOnlySearch).toHaveValue("Fixed query");

      const controls = page.locator("[data-state-control]");
      await browserExpect(controls).toHaveCount(5);
      for (const [index, invalid] of [true, false, true, false].entries()) {
        if (index > 0) await page.getByTestId("toggle-errors").click();
        await browserExpect(page.getByTestId("states")).toHaveAttribute("data-invalid", String(invalid));
        await browserExpect(page.getByRole("alert")).toHaveCount(invalid ? 5 : 0);
        await browserExpect.poll(() => controls.evaluateAll(elements => elements.map(element => ({
          invalid: element.getAttribute("aria-invalid"), border: getComputedStyle(element).borderTopColor,
        }))), paint).toEqual(Array.from({ length: 5 }, () => ({ invalid: String(invalid), border: colors[invalid ? "destructive" : "input"] })));
      }
      // Establish keyboard modality before focusing button-backed controls.
      await page.keyboard.press("Tab");
      for (const control of await controls.all()) {
        await control.focus();
        await browserExpect(control).toBeFocused();
        await browserExpect.poll(() => control.evaluate(element => {
          const style = getComputedStyle(element);
          return { visible: element.matches(":focus-visible"), offset: style.getPropertyValue("--tw-ring-offset-width") };
        }), paint).toEqual({ visible: true, offset: "2px" });
        await browserExpect.poll(() => control.evaluate(element => getComputedStyle(element).boxShadow), paint).toContain(colors.ring);
        await browserExpect.poll(() => control.evaluate(element => getComputedStyle(element).boxShadow), paint).toContain(colors.background);
      }
      await expectNoClippingOrOverlap(page);
    });
  });

  it("retains textarea/input refs, controlled multiline values and Field/fieldset ARIA associations", async () => {
    await withFixture({ width: 375, hasTouch: true, mode: "states" }, async page => {
      await browserExpect(page.getByRole("group", { name: "Editorial fields", exact: true })).toHaveAccessibleDescription("Review these fields together.");
      await browserExpect(page.getByRole("group", { name: "Unavailable controls", exact: true })).toHaveAccessibleDescription("Review these fields together.");
      await browserExpect(page.getByTestId("inherited-input")).toBeDisabled();
      await browserExpect(page.getByTestId("inherited-textarea")).toBeDisabled();
      await browserExpect(page.locator("label button, label [data-info-trigger]")).toHaveCount(0);
      await browserExpect.poll(() => page.locator("[data-field]").evaluateAll(fields => {
        const failures: string[] = [], controls: string[] = [];
        if (fields.length !== 14) failures.push(`expected 14 labelled fields, got ${fields.length}`);
        for (const field of fields) {
          const label = field.querySelector<HTMLLabelElement>("label")!;
          const control = document.getElementById(label.htmlFor);
          if (!control) { failures.push("missing labelled control"); continue; }
          controls.push(control.id);
          for (const attribute of ["aria-labelledby", "aria-describedby"]) {
            const ids = control.getAttribute(attribute)?.split(/\s+/) ?? [];
            if (new Set(ids).size !== ids.length || ids.some(id => !document.getElementById(id))) failures.push(`${control.id}: broken ${attribute}`);
            if (attribute === "aria-labelledby" && !ids.includes(label.id)) failures.push(`${control.id}: missing Field label`);
          }
        }
        if (new Set(controls).size !== controls.length) failures.push("duplicate control IDs");
        const ids = Array.from(document.querySelectorAll("[id]"), element => element.id);
        if (new Set(ids).size !== ids.length) failures.push("duplicate DOM IDs");
        return failures;
      }), paint).toEqual([]);
      const textarea = page.getByTestId("state-textarea");
      await browserExpect(textarea).toHaveAccessibleName("Body Editorial");
      await browserExpect(textarea).toHaveAccessibleDescription("External guidance. Review these fields together. Keep both lines. Body required. 0");
      await browserExpect(textarea).toHaveAttribute("data-ref-tag", "TEXTAREA");
      await page.getByTestId("focus-textarea-ref").click();
      await browserExpect(textarea).toBeFocused();
      await textarea.fill("Updated first\nUpdated second");
      await browserExpect(textarea).toHaveValue("Updated first\nUpdated second");
      await browserExpect(page.getByTestId("body-value")).toHaveText("Updated first\nUpdated second");
      await browserExpect.poll(() => textarea.evaluate(element => element.getBoundingClientRect().height), paint).toBeGreaterThanOrEqual(80);
      await page.getByTestId("focus-input-ref").click();
      const input = page.getByTestId("state-input");
      await browserExpect(input).toBeFocused();
      await input.fill("Revised");
      await browserExpect(page.getByTestId("title-value")).toHaveText("Revised");
      await page.getByTestId("toggle-errors").click();
      await browserExpect(textarea).toHaveAttribute("aria-invalid", "false");
      await browserExpect(textarea).toHaveAccessibleDescription("External guidance. Review these fields together. Keep both lines. 0");
      await browserExpect(page.locator("#state-textarea-error")).toHaveCount(0);
      await browserExpect.poll(() => textarea.getAttribute("aria-describedby"), paint).toBe("outside-help group-help state-textarea-help state-textarea-counter");
      await browserExpect(textarea).toHaveValue("Updated first\nUpdated second");
      await expectNoClippingOrOverlap(page);
    });
  });

  it.each([{ width: 320, hasTouch: false }, { width: 768, hasTouch: false }, { width: 1440, hasTouch: true }])("allows long-label growth without clipping at 200% root font, $width px, touch=$hasTouch", async options => {
    await withFixture({ ...options, mode: "reflow", zoom: true }, async page => {
      await browserExpect.poll(() => page.evaluate(() => {
        const failures: string[] = [];
        const fields = document.querySelectorAll<HTMLElement>("[data-reflow-grid] [data-field]");
        if (fields.length !== 6) failures.push("missing reflow fields");
        for (const field of fields) {
          const row = field.querySelector<HTMLElement>("[data-field-label]")!;
          const label = row.querySelector<HTMLLabelElement>("label")!;
          const control = document.getElementById(label.htmlFor)!;
          const rowBox = row.getBoundingClientRect(), labelBox = label.getBoundingClientRect(), box = control.getBoundingClientRect();
          if (getComputedStyle(label).fontSize !== "28px") failures.push("label is not actually at 200% text size");
          if (rowBox.height <= 44 || labelBox.height <= 40) failures.push("long label did not grow/wrap");
          if (labelBox.bottom > rowBox.bottom + 1 || rowBox.bottom > box.top) failures.push("grown label overlaps control");
          if (box.height < (control instanceof HTMLTextAreaElement ? 160 : 88)) failures.push("rem-based field minimum did not grow");
          const help = row.querySelector<HTMLElement>("[data-info-trigger]");
          if (help) {
            const helpBox = help.getBoundingClientRect();
            if (helpBox.width < 44 || helpBox.height < 44 || labelBox.right > helpBox.left) failures.push("zoomed help target shrank/overlapped label");
          }
        }
        const button = document.querySelector<HTMLElement>('[data-testid="growing-picker"]')!;
        if (button.getBoundingClientRect().height <= 88) failures.push("long picker label did not grow beyond its minimum");
        const searches = document.querySelectorAll<HTMLElement>('[data-picker] button[role="combobox"], [data-testid="commands"] [cmdk-input-wrapper]');
        if (searches.length !== 3) failures.push("missing zoomed search surfaces");
        for (const search of searches) {
          if (search.getBoundingClientRect().height < 88) failures.push("search surface did not grow with the root font");
        }
        return failures;
      }), paint).toEqual([]);
      await expectPickerArrows(page);
      await expectNoClippingOrOverlap(page);
    });
  });
});