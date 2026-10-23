# UI/UX implementation adoption notes — 2026-10-01

## Status and scope

**Local acceptance verified: UX-01–UX-27 and COLOR-01–COLOR-11.** UX-28 and
COLOR-12 remain blocked on the separately authorized release and its production
acceptance. The compact-button and Content-container follow-ups passed **1,167/1,167 tests in 24 exact files**;
TypeScript, token drift and temporary client/server compilation also pass.

These notes supersede the intermediate documentation-only/pending checkpoint.
The worktree is still dirty and uncommitted. This is not a deployment, a frozen
approved release manifest or a claim that the entire reliability roadmap is done.
See [current release handoff](UI_UX_RELEASE_HANDOFF_2026-10-01.md) for identities,
reproduction, limitations and operator gates. Root `.env` exists; its contents
were not read for this acceptance. No live AI, publication, email or payment was
triggered by these tests.

## Adoption map

Paths below identify the adopted source; the evidence section records execution.

| Contract | Current implementation / adoption |
|---|---|
| Light-only Ink & Cobalt | `client/src/design/tokens.ts`, generated CSS, `client/src/index.css`, `tailwind.config.ts`: white panels/sidebar, ink text, cobalt actions; neutral secondary and selected accent are separate. Dark exports/selector resolve light, and `dark:` utilities cannot activate an alternate theme. |
| Aligned page edges | `client/src/components/dashboard/page-header.tsx`: matching PageHeader/PageBody `reading` 48rem, `standard` 64rem, `workbench` 80rem; 16/24px gutters. One outer main includes identity and `PageBody as="div"`; default-main/width override escape hatches remain compatibility, not automatic enforcement. |
| No page title icons | PageHeader accepts optional `icon` but ignores `_icon`. Treat it as deprecated compatibility; omit it in new callers. Passing icons in existing call sites does not mean icons render. Do not work around this through `title`. |
| Scoped page controls | PageToolbar is a named, wrapping, non-sticky fieldset inside PageBody, with no second width/gutter or ARIA toolbar keyboard contract. Article controls stay in normal flow within shared gutters; Idea actions become locally sticky only from `lg` (1024px). Mobile controls wrap and scroll with the body. |
| Action geometry/state | `client/src/components/ui/button.tsx`: desktop default/standard/icon 36px, sm/compact 32px, lg 40px; 6px corners/gaps, 16px icons, 14px labels (13px small). Every size is at least 44×44px below 768px or with any coarse pointer. Minimums allow wrapping/zoom. Loading retains labels, selected is distinct from neutral, link composition uses one `asChild` link. |
| Accessible fields/selection | `client/src/components/ui/{field,segmented-control}.tsx`: actual-control ID/ARIA wiring, label/help/error/counter; named pressed-button groups with native keyboard behavior, not fake tabs. |
| Card semantics | `client/src/components/ui/card.tsx`: 6px neutral card, compact 12px or comfortable 16/24px inherited padding; CardTitle defaults to h2 with explicit lower heading levels. |
| Outcome presentation | `client/src/components/dashboard/workflow-status.tsx`: semantic ink/subtle-surface pairs, error alert vs status announcements, `live={false}` for static/duplicate guidance, actions outside the live region. |
| Canonical Create | `client/src/App.tsx`, `client/src/components/dashboard/{create-post-provider,instant-review-panel}.tsx`: account/tenant-scoped in-memory session above dashboard route transitions; full-page `/dashboard/create`, not modal-first composition. |
| Article source choice | `article-bento-board.tsx`: Story and Article URL are equal-width, top-aligned columns from 768px and stacked below it. Shared accessible guidance explains these are alternative sources, not two required fields. The selected story preview spans the width beneath the row; source confirmations and operation locks are unchanged. |
| Article platform picker | A count-labeled popover sits beside Your platform posts (wraps on narrow screens). Native labeled checkboxes include platform icons, remain open during selection, and preserve the four-target cap. Rows provide 44px minimum mobile/coarse-pointer targets; Tab/Space, Escape/focus restoration, vertical catalog scrolling, and a visible selected-name summary replace the horizontal platform strip. Generate and per-card Save/Copy stay outside the picker; deselection does not erase versions. |
| Article bento | `client/src/components/dashboard/{article-bento-board,social-preview-card}.tsx` and `client/src/components/dashboard/use-create-post-composer.ts`: preserve 6px cards, maximum four selected targets, sequential generation, completed cards retained, original unattempted-target continuation and explicit failed-card new attempts. |
| Content container | `client/src/pages/drafts.tsx` uses the shared `workbench` container for both PageHeader and PageBody, matching Discover, Create and Calendar. Shared 16px mobile / 24px desktop gutters remain, with symmetric centering at the 1280px cap. |
| Idea source | `client/src/components/dashboard/rich-article-editor.tsx`: plain text/literal Markdown; full 24-control formatting strip preserved with local horizontal scrolling and keyboard access. Rich styling is preview-only; attachments are separate session state, not fact-verified evidence. |
| Revisions/source guards | `shared/draft-revision.ts`, `server/routes/drafts.ts`, `server/storage.ts`, composer and Content editor: exact acknowledged content/timestamp CAS; explicit conflict choices; source/scope/operation fences; no silent overwrite or write replay. |
| Reload recovery | `client/src/lib/editorial-recovery.ts`, `client/src/hooks/use-editorial-generation.ts`, provider: only tenant/user/job/intent IDs in sessionStorage. Reconnect reads the existing acknowledged job; no text autosave, new generation or hidden retry spend. |
| Tenant query ownership | `client/src/lib/account-cache.ts` and `App.tsx`: same-user tenant changes gate descendants immediately, abort the old request lifetime, cancel/clear private caches and restore only accepted account/profile state into fresh query objects. Revision fences reject late old-tenant effects; ordinary same-tenant refresh retains the creation. |
| Scheduling consent | `shared/publishing-consent.ts`, schedule hooks/routes/storage: external admissions require reviewed exact text/revision and applicable schedule/target state. Compare under the scoped draft lock before policy/enqueue/mutation. A stale review fails with 409 and requires reconfirmation, not automatic adoption or replay. |
| Handoff/destinations | `PlatformComposeAction` is shared by Create and Content, with synchronous locks and latest ownership checks immediately before navigation after clipboard completion. Scoped no-store `/api/drafts/:id/details` resolves exact saved IDs independently of bounded lists, preserving receipt-aware delivery projection. No implicit save/approval/schedule/publication. |
| Email rendering | `server/services/email/{index,templates}.ts` and `server/services/emailService.ts` use authored-token `emailColor` RGB literals for complete foreground/background pairs. Twenty sandboxed rendering tests pass; no email sent. |

