/**
 * Design tokens — the single authored source of truth.
 *
 * Everything else is derived from this file:
 *   - `tokens.generated.css` (run `npm run design:tokens`) supplies the CSS
 *     custom properties that Tailwind and all stylesheets consume.
 *   - TypeScript consumers that cannot read CSS variables — Clerk's appearance
 *     API, chart libraries, email templates — import `color()` below.
 *
 * Before this file existed, ~15 token values were restated as hardcoded
 * `hsl(...)` strings in clerk-appearance.ts and several pages. Changing the
 * brand meant editing every copy by hand, and the light-mode chart palette
 * still carries a stale value from the previous brand as a result.
 *
 * To change the design system, edit ONLY this file, then run
 * `npm run design:tokens`. `npm run design:check` fails the build if the
 * generated CSS has drifted.
 */

/** Values that do not vary by theme. */
export const invariant = {
  "font-sans": "Inter, system-ui, sans-serif",
  "font-heading": "Poppins, system-ui, sans-serif",
  // Legacy font-serif consumers keep the same heading family.
  "font-serif": 'Poppins, system-ui, sans-serif',
  "font-mono": "JetBrains Mono, monospace",
  "page-gutter": "1rem",
  "page-gutter-wide": "1.5rem",
  "page-content-width": "72rem",
  "touch-target": "2.75rem",
  "radius": ".25rem",
  "spacing": "0.25rem",
  "tracking-normal": "0em",
} as const;

/**
 * Colour tokens as bare HSL triplets ("221 47% 20%").
 *
 * The triplet form (not `hsl(...)`) is required: Tailwind composes them as
 * `hsl(var(--token) / <alpha-value>)` so opacity utilities work.
 */
export const lightColors = {
  "surface-ink": "220 55% 13%",
  "surface-ink-foreground": "0 0% 100%",
  "background": "60 9% 98%",
  "foreground": "240 6% 10%",
  "border": "240 5% 88%",
  "card": "0 0% 100%",
  "card-foreground": "240 6% 10%",
  "card-border": "240 5% 92%",
  "sidebar": "240 6% 10%",
  "sidebar-foreground": "60 9% 96%",
  "sidebar-border": "240 5% 16%",
  "sidebar-primary": "221 47% 20%",
  "sidebar-primary-foreground": "0 0% 100%",
  "sidebar-accent": "240 5% 16%",
  "sidebar-accent-foreground": "60 9% 96%",
  "sidebar-ring": "38 92% 50%",
  "popover": "0 0% 100%",
  "popover-foreground": "240 6% 10%",
  "popover-border": "240 5% 88%",
  "primary": "221 47% 20%",
  "primary-foreground": "0 0% 100%",
  "secondary": "38 92% 50%",
  // Gold fill stays vivid; small text needs a deeper gold on light surfaces.
  "secondary-text": "32 85% 28%",
  "secondary-on-dark": "38 92% 50%",
  "secondary-foreground": "240 6% 10%",
  "muted": "240 5% 92%",
  "muted-foreground": "240 4% 40%",
  "accent": "221 40% 95%",
  "accent-foreground": "221 47% 20%",
  "destructive": "0 84% 45%",
  "destructive-foreground": "0 5% 98%",
  "success": "152 60% 32%",
  "success-foreground": "0 0% 100%",
  "input": "240 5% 82%",
  "ring": "221 47% 20%",
  "chart-1": "221 47% 20%",
  "chart-2": "38 92% 50%",
  "chart-3": "252 52% 46%",
  "chart-4": "20 85% 42%",
  "chart-5": "150 65% 35%",
} as const;

export const darkColors = {
  "surface-ink": "220 60% 10%",
  "surface-ink-foreground": "0 0% 100%",
  "background": "30 6% 7%",
  "foreground": "251 40% 95%",
  "border": "240 6% 18%",
  "card": "240 7% 10%",
  "card-foreground": "251 40% 95%",
  "card-border": "240 6% 15%",
  "sidebar": "240 8% 5%",
  "sidebar-foreground": "251 40% 92%",
  "sidebar-border": "240 6% 14%",
  "sidebar-primary": "222 49% 57%",
  "sidebar-primary-foreground": "0 0% 100%",
  "sidebar-accent": "240 6% 14%",
  "sidebar-accent-foreground": "251 40% 92%",
  "sidebar-ring": "38 80% 85%",
  "popover": "240 7% 12%",
  "popover-foreground": "251 40% 95%",
  "popover-border": "240 6% 18%",
  "primary": "222 49% 57%",
  "primary-foreground": "0 0% 100%",
  "secondary": "38 80% 55%",
  "secondary-text": "38 80% 60%",
  "secondary-on-dark": "38 80% 55%",
  "secondary-foreground": "240 6% 10%",
  "muted": "240 6% 16%",
  "muted-foreground": "240 5% 65%",
  "accent": "222 35% 22%",
  "accent-foreground": "222 40% 92%",
  "destructive": "0 84% 40%",
  "destructive-foreground": "0 5% 98%",
  "success": "152 55% 55%",
  "success-foreground": "240 8% 7%",
  "input": "240 6% 20%",
  "ring": "222 49% 57%",
  "chart-1": "222 49% 57%",
  "chart-2": "38 80% 55%",
  "chart-3": "252 78% 72%",
  "chart-4": "25 88% 65%",
  "chart-5": "150 65% 65%",
} as const;

