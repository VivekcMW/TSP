# UI/UX audit — prioritized task tracker

**Audit date:** 2026-09-30  
**Status:** UX-01–UX-27 verified locally on 2026-10-01; UX-28 blocked on release gates.  
**Progress:** 27 / 28 tasks verified locally.  
**Production rollout:** Not performed for this backlog.

## Scope and evidence

This tracker converts the UI/UX audit into actionable work for Home, Discover,
Content, Calendar, Settings and Create Post, including Article and Idea modes.

- **Observed:** inspected in the local browser. All six pages were checked at
  desktop and mobile sizes; Create received additional 320px and 768px checks.
- **Code:** established by reading the current implementation; paid generation,
  saving and publishing were not executed during the audit.
- **Risk:** a source-derived hypothesis requiring a targeted reproduction before
  choosing a fix. It is not a confirmed production incident.
- This is a local-workspace audit, not authenticated production acceptance or a
  full WCAG certification. Paths below are repository-relative.

### Historical Create header baseline — September 30 audit

The findings and Evidence bullets below preserve the original audit, not current
defects. Current adoption and execution evidence is recorded in each Tracking
entry and [the implementation notes](UI_UX_IMPLEMENTATION_2026-10-01.md).

| Property | Other five dashboard pages | Create Post |
| --- | --- | --- |
| Component | Shared `PageHeader` | Custom header in `InstantReviewPanel` |
| Title size / weight | 24px / 600 | 20px / 400 |
| Title icon | None | Pen icon |
| Vertical padding | 8px | 12px |
| Mobile / desktop horizontal padding | 16px / 24px | 20px / 32px |

At audit time `PageBody` was referenced only by a test. It is now adopted across
the six-page scope, including both Create modes, with coordinated widths/gutters.
The existing component library was extended, not replaced.

## Tracking rules

1. Keep task IDs stable. Use each top-level checkbox as the completion record.
2. Update the task's status, owner and verification evidence when work begins.
   Status values: **Not started**, **In progress**, **Blocked**, **Deferred**,
   **Verified**. Record a reason and next action for blocked/deferred work.
3. Check a task only after its acceptance criteria are verified. Code written is
   not the same as a verified fix. UX-09 is an investigation-first task: document
   reproduction or evidence-backed non-reproduction and its agreed disposition.
4. Add test commands/results, screenshots where useful, and commit/PR references
   under the affected task. Do not record credentials or private draft contents.
5. Update the progress totals and change log below. Local verification does not
   imply deployment; track release acceptance separately in UX-28.
6. Priority expresses impact, not an inflexible serial order. Implement a shared
   dependency before its consumers. Tests belong in every change; P3 groups the
   cross-page acceptance work, not permission to postpone testing.

| Priority | Meaning | IDs | Verified |
| --- | --- | --- | --- |
| P1 — Fix first | Navigation/accessibility blockers and core workflow correctness | UX-01–UX-09 | 9 / 9 |
| P2 — Standardize next | Reusable foundations, visual consistency and workflow clarity | UX-10–UX-24 | 15 / 15 |
| P3 — Maintain and release | Documentation, cross-page regression coverage and rollout gates | UX-25–UX-28 | 3 / 4 |

**Current combined evidence for all verified tasks:**
`node test/ux-priority/run.mjs` passes **1,150/1,150 tests in 24 exact files**, zero
failures/skips/todos, at `/tmp/tsp-ux-priority-sUHyaB/tests.json`. TypeScript,
token drift and temporary client/server build pass. Earlier 66/225-test entries
are historical increments, not extra totals. See the current checkpoint below
and [release handoff](UI_UX_RELEASE_HANDOFF_2026-10-01.md) for exact artifacts,
91 actual-App captures and remaining limitations.

## P1 — Navigation, accessibility and workflow correctness

- [x] **UX-01 — Restore a reachable mobile navigation opener**
  - **Evidence:** Observed + Code. Below 768px, all six pages lack a visible menu
    opener; the only `SidebarTrigger` is inside the closed sidebar sheet.
  - **Fix:** Add the mobile trigger to the persistent dashboard navbar.
  - **Acceptance:** Touch and keyboard users can open/close navigation at 320px
    and 375px; focus is managed correctly; Escape closes the sheet; desktop
    collapse behavior remains intact. Performance stays hidden.
  - **Files:** `client/src/components/dashboard/navbar.tsx`, `client/src/components/app-sidebar.tsx`, `client/src/components/ui/sidebar.tsx`.
  - **Depends on:** None.
  - **Tracking:** Verified | Owner: Copilot | Verification: Local Real App/Chromium
    at 320/375/767px on all six routes; 44px persistent opener, Enter/tap, sheet
    focus, Escape/close/in-sheet toggle and route-navigation focus restoration.
    Desktop collapse/navigation at 768/1440px; Performance remains hidden.
    Reproduce: `node test/ux-priority/run.mjs` (66/66 across two files, including
    existing security and composer-state regressions). Report:
    `/tmp/tsp-ux-priority-7xatXW/tests.json`. No production rollout.

- [x] **UX-02 — Fix the clipped Idea formatting toolbar**
  - **Evidence:** Observed + Code. The toolbar measured 1,177px inside a 343px
    clipped wrapper; its own client and scroll widths were equal.
  - **Fix:** Constrain the toolbar and provide deliberate, accessible overflow.
  - **Acceptance:** All formatting controls are reachable by touch and keyboard
    at 320px, 375px, 768px and desktop; focus is not clipped; no page-level
    horizontal overflow is introduced. Preserve Idea's existing workflow.
  - **Files:** `client/src/components/dashboard/rich-article-editor.tsx`.
  - **Depends on:** None; coordinate control sizing with UX-12.
  - **Tracking:** Verified | Owner: Copilot | Verification: Local Real App/Chromium
    at 320/375/768/1024/1440px. All 24 controls reachable with Tab/Shift+Tab and
    horizontal wheel emulation; touch-capable taps at both ends, local geometry
    and hit-testing prove controls are not clipped. No page-level overflow.
    Plain-text paste, formatting commands and route continuity retained without
    generation/save API writes. Same 66-test report as UX-01 (not 66 additional
    tests). Real-device swipes and screen-reader certification remain untested.