## Safety and outcome vocabulary to preserve

- **Source changes:** story, URL, mode and Start new transitions must use the
  composer's operation guards and explicit discard choices. Ordinary Idea text
  edits and route resume retain versions; incoming links do not overwrite work.
- **Revision CAS:** existing saves supply `expectedContent` and
  `expectedUpdatedAt` (including legacy `null`), based on an acknowledged row.
  HTTP 409 `draft_conflict` requires review; `draft_immutable` is a separate
  publishing lock. Fresh no-store snapshot reads do not silently adopt remote
  changes. Failed reads cannot promote stale cache to Saved.
- **Conflict choices:** Keep local leaves the conflict unresolved; Load latest
  adopts remote text with discard confirmation where needed; Use reviewed latest
  as baseline preserves local text. None writes. A later Save remains a CAS and
  can conflict again. A lost first-save acknowledgement needs inspection, not
  an automatic create retry or a claim of exactly-once draft creation.
- **No replay:** Retry same request checks original uncertain work. Continue a
  batch starts only unattempted targets. Generate again after terminal failure
  is a separate, explicit potentially chargeable attempt. Lifecycle detach is
  not remote cancellation, and monitoring does not renew the server deadline.
- **Honest states:** generated text is not saved; saving is not voice consent;
  voice consent is not publishing approval; approval is not scheduling; queued,
  simulated, manually claimed or uncertain delivery is not verified publication.
  Copy/open never establishes an application publishing receipt.
