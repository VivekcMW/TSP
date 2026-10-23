import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PageBody, PageHeader, PageToolbar } from "@/components/dashboard/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, mergeIdRefs } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, Select, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SegmentedControl, SegmentedControlItem } from "@/components/ui/segmented-control";

const h = React.createElement;

describe("foundation primitive markup contracts", () => {
  it.each([
    { width: "reading", className: "max-w-3xl" },
    { width: "standard", className: "max-w-5xl" },
    { width: "workbench", className: "max-w-7xl" },
  ] as const)("shares the $width width and data contract", ({ width, className }) => {
    const markup = renderToStaticMarkup(h(React.Fragment, null,
      h(PageHeader, { title: "Page title", width, stats: 0 }),
      h(PageBody, { width }, "Body"),
    ));
    expect(markup.match(new RegExp(`data-page-width="${width}"`, "g"))).toHaveLength(4);
    expect(markup.match(new RegExp(className, "g"))).toHaveLength(2);
    expect(markup).toContain(">0</div>");
    expect(markup).toContain("text-2xl font-semibold");
  });

  it("retains contentClassName and scroll escape hatches without nested main landmarks", () => {
    const markup = renderToStaticMarkup(h("main", null,
      h(PageHeader, { title: "Page", contentClassName: "max-w-4xl", sticky: false }),
      h(PageBody, { as: "div", contentClassName: "max-w-4xl", scrollable: false, className: "overflow-hidden", "aria-label": "Workspace" }, "Body"),
    ));
    expect(markup.match(/<main/g)).toHaveLength(1);
    expect(markup.match(/max-w-4xl/g)).toHaveLength(2);
    expect(markup).not.toContain("max-w-5xl");
    expect(markup).not.toContain("overflow-y-auto");
    expect(markup).not.toContain("sticky");
    expect(markup).toContain('data-page-scroll="parent"');
    expect(markup).toContain('aria-label="Workspace"');
    expect(renderToStaticMarkup(h(PageBody, { className: "overflow-hidden" }, "Legacy override"))).not.toContain("overflow-y-auto");
  });

  it("keeps secondary filters in an unconstrained non-sticky named group", () => {
    const markup = renderToStaticMarkup(h(PageToolbar, { "aria-label": "Content filters", actions: h(Button, null, "Apply") }, h(Input, { "aria-label": "Search" })));
    expect(markup).toContain('<fieldset aria-label="Content filters"');
    expect(markup).toContain("data-page-filters");
    expect(markup).toContain("data-page-actions");
    expect(markup).toContain("flex-wrap");
    expect(markup).toContain("min-w-0");
    expect(markup).not.toContain("sticky");
    expect(markup).not.toContain('role="toolbar"');
  });

  it.each([
    { size: "standard", geometry: "min-h-9 min-w-9 px-3 py-1.5" },
    { size: "default", geometry: "min-h-9 min-w-9 px-3 py-1.5" },
    { size: "sm", geometry: "min-h-8 min-w-8 px-2.5 py-1" },
    { size: "lg", geometry: "min-h-10 min-w-10 px-4 py-2" },
    { size: "icon", geometry: "min-h-9 min-w-9 p-1.5" },
  ] as const)("keeps $size compact and touch-safe with explicit focus/state classes", ({ size, geometry }) => {
    const classes = buttonVariants({ size });
    expect(classes).toContain(geometry);
    expect(classes).toContain("control-touch-target");
    expect(classes).toContain("gap-1.5");
    expect(classes).toContain("focus-visible:ring-2");
    expect(classes).toContain("focus-visible:ring-offset-2");
    expect(classes).toContain("hover:bg-primary-hover active:bg-primary-active");
    expect(classes).not.toMatch(/bg-primary\/|hover-elevate|active-elevate/);
  });

  it("has an explicit compact size and selected variant separate from secondary", () => {
    expect(buttonVariants({ size: "compact" })).toContain("min-h-8 min-w-8");
    expect(buttonVariants({ variant: "selected" })).toContain("bg-accent text-accent-foreground");
    expect(buttonVariants({ variant: "secondary" })).toContain("bg-secondary text-secondary-foreground");
    expect(buttonVariants({ variant: "outline" })).toContain("border-input");
  });

  it("retains label markup while busy and composes one link, not a nested button", () => {
    const markup = renderToStaticMarkup(h(Button, { asChild: true, loading: true }, h("a", { href: "/drafts" }, "Open drafts")));
    expect(markup.startsWith("<a ")).toBe(true);
    expect(markup).not.toContain("<button");
    expect(markup).not.toContain(' disabled=""');
    expect(markup).toContain('aria-disabled="true"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('data-button-label=""');
    expect(markup).toContain("Open drafts");
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain("motion-reduce:animate-none");
  });

  it("composes, de-duplicates and omits empty ID references", () => {
    expect(mergeIdRefs(" existing  hint ", undefined, "hint error", "")).toBe("existing hint error");
    expect(mergeIdRefs(undefined, " ")).toBeUndefined();
  });

  it("creates unique native field IDs and links only rendered descriptions, including zero counters", () => {
    const markup = renderToStaticMarkup(h(React.Fragment, null,
      h(Field, { label: "First", help: "Help", error: "Error", counter: 0, render: (props) => h(Input, props) }),
      h(Field, { label: "Second", render: (props) => h(Input, props) }),
    ));
    const ids = [...markup.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    const inputs = markup.match(/<input\b[^>]*>/g)!;
    expect(inputs).toHaveLength(2);
    const descriptions = inputs[0].match(/aria-describedby="([^"]+)"/)![1].split(" ");
    expect(descriptions).toHaveLength(3);
    expect(descriptions.every(id => ids.includes(id))).toBe(true);
    expect(inputs[1]).not.toContain("aria-describedby");
    expect(markup.match(/data-info-trigger=""/g)).toHaveLength(1);
    // Help adds its own named trigger; validate every reference, not the
    // incidental total number of IDs/buttons in the rendered component.
    for (const reference of markup.matchAll(/(?:aria-describedby|aria-labelledby|for)="([^"]+)"/g)) {
      expect(reference[1].split(" ").every(id => ids.includes(id))).toBe(true);
    }
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain('aria-invalid="false"');
    expect(markup).toContain(">0</p>");
  });

  it("supports explicit IDs, external ARIA references, and native/Radix selects", () => {
    const markup = renderToStaticMarkup(h(React.Fragment, null,
      h(Field, { id: "tone", label: "Tone", help: "Choose", controlProps: { "aria-describedby": "outside", "aria-invalid": "grammar" }, render: (props) => h(NativeSelect, props, h("option", { value: "neutral" }, "Neutral")) }),
      h(Field, { id: "platform", label: "Platform", render: (props) => h(Select, null, h(SelectTrigger, props, h(SelectValue, { placeholder: "Choose" }))) }),
    ));
    expect(markup).toContain('for="tone"');
    expect(markup).toContain('aria-describedby="outside tone-help"');
    expect(markup).toContain('aria-invalid="grammar"');
    expect(markup).toContain('aria-labelledby="platform-label"');
    expect(markup).toContain('role="combobox"');
  });

  it("uses pressed buttons in a named flexible group with no invented tab semantics", () => {
    const markup = renderToStaticMarkup(h(SegmentedControl, { "aria-label": "Format" },
      h(SegmentedControlItem, { selected: true }, "Article"),
      h(SegmentedControlItem, { selected: false }, "Idea"),
    ));
    expect(markup).toContain('aria-label="Format"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('aria-pressed="false"');
    expect(markup.match(/type="button"/g)).toHaveLength(2);
    expect(markup.match(/min-h-8 min-w-8/g)).toHaveLength(2);
    expect(markup).toContain("flex-wrap");
    expect(markup).not.toContain('role="tab');
  });

  it("uses semantic heading levels and accepts legacy div and heading refs", () => {
    const legacyRef = React.createRef<HTMLDivElement>();
    const headingRef = React.createRef<HTMLHeadingElement>();
    const markup = renderToStaticMarkup(h(Card, { density: "compact" },
      h(CardHeader, null, h(CardTitle, { ref: legacyRef }, "Section")),
      h(CardContent, null, h(CardTitle, { as: "h3", ref: headingRef }, "Subsection")),
    ));
    expect(markup).toContain("<h2");
    expect(markup).toContain("<h3");
    expect(markup).toContain('data-density="compact"');
    expect(markup.match(/p-3/g)).toHaveLength(2);
    expect(markup).toContain("rounded-[var(--radius)]");
    expect(markup).toContain("border-card-border");
    expect(markup).not.toMatch(/border-t-|border-primary|rounded-\[4px\]/);
  });
});