# Ink & Cobalt — light-theme specification

**Selected on:** 2026-10-01  
**Direction:** Ink & Cobalt, selected by the user from the color-audit options.  
**Scope:** Adopted design contract and local acceptance record.  
**Implementation:** COLOR-01–COLOR-11 verified locally — 11 / 12 tasks.  
**Deployment:** Not performed; COLOR-12 blocked with UX-28.

This is the implemented local color contract for TheSocialPundit. It supersedes
the older amber-accent and dark-sidebar direction. [Design system](design-system.md)
and [adoption notes](UI_UX_IMPLEMENTATION_2026-10-01.md) document the current
components, verified reports and limitations. Local rendering is not deployment.

The broader [UI/UX task tracker](UI_UX_AUDIT_TASKS_2026-09-30.md) remains the owner
of layout, interaction and workflow work. This specification supports UX-12,
UX-13, UX-15, UX-24, UX-25 and UX-26; it does not complete those tasks.

## 1. Design intent

**Professional, light, calm and content-first.** Use color to explain actions,
selection and state, rather than decorating every component.

- Almost-white page canvas, white cards, white navbar and white sidebar.
- Dark ink typography, with readable slate helper text.
- Cobalt for the main action, links, selection indicators and keyboard focus.
- Pale blue for selected surfaces; neutral secondary actions.
- Independent success, warning, error and information colors.
- Existing social-preview cards remain neutral, with **6px corners and no
  colored top border**. The palette is not a reason to redesign their layout.
- Preserve Poppins headings and Inter body text. Typography, spacing and
  component sizing are governed by the UI/UX tracker, not replaced here.

### Light-only policy

The application must stay light regardless of the operating system's preferred
theme. Do not add a theme switcher or automatic dark-mode behavior.

The policy includes the dashboard shell, mobile navigation sheet, dialogs,
popovers, menus, form controls and application-owned authentication/admin pages.
Use light surfaces when migrating existing dark marketing/authentication panels;
do not treat the white sidebar as the only light-theme change.

Existing `darkColors`, `darkEffects`, `.dark` output and theme-accepting helpers
are compatibility concerns, not a request to design a second palette. Inventory
consumers before retiring them. If temporarily retained, they must not activate
a user-facing dark theme. Application-owned native controls should use the light
color scheme. External platform pages and user-supplied images are not recolored.

## 2. Audit baseline and reasons for changing

The prior audit combined local browser inspection with source review. Findings
describe the inspected workspace, not fresh authenticated production acceptance.

| Finding | Existing behavior | Target behavior |
| --- | --- | --- |
| Accent overuse | `secondary` is orange/gold `#F59F0A`, reused for selection, progress, calendar highlights and decoration | One restrained brand accent, with separate semantic roles |
| Competing visual surfaces | Light canvas with near-black `#18181B` sidebar | White navigation with pale-blue active item |
| Secondary actions | Many selected controls use the solid secondary button variant | Neutral secondary actions; explicit selected variant |
| Coupled text/fill roles | Gold fill, dark gold text and bright gold on dark surfaces are separate tokens and CSS overrides | Migrate the complete family, not one HEX value |
| Faint input outline | Current input token `#CFCFD3` is about 1.5:1 against light surfaces | Stronger essential control boundaries, separate from decorative dividers |
| Broad dependency surface | Tokens also feed shared widgets, authentication, marketing and admin UI | Review all affected consumers before release |

The existing dark gold text `#844B0B` already has approximately 7.02:1 contrast
against white. The audit did **not** establish that all orange usage fails
accessibility. The main problems are hierarchy, overuse and mixed meaning.

## 3. Core palette and token mapping

HEX values below define the adopted sRGB colors. Store implementation values in
the existing authored token system; do not scatter these literals into JSX.
All token names below are now implemented in the authored source/utilities.