- [x] **UX-03 — Repair core accessibility and interaction semantics**
  - **Evidence:** Observed + Code. Article bento has no `main` landmark;
    Idea/Article controls lack selected-state semantics; the focused Idea editor
    has a transparent outline and no replacement ring. Source also contains
    nested link/button controls, including Calendar's Manage drafts action.
  - **Fix:** Provide stable page landmarks, an accessible mode selector, visible
    editor focus, textbox/multiline semantics, and single-element navigation.
  - **Acceptance:** Each page has one main landmark and one page-level heading;
    selected mode is announced; keyboard focus is visible; navigation actions
    do not nest interactive elements. Link field help/errors through UX-13.
  - **Files:** `client/src/components/dashboard/instant-review-panel.tsx`, `client/src/components/dashboard/article-bento-board.tsx`, `client/src/components/dashboard/rich-article-editor.tsx`, `client/src/pages/calendar.tsx`, `client/src/pages/dashboard.tsx`.
  - **Depends on:** None; coordinate markup with UX-10 and UX-13.
  - **Tracking:** Verified | Owner: Copilot | Verification: All six real App routes
    have one main containing the only H1 at 320/375/768/1440px. Both Create modes
    expose named groups and pressed states; Idea exposes a uniquely labelled
    multiline textbox, linked help/count and computed opaque inset focus ring.
    Mobile Tab/Shift+Tab now reveals the whole editor when it fits below the
    measured sticky toolbar, without moving focus or changing the caret.
    Calendar/Discover navigation uses single anchors; tests inspect workspace
    chrome, menus and story details for nested controls. Full isolated acceptance:
    225/225 tests across six files, including prior UX-01/02 and security cases;
    `/tmp/tsp-ux-priority-3TjBN2/tests.json`. Chromium, not screen-reader certification.

- [x] **UX-04 — Make Article entry consistent across all entry points**
  - **Evidence:** Observed + Code. A fresh session starts in internal `url` mode
    with Article visually selected, but clicking Article switches to bento.
    Discover-prefilled stories already enter bento.
  - **Fix:** Establish one canonical Article experience without redesigning Idea.
  - **Acceptance:** Direct Create, global Create, Discover and supported story
    deep links reach the same Article UI for a fresh session; existing sessions
    resume predictably; entry never automatically generates or saves content.
  - **Files:** `client/src/components/dashboard/use-create-post-composer.ts`, `client/src/components/dashboard/create-post-provider.tsx`, `client/src/components/dashboard/instant-review-panel.tsx`.
  - **Depends on:** None; coordinate session behavior with UX-05 and UX-17.
  - **Tracking:** Verified | Owner: Copilot | Verification: Fresh direct/global/
    Home/Discover entry and supported state/query links open the same Article
    bento. Removed the internal legacy URL-only mode/view. Valid and malformed
    link context is consumed once while unrelated history is retained; incoming
    links never replace an existing session or unresolved job. Idea inputs and
    saved/edited cards resume in memory. Story loading, empty and failed states
    remain distinct, with a read-only retry and usable pasted-URL alternative.
    Entry/retry tests assert no generation or save writes. Same 225-test report;
    existing selection/reload limitations remain tracked under UX-18.

- [x] **UX-05 — Treat source changes as explicit session transitions**
  - **Evidence:** Code. Selecting another story clears versions after a guard;
    editing the URL bypasses that transition. The paste-URL option does not clear
    an existing story selection. Old cards can belong to a different source.
  - **Fix:** Define one guarded source-change contract for stories and URLs.
  - **Acceptance:** A source change cannot silently mix unrelated cards; cancel
    preserves existing work; accepting replacement has clear consequences;
    paste-URL mode clears the selected story; active/uncertain jobs stay protected.
  - **Files:** `client/src/components/dashboard/article-bento-board.tsx`, `client/src/components/dashboard/use-create-post-composer.ts`, `client/src/components/dashboard/create-post-state.ts`.
  - **Depends on:** UX-04.
  - **Tracking:** Verified | Owner: Copilot | Verification: One atomic transition
    guards story/URL/mode replacement. Cancel preserves inputs, all platform/tone
    versions, saved IDs, errors, batch/copy state and the current route. Accept
    clears that session state; persisted drafts remain in Content. Paste-URL
    selection clears both story identity and URL. Initial bare-URL typing needs
    no prompt; story-associated or generated work requires confirmation.
    Ref locks protect same-turn generation, saves, uploads and recovery; stale
    pre-transition callbacks cannot generate from the previous source. Reset
    never implicitly cancels uncertain work and forgets terminal recovery so
    stale Retry cannot resurrect old cards. Idea source editing is read-only
    during uncertainty, then resumes after resolution. Forty dedicated mocked
    transition cases plus migrated generation regressions pass in the same
    225-test report (not additional totals). Normal Idea source revision editing
    retains its prior workflow; no autosave or browser draft persistence added.

