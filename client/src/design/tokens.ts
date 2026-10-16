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
  "page-content-width": "64rem",
  "page-width-reading": "48rem",
  "page-width-standard": "64rem",
  "page-width-workbench": "80rem",
  "touch-target": "2.75rem",
  "radius": "6px",
  "radius-control": "6px",
  "radius-card": "6px",
  "radius-small": "4px",
  // Avatars, pills, switch/slider thumbs and progress tracks are intentional exceptions.
  "radius-pill": "9999px",
  "space-1": "4px",
  "space-2": "8px",
  "space-3": "12px",
  "space-4": "16px",
  "space-6": "24px",
  "space-8": "32px",
  "surface-padding-compact": "12px",
  "surface-padding-standard": "16px",
  "surface-padding-relaxed": "24px",
  "motion-fast": "120ms",
  "motion-normal": "180ms",
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
  // Deprecated aliases, retained for static/theme helper compatibility. Owned
  // panels migrate as whole foreground/background pairs, not via these aliases.
  "surface-ink": "0 0% 100%",
  "surface-ink-foreground": "222.222222 47.368421% 11.176471%",
  "background": "210 40% 98.039216%",
  "foreground": "222.222222 47.368421% 11.176471%",
  "border": "214.285714 31.818182% 91.372549%",
  "card": "0 0% 100%",
  "card-foreground": "222.222222 47.368421% 11.176471%",
  "card-border": "214.285714 31.818182% 91.372549%",
  "sidebar": "0 0% 100%",
  "sidebar-foreground": "222.222222 47.368421% 11.176471%",
  "sidebar-border": "214.285714 31.818182% 91.372549%",
  "sidebar-primary": "224.278075 76.326531% 48.039216%",
  "sidebar-primary-foreground": "0 0% 100%",
  "sidebar-accent": "213.75 100% 96.862745%",
  "sidebar-accent-foreground": "224.278075 76.326531% 48.039216%",
  "sidebar-ring": "224.278075 76.326531% 48.039216%",
  "popover": "0 0% 100%",
  "popover-foreground": "222.222222 47.368421% 11.176471%",
  "popover-border": "214.285714 31.818182% 91.372549%",
  "primary": "224.278075 76.326531% 48.039216%",
  "primary-foreground": "0 0% 100%",
  "primary-hover": "225.931034 70.731707% 40.196078%",
  "primary-active": "224.444444 64.285714% 32.941176%",
  "secondary": "210 40% 96.078431%",
  "secondary-text": "215.294118 19.318182% 34.509804%",
  "secondary-on-dark": "215.294118 19.318182% 34.509804%",
  "secondary-foreground": "222.222222 47.368421% 11.176471%",
  "secondary-hover": "214.285714 31.818182% 91.372549%",
  "muted": "210 40% 96.078431%",
  "muted-foreground": "215.294118 19.318182% 34.509804%",
  "accent": "213.75 100% 96.862745%",
  "accent-foreground": "224.278075 76.326531% 48.039216%",
  "destructive": "0 73.70892% 41.764706%",
  "destructive-foreground": "0 0% 100%",
  "destructive-text": "0 73.70892% 41.764706%",
  "destructive-subtle": "0 85.714286% 97.254902%",
  "success": "142.78481 64.227642% 24.117647%",
  "success-foreground": "0 0% 100%",
  "success-subtle": "138.461538 76.470588% 96.666667%",
  "warning": "31.764706 80.952381% 28.823529%",
  "warning-subtle": "54.545455 91.666667% 95.294118%",
  "info": "225.931034 70.731707% 40.196078%",
  "info-subtle": "213.75 100% 96.862745%",
  "input": "216.428571 11.965812% 54.117647%",
  "ring": "224.278075 76.326531% 48.039216%",
  // Categorical data colors are not application action/status colors.
  "chart-1": "221 47% 20%",
  "chart-2": "38 92% 50%",
  "chart-3": "252 52% 46%",
  "chart-4": "20 85% 42%",
  "chart-5": "150 65% 35%",
} as const;

/** Legacy light-only compatibility; every ColorToken remains safe to index. */
export const darkColors = lightColors;

/** Shadows, outlines and elevation overlays — full CSS values. */
export const lightEffects = {
  "button-outline": "hsl(var(--input))",
  "badge-outline": "hsl(var(--border))",
  "opaque-button-border-intensity": "0",
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

/** Legacy compatibility, not an alternate dark elevation palette. */
export const darkEffects = lightEffects;

/**
 * Stable border-token names. Their explicit semantic sources below distinguish
 * decorative dividers, essential outlines and selected/action boundaries.
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

/** Explicit boundaries, not gold-era lightness shifts. */
export const borderSources = {
  "sidebar-primary": "sidebar-primary",
  "sidebar-accent": "sidebar-primary",
  primary: "primary",
  secondary: "input",
  muted: "border",
  accent: "primary",
  destructive: "destructive",
} as const satisfies Record<typeof derivedBorderTokens[number], keyof typeof lightColors>;

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
 * The legacy theme argument is accepted but both branches resolve light.
 * It never reads browser storage or OS preferences.
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