| Role | Implemented token | Target HEX | Usage |
| --- | --- | --- | --- |
| Page canvas | `background` | `#F8FAFC` | Background around content surfaces |
| Card/dialog/menu surface | `card`, `popover` | `#FFFFFF` | Raised and overlay surfaces |
| Main text | `foreground`, `card-foreground`, `popover-foreground` | `#0F172A` | Headings, body and labels |
| Helper text | `muted-foreground` | `#475569` | Descriptions, metadata, helper text |
| Main action | `primary` | `#1D4ED8` | Primary buttons, links and active indicators |
| Main action text | `primary-foreground` | `#FFFFFF` | Text/icons on solid cobalt |
| Main action hover | `primary-hover` | `#1E40AF` | Explicit hover color, not arbitrary opacity |
| Main action pressed | `primary-active` | `#1E3A8A` | Pointer/keyboard pressed state |
| Selected surface | `accent` | `#EFF6FF` | Selected tab, platform chip or list item |
| Selected text | `accent-foreground` | `#1D4ED8` | Text/icons on the selected surface |
| Secondary action surface | `secondary` | `#F1F5F9` | Neutral secondary buttons |
| Secondary action text | `secondary-foreground` | `#0F172A` | Text/icons on neutral buttons |
| Secondary action hover | `secondary-hover` | `#E2E8F0` | Hover for neutral secondary controls |
| Compatibility secondary ink | `secondary-text` | `#475569` | Neutral text only; reclassify old accent callers |
| Subtle surface | `muted` | `#F1F5F9` | Grouped controls, skeletons, neutral inset areas |
| Decorative divider | `border`, `card-border`, `popover-border` | `#E2E8F0` | Nonessential surface separation |
| Essential control boundary | `input` | `#7C8798` | Input/select outlines and necessary control boundaries |
| Focus indicator | `ring` | `#1D4ED8` | Visible keyboard focus with an appropriate offset |

### Sidebar contract

| Token | Target HEX | Meaning |
| --- | --- | --- |
| `sidebar` | `#FFFFFF` | White sidebar and mobile navigation sheet |
| `sidebar-foreground` | `#0F172A` | Navigation text/icons |
| `sidebar-border` | `#E2E8F0` | Decorative separation from the workspace |
| `sidebar-accent` | `#EFF6FF` | Active navigation item surface |
| `sidebar-accent-foreground` | `#1D4ED8` | Active item text/icons |
| `sidebar-primary` | `#1D4ED8` | Rare solid navigation action, not the active-row fill |
| `sidebar-primary-foreground` | `#FFFFFF` | Text on that solid action |
| `sidebar-ring` | `#1D4ED8` | Keyboard focus indicator |

Use a visible active marker and `aria-current`, not color alone. A cobalt marker
can accompany the pale active row; do not turn the whole sidebar or active row
into a large saturated block.

### Essential borders versus decorative borders

`border` is intentionally subtle and is **not** a universal control outline.
Where a boundary is needed to identify an input or control, use `input` or an
equivalently verified semantic boundary. Do not lower every border's opacity.

Review the existing `button-outline` effect token: an outline-only control may
need to derive its boundary from `input`, rather than the current translucent
black. Decorative badge outlines may derive from `border`. Focus is a separate
state and must remain visible even where the resting boundary is subtle.

## 4. Semantic states

These colors communicate outcomes, not brand decoration. Always include an
appropriate label/icon, and do not rely on red/green or any color pair alone.

| State | Ink / solid token | Ink HEX | Subtle surface token | Surface HEX |
| --- | --- | --- | --- | --- |
| Success | `success` | `#166534` | `success-subtle` | `#F0FDF4` |
| Error/destructive | `destructive`, `destructive-text` | `#B91C1C` | `destructive-subtle` | `#FEF2F2` |
| Warning | `warning` | `#854D0E` | `warning-subtle` | `#FEFCE8` |
| Information | `info` | `#1E40AF` | `info-subtle` | `#EFF6FF` |