- [x] **UX-06 — Make partial-batch recovery safe and understandable**
  - **Evidence:** Code. The batch stops after failure, but the primary action
    returns to Generate N posts and can include previously completed platforms.
  - **Fix:** Separate checking an existing request, explicitly generating a
    failed card again, and continuing platforms that were not attempted.
  - **Acceptance:** Completed cards are not regenerated by a recovery action;
    remaining cards show Not attempted rather than failure; uncertainty is
    reconciled before new work; new paid attempts are explicit; generation
    remains sequential with duplicate-click and cancellation protection.
  - **Files:** `client/src/components/dashboard/use-create-post-composer.ts`, `client/src/components/dashboard/article-bento-board.tsx`, `client/src/components/dashboard/social-preview-card.tsx`, `client/src/hooks/use-editorial-generation.ts`.
  - **Depends on:** None; coordinate progress language with UX-24.
  - **Tracking:** Verified | Owner: Copilot | Verification: Composer, transport and
    actual-App regressions pass in the current combined run. Recovery inspects
    the original uncertain job; explicit new attempts target failed cards;
    continuation targets only the original unattempted platforms with matching
    source/tone/format. Completed cards, sequential admission, cancellation and
    same-turn duplicate locks are preserved; malformed results retain usable text.

- [x] **UX-07 — Unify platform character counting and validation**
  - **Evidence:** Code. Create counts X links with its weighted rule; Content
    editing and publishing readiness/policy use raw string length.
  - **Fix:** Share the platform-aware counting contract across relevant client
    and server paths, while retaining explicitly documented application limits.
  - **Acceptance:** Identical text receives consistent counts and limit decisions
    in Create, Content and scheduling; cover long URLs, multiple URLs, Unicode,
    blank text and boundary values; server-side enforcement remains authoritative.
  - **Files:** `shared/editorial.ts`, `client/src/pages/drafts.tsx`, `client/src/pages/calendar.tsx`, `client/src/lib/publishing.ts`, `server/services/publishing-policy.ts`.
  - **Depends on:** None.
  - **Tracking:** Verified | Owner: Copilot | Verification: Shared/client/server
    tests pass for long/multiple HTTP(S) links, punctuation, Unicode, blank text
    and boundaries. X links weigh 23 while the separate application cap remains
    5,000 raw UTF-16 units. Create, Content, Calendar and authoritative publishing
    policy share the contract; this is not a complete provider Unicode parser.

- [x] **UX-08 — Make scheduling destinations match user intent**
  - **Evidence:** Code. An eligible profile default takes precedence over a
    saved draft's platform. Calendar cross-posts one text, whereas Create
    generates separate tailored texts.
  - **Fix:** Prefer the draft's destination and explicitly distinguish using the
    same text on additional platforms from scheduling tailored versions.
  - **Acceptance:** An eligible draft opens with its own platform selected;
    unavailable destinations are explained, not silently substituted; users
    confirm target/text/timezone; review/connection blockers offer contextual
    resolution without losing the scheduling context or auto-approving content.
  - **Files:** `client/src/lib/publishing.ts`, `client/src/pages/calendar.tsx`, `client/src/components/schedule-article-modal.tsx`, `client/src/components/publishing-platform-selector.tsx`.
  - **Depends on:** UX-07 for consistent readiness validation.
  - **Tracking:** Verified | Owner: Copilot | Verification: Publishing UX,
    routes, locked-consent mocks and actual-App confirmation journey pass.
    Draft destination wins, unavailable targets are explained, same-text crossposting
    is explicit, blocker repair retains context, and text/targets/timezone require
    confirmation. Stale consent is rejected under the draft lock before mutation;
    drag reschedule also confirms. No automatic approval/adoption/write replay.

- [x] **UX-09 — Investigate stale saved versions across Create and Content**
  - **Evidence:** Risk. Create retains its own version state; Content saves to
    the server without an obvious reconciliation path back into that state.
  - **Fix:** First reproduce Save in Create → edit in Content → return to Create
    using isolated fixtures. Implement reconciliation only if the risk is confirmed.
  - **Acceptance:** Record reproduction or evidence-backed non-reproduction.
    If confirmed, detect a newer persisted revision; do not silently overwrite
    either version; Saved means synchronized with the persisted revision.
    Include concurrent-edit and failed-refresh coverage.
  - **Files:** `client/src/components/dashboard/use-create-post-composer.ts`, `client/src/components/dashboard/create-post-state.ts`, `client/src/pages/drafts.tsx`.
  - **Depends on:** None; coordinate save-state language with UX-20.
  - **Tracking:** Verified | Owner: Copilot | Verification: Reproduced stale Saved
    across Create save → Content edit → Create return. Fresh scoped snapshots now
    detect conflicts without replacing text/baselines; explicit choices never write.
    Exact content/timestamp CAS protects PATCH under lock. Fifteen reconciliation
    browser and 14 storage-mock cases, plus actual-App/state cases, pass for
    concurrent changes, canonical acknowledgements, failed reads and immutability.
    SQL ordering is verified; current real-PostgreSQL contention is not claimed.

## P2 — Shared foundations and workflow clarity

- [x] **UX-10 — Adopt a shared page frame and coordinated content widths**
  - **Evidence:** Code. `PageBody` is unused by application pages. Headers and
    bodies independently use 48, 56, 64, 72 and 80rem constraints and custom gutters.
  - **Fix:** Reuse `PageBody` or compose it into a thin page frame with named
    reading, standard and workbench width variants.
  - **Acceptance:** Header/body edges coordinate within each page; gutters use
    16px mobile and 24px desktop unless a documented exception is required;
    scrolling and sticky regions have clear ownership; preserve Discover's
    split pane, Create's bento and Calendar's wider working area.
  - **Files:** `client/src/components/dashboard/page-header.tsx`, `client/src/index.css`, `client/src/design/tokens.ts`, `client/src/pages/overview.tsx`, `client/src/pages/drafts.tsx`, `client/src/pages/calendar.tsx`, `client/src/components/settings/settings-shell.tsx`.
  - **Depends on:** None; foundation for UX-11 and UX-16.
  - **Tracking:** Verified | Owner: Copilot | Verification: Shared reading/standard/
    workbench widths (48/64/80rem), 16/24px gutters and one outer main adopted on
    all six pages. Foundation/page-adoption/actual-App geometry checks pass;
    Discover retains split-pane scrolling, Calendar/Create their workbench width.
    Article controls stay in flow; Idea desktop-only sticky ownership is documented.