/** Shadows, outlines and elevation overlays — full CSS values. */
export const lightEffects = {
  "button-outline": "rgba(0,0,0, .10)",
  "badge-outline": "rgba(0,0,0, .05)",
  "opaque-button-border-intensity": "-8",
  "elevate-1": "rgba(0,0,0, .03)",
  "elevate-2": "rgba(0,0,0, .08)",
  "shadow-2xs": "0px 2px 0px 0px hsl(210 6% 12% / 0.02)",
  "shadow-xs": "0px 2px 0px 0px hsl(210 6% 12% / 0.03)",
  "shadow-sm": "0px 2px 0px 0px hsl(210 6% 12% / 0.04), 0px 1px 2px -1px hsl(210 6% 12% / 0.06)",
  "shadow": "0px 2px 0px 0px hsl(210 6% 12% / 0.04), 0px 1px 2px -1px hsl(210 6% 12% / 0.08)",
  "shadow-md": "0px 2px 0px 0px hsl(210 6% 12% / 0.05), 0px 2px 4px -1px hsl(210 6% 12% / 0.10)",
  "shadow-lg": "0px 2px 0px 0px hsl(210 6% 12% / 0.06), 0px 4px 6px -1px hsl(210 6% 12% / 0.12)",
  "shadow-xl": "0px 2px 0px 0px hsl(210 6% 12% / 0.08), 0px 8px 10px -1px hsl(210 6% 12% / 0.14)",
  "shadow-2xl": "0px 2px 0px 0px hsl(210 6% 12% / 0.10)",
} as const;

export const darkEffects = {
  "button-outline": "rgba(255,255,255, .10)",
  "badge-outline": "rgba(255,255,255, .05)",
  "opaque-button-border-intensity": "9",
  "elevate-1": "rgba(255,255,255, .04)",
  "elevate-2": "rgba(255,255,255, .09)",
  "shadow-2xs": "0px 2px 0px 0px hsl(210 6% 2% / 0.15)",
  "shadow-xs": "0px 2px 0px 0px hsl(210 6% 2% / 0.20)",
  "shadow-sm": "0px 2px 0px 0px hsl(210 6% 2% / 0.25), 0px 1px 2px -1px hsl(210 6% 2% / 0.30)",
  "shadow": "0px 2px 0px 0px hsl(210 6% 2% / 0.25), 0px 1px 2px -1px hsl(210 6% 2% / 0.35)",
  "shadow-md": "0px 2px 0px 0px hsl(210 6% 2% / 0.30), 0px 2px 4px -1px hsl(210 6% 2% / 0.40)",
  "shadow-lg": "0px 2px 0px 0px hsl(210 6% 2% / 0.35), 0px 4px 6px -1px hsl(210 6% 2% / 0.45)",
  "shadow-xl": "0px 2px 0px 0px hsl(210 6% 2% / 0.40), 0px 8px 10px -1px hsl(210 6% 2% / 0.50)",
  "shadow-2xl": "0px 2px 0px 0px hsl(210 6% 2% / 0.45)",
} as const;

/**
 * Tokens whose border colour is derived from their own fill by shifting
 * lightness, so a button's border tracks its background automatically.
 */
export const derivedBorderTokens = [
  "sidebar-primary",
  "sidebar-accent",
  "primary",
  "secondary",
  "muted",
  "accent",
  "destructive",
] as const;

export type ColorToken = keyof typeof lightColors;
export type EffectToken = keyof typeof lightEffects;
export type Theme = "light" | "dark";

/**
 * External platform brand colours. These belong to other companies, so they
 * are deliberately NOT themeable — LinkedIn blue is LinkedIn blue in dark mode.
 */
export const platformBrand = {
  linkedin: "#0A66C2",
  twitter: "#000000",
  threads: "#000000",
  bluesky: "#0285FF",
  substack: "#FF6719",
  medium: "#000000",
  reddit: "#FF4500",
  mastodon: "#6364FF",
  devto: "#0A0A0A",
  hashnode: "#2962FF",
} as const;

export type PlatformKey = keyof typeof platformBrand;

/**
 * A CSS reference to a token: `hsl(var(--primary))`.
 * Prefer a Tailwind class where one exists; use this for inline styles.
 */
export function cssVar(token: ColorToken, alpha?: number): string {
  return alpha === undefined
    ? `hsl(var(--${token}))`
    : `hsl(var(--${token}) / ${alpha})`;
}

/**
 * A literal colour string for consumers that cannot resolve CSS variables:
 * Clerk's appearance API, canvas-based charts, HTML email.
 *
 * Because it resolves at call time it does not follow a runtime theme switch —
 * pass the theme explicitly for anything that must react to one.
 */
export function color(token: ColorToken, theme: Theme = "light", alpha?: number): string {
  const triplet = theme === "dark" ? darkColors[token] : lightColors[token];
  const [h, s, l] = triplet.split(/\s+/);
  return alpha === undefined ? `hsl(${h} ${s} ${l})` : `hsl(${h} ${s} ${l} / ${alpha})`;
}

/** Ordered categorical palette for charts. */
export const chartSeries: readonly ColorToken[] = [
  "chart-1", "chart-2", "chart-3", "chart-4", "chart-5",
] as const;