For a solid semantic button/badge, its paired `*-foreground` is `#FFFFFF`.
For a subtle banner, use the **ink** color on the **subtle surface**; never put
white foreground text on these pale surfaces. Existing success/destructive
foreground tokens should follow this distinction. Add warning/info foreground
tokens only if solid variants are actually needed.

- Warnings use muted ochre only for real cautions, not selected controls,
  ordinary navigation, AI decoration or routine scheduled posts.
- Generating is a process state: use cobalt/information styling with text or a
  spinner, not a warning fill. Do not invent progress beyond known server state.
- Saved confirms persistence only. It does not mean scheduled or published.
- Uncertain delivery needs explicit caution and recovery guidance; never display
  it as success just because a request was accepted.
- Error styling must remain beside the affected card/field, not only in a toast.

## 5. Component usage rules

| Component/state | Treatment |
| --- | --- |
| Page header/navbar | White surface, ink title, slate subtitle, neutral bottom divider |
| Primary button | Cobalt fill, white label, explicit hover/pressed colors |
| Secondary button | Neutral surface with ink label; no saturated brand fill |
| Outline/ghost action | Ink or appropriate semantic text; neutral hover; sufficient boundary/focus treatment |
| Selected tab/platform chip | Pale blue fill, cobalt text and clear selected indicator/semantics |
| Unselected tab/platform chip | White/neutral surface and ink/slate text |
| Input/select/textarea | White fill, ink value, readable slate hint, essential outline token |
| Focused control | Visible cobalt indicator; target 2px ring/outline with a 2px light offset where needed |
| Invalid field | Error boundary/message plus semantic association; not only a red border |
| Disabled control | Neutral treatment and a clear disabled state/reason; do not make it resemble a selected control |
| Read-only field | Readable text, distinct from disabled; preserve permitted selection/copy |
| Card | White surface, neutral boundary, restrained shadow and existing geometry contract |
| Menu/dialog/mobile sheet | White surface with ink content; light-native controls and visible focus |
| Skeleton/progress track | Neutral muted track; primary progress indicator |
| Empty state | Neutral surface/icon by default; primary only for the meaningful next action |
| Status badge/toast | Semantic ink/surface pair, icon and truthful label |
| Text link | Cobalt; underline or another non-color affordance where required in prose |

### Action hierarchy

One primary action per working context, not necessarily one button across an
entire multi-card screen. For example:

- Creation setup: Generate is primary; source/tone/format controls are not.
- Generated card: Save can be primary; Edit/Copy are neutral and Regenerate is
  lower emphasis. Multiple cards must not become large blue panels.
- Destructive confirmation: the destructive action uses red, not cobalt.
- Do not mechanically replace every former orange fill with solid cobalt.

### Selected is not secondary

The old screens frequently expressed selection through `Button variant="secondary"`.
The adopted `selected` treatment consumes `accent` and `accent-foreground`, with
appropriate `aria-pressed`, current or tab semantics. Neutral helper/category
consumers remain neutral; do not replace them mechanically with selected cobalt.

## 6. Page-by-page application

| Area | Target treatment | Preserve |
| --- | --- | --- |
| Home | Neutral next-action cards; primary next action; restrained information icons | Existing next-action logic and honest schedule state |
| Discover | Pale-blue selected story; neutral keyword/relevance chips unless a semantic distinction is needed | Split-pane triage and readable source context |
| Create setup | White toolbar, neutral secondary controls, pale-blue platform selection, cobalt Generate | Article/Idea distinction and sequential generation |
| Social previews | White cards, neutral borders, ink content, small meaningful status indicators | Exact editable text, 6px radius, no colored top strip |
| Content | Neutral draft cards, clear filters, separate save and delivery states | Duplicate-publication and uncertainty guards |
| Calendar | Cobalt Today marker; restrained information styling for ordinary scheduled items | Target-specific outcomes and timezone clarity |
| Settings | White sections, consistent fields and one clear local save action | Existing navigation/unsaved-edit protection |
| Authentication/admin/marketing | Light owned surfaces, cobalt brand actions, independent provider branding | Route/auth behavior, meaningful status distinctions |