- [x] **UX-11 — Replace Create's custom header with PageHeader**
  - **Evidence:** Observed + Code. See the measured header baseline above.
  - **Fix:** Adopt the existing shared header and keep the composer toolbar below it.
  - **Acceptance:** Create matches the shared 24px/600 title, icon policy,
    description rhythm, borders and gutters; one page-level heading remains;
    Article and Idea both use it; small-screen wrapping remains usable.
  - **Files:** `client/src/components/dashboard/instant-review-panel.tsx`, `client/src/components/dashboard/page-header.tsx`, `client/src/pages/create-post.tsx`.
  - **Depends on:** UX-10.
  - **Tracking:** Verified | Owner: Copilot | Verification: Both modes share the
    24px/600 PageHeader, subtitle/divider/gutters and sole H1. No title icon is
    rendered; the legacy prop is intentionally ignored. Narrow/zoomed wrapping
    and header/body edges pass actual-App acceptance.

- [x] **UX-12 — Standardize buttons and action-group sizing**
  - **Evidence:** Observed + Code. Controls range from 32–44px; Create relies on
    descendant overrides; Article places 44px buttons inside a 36px group.
  - **Fix:** Define deliberate sizes in the existing Button primitive and shared
    action groups, including loading, disabled, icon-only and navigation usage.
  - **Acceptance:** Standard touch targets are at least 44px; compact variants
    are deliberate and accessible; groups fit their children; labels/icons align;
    loading does not cause unnecessary layout shifts; page-level overrides shrink.
  - **Files:** `client/src/components/ui/button.tsx`, `client/src/components/dashboard/article-bento-board.tsx`, `client/src/components/dashboard/instant-review-panel.tsx`, `client/src/index.css`.
  - **Depends on:** None; coordinate with UX-03.
  - **Tracking:** Verified | Owner: Copilot | Verification: Shared default/sm/icon
    minimum 44px, large 48px, deliberate compact 32px for dense tools; stable
    loading labels, guarded asChild and wrapping groups pass primitive/browser
    tests. Idea's 36px dense boxes retain all tools and local keyboard scrolling.

- [x] **UX-13 — Share form-field and segmented-control contracts**
  - **Evidence:** Code. Labels, helper text, errors, counters and select controls
    are repeatedly hand-built; generated-text validation is not field-associated.
  - **Fix:** Reuse existing form primitives or add a lightweight field wrapper
    usable without requiring every form to adopt the same state library.
  - **Acceptance:** Consistent label/help/error spacing; unique IDs;
    `aria-describedby` and `aria-invalid` where appropriate; selected-state
    semantics; consistent input/select/textarea sizing. Native and Radix controls
    may coexist when they satisfy the same interaction and presentation contract.
  - **Files:** `client/src/components/ui/form.tsx`, `client/src/components/ui/input.tsx`, `client/src/components/ui/textarea.tsx`, `client/src/components/ui/select.tsx`, `client/src/components/dashboard/social-preview-card.tsx`.
  - **Depends on:** UX-12; coordinate accessibility fixes with UX-03.
  - **Tracking:** Verified | Owner: Copilot | Verification: Field and segmented
    primitives, RHF/native/Radix wiring and adopted generated-text fields pass
    tests for unique IDs, merged label/help/error/counter associations, invalid
    state, pressed selection and native keyboard access. Inputs grow with text.

- [x] **UX-14 — Normalize typography roles and heading hierarchy**
  - **Evidence:** Code. Page, card and section titles do not consistently share
    semantic elements and typography; `CardTitle` uses a div while heading fonts
    are applied to actual heading elements.
  - **Fix:** Define page title, section title, body, helper and metadata roles
    using the existing font families; support an explicit heading level.
  - **Acceptance:** Heading outlines are logical; CardTitle has appropriate
    semantics; body text remains readable; line height and metadata styles are
    consistent; long titles and 200% zoom do not clip controls or content.
  - **Files:** `client/src/components/ui/card.tsx`, `client/src/index.css`, `client/src/design/tokens.ts`, `client/src/components/settings/account-settings.tsx`.
  - **Depends on:** UX-10 and UX-11 for page-title adoption.
  - **Tracking:** Verified | Owner: Copilot | Verification: Shared page roles and
    CardTitle h2–h6 semantics pass primitive/actual-App checks. Long text and
    atomic 200% text-only zoom pass across seven surfaces (both Create modes)
    and Settings sections. Read-only account email remains selectable/readable.

