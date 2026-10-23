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

## Platform-admin investigation milestone

- `/admin` is the Command Center: queue readiness, actual environment,
  production scheduler configuration, retained schedule states, affected
  workspaces and bounded recent failure samples. Configuration is not a worker
  heartbeat; missing queue counters are unavailable, not zero. Historical
  failures are not presented as confirmed unresolved incidents.
- `/admin/tenants` uses the server-paginated `/api/admin/tenant-directory`:
  25 workspaces per page, literal name search or exact ID, status/type filters,
  deterministic newest-first ordering and URL-backed search/history. The
  existing `/api/admin/tenants` list contract remains unchanged.
- `/admin/tenants/:id` is a read-only Tenant 360. Opening customer data requires
  an explicit investigation reason. The client supplies the matching
  `x-tenant-id`; the server requires platform tenant/user read capabilities,
  matching context and successful auditing. Tenant source reads retain
  transaction-local RLS plus explicit tenant predicates.
- Detail shows retained article/draft totals, failed and overdue schedule
  counts, members paged in groups of 50 with onboarding status, the latest stored
  subscription, ten recent runs/schedules/payments each and up to 50 source and
  social connection records each. Truncation and absent records are explicit.
  No credentials, provider payloads, raw failure messages or payment instrument
  data are selected. Billing records are not live entitlement determinations.
- Monitoring aggregates schedules in SQL rather than loading all schedules,
  processes at most four tenant transactions concurrently, and caps failure
  samples. It still visits every tenant; large-scale rollups, worker liveness
  and safe recovery controls remain later work.
- These screens use existing Ink & Cobalt components and responsive layouts.
  This milestone introduces no migrations, privileged mutations or automated
  retries. It does not certify the later phases of the admin roadmap.

### Expanded local operations milestone

- Admin authorization now requires **both** an existing provisioned staff role
  and a verified email matching `hello@thesocialpundit.com` or
  `marketing@thesocialpundit.com`. Matching ignores case and surrounding
  whitespace, not aliases or subdomains. Signing up with an approved email
  does not grant a role. Server tenant resolution, permission enforcement,
  sanitized account responses and the admin layout use the same policy.
  Tenant owners are not platform admins. MFA was explicitly declined for this
  scope; do not represent an MFA gate as implemented.
- The local `dev@example.com` bypass identity is intentionally denied, even
  if it retains an old stored staff role. Do not rewrite its email, invent a
  password, mark an account verified or add a development exception.
- After signing up and actually verifying ownership of an approved account,
  an authorized local operator can run
  `pnpm exec tsx scripts/provision-local-admin.ts hello@thesocialpundit.com grant`
  (or `marketing@thesocialpundit.com`). `revoke` removes the role. The command
  requires an existing account, writes an audit record atomically, and refuses
  production mode, non-loopback hosts and database names not ending in `_dev`
  or `_test`. It does not create accounts or change verification/passwords.
  Local normal sign-in requires deliberately disabling `DEV_AUTH_BYPASS` and
  its frontend counterpart rather than forging the bypass user's identity.
- The VS Code **Run TheSocialPundit locally** task explicitly disables both
  bypass flags and sets the auth/application origin to `http://localhost:4300`.
  These task-scoped overrides take precedence over existing dotenv values;
  plain `pnpm dev` does not inherit the task overrides. Restart using that task
  and open `http://localhost:4300/sign-up`, choose an approved mailbox and your
  own password, and follow the real mailbox verification link on the same
  machine. Creating the account can send a verification email; do not submit
  on another person's behalf or manually set verification status. After
  verification, run the provisioning command above, then open `/admin`.
  Provisioning is local only; a production account/role is not copied locally.
- Users and Audit Log are now server-paginated searchable directories, with
  URL-backed filters and explicit outage/retry states. User details require
  an investigation reason and show safe identity fields, memberships paginated
  in pages of 100,
  saved communication preference signals and the latest 20 attributable
  account-wide email delivery states. This is not complete email delivery
  history; unattributed legacy deliveries are not inferred. No provider
  errors, credentials or email deduplication keys are exposed.
- Tenant member pagination retains the original reason and tenant context
  for every page. Source fetch timestamps/status and stored social token
  expiry are diagnostics, not live availability checks. URLs, tokens and
  provider payloads are not selected. Payment values are explicitly stored
  minor currency units, not revenue, provider reconciliation or entitlement.