Performance remains hidden. Do not re-enable it to demonstrate the new palette.
If charts are exposed elsewhere, preserve categorical distinguishability and
use labels/patterns; do not recolor every series cobalt. Chart-palette acceptance
is separate from these button/text contrast checks.

## 7. Platform brands and legacy dark surfaces

### Preserve recognizable external branding

LinkedIn, Reddit, Substack and other provider marks retain their official colors.
Orange inside an official Reddit/Substack mark is **not** an orange application
accent. Use the central `platformBrand` definitions where applicable; avoid
duplicated literals in authentication buttons or components.

User content, uploaded artwork, platform logos and rich-editor content-color
choices are distinct from application chrome. Do not rewrite them during theme
migration. Test their containing surfaces for readability separately.

### Completed consumer inventory and compatibility disposition

| Consumer family | Role / disposition |
|---|---|
| `tokens.ts`, generator, Tailwind, `index.css` | Bare-HSL semantic source; explicit border sources and hover/active pairs. Old on-dark CSS overrides removed. `darkColors`/`darkEffects` equal light exports; generated `.dark` remains light and legacy dark utilities use a nonmatching selector. No user toggle or theme flash. |
| App/admin sidebars and navbars, PageHeader | White surfaces, ink identity, cobalt current marker plus semantics. Admin colour adoption does not imply six-page layout certification. |
| Button/Tabs/segmented controls, selected inbox rows and platform controls | Neutral actions separate from pale-blue selected state; pressed/current/tab cues retained. |
| Field/input/select/textarea, editor focus, outline controls | Essential `input` boundaries, readable hint/readonly text, separated cobalt focus and semantic invalid state. Native colour-picker labels use essential boundaries; user swatches are content. |
| Badge/Toast/Progress/Slider/Sheet/multi-select and Tailwind status mappings | Neutral tracks/containers, explicit primary indicators/selection, labelled semantic outcomes. Presence warning is not navigation selection. |
| WorkflowStatus, generation/save/publishing/Calendar state | Separate info/success/warning/error ink and pale surfaces; accepted/uncertain/manual outcomes never become verified delivery by colour. |
| `draft-card`, `inbox-detail`, `sources-manager`, profile chips/onboarding evidence | Remaining secondary text/containers are neutral helper, provider identity containers or taxonomy. Labelled scheduled timestamp metadata can stay neutral; not a warning or selected state. |
| Public/auth/landing/site-footer and admin helper/metric icons | Former dark/gold foreground/background pairs migrated together. Provider marks and neutral helper/icon containers retained deliberately. |
| `server/services/email/{index,templates}.ts`, `emailService.ts` | Migrated full pairs via authored-token `emailColor` RGB literals. No CSS variables/HSL in output; email typography/geometry remain separate. Twenty render tests, no delivery. |
| `platformBrand`, charts, user media/Idea colours | Recognizable provider marks and user choices unchanged; categorical chart colours are not app accent. Chart perceptual certification remains separate. |
| Hidden `performance.tsx`, legacy presentation files | Not used to demonstrate adoption or re-exposed. Canonical routes remain the acceptance scope; obsolete markup is not a live selected-state claim. |

`surface-ink` is now a white/ink compatibility pair and `secondary-on-dark`
resolves neutral helper ink. Retained exports support older helpers/static
consumers, not a second theme. New callers should use semantic names directly.

## 8. Token architecture and implementation constraints

**Single authored source:** `client/src/design/tokens.ts`.

The existing generator `script/generate-design-css.ts` writes
`client/src/design/tokens.generated.css`. Tailwind maps those variables to
utilities, and `index.css` imports the generated output.

1. Update authored tokens and any required utility mappings; never hand-edit the
   generated CSS or hardcode the palette throughout JSX.
