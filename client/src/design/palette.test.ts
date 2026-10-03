import { readFileSync } from "node:fs";
import postcss from "postcss";
import { describe, expect, it } from "vitest";
import config from "../../../tailwind.config";
import {
  borderSources, color, cssVar, darkColors, darkEffects, derivedBorderTokens,
  invariant, lightColors, lightEffects, platformBrand, type ColorToken,
} from "./tokens";

// Specification expectations only, not a second runtime palette.
const targets = {
  background: "#F8FAFC",
  card: "#FFFFFF", popover: "#FFFFFF", sidebar: "#FFFFFF",
  foreground: "#0F172A", "card-foreground": "#0F172A", "popover-foreground": "#0F172A", "sidebar-foreground": "#0F172A",
  "muted-foreground": "#475569", "secondary-text": "#475569",
  primary: "#1D4ED8", "primary-foreground": "#FFFFFF", "primary-hover": "#1E40AF", "primary-active": "#1E3A8A",
  accent: "#EFF6FF", "accent-foreground": "#1D4ED8",
  secondary: "#F1F5F9", "secondary-foreground": "#0F172A", "secondary-hover": "#E2E8F0", muted: "#F1F5F9",
  border: "#E2E8F0", "card-border": "#E2E8F0", "popover-border": "#E2E8F0", "sidebar-border": "#E2E8F0",
  input: "#7C8798", ring: "#1D4ED8", "sidebar-ring": "#1D4ED8",
  "sidebar-primary": "#1D4ED8", "sidebar-primary-foreground": "#FFFFFF",
  "sidebar-accent": "#EFF6FF", "sidebar-accent-foreground": "#1D4ED8",
  success: "#166534", "success-foreground": "#FFFFFF", "success-subtle": "#F0FDF4",
  destructive: "#B91C1C", "destructive-text": "#B91C1C", "destructive-foreground": "#FFFFFF", "destructive-subtle": "#FEF2F2",
  warning: "#854D0E", "warning-subtle": "#FEFCE8", info: "#1E40AF", "info-subtle": "#EFF6FF",
} as const satisfies Partial<Record<ColorToken, string>>;

