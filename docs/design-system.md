# Design system

## Adopted source contract — 2026-10-01

The current source implements **Ink & Cobalt, light-only**. This replaces amber
brand emphasis, dark sidebars, dark marketing panels and modal-first Create
guidance. Local integrated acceptance passes: **1,156 tests**, TypeScript, token
drift and temporary client/server build. This is **not deployment acceptance**.
See [implementation notes](UI_UX_IMPLEMENTATION_2026-10-01.md) for artifacts,
scope limits and remaining release gates.

The [palette specification](INK_AND_COBALT_LIGHT_THEME.md) remains the design
reference; its checklist and the UX master tracker distinguish local completion
from the still-open UX-28/COLOR-12 deployment gate.

## Token ownership and light-only compatibility

- Author values in `client/src/design/tokens.ts`; the `design:tokens` package
        script produces `tokens.generated.css`, imported by `client/src/index.css`.
        Never hand-edit the generated file. `design:check` checks drift and passed
        for the current accepted source.
- Prefer semantic Tailwind classes. Use `cssVar()` for inline CSS references and
        `color()` for consumers that need resolved literal colours. Do not introduce
        app-chrome colour literals or independent palettes.
- Colours are bare HSL triplets so Tailwind can compose alpha values. Use the
        explicit state/surface pairs below rather than opacity to invent a status.
- `darkColors = lightColors` and `darkEffects = lightEffects` are compatibility
        aliases. The legacy `color(token, "dark")` argument still resolves light.
        Generated `.dark` variables also resolve light; Tailwind's legacy `dark:`
        selector is non-matching (`:not(*)`). CSS sets `color-scheme: only light`.
        Neither OS preference nor a legacy class enables another theme.
- `surface-ink` now aliases white with ink text; it no longer means a dark
        panel. `secondary-on-dark` is legacy neutral helper ink, not a dark-theme API.
        New code should use the semantic surface/text roles directly.

| Role | Tokens / usage |
|---|---|
| Canvas and readable text | `background`, `foreground` |
| White panels and overlays | `card`, `card-foreground`, `card-border`; `popover` pairs |
| Primary action | `primary`, `primary-foreground`, `primary-hover`, `primary-active` |
| Neutral action / hover | `secondary`, `secondary-foreground`, `secondary-hover` |
| Selected state | `accent`, `accent-foreground`, primary border; separate from neutral actions |
| Helper content | `muted`, `muted-foreground`; legacy `text-secondary` maps to neutral `secondary-text` |
| Outcome surfaces | `info` / `info-subtle`, `success` / `success-subtle`, `warning` / `warning-subtle`, `destructive` / `destructive-subtle` |
| Essential boundaries | `input` for controls, `ring` for focus; `border` for decorative dividers |
| Sidebar | White `sidebar`, ink `sidebar-foreground`, cobalt selected/focus pairs |
| Data categories | `chart-1` through `chart-5`, ordered by `chartSeries`; not action/status colours |

`borderSources` maps derived borders explicitly: primary/accent selection uses
primary, neutral outlined controls use input, and muted dividers use border.
White success/destructive foreground tokens belong on solid fills, **not** their
pale `*-subtle` surfaces. Warning ink may be brown/amber for an actual warning;
that is not a return to decorative gold branding.

## Typography, geometry and motion

- Poppins (`font-heading`) for headings, Inter (`font-sans`) for body/UI, and
        JetBrains Mono (`font-mono`) for code/technical content. `font-serif` is a
        compatibility alias to Poppins, not a separate serif heading system.
- App page titles use `heading-dashboard` (24px, weight 600); marketing display
        and section titles use `heading-display` / `heading-section`. Do not apply
        marketing display sizes to dashboard page headers.
- Controls and cards use **6px** corners. Small geometry has a 4px token; pill
        geometry is explicitly separate. Preserve the 6px Article bento cards.
- Authored spacing is 4/8/12/16/24/32px; surface padding is 12/16/24px. Motion
        tokens are 120/180ms. Respect reduced motion and avoid scroll-reveal gates
        that can leave operational data invisible.

## PageHeader, PageBody and PageToolbar

Source: `client/src/components/dashboard/page-header.tsx`.

| `width` | Maximum measure | Appropriate use |
|---|---|---|
| `reading` | 48rem (`max-w-3xl`) | Narrow reading/review surfaces |
| `standard` (default) | 64rem (`max-w-5xl`) | General dashboard content/forms |
| `workbench` | 80rem (`max-w-7xl`) | Create bento, Content and Calendar |

Pass the **same width** to header and body. Both use centred, shrinkable
containers and **16px gutters, 24px from `sm` (640px)**. Do not add a second
outer padding/max-width wrapper. `contentClassName` is a legacy escape hatch;
if necessary, apply the same override to both edges, not only one.

Use **one outer `main` containing the page identity and body**. Within it,
`PageBody as="div"` avoids nested landmarks. `PageBody` defaults to `main` for
compatibility, so it does not enforce this composition automatically. Body
scrolling is the default; set `scrollable={false}` when a parent or split panes
own scrolling. Keep `min-w-0`/`min-h-0` through those containers.