2. Preserve bare HSL-triplet storage and alpha-aware Tailwind utilities. Convert
   from the chosen HEX values using the appendix, with round-trip checks.
3. Add explicit primary hover/pressed and semantic-subtle tokens. Do not depend
   on arbitrary opacity values to invent new brand shades.
4. Keep type/generator compatibility when adding keys: `ColorToken` currently
   comes from `lightColors`, while `color()` also indexes `darkColors`. Additions
   must not leave missing keys in reachable helper branches. Resolve the legacy
   API deliberately without introducing a user-facing dark-theme requirement.
5. Review derived borders and `button-outline`, rather than assuming existing
   gold-oriented lightness adjustments meet the new control contracts.
6. Review the hardcoded `status` palette in `tailwind.config.ts`. Classify real
   presence/status uses before mapping them to semantic tokens; do not give an
   away indicator the same role as a selected tab.
7. Prefer explicit state colors over stacking new overlays onto the existing
   `hover-elevate` system. Verify the final composited hover/pressed appearance.
8. Retain neutral shadows and reduced-motion support. No gradients, glowing
   cobalt panels or extra motion are required by this color decision.

## 9. Contrast contract

Calculated from the specified opaque sRGB HEX pairs on 2026-10-01. Ratios are
rounded to two decimal places; these are pair calculations, not a claim of
complete application accessibility or production verification.

| Usage | Foreground | Background | Contrast | Minimum target |
| --- | --- | --- | --- | --- |
| Primary button | `#FFFFFF` | `#1D4ED8` | 6.70:1 | 4.5:1 |
| Primary hover | `#FFFFFF` | `#1E40AF` | 8.72:1 | 4.5:1 |
| Primary pressed | `#FFFFFF` | `#1E3A8A` | 10.36:1 | 4.5:1 |
| Body on canvas | `#0F172A` | `#F8FAFC` | 17.06:1 | 4.5:1 |
| Helper on canvas | `#475569` | `#F8FAFC` | 7.24:1 | 4.5:1 |
| Helper on subtle surface | `#475569` | `#F1F5F9` | 6.92:1 | 4.5:1 |
| Selected text | `#1D4ED8` | `#EFF6FF` | 6.16:1 | 4.5:1 |
| Field boundary on white | `#7C8798` | `#FFFFFF` | 3.64:1 | 3:1 |
| Field boundary on canvas | `#7C8798` | `#F8FAFC` | 3.47:1 | 3:1 |
| Success message | `#166534` | `#F0FDF4` | 6.81:1 | 4.5:1 |
| Warning message | `#854D0E` | `#FEFCE8` | 6.62:1 | 4.5:1 |
| Error message | `#B91C1C` | `#FEF2F2` | 5.91:1 | 4.5:1 |
| Information message | `#1E40AF` | `#EFF6FF` | 8.01:1 | 4.5:1 |

### Acceptance beyond those numbers

- Aim for at least 4.5:1 for normal application text, including helper and
  placeholder text; large text has a 3:1 minimum, but do not weaken normal text.
- Essential component boundaries and state/focus indicators must meet applicable
  non-text contrast requirements against their actual adjacent colors.
- Cobalt focus against cobalt fill is not distinguishable by itself. Use the
  light offset/separation and test the rendered control, not only two token names.
- Decorative card dividers need not be made as dark as essential field outlines.
- Do not claim disabled controls are readable solely because a WCAG contrast
  exemption may apply. Preserve practical legibility and explain blocked actions.
- Recheck opacity-composited, hover, active, focus, disabled and overlay states.
  The table does not validate arbitrary alpha variants or text over images.
- Check color-independent cues, keyboard navigation, zoom, forced-colors behavior
  and real screen-reader behavior separately. Do not suppress user accessibility
  overrides to preserve the visual palette.

## 10. Prioritized color-migration checklist

Tasks 01–11 are **Verified locally**, owner **Copilot**. Task 12 is **Blocked**
on the scoped production gate. Evidence is recorded beneath each task and in
the adoption notes. These COLOR IDs remain a separate sub-checklist; they do
not change the master tracker's 28-task count.