- **Exact links:** confirmed saved versions carry their encoded ID to Content
  or Calendar. Arrival selects/reviews only that record, never writes. Existing
  schedules are not recreated, missing links do not select another draft, and
  publishing readiness/confirmation remain separate from draft storage. The
  details lookup filters the scoped ID before limiting results, so records
  beyond the first 500 are reachable. Read errors are not reported as deletion.
- **Tenant transitions:** a provider remount alone does not clear infinitely
  fresh queries. The reproduced same-account tenant leak is fixed at cache and
  render ownership boundaries; old requests cannot repopulate the new tenant.
- **Delayed handoff:** an already completed clipboard write cannot be undone.
  If the text/draft/scope/delivery lock changes while it is pending, abandon the
  reserved popup and suppress stale continuation instead of navigating anyway.

Details: [design system](design-system.md), [root guidelines](../design_guidelines.md),
[recovery/reconciliation](editorial-reload-recovery.md),
[manual compose handoff](platform-compose-handoff.md).

## Intentional exceptions

| Exception | Allowed scope; do not generalize |
|---|---|
| Round geometry | Avatars, pills/status badges, dots, switch/slider thumbs and progress tracks; normal controls/cards and the bento remain 6px. |
| Dense formatting controls | Idea uses 32px desktop button/select boxes, at least 44px on mobile/touch. Preserve all 24 tools and internal scrolling. Navigation and form fields retain their existing larger geometry; ordinary actions use the approved compact scale. |
| Provider identity | External marks/`platformBrand` may use provider colours; these are not app action, selected, approval or delivery roles. |
| Categorical charts | `chartSeries` deliberately includes non-cobalt colours, including amber. Legends and meaningful labels remain necessary; rendered distinguishability is a separate acceptance check. |
| User preview content | Idea font/size/colour tools, including literal colour-picker defaults, affect preview content only. Plain text is submitted/restored, not rich DOM styling. |
| Static email | Email-safe RGB literals come from authored tokens, not browser CSS variables. Email typography/geometry remain separate; local rendering is not inbox-client or delivery certification. |
| Create scrolling | Article controls are non-sticky. Idea actions are sticky only at desktop `lg`; mobile actions are normal flow. No negative gutter escape or mobile overlay bar. |
| Neutral secondary consumers | Helper text, provider containers and source/keyword taxonomy chips remain neutral. A scheduled timestamp can remain labelled neutral metadata; it must not imply warning, selection or delivery. Do not turn every `secondary` occurrence blue. |

## Scope limits and resolved findings

| Item | Disposition |
|---|---|
| Active admin layout | Outside the six-page layout adoption scope. Admin colour/navigation consumers were migrated, but some pages retain independent widths, 24px mobile body gutters and identity outside body main. This is a disclosed follow-up, not a claim of universal layout compliance. |
| Exact-draft reachability | Resolved by independent scoped details lookup; beyond-list, missing/forbidden and failed-read tests pass. |
| Email palette | Resolved with authored-token RGB pairs and 20 isolated render tests; the earlier navy/gold exception is obsolete. |
| Account/tenant cache leak | Reproduced and resolved; 29 cache tests plus actual-App tenant transition cases pass without weakening the boundary assertion. |
| Responsive failures | Fixed intrinsic-width traps, wrapping, mobile toolbar/toast obstruction and Article negative-gutter overflow. Actual-App loaded/exceptional-state checks now pass. |
| Browser-fixture defects | Standards-mode doctype fixes hover interpretation. Atomic text inflation prevents reduced-motion transitions from compounding 200% into 400%+; original transition properties are restored and root rem layout is unchanged. Native colour inputs are checked as labelled non-text swatches, including 3:1 icon/boundary contrast, not nonexistent rendered text. Normal text thresholds remain 4.5:1 / large 3:1. |