`PageHeader` owns the single page `h1`, subtitle, small stats and essential
actions. Its default is sticky; use `sticky={false}` when another region owns
the sticky behavior, as Create does. Actions wrap rather than clipping.
**No decorative title icons.** The optional `icon` prop is deprecated
compatibility: it is destructured as `_icon` and intentionally never rendered.
Old callers may still pass it; new callers should omit it, not add an icon to
`title` or recreate the old icon box. Semantic action/provider icons are distinct.

`PageToolbar` belongs **inside PageBody**, with a scoped accessible name such as
"Content filters". It is a wrapping native `fieldset`, not an ARIA toolbar:
native Tab behavior is retained. It has no sticky positioning, fixed height,
extra gutters or independent page width. Put filters in its children and
secondary actions in `actions`. Article's generation controls remain in normal
flow within shared gutters. Idea's action bar is locally sticky only from `lg`
(1024px), not on mobile. Neither justifies sticky page filters or negative-gutter
wrappers that escape the shared frame.

## Controls

### Button

Source: `client/src/components/ui/button.tsx`.

Approved compact scale (fine-pointer layouts at least 768px wide):

| Control | Minimum height | Label | Horizontal padding |
|---|---:|---:|---:|
| `default` / `standard` | 36px | 14px | 12px |
| `sm` / secondary card action | 32px | 13px | 10px |
| `lg` / prominent CTA | 40px | 14px | 16px |
| `icon` | 36×36px | Accessible name, 16px icon | 6px |
| `compact` / Idea formatting | 32px (32×32px icon tools) | 13px / 16px icon | 8px |
| Segmented option / tab | 32px | 13px | 10px |

- Use **6px corners and 6px icon–label gaps**, content-based widths and the same
        size for paired primary/secondary actions. Priority comes from colour,
        not different dimensions. Labels wrap; these are minimums, not fixed
        heights that clip translations or text zoom.
- **Below 768px or whenever `any-pointer: coarse` matches**, every size has an
        actual **44×44px minimum target** via `control-touch-target`, including
        touch laptops. Targets occupy layout space; do not overlap invisible hit
        areas. Consumer height/min-size utilities must not defeat this minimum.
- Idea's full 24-control strip uses 32px desktop controls and 44px touch targets.
        Date-picker cells and headings grow with date buttons to prevent overlap;
        constrained internal scrolling handles insufficient room for seven dates.
- Standard single-line fields use the shared 44px minimum below; sidebar
        navigation and dialog close affordances retain 44px targets on desktop too.
        Avoid blanket ancestor button-height rules or fixed heights overriding the
        scale. Keep adjacent input/action rows centred rather than stretching actions.
- Use `selected` with `aria-pressed` or genuine tab semantics. `secondary`,
        `outline` and `ghost` are neutral actions, not a selection indicator.
- Preserve focus rings, disabled styling and accessible names. `loading`
        blocks activation, sets busy state and keeps the label in the layout while
        showing a decorative spinner. Do not replace a meaningful name with an icon.
- For navigation, `asChild` takes one ref-forwarding link. Never nest a button
        inside a link or a link inside a button. Pass `disabled`/`loading` to block
        activation; an ARIA attribute alone is not an action guard.

### Field and SegmentedControl

Sources: `client/src/components/ui/{field,segmented-control}.tsx`.

`Field` supplies a label, optional help/error/counter, unique control ID and
merged `aria-labelledby` / `aria-describedby` references. Spread the `render`
callback's props onto the actual native control or Radix trigger, not a wrapper.
Only rendered descriptions receive references; errors set invalid state and
announce with `role="alert"`. Use `fieldControlClassName` for compatible native
controls; the shared control minimum is 44px.

Input alignment contract:

- `Input`, `NativeSelect`, Radix `SelectTrigger` and searchable pickers share a
        **44px minimum height**, **6px corners**, `border-input` / `bg-card`, and
        **12px horizontal / 8px vertical padding**. Text is 16px on narrow screens,
        14px from `md`; retain native picker behavior rather than replacing it for
        cosmetic uniformity.
- Button-backed pickers use `fieldTriggerClassName`, not action-button sizing.
        It aligns the value and chevron across the inner `data-button-label` wrapper.
        Compound search/chat inputs use one outer field frame, not nested borders.
- `fieldLabelRowClassName` reserves **36px**, or **44px below 768px / on coarse
        pointers**, with or without contextual help. `Field` uses an 8px label/control
        gap. Rows and controls may grow for wrapping labels and text zoom; do not set
        fixed heights or truncate labels to force alignment.
- Textareas remain multiline (**80px minimum**, larger editor heights retained).
        Checkbox/switch visuals remain compact with accessible labelled hit areas.
        The approved Idea formatting toolbar remains 32px desktop / 44px touch.