### P1 — Role separation and safe foundations

- [x] **COLOR-01 — Inventory and classify existing color consumers**
  - Audit `secondary`, gold text, on-dark overrides, selection variants, status
    literals, derived borders, shared widgets and static/server consumers.
  - Done when each affected use is assigned a brand, neutral, selection, semantic,
    provider-brand or content role; intentional exceptions are documented.
  - **Verified:** Consumer inventory above and adoption exceptions reconcile
    remaining secondary uses, dark compatibility, static email and hidden routes.

- [x] **COLOR-02 — Implement the selected token contract**
  - Update `tokens.ts`, add necessary state tokens, preserve helper key safety
    and regenerate CSS. Do not edit generated CSS by hand.
  - Done when HEX/HSL round trips, token references, generation drift checks and
    type checks pass. Depends on COLOR-01.
  - **Verified:** Palette round-trip/helper-key tests, TypeScript and
    `pnpm run design:check` pass in the final integrated checkpoint.

- [x] **COLOR-03 — Migrate utility mappings and dark-surface overrides**
  - Update Tailwind mappings, explicit selected treatments, outline effects and
    sidebar/on-dark CSS behavior together.
  - Done when neutral secondary actions and blue selected states are distinct,
    no bright on-dark ink leaks onto white, and focus remains visible.
  - Depends on COLOR-02.
  - **Verified:** Neutral/selected utility, border-source, composited hover/active
    and separated focus tests pass; obsolete bright-on-dark overrides removed.

- [x] **COLOR-04 — Enforce light-only application behavior**
  - Cover initial render, navigation, native controls, overlays and system-dark
    preference. Inventory legacy dark APIs before any compatibility removal.
  - Done when application-owned routes remain light without a theme toggle,
    theme flash or unintended `.dark` activation. Depends on COLOR-02–COLOR-03.
  - **Verified:** Initial HTML, legacy helper/class and OS-dark browser checks
    pass; native controls and overlays retain light scheme without suppressing
    forced-colours accessibility overrides.

### P2 — Component and page adoption

- [x] **COLOR-05 — Migrate the shell, sidebar and page headers**
  - Apply white navigation, ink titles, slate descriptions and pale-blue active
    items to desktop/mobile shells, including applicable admin navigation.
  - Done when active, hover and focus states are distinct; navigation stays
    accessible; Performance remains hidden. Depends on COLOR-03–COLOR-04.
  - **Verified:** Actual-App navigation/current/focus checks and app/admin source
    guardrails pass. White navigation, current marker and mobile opener retained;
    admin page-layout differences remain disclosed outside the six-page scope.

- [x] **COLOR-06 — Migrate buttons, tabs, chips and shared widgets**
  - Apply explicit primary/secondary/selected states; review Badge, Progress,
    Slider, Sheet, Toast and searchable multi-select consumers.
  - Done when track versus indicator and selected versus hover remain clear,
    with no accidental global orange-to-cobalt replacement. Depends on COLOR-03.
  - **Verified:** Primitive, palette and browser cases pass for primary/neutral/
    selected states, widgets and track/indicator distinction. Neutral taxonomy
    and provider containers are intentionally not recoloured as selection.

- [x] **COLOR-07 — Migrate form boundaries, focus and validation states**
  - Apply white fields, readable text, stronger necessary outlines, visible focus
    and semantic errors, including rich-editor focus styling.
  - Done when actual rendered normal/focus/error/disabled/read-only fields meet
    the contract at desktop/mobile sizes. Depends on COLOR-03 and COLOR-06.
  - **Verified:** Actual rendered field/focus/error/readonly checks pass, including
    Idea ring and labelled colour-swatches' icon/boundary contrast. Text thresholds
    stay 4.5:1 normal / 3:1 large; essential boundaries and indicators use 3:1.

