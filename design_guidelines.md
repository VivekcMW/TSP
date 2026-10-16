# TheSocialPundit Design Guidelines

## Adopted direction — 2026-10-01

**Ink & Cobalt, light-only**: white panels/sidebar, a light canvas, ink text,
cobalt actions and explicit selected states. Prior amber branding, dark-sidebar
and modal-first composition recommendations are superseded.

This guide describes current source contracts and adoption rules, not completed
release acceptance. [Component contracts](docs/design-system.md) are the detailed
reference; [implementation notes](docs/UI_UX_IMPLEMENTATION_2026-10-01.md) record
exceptions, the green local acceptance (1,156 integrated tests, type/token/build
checks) and the still-open production release gates.

Principles: clarity over decoration; typography and spacing before more boxes;
visible, recoverable state; and no success claim beyond the acknowledged action.

## Tokens and typography

- Author tokens in `client/src/design/tokens.ts`; consume semantic classes and
  generated CSS. Do not hand-edit `tokens.generated.css` or add chrome colours.
- Use Poppins for headings, Inter for body/UI and JetBrains Mono for technical
  content. The legacy `font-serif` alias also resolves Poppins.
- Dashboard `PageHeader` uses a 24px `heading-dashboard` title. Reserve fluid
  `heading-display` and `heading-section` for marketing/editorial hierarchy.
- `secondary` is neutral; `accent` is selected cobalt-on-pale-blue. Selection is
  not just a secondary button or a colour change: expose pressed/current/tab
  semantics appropriate to the control.
- Use paired outcome tokens for info, success, warning and error. Pale status
  surfaces need coloured ink, not white foreground text. Warnings may use their
  brown/amber semantic ink, not decorative gold for every AI feature.
- The dark exports/selector and `surface-ink` names are light-only compatibility,
  not a hidden dark theme or permission to restore dark marketing panels.

## Page composition

Use one outer `main` containing the page `h1` and `PageBody as="div"`. Do not
nest main landmarks. Give PageHeader and PageBody the same `width`:

| Width | Measure | Use |
|---|---|---|
| `reading` | 48rem | Content / reading and review |
| `standard` | 64rem | General dashboard/forms; default |
| `workbench` | 80rem | Create / Calendar |

Shared gutters are **16px, then 24px from 640px**. Avoid another padded or
independently constrained outer container. Keep shrinkable flex/grid ancestors;
choose body scrolling or parent/split-pane scrolling explicitly.

PageHeader contains identity and essential actions. **No title icons**: its
optional `icon` prop is deprecated compatibility and ignored by the renderer.
Do not emulate the old icon box in the title. Put secondary filters and actions
in a named `PageToolbar` **inside PageBody**; it wraps and is non-sticky, without
extra gutters or a fixed height. Article controls stay in normal flow within the
shared gutters. Idea actions become locally sticky only at desktop `lg` (1024px);
mobile actions are non-sticky. Do not add negative gutter escapes or overlay bars.

The authenticated shell owns its existing collapsible/sidebar navigation; do
not replace mobile navigation with an invented bottom bar. Primary dashboard
routes are Overview, Create, Discover, Content, Calendar and Settings. Old
Drafts/Published/Connections/Billing bookmarks redirect to their current
destinations; a legacy file's layout is not automatically an active route.

## Shared controls and surfaces

- **Button:** desktop standard/default is 36px, small/card actions 32px, large
  CTA 40px, icon-only 36×36px, Idea formatting 32×32px. Use 14px labels (13px
  small/compact), 16px icons, 6px corners/gaps and content-based widths. Match
  primary/secondary geometry within a group. These are minimums: allow wrapping
  and text zoom, not fixed heights. Below 768px or with any coarse pointer,
  retain **44×44px actual non-overlapping targets**, including touch laptops.
  Fields and navigation keep their existing sizing; remove blanket action-height
  overrides rather than shrinking fields. See the detailed size/padding table.
  Keep an accessible name, visible focus and a stable label while loading.
  Navigation uses `asChild` with one link, not nested interactive elements.
- **Field:** use the label/help/error/counter contract. Spread its generated IDs
  and ARIA attributes onto the actual input/select/Radix trigger. A placeholder
  is not a label. Disabled controls need nearby reasons where useful.
- **SegmentedControl:** a named pressed-button group, not tabs; the caller owns
  selection, with native Tab/Enter/Space behavior. Use genuine Tabs for panels.
  Options/tabs are 32px desktop and at least 44px mobile/touch, with 13px labels;
  a single row including group padding is 40px / 52px tall.
- **Card:** neutral border/shadow and 6px corners. Comfortable density is
  16px/24px responsive padding; compact is 12px. `CardTitle` defaults to `h2` and
  accepts `h3`–`h6`; choose hierarchy, not a visual size masquerading as a heading.