function toHex(triplet: string) {
  const [hue, saturation, lightness] = triplet.split(/\s+/).map(Number.parseFloat);
  const l = lightness / 100;
  const a = saturation / 100 * Math.min(l, 1 - l);
  const channels = [0, 8, 4].map((offset) => {
    const k = (offset + hue / 30) % 12;
    return Math.round((l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255);
  });
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

const source = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");

describe("Ink & Cobalt authored palette", () => {
  it.each(Object.entries(targets))("%s round-trips from bare HSL to exact %s", (name, hex) => {
    const value = lightColors[name as ColorToken];
    expect(value).toMatch(/^\d+(?:\.\d+)? \d+(?:\.\d+)?% \d+(?:\.\d+)?%$/);
    expect(toHex(value)).toBe(hex);
  });

  it("keeps every legacy dark helper branch type-safe and light-only", () => {
    expect(darkColors).toEqual(lightColors);
    expect(darkEffects).toEqual(lightEffects);
    for (const token of Object.keys(lightColors) as ColorToken[]) {
      expect(color(token, "dark")).toBe(color(token, "light"));
      expect(color(token, "dark", 0.35)).toBe(`hsl(${lightColors[token]} / 0.35)`);
      expect(cssVar(token, 0.35)).toBe(`hsl(var(--${token}) / 0.35)`);
    }
  });

  it("uses explicit essential vs decorative boundary aliases without relative-color drift", () => {
    expect(Object.keys(borderSources)).toEqual([...derivedBorderTokens]);
    expect(borderSources.secondary).toBe("input");
    expect(borderSources.accent).toBe("primary");
    expect(borderSources.muted).toBe("border");
    expect(lightEffects["button-outline"]).toBe("hsl(var(--input))");
    expect(lightEffects["badge-outline"]).toBe("hsl(var(--border))");
    expect(source("../../../script/generate-design-css.ts")).not.toContain("hsl(from");
  });

  it("matches the generated root and light-compatible legacy selector after generation", () => {
    const root = postcss.parse(source("./tokens.generated.css"));
    for (const [selector, expected] of [
      [":root", { ...invariant, ...lightColors, ...lightEffects }],
      [".dark", { ...lightColors, ...lightEffects }],
    ] as const) {
      const actual: Record<string, string> = {};
      root.walkRules(selector, (rule) => {
        rule.walkDecls((decl) => { actual[decl.prop] = decl.value; });
      });
      for (const [name, value] of Object.entries(expected)) expect(actual[`--${name}`], `${selector} ${name}`).toBe(value);
      for (const name of derivedBorderTokens) expect(actual[`--${name}-border`]).toBe(`hsl(var(--${borderSources[name]}))`);
    }
  });

  it("keeps radius, density, width and short motion in the authored source", () => {
    expect(invariant.radius).toBe("6px");
    expect(invariant["radius-card"]).toBe("6px");
    expect(invariant["radius-pill"]).toBe("9999px");
    expect([1, 2, 3, 4, 6, 8].map((step) => invariant[`space-${step}` as keyof typeof invariant])).toEqual(["4px", "8px", "12px", "16px", "24px", "32px"]);
    expect([invariant["page-width-reading"], invariant["page-width-standard"], invariant["page-width-workbench"]]).toEqual(["48rem", "64rem", "80rem"]);
    expect(Number.parseFloat(invariant["motion-normal"])).toBeLessThanOrEqual(200);
    expect(source("../index.css")).toContain(".dashboard-container-reading,");
    expect(source("../index.css")).toContain(".dashboard-container-workbench { max-width: var(--page-width-workbench); }");
  });

  it("starts light before JavaScript and cannot activate legacy dark utilities", () => {
    const html = source("../../index.html");
    expect(html).toContain('class="light" style="color-scheme: only light;"');
    expect(html).toContain('<meta name="color-scheme" content="light"');
    expect(html).toContain('<meta name="theme-color" content="#FFFFFF"');
    expect(config.darkMode).toEqual(["class", ":not(*)"]);
    expect(source("../index.css")).not.toContain("--secondary-text: var(--secondary-on-dark)");
  });

  it("preserves external provider colors and categorical data, not application accents", () => {
    expect(platformBrand).toEqual({ linkedin: "#0A66C2", twitter: "#000000", threads: "#000000", bluesky: "#0285FF", substack: "#FF6719", medium: "#000000", reddit: "#FF4500", mastodon: "#6364FF", devto: "#0A0A0A", hashnode: "#2962FF" });
    expect(new Set([1, 2, 3, 4, 5].map((index) => lightColors[`chart-${index}` as ColorToken])).size).toBe(5);
    expect(source("../pages/auth.tsx")).toContain("bg-brand-linkedin");
    expect(source("../pages/auth.tsx")).not.toMatch(/#[\da-f]{6}/i);
  });

  it("maps presence to semantic roles rather than selection or literal Tailwind colors", () => {
    expect(config.theme.extend.colors.status).toEqual({
      online: "hsl(var(--success) / <alpha-value>)", away: "hsl(var(--warning) / <alpha-value>)",
      busy: "hsl(var(--destructive) / <alpha-value>)", offline: "hsl(var(--muted-foreground) / <alpha-value>)",
    });
  });
});

describe("owned chrome adoption guardrails", () => {
  it.each([
    "../pages/auth.tsx", "../pages/how-it-works.tsx", "../components/site-header.tsx", "../components/site-footer.tsx",
    "../components/newsletter-signup.tsx", "../components/landing/facts.tsx", "../components/landing/final-cta.tsx",
    "../components/landing/markets.tsx", "../components/landing/announcement-bar.tsx",
  ])("%s migrates complete light pairs without on-dark overrides", (file) => {
    expect(source(file)).not.toContain("surface-ink");
    expect(source(file)).not.toContain("secondary-on-dark");
  });

  it.each(["../components/app-sidebar.tsx", "../components/admin/admin-sidebar.tsx"])("%s preserves current-page semantics and a non-animated visible marker", (file) => {
    expect(source(file)).toContain('aria-current={isActive ? "page" : undefined}');
    expect(source(file)).toContain("border-l-2 border-sidebar-primary");
    expect(source(file)).not.toContain("framer-motion");
    expect(source(file)).not.toContain('title: "Performance"');
  });

  it("separates neutral tracks, selected states and semantic messages", () => {
    expect(source("../components/ui/progress.tsx")).toContain("bg-muted");
    expect(source("../components/ui/slider.tsx")).toContain("bg-muted border border-input");
    expect(source("../components/ui/tabs.tsx")).toContain("data-[state=active]:border-primary");
    expect(source("../components/ui/badge.tsx")).toContain('selected: "border-primary bg-accent text-accent-foreground"');
    expect(source("../components/ui/toast.tsx")).toContain("bg-destructive-subtle text-destructive");
    expect(source("../components/ui/toast.tsx")).not.toContain("opacity-90");
  });
});