- [x] **COLOR-08 — Apply page-specific selection and status rules**
  - Cover Home, Discover, Create, Content, Calendar and Settings, including empty,
    loading, partial, saved, failed and uncertain states.
  - Done when statuses retain accurate meaning and Create keeps its neutral 6px
    cards, exact content and existing safety guards. Depends on COLOR-05–COLOR-07.
  - **Verified:** Loaded and exceptional actual-App/publishing/generation cases
    pass for all six pages and both Create modes. Neutral 6px cards, literal
    content and separate persistence/delivery/recovery states remain intact.

- [x] **COLOR-09 — Review authentication, public and remaining shared surfaces**
  - Migrate legacy ink panels as whole foreground/background pairs, preserve
    official provider brands and review shared static-render consumers safely.
  - Done when no application-owned surface relies on old gold/dark assumptions,
    and no emails/provider actions were triggered just to test styling.
  - Depends on COLOR-01–COLOR-04.
  - **Verified:** Palette source/browser guardrails and 20 sandboxed email-render
    tests pass. Light foreground/background pairs migrated together; provider
    identity preserved. No email or real provider action used as styling proof.

### P3 — Cross-page verification, documentation and release

Testing starts with each task above; P3 is the combined acceptance gate.

- [x] **COLOR-10 — Add token, utility and component contrast regressions**
  - Update `client/src/design/contrast.test.ts` and relevant foundation tests to
    assert semantic roles and actual light surfaces rather than old gold names.
  - Done when contrast, generated utilities, alpha compositions and focus
    separation are covered. Do not lower thresholds merely to make tests pass.
  - Depends on COLOR-02–COLOR-09 as each consumer migrates.
  - **Verified:** Design files contribute 97 contrast, 16 primitive, 40 foundation
    browser, 7 palette browser and 61 palette cases to the green integrated run.
    Alpha compositions/state colours/focus separation covered; no lowered text
    thresholds. These 221 cases are included in 1,150, not additional totals.

- [x] **COLOR-11 — Verify real routes and interaction states visually**
  - Review 320, 375, 768, 1024 and 1440px; both Create modes; menus/dialogs;
    keyboard focus; 200% zoom; reduced motion; OS dark preference and forced colors.
  - Done when screenshots and browser checks cover loaded and exceptional states,
    not only empty component fixtures. Record untested device/assistive coverage.
  - Depends on COLOR-05–COLOR-10; supports UX-26.
  - **Verified locally:** Automated rendered-state/interaction acceptance at all
    five widths; 91 actual-App captures include loaded, empty/error, conflict,
    partial and confirmed-scheduling states. OS-dark, 200% text-only zoom, forced
    colours and reduced motion pass. Screenshot sets use 375/1440px, not every
    state at every size. Full human pixel review, real devices/screen readers,
    production webfonts and other browser engines are not certified.

- [ ] **COLOR-12 — Update adoption records and verify the scoped release**
  - Record changed files, remaining exceptions, test/build results, artifact
    identity, rollback and production verification through UX-28.
  - Done when local acceptance and actual deployment are separately evidenced;
    remaining master-tracker tasks stay open. Depends on COLOR-10–COLOR-11.
  - **Blocked | Owner: Copilot / release operator:** Local docs/tests/build and
    source/artifact fingerprints are recorded in the current handoff. Next approve
    exact release/schema scope, AI-worker drain, rollback and bounded authenticated
    acceptance; no deployment has occurred. UX-28 stays open.

## 11. Validation and delivery procedure

Use the following for future changes. Current outcomes are recorded in
[the release handoff](UI_UX_RELEASE_HANDOFF_2026-10-01.md):

1. Run `pnpm design:tokens` after editing the authored tokens, then
   `pnpm design:check`. Inspect the generated diff.
2. Run `pnpm exec tsc --noEmit --incremental false` and
  `node test/ux-priority/run.mjs --design-only`; the whitelist runner avoids
  root database setup and dotenv loading. Use the full UX runner for integrated
  acceptance. Current full result: 1,150/1,150, 24 files, zero skips/failures.