- [x] **UX-15 — Consolidate spacing, surfaces, radius and motion tokens**
  - **Evidence:** Code. Card padding and radius ownership are fragmented;
    tokens/Card use 4px while Tailwind defines 3/6/9px and bento explicitly uses 6px.
  - **Fix:** Define surface density and geometry variants from one authored token
    source; proposed spacing scale: 4, 8, 12, 16, 24 and 32px. Use the selected
    [Ink & Cobalt light-theme specification](INK_AND_COBALT_LIGHT_THEME.md) for
    color roles and its separate COLOR-01–COLOR-12 migration checklist.
  - **Acceptance:** Preserve 6px bento corners and no colored top border; document
    intentional avatar/pill exceptions; borders, shadows and padding follow
    named variants; motion is short and purposeful with reduced-motion support;
    generated CSS matches tokens. Do not mechanically flatten useful density differences.
  - **Files:** `client/src/design/tokens.ts`, `tailwind.config.ts`, `client/src/index.css`, `client/src/components/ui/card.tsx`, `client/src/components/dashboard/social-preview-card.tsx`.
  - **Depends on:** UX-10 and UX-12.
  - **Tracking:** Verified | Owner: Copilot | Verification: Authored 6px geometry,
    4/8/12/16/24/32 spacing, compact/comfortable density and 120/180ms motion;
    generated CSS drift, palette and reduced-motion checks pass. Bento remains
    neutral without coloured top strips. Round/provider/chart/content exceptions
    are documented; Ink & Cobalt is implemented locally, not deployed.

- [x] **UX-16 — Reduce mobile header and filter congestion**
  - **Evidence:** Observed. Content, Calendar and Discover page headers measured
    approximately 183–213px at 375px, excluding the global navbar.
  - **Fix:** Separate identity from a responsive PageToolbar; prioritize essential
    actions and provide a compact arrangement for secondary filters.
  - **Acceptance:** No clipping or page overflow; content is not crowded out by
    sticky controls; filter state remains visible/discoverable; touch targets do
    not shrink to force a single row. Keep Create from/Tone grouping on desktop,
    with logical wrapping on mobile.
  - **Files:** `client/src/components/dashboard/page-header.tsx`, `client/src/pages/dashboard.tsx`, `client/src/pages/drafts.tsx`, `client/src/pages/calendar.tsx`, `client/src/components/dashboard/article-bento-board.tsx`.
  - **Depends on:** UX-10, UX-12 and UX-13.
  - **Tracking:** Verified | Owner: Copilot | Verification: Named body PageToolbars
    separate filters from identity; wrapping preserves target size. Actual-App
    page/local clipping and hit-testing pass, including Discover empty/error,
    Article controls, Idea mobile controls and Settings text zoom. Desktop source/
    tone grouping remains; mobile toolbars do not crowd out content with overlays.

- [x] **UX-17 — Clarify New post, Resume creation and CTA hierarchy**
  - **Evidence:** Observed + Code. Global Create resumes the existing composer;
    Home duplicates creation actions; starting a clean session is not explicit.
  - **Fix:** Define predictable new/resume behavior and one primary next action
    per working context, without removing useful empty-state guidance.
  - **Acceptance:** New post protects unsaved work with a clear choice; Resume
    retains work; Create on the Create page has an unambiguous purpose; no action
    silently discards content or automatically generates, saves or publishes.
  - **Files:** `client/src/components/dashboard/navbar.tsx`, `client/src/pages/overview.tsx`, `client/src/components/dashboard/create-post-provider.tsx`, `client/src/components/dashboard/use-create-post-composer.ts`.
  - **Depends on:** UX-04 and UX-05.
  - **Tracking:** Verified | Owner: Copilot | Verification: Global/Home New versus
    Resume, explicit discard and in-memory continuity pass composer/transition/
    actual-App cases. Saved drafts survive Start new; entry and resume issue no
    implicit generation/save/publication. Home exposes a contextual primary CTA.

- [x] **UX-18 — Preserve composer selection and explain reload limits**
  - **Evidence:** Code. Platform selection is local to the remounted bento board;
    navigation can reset visible selection. Reload stores an acknowledged job
    pointer, not all delivered cards, inputs or unsaved edits.
  - **Fix:** Keep selection with the composer and distinguish in-memory continuity,
    explicit saves and bounded unfinished-job recovery in the UI.
  - **Acceptance:** Route navigation restores selected platforms/tone and existing
    versions; users see unsaved status and accurate reload messaging; logout and
    tenant boundaries remain intact. No implicit draft-text persistence is added
    to localStorage/sessionStorage. Durable autosave requires separate design approval.
  - **Files:** `client/src/components/dashboard/article-bento-board.tsx`, `client/src/components/dashboard/use-create-post-composer.ts`, `client/src/components/dashboard/create-post-provider.tsx`, `docs/editorial-reload-recovery.md`.
  - **Depends on:** UX-04 and UX-05.
  - **Tracking:** Verified | Owner: Copilot | Verification: Provider-owned platform
    selection initializes once after preferences, survives route changes with
    tone/versions, and communicates in-memory/pointer-only reload limits. Actual-App
    plus 29 account-cache cases verify logout, late responses and same-user tenant
    changes; the reproduced old-tenant cache leak is fixed. No draft text persisted.

- [x] **UX-19 — Allow safe actions on completed cards during a batch**
  - **Evidence:** Code. Global busy state disables editing, saving, copying and
    handoff for completed cards while another platform generates.
  - **Fix:** Evaluate per-version locks while preserving sequential generation
    and source/tone locks. Do not simply remove the global guards.
  - **Acceptance:** Safe completed-card actions do not mutate the active request,
    duplicate saves or overwrite results; stop/cancel/recovery remains correct;
    any action that must stay locked explains why.
  - **Files:** `client/src/components/dashboard/use-create-post-composer.ts`, `client/src/components/dashboard/social-preview-card.tsx`.
  - **Depends on:** UX-06 and the UX-09 investigation outcome.
  - **Tracking:** Verified | Owner: Copilot | Verification: Per-version synchronous
    generation reservations and save locks permit unrelated completed-card edit/
    copy/save/handoff, but protect active/queued/uncertain targets. Concurrent saves,
    same-turn clicks, cancellation and latest handoff admission pass regressions;
    source/tone/format remain protected with local reasons.