- Supplementary guidance uses `InfoTooltip` beside its label, available on
        hover, focus, keyboard and tap. Its stable description remains associated
        while closed. Never nest the help button inside a label. Validation errors,
        character counts, consent, safety warnings and live status remain visible.

`field-alignment.browser.test.ts` checks native input types, composed pickers,
mixed help/no-help rows, keyboard selection, refs/ARIA, disabled/read-only/error
states, narrow/coarse layouts and 200% root-font reflow. Run it via the exact-file
`test/ux-priority/run.mjs` allowlist, not the database-oriented root test setup.

`SegmentedControl` is a named `fieldset`; its items are buttons with
`aria-pressed`, not tabs. The caller owns single/multiple selection. Preserve
native Tab/Enter/Space; use real Tabs for tab panels and arrow-key tab behavior.
Options use the 32px desktop / 44px touch scale above; the 4px group padding
makes a single-row group 40px / 52px tall. Groups grow when labels wrap.
Wrap groups normally. An intentionally horizontal catalog/formatting strip must
scroll **inside its own constrained viewport**, with keyboard access, without
moving sibling cards or widening the editor.

## Card and WorkflowStatus

`client/src/components/ui/card.tsx` supplies a neutral 6px surface, card border,
subtle shadow and density inherited by its sections:

- `comfortable` (default): 16px padding, 24px from `sm`.
- `compact`: 12px padding. Header/content/footer can override density explicitly.
- `CardTitle` is a real `h2` by default; choose `as="h3"` through `h6` to follow
        the document hierarchy. Never add a second page `h1`. Content/footer omit
        top padding to compose with the header; avoid arbitrary competing padding.

`client/src/components/dashboard/workflow-status.tsx` provides neutral, info,
success, warning and error ink/surface pairs plus an icon and text. With default
`live={true}`, errors are alerts and other outcomes are status announcements;
use `live={false}` for static guidance or repeated per-card detail. Actions sit
outside the live region. Prefer one local announcement of a changing operation,
not every card repeatedly announcing the same result. The component presents an
outcome; it does not decide whether a save or delivery actually succeeded.

## Editorial workflow invariants

- Keep the responsive **6px Article bento**, at most **four selected platforms**,
        generated **sequentially**, with completed cards visible. Source, selection,
        tone and format stay guarded while an operation owns them. Continuing a batch
        targets only unattempted cards; a failed card needs an explicit new attempt.
- Ordinary dashboard navigation retains the in-memory creation. Replacing a
        story, URL, mode or creation must respect source guards and confirm discarding
        existing work. Incoming story links never silently overwrite a creation.
- Saved draft edits use exact content/revision CAS and explicit conflict review;
        cache refresh is not permission to overwrite. See
        [reconciliation and recovery](editorial-reload-recovery.md).
- Reload recovery stores only the scoped job/intent pointer, never draft text.
        It monitors the original job; it does not autosave, replay or regenerate.
- Idea text is plain text (Markdown stays literal). Preserve the full formatting
        toolbar, but disclose that rich styling is **preview-only**, not submitted or
        restored after navigation; attachments are separate, not fact-checked evidence.
- Copy, save, voice-sample consent, publishing approval, scheduling and delivery
        are separate outcomes. "Generated", "Saved", "Approved" and "Scheduled" must
        never imply "Published". See [handoff boundaries](platform-compose-handoff.md).

## Intentional exceptions, not blanket exemptions

| Exception | Boundary |
|---|---|
| Pills and circular affordances | Avatars, badges/status pills, dots, switch/slider thumbs and progress tracks may remain round. Do not round ordinary cards/actions into pills. |
| Provider branding | External marks and `platformBrand` colours identify providers. They do not define app selection, success, readiness or delivery. |
| Charts | `chartSeries` remains categorical and includes colours outside cobalt. Preserve legends/text; no claim that all rendered chart contrasts have been accepted. Recharts selectors matching library defaults are not authored app palette literals. |
| Content formatting | Idea's font/size/colour tools and their literal picker defaults affect user preview content, not app chrome. They do not create a rich-text persistence contract. |
| Static email | Server-rendered email uses authored-token `emailColor` RGB literals, not browser variables/HSL. Typography/geometry remain email-specific. Twenty sandboxed rendering tests pass; no inbox-client or delivery certification is implied. |
| Neutral metadata | Helper text, provider containers and source/keyword taxonomy chips can stay neutral. A labelled scheduled timestamp need not become cobalt; colour is not delivery proof. |

## Adoption and acceptance

Use these contracts for new/changed surfaces, rather than copying legacy pages.
Some active admin pages still place PageHeader outside their body `main` and use
independent widths/gutters. Those remain follow-up layout work outside the six
dashboard-page scope, not a claim that every route is aligned. Admin colour
adoption does not establish admin responsive/landmark certification.
The [adoption notes](UI_UX_IMPLEMENTATION_2026-10-01.md) identify verified reports,
screenshots and limitations. Automated Chromium rendered-state acceptance is not
real-device/screen-reader, complete human visual review or production acceptance.