3. Compile into an owned temporary directory with Vite env loading disabled and
  exported `serverBuildOptions()`; preserve workspace `dist`. The current build
  is `/tmp/tsp-ux-release-build-OlN05J/` (25 compressed assets), with the known
  nonfatal PostCSS warning. Do not substitute unrestricted DB tests or an
  unbounded live-provider run for focused colour validation.
4. Verify actual routes/states and palette consistency, including browser-native
   fields, mobile navigation and legacy shared surfaces.
5. Review the diff to confirm no API/provider/model, publishing, billing,
   authentication or persistence behavior was changed as a color side effect.
6. Deploy only through the normal authorized process; verify the actual deployed
   revision. A local palette preview is not production acceptance.

No paid generation, publication, email delivery, schema operation or secret
change is required to implement or test the visual palette in isolated fixtures.

## 12. Non-goals and preservation rules

- No new dark theme or theme switcher.
- No wholesale page redesign, replacement component library or feature expansion.
- No changes to article/idea generation behavior, retries, quotas, provider
  deadlines, model selection, publishing approvals or uncertain-delivery guards.
- No automatic draft persistence, scheduling or publication.
- No reintroduction of Performance and no unverified analytics redesign.
- No recoloring of official provider marks, uploaded images or user-authored media.
- No claim that color changes fix the production generation timeout. That work
  remains in [Production generation reliability](PRODUCTION_GENERATION_RELIABILITY_2026-09-30.md).

## Appendix A — HEX to bare-HSL implementation reference

The existing generator expects bare HSL triplets, without `hsl(...)`. Values below
are rounded to six decimal places and should round-trip to the listed 8-bit HEX.
They are documentation values, not a second authored runtime token file.

| HEX | Bare HSL triplet |
| --- | --- |
| `#F8FAFC` | `210 40% 98.039216%` |
| `#FFFFFF` | `0 0% 100%` |
| `#0F172A` | `222.222222 47.368421% 11.176471%` |
| `#475569` | `215.294118 19.318182% 34.509804%` |
| `#1D4ED8` | `224.278075 76.326531% 48.039216%` |
| `#1E40AF` | `225.931034 70.731707% 40.196078%` |
| `#1E3A8A` | `224.444444 64.285714% 32.941176%` |
| `#EFF6FF` | `213.75 100% 96.862745%` |
| `#F1F5F9` | `210 40% 96.078431%` |
| `#E2E8F0` | `214.285714 31.818182% 91.372549%` |
| `#7C8798` | `216.428571 11.965812% 54.117647%` |
| `#166534` | `142.78481 64.227642% 24.117647%` |
| `#F0FDF4` | `138.461538 76.470588% 96.666667%` |
| `#B91C1C` | `0 73.70892% 41.764706%` |
| `#FEF2F2` | `0 85.714286% 97.254902%` |
| `#854D0E` | `31.764706 80.952381% 28.823529%` |
| `#FEFCE8` | `54.545455 91.666667% 95.294118%` |

## Decision and verification log

| Date | Decision/change | Evidence/status |
| --- | --- | --- |
| 2026-10-01 | User selected Ink & Cobalt, light-only | Documented target; runtime palette unchanged |
| 2026-10-01 | Defined token mappings, component rules and COLOR-01–COLOR-12 | All implementation tasks not started |
| 2026-10-01 | Calculated documented opaque sRGB contrast pairs | Pair calculations only; rendered-state acceptance remains pending |
| 2026-10-01 | Implemented full token/consumer/light-only migration, including email RGB pairs; reconciled inventory and adoption docs | COLOR-01–COLOR-11 locally verified. 1,150-test integrated run, TypeScript/token drift/temp build pass; 91 actual-App screenshots and rendered-state checks. COLOR-12/UX-28 blocked on production gate; no deployment. |