- [x] **UX-20 — Unify save states and draft-specific next steps**
  - **Evidence:** Code. Editing a saved bento card returns its label to Save draft
    although the operation updates it. Bento lacks the single-version view's
    saved confirmation and Content/Calendar handoff.
  - **Fix:** Reuse Save draft → Saving → Saved → Save changes behavior, show a
    board saved/unsaved summary, and link to the exact saved draft.
  - **Acceptance:** Save failures retain text and offer recovery; failed saves
    are not labeled Saved; edits retain the draft ID; handoff selects the intended
    draft, preserves other cards and does not schedule or publish automatically.
  - **Files:** `client/src/components/dashboard/social-preview-card.tsx`, `client/src/components/dashboard/instant-review-panel.tsx`, `client/src/components/dashboard/use-create-post-composer.ts`, `client/src/pages/drafts.tsx`, `client/src/pages/calendar.tsx`.
  - **Depends on:** UX-09, UX-12 and UX-18.
  - **Tracking:** Verified | Owner: Copilot | Verification: Shared save vocabulary,
    board summary, retained IDs/text on failure and synchronized-only links pass.
    Content/Calendar resolve scoped exact details beyond 500, distinguish failed
    reads from missing/forbidden records, and never substitute another draft or
    schedule/publish on arrival. First-save lost acknowledgements are not replayed.

- [x] **UX-21 — Keep source context and essential review guidance visible**
  - **Evidence:** Code. Bento places human-review guidance, source warnings and
    claim checks inside collapsed Generation details after action buttons.
  - **Fix:** Expose source identity, material warnings and human-review guidance;
    make original/fetched source review accessible; collapse technical details instead.
  - **Acceptance:** Users can inspect the source before acting; edited content
    does not inherit misleading verification claims; review acknowledgement,
    optional voice-sample consent and publishing approval are clearly distinct.
    Never imply source matching is independent factual verification.
  - **Files:** `client/src/components/dashboard/social-preview-card.tsx`, `client/src/components/dashboard/editorial-details.tsx`, `client/src/components/dashboard/claim-support-review.tsx`, `client/src/components/dashboard/approve-voice-edit.tsx`.
  - **Depends on:** UX-05; coordinate saved-draft approval handoff with UX-08 and UX-20.
  - **Tracking:** Verified | Owner: Copilot | Verification: Source identity/link/
    text and material human-review warnings precede actions; only technical details
    collapse. Browser cases verify edited-content claims and separate review,
    optional voice consent, save and publishing approval. Source matching and
    attachments are never described as independent factual verification.

- [x] **UX-22 — Reuse the platform handoff component in Content**
  - **Evidence:** Code. Create uses `PlatformComposeAction`; Content implements
    separate asynchronous clipboard/window-opening logic with toast-only fallback.
  - **Fix:** Reuse the existing handoff implementation while preserving Content's
    uncertain-delivery and duplicate-publication restrictions.
  - **Acceptance:** Exact latest text is used; clipboard denial and blocked popups
    have clear recovery; copy status becomes stale after edits; neither opening
    nor copying marks content as saved, scheduled or published. Media stays explicit.
  - **Files:** `client/src/components/platform-compose-action.tsx`, `client/src/lib/platform-handoff.ts`, `client/src/pages/drafts.tsx`, `docs/platform-compose-handoff.md`.
  - **Depends on:** UX-12; retain existing publishing safety guards.
  - **Tracking:** Verified | Owner: Copilot | Verification: Content now uses the
    shared action; 44 pure handoff cases plus publishing/browser regressions pass
    for exact edits, denial, popup failure, stale copy and delayed ownership loss.
    Synchronous manual/direct-publish exclusion and pre-navigation rechecks retain
    delivery safety. Copy cannot be undone, but stale navigation is prevented.

- [x] **UX-23 — Resolve Idea's formatting-versus-storage contract**
  - **Evidence:** Code. Formatting commands alter the editor DOM, but composer
    state stores plain text. Fonts/colors imply persistence that is not provided.
  - **Fix:** Decide and document the supported formatting model before changing
    the toolbar. Preserve the Idea workflow; do not introduce a new editor implicitly.
  - **Acceptance:** Help text and controls truthfully describe what is retained
    and submitted; navigation preserves the supported representation; unsupported
    styling is not promised as social-platform formatting. Any feature removal or
    rich-text/Markdown serialization change is explicitly reviewed first.
  - **Files:** `client/src/components/dashboard/rich-article-editor.tsx`, `client/src/components/dashboard/create-post-state.ts`, `client/src/components/dashboard/use-create-post-composer.ts`.
  - **Depends on:** UX-02 and UX-13.
  - **Tracking:** Verified | Owner: Copilot | Verification: Existing plain-text/
    literal-Markdown model retained; all 24 tools remain. Visible help distinguishes
    preview-only rich styling from submitted/restored text and separate attachments.
    Navigation/remount and toolbar reachability tests pass. No editor replacement,
    feature removal or rich-text serialization was introduced.

- [x] **UX-24 — Standardize progress, errors, empty states and disabled reasons**
  - **Evidence:** Observed + Code. Feedback combines pills, toasts and inline
    messages inconsistently. Ready can coexist with a save failure; batch progress
    is mixed with request-level platform counts.
  - **Fix:** Define reusable loading, empty, filtered-empty, error, partial-success
    and status patterns. Separate generation, persistence and delivery state.
  - **Acceptance:** Card errors are local and actionable; important state changes
    are announced appropriately; disabled actions explain prerequisites; generation
    shows one understandable progress hierarchy; real terminal failures are never
    disguised as continued processing; accepted requests are not called delivered.
  - **Files:** `client/src/components/dashboard/editorial-details.tsx`, `client/src/components/dashboard/social-preview-card.tsx`, `client/src/components/dashboard/empty-state.tsx`, `client/src/pages/drafts.tsx`, `client/src/pages/calendar.tsx`.
  - **Depends on:** UX-06, UX-12 and UX-20.
  - **Tracking:** Verified | Owner: Copilot | Verification: WorkflowStatus and
    local field/card feedback separate generation, persistence and delivery.
    Label/icon/live-region checks and empty/error/partial/uncertain journeys pass;
    terminal failure is not a spinner and accepted work is not delivered. Batch
    progress has one hierarchy; disabled reasons remain visible and actionable.

