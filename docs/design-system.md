# Design system

One authored file drives every colour, type and geometry decision in the app.

```
client/src/design/tokens.ts          ← THE ONLY FILE YOU EDIT
        │
        ├─ npm run design:tokens ──> client/src/design/tokens.generated.css
        │                                    │
        │                                    └─ @import'd by index.css
        │                                       → Tailwind reads the CSS vars
        │
        ├─ tailwind.config.ts (imports platformBrand)
        │
        └─ TypeScript consumers: color(), cssVar(), invariant, chartSeries
```

## Rules

1. **Never write a colour literal.** No `#0A66C2`, no `hsl(221, 47%, 20%)`, no `text-[hsl(...)]`. If you need a colour that doesn't exist, add a token.
2. **Edit only `tokens.ts`,** then run `npm run design:tokens`. `tokens.generated.css` is generated and carries a DO-NOT-EDIT header.
3. **Prefer the Tailwind class** (`bg-primary`, `text-muted-foreground`). Reach for `cssVar()` only for inline styles, and `color()` only for APIs that cannot resolve CSS variables.
4. **`npm run design:check`** fails if the generated CSS has drifted from `tokens.ts`. Wire it into CI so the two can never disagree silently.

## Why it exists

Before this, the tokens lived in `index.css` and were *restated by hand* wherever JavaScript needed them — about fifteen values in `clerk-appearance.ts` alone, plus scattered literals in four pages. Moving the brand from purple to navy therefore required editing every copy, and two symptoms of that are still visible in the token values themselves:

- `--chart-4` (light) is `251 92% 96%`, a near-white lavender left over from the purple brand — effectively invisible as a chart series on a white card.
- `--chart-3` (dark) carries the same stale value.

Two colour bugs were fixed during consolidation:

- The footer and final CTA each hardcoded the same navy pair (`#0F1B33` / `#0A1428`). Now one `surface-ink` token.
- `settings.tsx` used `#0077b5`, LinkedIn's **retired** brand blue, while `analytics.tsx` used the current `#0A66C2`. Same brand, two colours, one product. Now `brand-linkedin`.

## Token groups

| Group | Export | Count | Notes |
|---|---|---|---|
| Invariant | `invariant` | 6 | Fonts, radius, spacing, tracking — no theme variance |
| Colours | `lightColors` / `darkColors` | 38 each | Bare HSL triplets, e.g. `"221 47% 20%"` |
| Effects | `lightEffects` / `darkEffects` | 13 each | Shadows, outlines, elevation overlays |
| Derived borders | `derivedBorderTokens` | 7 | Border colour computed from the token's own fill |
| Platform brands | `platformBrand` | 10 | External brands — deliberately **not** themeable |

Colours are stored as bare triplets, not `hsl(...)`, because Tailwind composes them as `hsl(var(--token) / <alpha-value>)`. That is what makes `bg-brand-linkedin/10` and `bg-destructive/30` work.

## Usage

```ts
import { color, cssVar, invariant, chartSeries } from "@/design/tokens";

// Preferred — a Tailwind class
<div className="bg-primary text-primary-foreground rounded-md" />

// Inline style
<div style={{ borderColor: cssVar("border") }} />

// An API that cannot read CSS variables (Clerk, canvas charts, email)
color("primary")               // "hsl(221 47% 20%)"
color("primary", "dark")       // "hsl(222 49% 57%)"
color("primary", "light", 0.1) // "hsl(221 47% 20% / 0.1)"

invariant["font-sans"]         // "Inter, system-ui, sans-serif"
```

`color()` resolves at call time, so it does **not** follow a runtime theme switch. Pass the theme explicitly for anything that must react to one.

## Semantic colour reference

| Token | Use for |
|---|---|
| `background` / `foreground` | Page surface and its text |
| `card` / `card-foreground` / `card-border` | Raised panels |
| `popover` / `popover-*` | Overlays, dropdowns, tooltips |
| `primary` / `primary-foreground` | Primary actions, brand emphasis |
| `secondary` / `secondary-foreground` | Amber accent; secondary emphasis |
| `muted` / `muted-foreground` | De-emphasised surfaces and helper text |
| `accent` / `accent-foreground` | Hover and selected states |
| `destructive` / `destructive-foreground` | Errors, deletion |
| `success` / `success-foreground` | Confirmation |
| `border` / `input` / `ring` | Hairlines, field borders, focus rings |
| `surface-ink` / `surface-ink-foreground` | Deep navy sections — footer, final CTA |
| `sidebar*` | The dashboard sidebar's own dark scale |
| `chart-1` … `chart-5` | Categorical chart series, in order |

## Dark mode

Both themes are fully defined. Activation is class-based (`darkMode: ["class"]`), so dark mode requires adding the `dark` class to `<html>`. **There is currently no theme toggle** — `theme-provider.tsx` and `theme-toggle.tsx` were deleted, and `next-themes` was removed as an unused dependency. The tokens are ready; the switcher needs rebuilding when dark mode is wanted.

## Known gaps

- **Chart palette needs a proper pass.** Beyond the two stale lavender values above, the five series colours have not been checked for categorical distinguishability or contrast in either theme. Do this with the `dataviz` skill before building analytics-heavy surfaces.
- **No typographic scale tokens.** Font *families* are tokenised; sizes, weights and line heights still rely on Tailwind defaults. Worth adding before three dashboards diverge.
- **No spacing scale beyond Tailwind's default** (`--spacing: 0.25rem` exists but is unused).
- **No component-level documentation.** Forty shadcn primitives exist in `components/ui/` with no usage guidance, so the three dashboards risk solving the same layout problems differently.