- Command Center and Monitoring show Redis-backed scheduler cycle observations
  only after real lock/slot admission. Run identity fences late completion;
  last success survives new starts/failures. Records expire after 30 days,
  can disappear with Redis loss and become stale after twice the configured
  cadence (minimum five minutes). Missing, malformed and unavailable records
  never imply success. Cycle completion does not certify per-scope outcomes,
  individual worker liveness or end-user email/publication delivery.
- Campaign controls retain single-admin explicit confirmation and add
  reason-gated pause/resume and independently enabled self-tests. See the
  [email contract](notifications-media-contract.md#announcement-operator-controls)
  for admission races, test identity and flag behavior.
- Outside the earlier milestone (superseded by the advanced controls below): global delivery search, complete account
  membership pagination, worker liveness/oldest-queue-age alerts and incident
  lifecycle, eligibility-checked recovery with verified outcomes, billing
  reconciliation/quota adjustments/AI cost ledger, source-quality analytics,
  owned/expiring targeted feature rollouts, rollups/load acceptance and global
  search/saved views. No production deployment, remote migration or provider
  acceptance is implied. Existing email migrations 0055/0056 remain rollout
  prerequisites; the added `paused` state uses the existing varchar column.

### Advanced admin controls and operating runbook

The locally implemented roadmap adds Operations, Email Deliveries and Platform
Search alongside Tenant 360, Users, Audit Log, campaigns and monitoring. All
controls retain verified/provisioned staff policy, server permissions, no-store
responses, audited intent and transaction-local tenant RLS. No approved local
admin account currently exists; the development bypass remains denied.

- **Investigation:** delivery search supports literal recipient/exact identity,
  account, type and status filters at 25 records/page. It excludes bodies,
  raw provider errors, claims and deduplication keys. Account membership pages
  retain investigation context. Platform Search searches four audited directories,
  shows the first five matches/source and links to full results. Failed sources
  are errors, not empty results. Up to ten saved views are validated internal
  URLs stored locally in the browser and namespaced to the signed-in account;
  they are not shared or cross-device preferences.
- **Recovery:** only retained failed discovery jobs with their original job,
  tenant, member, operation and deduplication identity can be admitted. Current
  workspace/membership and original-mode receipt are rechecked. Existing queue
  admission reserves at most two recoveries without resetting attempts or
  removing/recreating jobs. UI requires a reason and explicit confirmation;
  returned queue state is not completed customer work. Historical pipeline rerun
  is deliberately retired with HTTP 410 because it created new identities.
  Publishing, payment and unknown email outcomes remain investigation-only.
- **Health:** registered workers write process heartbeats every 15 seconds,
  expiring after 60 seconds. These show process responsiveness, not job success.
  Waiting scans cover at most 5,000 retained jobs/queue; incomplete scans cannot
  establish a healthy backlog. Queue movement can change the sampled ordering.
  Unknown/malformed/unavailable observations never become healthy defaults.
- **Incidents:** production-required queue loss, observed worker absence, waiting
  age over 15 minutes, and failed/stale/never-observed scheduler cycles produce
  durable in-app incidents. No email, SMS or external webhook is sent.
  Acknowledge/resolution is reason- and version-fenced, serialized with automatic
  evaluation, and commits a completion audit atomically. An actively failing
  signal reopens after manual resolution; missing observations do not resolve it.
  `ADMIN_OPERATIONS_ENABLED=true` schedules evaluation every minute only with
  the existing production scheduler gates. It defaults false.
- **Quota:** workspace-scoped reasoned grants use stable request UUIDs, future
  expiry within 30 days, a combined active cap of 1,000 and idempotent revocation.
  Existing generation admission enforces additions atomically under its billing
  lock. They add to each finite valid allowance period while active, never
  reset consumption, unlock a denied plan, change a paid plan or charge a user.
  On uncertain response inspect grants and reuse the same intent; choosing a
  distinct identity can create another grant.
- **Flags:** reasoned controls have owner, expiry, exact tenant targeting,
  revision fencing and immutable before/after history. Enable requires an owner
  and expiry within 30 days. Empty targets mean global; expired policies deny.
  Decisions use trusted request scope even with cached policy rows. Cross-process
  cache invalidation is bounded by 30 seconds, not instantaneous. Deleting restores
  the shipped fallback and may enable the feature; confirmation warns about this.
  Only `team_workspaces` currently has a runtime consumer; arbitrary flag rows
  do not implement additional product behavior. Policy outages fail closed.
- **Insights:** reason-gated workspace queries expose 30-day stored payment
  states in separate currencies/minor units, generation states, content freshness,
  canonical/relevance coverage and feedback events. Current source status is
  not historical reliability. AI observations require separately enabling
  `AI_OBSERVATIONS_ENABLED`; only scoped dispatched attempts and reported token
  or USD-cost fields are stored, never prompts/output/provider payloads.
  Observation writes are asynchronous, best effort, bounded by database
  timeouts and never delay/replay provider work. Shutdown/storage failures can
  leave gaps. Missing cost is unknown, not zero; these are not complete spend,
  verified content quality, live billing reconciliation or unit economics.
  AI/source/feedback grouped lists are limited to 100 groups. The development
  database's missing migration 0053 produces explicitly unavailable feedback,
  not a fabricated zero.
- **Scale:** count-only workspace rollups store observations without content,
  addresses or credentials. Reads are paginated; missing snapshots say never
  observed and snapshots older than 30 minutes say stale. Refresh is explicit
  and scoped. `ADMIN_ROLLUPS_ENABLED=true` schedules 15-minute collection under
  production gates, default false. Collection uses keyset batches of 100 and
  at most four concurrent tenant transactions; failures retain prior snapshots
  and fail the cycle. Legacy live monitoring still visits all tenants, now with
  bounded concurrency; it is not an O(1) read model.

**Local verification and rollout boundary:** migrations 0055 through 0058 have
been applied only to the verified loopback development database. Existing ledger
gaps 0050/0052/0053 remain unreconciled. All 58 migrations replayed successfully
in a separate disposable acceptance database, removed afterward. Run
`pnpm exec tsx scripts/verify-admin-roadmap.ts` for guarded disposable acceptance;
do not run destructive repository-wide fixture tests against development data.
An optional `ADMIN_ACCEPTANCE_REPORT` file path retains JSON timings.

The fixture contains 100 tenants, 10,000 audit records and 10,000 deliveries.
Twenty-five sequential localhost requests per paginated endpoint passed the
one-second p95 assertion: tenant directory 2.88ms, users 2.57ms, audit 11.95ms,
deliveries 4.03ms and rollups 2.86ms in the recorded run. Permission/audit middleware,
RLS, transactions and SQL are real; authentication uses an explicit fixture
identity, not an accepted real-mailbox login. Offline browser fixtures exercise
control confirmation and publishing read-only behavior without live sends.
These measurements are not concurrent load or production certification.
Remote migration review, reviewed ledger-gap reconciliation, real verified
admin sign-in and live-provider/deployment acceptance remain operator rollout
prerequisites, not implicitly completed actions.

## Home dashboard data contract

- Content pipeline is one actionable workflow panel: Discover, Ready to review,
  Scheduled, Published. Each stage has a count, unit and explicit
  navigation action. Highlight ready drafts first, then available discovery,
  then scheduled work; an empty workflow highlights creating a post.
- Desktop uses four columns with decorative directional connectors; mobile
  uses a vertical list with touch-sized actions. This is not a conversion
  funnel or completion progress bar. Published explicitly shows its 30-day
  window. Keep KPI tiles to labels and values, without trends or supporting
  descriptions. Pipeline stages omit explanatory prose; actions remain visible
  even when their count is zero.
- A separate amber strip inside the panel links to posts needing attention.
  Recovery is a blocker, not a fifth stage; hide the strip when none need review.
- Home and Content load all draft pages; the Home pipeline also loads all inbox
  and schedule pages. Metrics refresh every 15 seconds and after publishing
  mutations. Failed required reads show a retry state, not zero-valued metrics.
- Posting streak uses confirmed live publications across all history, grouped in
  the profile's publishing timezone. Invalid/future dates do not count.
- Published this week means Monday through now in that timezone, compared with
  the complete previous Monday–Sunday week. Published in the pipeline means the
  last 30 local calendar days, including today.
- Drafts in pipeline means ready-to-review drafts. Scheduled includes scheduled,
  queued and publishing posts. Needs attention counts distinct drafts requiring
  review or delivery checks, including partial/unverified results and failed
  targets; a draft is never counted twice for multiple failed targets.
- Average time to publish uses valid, nonnegative creation-to-publication
  durations for confirmed posts published in the last 30 local days. With no
  valid samples it displays a dash, not an invented duration. Simulation and
  manual/unverified delivery do not inflate confirmed-publication metrics.

## Calendar filters

- A Filter button precedes the Month/Week/Agenda view controls and opens a
  collision-safe side popover. Search posts, Platform, Status and Display &
  scheduling timezone are shown in the popover without expanding the page.
- Closing the popover preserves selected filters and the display timezone.
  Active-filter guidance and Clear filters remain visible when it is closed.

## Content filters

- A Filter button follows Published, alongside the always-visible Content status
  tabs, and opens a collision-safe side popover. Search drafts, Filter by
  platform and Sort posts are shown in the popover without expanding the page.
- Closing preserves search, platform, sort and bulk selections. Matching-post
  counts, Clear filters and bulk-selection actions remain visible outside the
  popover.

## Discover topic dropdown

- Topics in your recent articles opens an on-demand, single-column dropdown
  list, not a grid of cards or a topic-selection filter.
- Explain the purpose (finding a post idea), last-7-day article counts and
  comparison with the previous 7 days. Each separated row retains source
  coverage, discovery dates, partial-coverage notices and example article links.
- Preserve empty, loading and retry states, keyboard dismissal and the
  distinction between personal article coverage and market/post-performance trends.

## Discover filters, sort and New articles

- Keep All/Saved/Dismissed visible. One Filter button opens an anchored popover
  (never an inline panel that pushes the page down) with search (headline,
  source, keywords), Added to Discover (any/today/7/30 days), topic, source and
  reading (all/unread/read). On desktop it opens beside the button; below 768px
  it opens below it. Both stay inside the viewport (16px collision padding,
  width capped at the viewport, scrolling when taller than the space left).
  Escape and outside presses close it and focus returns to Filter. Closing keeps
  every value, and the button shows the active filter count. Sort stays outside the popover:
  Recently added (default), Relevance, Newest published (missing dates last).
  There is no "most viewed" sort because view counts are not collected.
- The Sort select is a toolbar control, not a form field: it uses the small
  button geometry (32px desktop, 13px label, 44px touch target) so it shares a
  height and centre line with the Topics and Filter triggers and wraps with them.
- Matching count and Clear filters remain visible in the page outside the popover.
- New uses a pale primary row tint plus a small "New" badge; "Added …" (time in
  Discover) is shown separately from the publication date.
- After a refresh, show the actual added count and a Show new articles action
  that resets to All/Recently added without clearing the story being read.

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

All six primary workspace routes (Home, Discover, Content, Calendar, Settings
and Create) use the shared `PageHeader` and `PageBody` with `width="workbench"`.
Keep their title font, top inset and horizontal edges consistent when navigating.
Home and Settings guidance is a visible subtitle, matching the other pages.
Create keeps its save status/actions in the shared header and its editor-view
controls in a separate row below it; editor content remains independently scrollable.

| `width` | Maximum measure | Appropriate use |
|---|---|---|
| `reading` | 48rem (`max-w-3xl`) | Narrow reading/review surfaces |
| `standard` (default) | 64rem (`max-w-5xl`) | General dashboard content/forms |
| `workbench` | 80rem (`max-w-7xl`) | All primary workspace pages |

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
| Static email | Server-rendered email uses authored-token `emailColor` RGB literals, not browser variables/HSL. The shared table-based shell uses Inter/Poppins stacks with Arial/Helvetica fallbacks, 6px token corners, a 600px maximum width, 24px padding, a 24px/600 heading, neutral dividers and secondary actions, and cobalt primary actions. Mobile padding reduces to 16px and buttons stack with 44px-plus targets. Preview text lives in the body; light-scheme hints and an Outlook fixed-width fallback are included. Digest/reminder stories use presentation tables and matching heading/metadata styles. The compatibility welcome sender uses the same content and shell rather than nesting a second HTML document. Sandboxed regression and local responsive-browser checks are not inbox-client or delivery certification. |
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