## P3 — Documentation, regression coverage and release acceptance

- [x] **UX-25 — Document and enforce the adopted component contracts**
  - **Evidence:** Code/docs. Guidance describes outdated navigation and a
    generation modal; component-level usage contracts are incomplete.
  - **Fix:** Update design guidance with implemented tokens, page variants,
    toolbar/field/action patterns, status language and intentional exceptions.
  - **Acceptance:** Documentation matches actual components; examples use shared
    primitives; deprecated/ignored props are addressed deliberately; token
    generation/drift checks remain enforced; no new parallel design system appears.
  - **Files:** `docs/design-system.md`, `design_guidelines.md`, `client/src/design/tokens.ts`, `client/src/components/dashboard/page-header.tsx`.
  - **Depends on:** UX-10–UX-16 and UX-24, as those contracts stabilize.
  - **Tracking:** Verified | Owner: Copilot | Verification: Design/adoption,
    recovery and handoff docs now match current components and accepted evidence;
    ignored icon/legacy dark APIs, email RGB rendering, toolbar scrolling and
    intentional exceptions are explicit. Token/primitive guardrails and drift
    check pass. Admin layout scope gaps and release gates are not hidden.

- [x] **UX-26 — Add real-page responsive, visual and accessibility regressions**
  - **Evidence:** Code. An isolated PageBody fixture does not prove adoption by
    real routes; normal document overflow checks missed the clipped Idea toolbar.
  - **Fix:** Test real page chrome, both creation modes and important loaded states.
  - **Acceptance:** Cover 320, 375, 768, 1024 and 1440px; header/body alignment;
    navigation reachability; local clipping as well as page overflow; long text;
    200% zoom; keyboard/focus/landmarks; contrast and reduced motion. Record any
    untested real-device/screen-reader coverage honestly. Performance stays hidden.
  - **Files:** `client/src/design/foundations.browser.test.ts`, `test/integration-security/app.browser.test.ts`, `e2e/route-smoke.spec.ts`.
  - **Depends on:** Relevant UX-01–UX-03 and UX-10–UX-16 changes; add coverage incrementally.
  - **Tracking:** Verified | Owner: Copilot | Verification: Actual-App has 242
    cases in the green integrated run, alongside page/foundation/palette checks.
    All requested widths, local clipping, focus, landmarks, long text, 200% text
    zoom, OS-dark, forced colours and reduced motion covered; 91 captures include
    loaded/exceptional states. Automated rendered-state acceptance, not complete
    human visual review, real-device/AT or non-Chromium certification.

- [x] **UX-27 — Verify the complete journey with isolated workflow regressions**
  - **Fix:** Add focused tests alongside each workflow change and run a combined
    acceptance pass with mocked external providers and isolated fixtures.
  - **Acceptance:** Cover entry/source replacement; sequential and partial batches;
    same-job recovery versus new usage; completed-card actions; selection/reload
    boundaries; editing/save/reconciliation; clipboard/popup failure; consistent
    counting; destination defaults; approval/timezone blockers and uncertain
    delivery. Verify no duplicate generation, save or publication is introduced.
  - **Files:** `client/src/components/dashboard/editorial-generation.test.ts`, `client/src/pages/publishing-ux.test.ts`, `client/src/lib/publishing.test.ts`, `test/integration-security/app.browser.test.ts`.
  - **Depends on:** Relevant UX-04–UX-09 and UX-17–UX-24 changes; test each increment.
  - **Tracking:** Verified | Owner: Copilot | Verification: Combined 24-file
    1,150-test run covers the listed entry/recovery/edit/handoff/publishing journey
    with mocked external boundaries; every suite/assertion passed, zero skips.
    Separate 681 reliability and 180 budget tests also pass (overlapping, not
    additive). No new real-DB contention or live-provider acceptance claimed.

- [ ] **UX-28 — Record release readiness and separately verify deployment**
  - **Fix:** Prepare an explicit release handoff after local acceptance, then
    deploy only through the normal authorized release process.
  - **Acceptance:** Typecheck, focused tests, build and token checks pass; remaining
    issues are disclosed; rollback/artifact identity is recorded; the deployed
    revision is verified with desktop/mobile and authenticated workflow acceptance.
    Any live AI test has explicit spend bounds; publication/email/payment tests
    require their own scope. Local screenshots alone are not production evidence.
  - **Files:** `docs/production-cloud-run.md`, `docs/RELEASE_HANDOFF.md`, `docs/PRODUCTION_GENERATION_RELIABILITY_2026-09-30.md`.
  - **Depends on:** UX-25–UX-27 and the release's selected P1/P2 tasks. Record any
    remaining task as open/deferred; do not claim the whole backlog is complete.
  - **Tracking:** Blocked | Owner: Copilot / release operator | Verification:
    Local type/tests/token/build evidence and dirty-source/artifact hashes are
    recorded in [the current handoff](UI_UX_RELEASE_HANDOFF_2026-10-01.md).
    Next: approve exact release/0049 scope, maintenance drain, rollback identity
    and bounded authenticated acceptance. No deployment or paid tests performed.

