import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import config from "../../../tailwind.config";
import { darkColors, invariant, lightColors } from "./tokens";

type RGB = [number, number, number];

function rgb(triplet: string): RGB {
  const [h, s, l] = triplet.split(/\s+/).map(Number.parseFloat);
  const saturation = s / 100;
  const lightness = l / 100;
  const a = saturation * Math.min(lightness, 1 - lightness);
  const channel = (offset: number) => {
    const k = (offset + h / 30) % 12;
    return lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [channel(0), channel(8), channel(4)];
}

function luminance(channels: RGB) {
  const [r, g, b] = channels.map((c) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: RGB, b: RGB) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function composite(front: RGB, back: RGB, alpha: number): RGB {
  return front.map((channel, i) => channel * alpha + back[i] * (1 - alpha)) as RGB;
}

describe.each([['light', lightColors], ['dark', darkColors]] as const)("%s contrast foundations", (_theme, tokens) => {
  it.each(["background", "card", "popover", "muted", "accent"] as const)("gold text passes WCAG AA on %s", (surface) => {
    expect(contrast(rgb(tokens["secondary-text"]), rgb(tokens[surface]))).toBeGreaterThanOrEqual(4.5);
  });

  it.each([0.05, 0.1, 0.15, 0.2, 0.3])("gold text passes on gold-tinted surfaces at %s opacity", (alpha) => {
    for (const surface of ["background", "card"] as const) {
      const background = composite(rgb(tokens.secondary), rgb(tokens[surface]), alpha);
      expect(contrast(rgb(tokens["secondary-text"]), background)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(["sidebar", "sidebar-accent", "surface-ink"] as const)("bright gold stays legible on permanent dark %s", (surface) => {
    expect(contrast(rgb(tokens["secondary-on-dark"]), rgb(tokens[surface]))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(["sidebar", "sidebar-accent", "sidebar-primary"] as const)("sidebar focus indicator contrasts with %s", (surface) => {
    expect(contrast(rgb(tokens["sidebar-ring"]), rgb(tokens[surface]))).toBeGreaterThanOrEqual(3);
  });

  it("preserves readable text on gold buttons", () => {
    expect(contrast(rgb(tokens["secondary-foreground"]), rgb(tokens.secondary))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(["background", "card", "popover", "muted"] as const)("helper text passes on %s", (surface) => {
    expect(contrast(rgb(tokens["muted-foreground"]), rgb(tokens[surface]))).toBeGreaterThanOrEqual(4.5);
  });
});

describe("generated utility contracts", () => {
  it("keeps Poppins headings, legacy font-serif, and Inter body", () => {
    expect(invariant["font-heading"]).toBe("Poppins, system-ui, sans-serif");
    expect(invariant["font-serif"]).toBe(invariant["font-heading"]);
    expect(invariant["font-sans"]).toBe("Inter, system-ui, sans-serif");
    expect(Number.parseFloat(invariant["touch-target"]) * 16).toBeGreaterThanOrEqual(44);
  });

  it("compiles distinct gold text/fill mappings, heading alias, and collapsed sizing", async () => {
    const result = await postcss([tailwindcss({ ...config, content: [{ raw: 'text-secondary hover:text-secondary text-secondary/80 text-secondary-foreground bg-secondary font-heading font-serif group-data-[collapsible=icon]:!w-11 group-data-[collapsible=icon]:!h-11' }] })]).process("@tailwind utilities;", { from: undefined });
    const declarations = (selector: string) => {
      const values: string[] = [];
      result.root.walkRules(selector, (rule) => { rule.walkDecls((decl) => { values.push(`${decl.prop}: ${decl.value}`); }); });
      return values.join(";");
    };
    expect(declarations(".text-secondary")).toContain("var(--secondary-text)");
    expect(declarations(".hover\\:text-secondary:hover")).toContain("var(--secondary-text)");
    expect(declarations(".text-secondary\\/80")).toContain("var(--secondary-text) / 0.8");
    expect(declarations(".text-secondary-foreground")).toContain("var(--secondary-foreground)");
    expect(declarations(".bg-secondary")).toContain("var(--secondary)");
    expect(declarations(".font-heading")).toContain("var(--font-heading)");
    expect(declarations(".font-serif")).toContain("var(--font-serif)");
    expect(result.css).toContain("width: 2.75rem !important");
    expect(result.css).toContain("height: 2.75rem !important");
  });

  it("scopes dark-surface gold ink without a page-dependent dialog override", () => {
    const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");
    expect(css).toContain('[data-sidebar="sidebar"], .bg-surface-ink');
    expect(css).toContain("--secondary-text: var(--secondary-on-dark)");
    expect(css).toContain("font-variant-numeric: tabular-nums");
    expect(css).not.toContain("body:has");
  });
});