- **WorkflowStatus:** use local neutral/info/success/warning/error messages with
  text and icons, not colour alone. Dynamic errors alert; other dynamic outcomes
  announce as status. Static or duplicate guidance uses `live={false}`; actions
  remain outside the live region.

## Create is a workbench, not a generation modal

The canonical `/dashboard/create` route presents Idea and Article modes using
`InstantReviewPanel` and the account/tenant-scoped `CreatePostProvider`. Dialogs
remain appropriate for focused editing, confirmation and scheduling; they are
not the default container for the whole creation workflow.

- Preserve the **6px Article bento**, stacking on narrow screens and using two
  columns when space permits. Keep a maximum of **four selected platforms**,
  generated **one at a time**. Retain completed cards through later failures.
- Keep platform/tone versions separate. Source, tone, format, selection,
  generation, uploads and saves obey the existing ownership guards, including
  same-turn and uncertain requests. Regeneration must not silently overwrite
  edits. Continue only unattempted batch cards; retrying a failed card as a new
  generation is explicit and may consume usage.
- Preserve ordinary route-resume state. Start new, change story, replace URL or
  switch mode must confirm when replacing existing work; incoming story links
  cannot silently reset it. Saved records remain in Content after replacement.
- Idea source is **plain text**; Markdown remains literal. Preserve every
  formatting tool and its horizontal scroll/keyboard access. Disclose that
  fonts, colours and rich styling affect the preview only, are not submitted or
  restored after navigation, and do not promise platform formatting. Attachments
  are retained separately in the session, not inspected as verified evidence.
- Saving an existing version uses revision CAS, not last-write-wins. Conflict
  review offers Load latest, Keep local text, or Use reviewed latest as baseline;
  none silently saves. See [recovery and reconciliation](docs/editorial-reload-recovery.md).
- Reload recovery stores only tenant/user/job/intent IDs, not text or selection.
  It reads the original acknowledged job; it never autosaves, regenerates or
  silently replays an uncertain operation.

## Honest actions and destinations

| Action / state | Meaning, not an implied next step |
|---|---|
| Generated | Reviewable working text, not saved or fact-verified |
| Copy / Copy & open | Exact current text handed off for manual publication; no delivery receipt |
| Save draft / Save changes | Acknowledged server draft/revision, not approval or scheduling |
| Retain approved voice edit | Explicit consent to retain a sample; not automatic voice enablement or publishing approval |
| Approve publishing | Separate review of the exact saved draft; not delivery |
| Schedule | Explicitly confirmed text, targets and time/zone; delivery still pending |
| Published | Requires the delivery contract's target outcomes/receipts; queued, simulated and uncertain are not live delivery |

Saved links include the encoded draft ID: `/dashboard/content?draft=…` and
`/dashboard/calendar?draft=…`. Select/review that draft, not the first available
one; the link itself never approves, schedules or publishes. Scoped no-store
details lookup resolves IDs beyond bounded lists; distinguish unavailable records
from a failed read. External scheduling admissions bind reviewed text/revision
and schedule/target state under the scoped draft lock; stale consent requires
reconfirmation. See [manual handoff contract](docs/platform-compose-handoff.md).

## Exceptions and responsive acceptance

Intentional exceptions are limited to round avatars/pills/dots/thumbs/progress
tracks; external provider marks/brand colours; categorical chart series; and
user-controlled preview formatting. Static emails use authored-token RGB pairs
with email-specific typography/geometry, not browser CSS variables. Neutral
helper text, taxonomy chips and provider containers need not become cobalt.
These exceptions do not permit arbitrary app-chrome colours, title icons or
large card radii.

Verify mobile/sidebar-reduced widths, text zoom, focus visibility, wrapping and
reduced motion. Horizontal scrolling belongs to the constrained strip/table,
not the whole editor; outer overflow clipping is not evidence that content fits.
Keep loading, empty, error, permission and uncertain states distinct. Preserve
explicit saves, destructive confirmations and recovery actions across layouts.

Marketing may use larger display type and genuine product imagery, but never
invent customer counts, testimonials, compliance badges or screenshots. Label
illustrations as examples; capabilities and pricing must match the product.

## Acceptance and release scope

The [implementation notes](docs/UI_UX_IMPLEMENTATION_2026-10-01.md) record current
verified reports and 91 actual-App screenshots. The six dashboard pages are the
layout acceptance scope; active admin pages retain disclosed layout gaps despite
colour migration. Chromium checks are not real-device/screen-reader or complete
human visual-review certification. Deployment remains separately gated in the
[current handoff](docs/UI_UX_RELEASE_HANDOFF_2026-10-01.md); never infer production
acceptance from local screenshots or historical approvals.