## Verified local evidence

The compact-button follow-up removes masking overrides in Settings/Connections,
Create handoffs, footer, onboarding, auth and marketing actions. It also covers
32px tabs/options and growing date-picker cells (no overlapping touch dates).
The sizing matrix includes 320/375/767/768/1440px and a wide coarse-pointer device,
exact label/icon/padding/gap measurements, keyboard tabs, loading/disabled/link
states, all Idea tools, and the newsletter's unchanged 48px input alongside its
40px desktop CTA. Two Create fixtures now compile the real stylesheet/tokens
instead of omitting the touch rules. Zoom overflow assertions retain their exact
threshold and allow the stylesheet to finish reflowing before assessment.

The subsequent Article source/picker follow-up adds 11 browser cases, including
the 767/768px boundary, desktop touch, 200% root-font reflow, clickable/tappable
label edges, keyboard-only selection, cap replacement, empty selections and
edited-card retention. Existing source confirmation, generation locks, resume,
sequential recovery and Save/Copy tests remain. Popover opening honors reduced
motion; geometry samples are atomic and boundedly wait for layout/paint without
relaxing the size or overflow thresholds. Only UI/test code changed in this follow-up.

| Check | Result / artifact |
|---|---|
| Integrated UX — current follow-ups | `node test/ux-priority/run.mjs`: **1,167/1,167**, 24 files, zero failure/skip/todo; fresh report from the final run |
| Reliability — preceding acceptance, not rerun for CSS-only sizing | `node test/generation-reliability/run.mjs`: **681/681**, 18 files; `/tmp/tsp-generation-reliability-oJvKnk/tests.json` |
| Workflow budgets — preceding acceptance, not rerun for sizing | `node test/workflow-budgets/run.mjs`: **180/180**, 10 files and 10 metric scenarios; `/tmp/tsp-workflow-budgets-lp5Qfq/tests.json` |
| Types / generated tokens | `pnpm exec tsc --noEmit --incremental false` and `pnpm run design:check`: pass |
| Production-format compilation — sizing follow-up | Client + server, 25 precompressed assets; `/tmp/tsp-button-sizing-build-RmSvUI/summary.json`; 688 source/132 output hashes verified, workspace `dist` unchanged, Vite env-file loading disabled |
| Actual-App captures — sizing follow-up | 91 PNGs under `/tmp/tsp-ux-priority-WxLfmk/screenshots/actual-app-98200/`; loaded pages, both Create modes, Settings sections, failures/conflicts and confirmed scheduling |

The suites overlap: **do not add their counts**. The runner uses exact includes
and filters, no root DB setup, sanitized child environments and owned artifacts.
`--only=<exact-allowlisted-relative-file>` can select focused UX files; arbitrary
paths and combining it with `--design-only` are rejected.

Actual-App checks cover 320/375/768/1024/1440px, header/body edges, page and local
overflow, keyboard/hit-testing, landmarks, long text, all Idea tools, light/OS-dark,
200% text-only zoom, forced colours and reduced motion. Loaded screenshot sets
use 375/1440px; this is not a claim of every state at every size. Screenshot
capture and automated rendered-state assertions passed; a complete human pixel
review, real-device swipes, real screen-reader and non-Chromium certification
are not claimed. External fonts/resources are not production-font acceptance.

CAS/consent storage mocks verify ordering and compiled scope predicates, not
actual PostgreSQL lock contention. The real-DB recovery/workflow suites and
`e2e/content-workflow.spec.ts` were not executed in this checkpoint. Historical
September 19 DB evidence remains labelled historical in the recovery document.

The build retains a nonfatal PostCSS missing-`from` warning. Editor diagnostics
retain `execCommand` deprecation and the native-textbox recommendation for Idea;
replacing the preserved editor is outside this change. This is not a clean
global lint or full WCAG certification. No process restart, production rollout,
live provider benchmark, migration, credential change, commit or push occurred.