## Current implementation checkpoint

The agreed sequence is complete locally: P1 correctness → shared foundations/
Ink & Cobalt → remaining workflows → integrated acceptance/documentation.
**Only UX-28 remains open in this tracker.** COLOR-12 separately remains open;
the broader reliability roadmap is not absorbed into these completion totals.

- UX runner: 1,150/1,150, 24 exact files,
  `/tmp/tsp-ux-priority-sUHyaB/tests.json`.
- Reliability rerun: 681/681, 18 files,
  `/tmp/tsp-generation-reliability-oJvKnk/tests.json`.
- Budget rerun: 180/180, 10 files/10 metric scenarios,
  `/tmp/tsp-workflow-budgets-lp5Qfq/tests.json`.
- TypeScript and token drift pass. Temporary production-format client/server
  build and 25 compressed assets pass in `/tmp/tsp-ux-release-build-OlN05J/`.
  No dotenv loading or replacement of workspace `dist`.
- 91 actual-App screenshots and automated rendered-state assertions cover loaded
  and exceptional flows, not only empty primitive fixtures. See adoption notes
  for viewport/state coverage and native colour-swatch/text-zoom test details.

No counts are additive. No complete human pixel review, real-device/AT,
non-Chromium, fresh real-DB contention or live-provider certification is claimed.
Existing PostCSS missing-`from`, Idea `execCommand`/native-textbox advisories and
out-of-scope admin layout gaps are disclosed. No commit, deployment or production
change occurred. Next action is the scoped operator decision and drained cutover
in the [release handoff](UI_UX_RELEASE_HANDOFF_2026-10-01.md), not more unbounded
synthetic tests or an accidental whole-worktree deployment.

## Workflow and safety requirements to preserve

- Happy path: choose source → platform/tone/format → explicit sequential
  generation → review/edit → save to Content **or** copy & open manually.
- Saved-draft delivery: resolve readiness → explicitly approve the exact version
  where required → confirm target/text/timezone → schedule or publish.
- Recovery: inspect the original request first; explicitly retry a terminally
  failed platform or continue unattempted platforms; never replay uncertain work
  automatically or silently regenerate completed cards.
- Keep Article's social-preview bento, exact editable content, neutral borders,
  6px corners and reduced-motion support. Keep Idea's workflow unless a specific
  behavior change is reviewed under its task.
- Connections remain optional for drafting and manual copying. Saving, retaining
  an optional voice sample and approving publication remain separate actions.
- Preserve tenant/auth boundaries, existing duplicate locks, uncertain-delivery
  guards, authoritative per-target outcomes and generation/publishing safety.
- Do not re-expose Performance while consolidating navigation or headers.
- Do not introduce automatic publishing, unapproved paid replay, silent model
  fallback, browser storage of draft text or a new persistence policy as a
  side effect of visual refactoring.

## Related work, not silently included in this backlog

- [Ink & Cobalt light-theme specification](INK_AND_COBALT_LIGHT_THEME.md) records
  the palette selected on 2026-10-01. Its 12 color-migration tasks support UX-15,
  UX-25 and UX-26 without changing this tracker's 28-task count or marking any fix
  complete automatically. Runtime palette is locally accepted (11/12 COLOR
  tasks); deployment remains pending under COLOR-12/UX-28.
- [Production generation reliability](PRODUCTION_GENERATION_RELIABILITY_2026-09-30.md)
  tracks provider deadlines, coordinated AI leases, durable recovery and capacity.
  UI consistency does not fix the underlying Gemini timeout; do not hide it with
  a longer spinner or declare global reliability from this audit.
- [Editorial reload recovery](editorial-reload-recovery.md) defines existing
  pointer-only recovery; it is not draft autosave.
- [Platform handoff](platform-compose-handoff.md),
  [publishing safety](publishing-safety-contract.md) and
  [voice/claims](voice-claims-contract.md) define safeguards to retain.
- Creating this tracker authorizes no production deployment, schema change,
  provider expenditure, secret/configuration change or external message.

## Change log

| Date | Task IDs | Change | Verification / release |
| --- | --- | --- | --- |
| 2026-09-30 | UX-01–UX-28 | Created prioritized tracker from the read-only audit; all tasks not started. | Documentation only; no implementation or deployment. |
| 2026-10-01 | UX-15, UX-25, UX-26 | Linked the selected Ink & Cobalt light-theme specification and separate color checklist. | Decision documented; 0 / 28 master tasks verified; no runtime theme change. |
| 2026-10-01 | UX-01, UX-02 | After local P0 deadline/lease acceptance, restored mobile navigation and constrained Idea toolbar overflow. | 66/66 isolated tests, two files; 2 / 28 tasks verified locally, not deployed. Remaining P1 tasks precede shared foundations/Ink & Cobalt; all COLOR tasks still pending. |
| 2026-10-01 | UX-03–UX-05 | Added stable landmarks/selected semantics/editor focus; canonicalized Article entry; guarded atomic source transitions, same-turn operations and uncertain recovery. | 225/225 isolated tests, six files; TypeScript, temporary production build and token checks pass. 5 / 28 tasks verified locally, not deployed. UX-06–UX-09 next; all COLOR tasks remain pending. |
| 2026-10-01 | UX-06–UX-27 | Completed P1 recovery/counting/consent/CAS, shared foundations/theme, remaining workflows, exact lookup, tenant-cache and delayed-handoff safety; fixed integrated responsive failures and reconciled docs. | 1,150/1,150 across 24 files; separate 681 reliability and 180 budget tests; type/token/temp build pass. 27 / 28 locally verified; UX-28 blocked on scoped authorized drain/release/acceptance. |
