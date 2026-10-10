import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import config from "../../../tailwind.config";
import { darkColors, invariant, lightColors, lightEffects } from "./tokens";

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
  it.each(["background", "card", "popover", "muted", "accent", "secondary", "secondary-hover"] as const)("body and neutral helper ink pass WCAG AA on %s", (surface) => {
    for (const ink of ["foreground", "secondary-text", "muted-foreground"] as const) {
      expect(contrast(rgb(tokens[ink]), rgb(tokens[surface]))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each([0.05, 0.1, 0.15, 0.2, 0.3])("compatibility neutral ink passes on secondary tints at %s opacity", (alpha) => {
    for (const surface of ["background", "card"] as const) {
      const background = composite(rgb(tokens.secondary), rgb(tokens[surface]), alpha);
      expect(contrast(rgb(tokens["secondary-text"]), background)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(["sidebar", "sidebar-accent", "surface-ink"] as const)("light navigation and compatibility ink stay legible on %s", (surface) => {
    for (const ink of ["sidebar-foreground", "sidebar-accent-foreground", "secondary-on-dark"] as const) {
      expect(contrast(rgb(tokens[ink]), rgb(tokens[surface]))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(["sidebar", "sidebar-accent", "card", "background", "muted"] as const)("focus indicator contrasts with adjacent %s", (surface) => {
    expect(contrast(rgb(tokens["sidebar-ring"]), rgb(tokens[surface]))).toBeGreaterThanOrEqual(3);
  });

  it("preserves readable text on neutral secondary actions", () => {
    expect(contrast(rgb(tokens["secondary-foreground"]), rgb(tokens.secondary))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(rgb(tokens["secondary-foreground"]), rgb(tokens["secondary-hover"]))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(["primary", "primary-hover", "primary-active"] as const)("white action text passes on opaque %s", (state) => {
    expect(contrast(rgb(tokens["primary-foreground"]), rgb(tokens[state]))).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps selected text readable and its marker distinct", () => {
    expect(contrast(rgb(tokens["accent-foreground"]), rgb(tokens.accent))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(rgb(tokens.primary), rgb(tokens.accent))).toBeGreaterThanOrEqual(3);
  });

  it("distinguishes progress fill and slider thumbs from their neutral track", () => {
    expect(contrast(rgb(tokens.primary), rgb(tokens.muted))).toBeGreaterThanOrEqual(3);
    expect(contrast(rgb(tokens.input), rgb(tokens.muted))).toBeGreaterThanOrEqual(3);
    expect(contrast(rgb(tokens.card), rgb(tokens.primary))).toBeGreaterThanOrEqual(3);
    expect(contrast(rgb(tokens["success-foreground"]), rgb(tokens.success))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(["card", "background", "muted"] as const)("essential boundaries meet 3:1 on %s", (surface) => {
    expect(contrast(rgb(tokens.input), rgb(tokens[surface]))).toBeGreaterThanOrEqual(3);
    expect(lightEffects["button-outline"]).toBe("hsl(var(--input))");
    // Decorative dividers deliberately do not stand in for control boundaries.
    expect(contrast(rgb(tokens.border), rgb(tokens[surface]))).toBeLessThan(3);
  });

  it.each(["success", "destructive", "warning", "info"] as const)("%s subtle messages use semantic ink, never white", (state) => {
    const surface = rgb(tokens[`${state}-subtle`]);
    expect(contrast(rgb(tokens[state]), surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(rgb(tokens["primary-foreground"]), surface)).toBeLessThan(4.5);
  });

  it("requires light separation around focus on solid cobalt", () => {
    const focus = rgb(tokens.ring);
    const offset = rgb(tokens.card);
    expect(contrast(focus, rgb(tokens.primary))).toBeCloseTo(1, 5);
    expect(contrast(focus, offset)).toBeGreaterThanOrEqual(3);
    for (const state of ["primary", "primary-hover", "primary-active", "sidebar-primary"] as const) {
      expect(contrast(offset, rgb(tokens[state]))).toBeGreaterThanOrEqual(3);
    }
  });

  it.each([0.03, 0.08])("legacy neutral elevation at %s alpha retains readable text", (alpha) => {
    for (const surface of ["card", "secondary", "accent"] as const) {
      const background = composite([0, 0, 0], rgb(tokens[surface]), alpha);
      for (const ink of ["foreground", "muted-foreground"] as const) {
        // The ::after overlay is above both text and background.
        expect(contrast(composite([0, 0, 0], rgb(tokens[ink]), alpha), background)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("tests translucent sidebar labels against their actual white surface", () => {
    const surface = rgb(tokens.sidebar);
    expect(contrast(composite(rgb(tokens["sidebar-foreground"]), surface, 0.7), surface)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps overlay contents opaque above the composited scrim", () => {
    const scrim = composite(rgb(tokens.foreground), rgb(tokens.background), 0.3);
    const panel = composite(rgb(tokens.card), scrim, 1);
    expect(contrast(rgb(tokens["card-foreground"]), panel)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(rgb(tokens["muted-foreground"]), panel)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(["background", "card", "popover", "muted"] as const)("error text passes WCAG AA on %s", (surface) => {
    expect(contrast(rgb(tokens["destructive-text"]), rgb(tokens[surface]))).toBeGreaterThanOrEqual(4.5);
  });

  it.each([0.05, 0.1, 0.15])("error text passes on red-tinted surfaces at %s opacity", (alpha) => {
    for (const surface of ["background", "card"] as const) {
      const background = composite(rgb(tokens.destructive), rgb(tokens[surface]), alpha);
      expect(contrast(rgb(tokens["destructive-text"]), background)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps readable text on red buttons", () => {
    expect(contrast(rgb(tokens["destructive-foreground"]), rgb(tokens.destructive))).toBeGreaterThanOrEqual(4.5);
  });

  it("footer uses opaque ink/helper pairs on white, not legacy dark alpha text", () => {
    const footer = readFileSync(new URL("../components/site-footer.tsx", import.meta.url), "utf8");
    expect(footer).not.toContain("surface-ink");
    expect(footer).toContain("bg-card");
    for (const ink of ["foreground", "muted-foreground", "primary"] as const) {
      expect(contrast(rgb(tokens[ink]), rgb(tokens.card))).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("generated utility contracts", () => {
  it("keeps Poppins headings, legacy font-serif, and Inter body", () => {
    expect(invariant["font-heading"]).toBe("Poppins, system-ui, sans-serif");
    expect(invariant["font-serif"]).toBe(invariant["font-heading"]);
    expect(invariant["font-sans"]).toBe("Inter, system-ui, sans-serif");
    expect(Number.parseFloat(invariant["touch-target"]) * 16).toBeGreaterThanOrEqual(44);
  });

  it("compiles neutral/selected/semantic/action states, alpha, focus separation and geometry", async () => {
    const result = await postcss([tailwindcss({ ...config, content: [{ raw: 'text-destructive text-destructive-foreground bg-destructive text-secondary hover:text-secondary text-secondary/80 text-secondary-foreground bg-secondary bg-secondary-hover bg-accent text-accent-foreground bg-primary hover:bg-primary-hover active:bg-primary-active bg-success-subtle text-success bg-warning-subtle text-warning bg-info-subtle text-info bg-destructive-subtle border-input ring-2 ring-ring ring-offset-2 ring-offset-card rounded-card p-surface-standard max-w-reading max-w-standard max-w-workbench font-heading font-serif group-data-[collapsible=icon]:!w-11 group-data-[collapsible=icon]:!h-11' }] })]).process("@tailwind utilities;", { from: undefined });
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
    expect(declarations(".text-destructive")).toContain("var(--destructive-text)");
    expect(declarations(".text-destructive-foreground")).toContain("var(--destructive-foreground)");
    expect(declarations(".bg-destructive")).toContain("var(--destructive)");
    for (const state of ["success", "warning", "info", "destructive"]) {
      expect(declarations(`.bg-${state}-subtle`)).toContain(`var(--${state}-subtle)`);
    }
    expect(declarations(".bg-secondary-hover")).toContain("var(--secondary-hover)");
    expect(declarations(".bg-accent")).toContain("var(--accent)");
    expect(declarations(".text-accent-foreground")).toContain("var(--accent-foreground)");
    expect(declarations(".hover\\:bg-primary-hover:hover")).toContain("var(--primary-hover)");
    expect(declarations(".active\\:bg-primary-active:active")).toContain("var(--primary-active)");
    expect(declarations(".border-input")).toContain("var(--input)");
    expect(declarations(".ring-offset-2")).toContain("--tw-ring-offset-width: 2px");
    expect(declarations(".ring-offset-card")).toContain("var(--card)");
    expect(declarations(".ring-ring")).toContain("var(--ring)");
    expect(declarations(".rounded-card")).toContain("var(--radius-card)");
    expect(declarations(".p-surface-standard")).toContain("var(--surface-padding-standard)");
    for (const width of ["reading", "standard", "workbench"]) {
      expect(declarations(`.max-w-${width}`)).toContain(`var(--page-width-${width})`);
    }
    expect(result.css).toContain("width: 2.75rem !important");
    expect(result.css).toContain("height: 2.75rem !important");
  });

  it("removes on-dark ink overrides and keeps light-native/reduced-motion behavior", () => {
    const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");
    expect(css).not.toContain("--secondary-text: var(--secondary-on-dark)");
    expect(css).toContain("color-scheme: only light");
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).not.toContain("forced-color-adjust: none");
    expect(css).toContain("font-variant-numeric: tabular-nums");
    expect(css).not.toContain("body:has");
  });
});