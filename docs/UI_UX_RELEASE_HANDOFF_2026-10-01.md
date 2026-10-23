# UI/UX and Ink & Cobalt — local release handoff, 2026-10-01

**Decision: local acceptance complete; production release BLOCKED.**
UX-01–UX-27 are locally verified (27/28); COLOR-01–COLOR-11 are locally verified
(11/12). UX-28/COLOR-12 require the scoped deployment and its own acceptance.
This document does not reuse September 19 authorization for a different release.

## Scope and source identity

- Implemented P1 recovery/counting/scheduling/revision correctness, shared
  accessible page/control foundations, light-only Ink & Cobalt, composer
  continuity and per-version locks, source/review/status clarity, exact draft
  lookup, Content manual handoff, and email palette rendering.
- Integrated acceptance additionally reproduced/fixed the same-account tenant
  cache leak, delayed popup ownership, server-locked publishing consent and
  responsive overflow/obstruction. See [adoption notes](UI_UX_IMPLEMENTATION_2026-10-01.md).
- Approved compact-button follow-up: desktop 36px standard/icon, 32px small/
  segmented/Idea tools, 40px large; 44×44px minimum below 768px or on any coarse
  pointer. Fields/navigation retain existing geometry; 6px corners/gaps remain.
- Content now uses the shared `workbench` page container for both header and body,
  matching Discover/Create/Calendar while retaining the common 16px mobile and
  24px desktop gutters.
- Worktree remains dirty and uncommitted on the existing release branch. No
  broad staging, commit, push, app restart, migration or production change was
  performed. Base HEAD is `cc3d91ef4a36bf70eba7f6e6e8fd3c00bafed22e`; **HEAD alone
  does not identify this build**.
- Temporary build: `/tmp/tsp-button-sizing-build-RmSvUI/`. Its `summary.json` records
  688 source-file hashes and 132 output hashes, with 25 precompressed assets.
  Every source and output hash was rechecked after compilation. This supersedes
  `/tmp/tsp-ux-release-build-OlN05J/`, which predates the sizing changes.

| Identity | SHA-256 |
|---|---|
| Source fingerprint | `5bff507e26eeb3929f235b2b803939dd4c4295834a0403b6e705d103c8d95391` |
| Artifact fingerprint | `df69a4604f3e7e3286bd1aa22ebadf18144ee09ca991465c3b809273dbb8dc42` |
| Server `index.cjs` | `541ce44534c33725d2a811c1e72bd0c0cd90c50562aee5c4a60e680f1e61baa3` |
| Client `public/index.html` | `167d195e3f50b3cdbe6373b5dd87de376edcae8967d1ca7a201addb5fed44b74` |

Fingerprints hash the JSON maps of sorted relative paths to SHA-256 hashes.
Source scope is client/server/shared/script, package/lockfile, Vite/Tailwind/
PostCSS/TypeScript configuration and Dockerfile; environment files are excluded.
Docs, migrations and e2e are not covered by this source fingerprint. The build
is local compilation evidence, **not an approved full release manifest or a
deployable container digest**. `/tmp` artifacts are ephemeral: archive/freeze the
reviewed release separately before rollout, excluding secrets/uploads/reports
from its application payload.

## Verified checks

| Command / check | Result | Evidence |
|---|---|---|
| `pnpm exec tsc --noEmit --incremental false` | Pass | Integrated acceptance command completed successfully |
| `node test/ux-priority/run.mjs` | Current Content-container follow-up: 1,167/1,167; 24 files | Fresh report from the final run |
| `pnpm run design:check` | Pass | No generated-token drift |
| `node test/generation-reliability/run.mjs` | Preceding acceptance: 681/681; 18 files; not rerun for sizing | `/tmp/tsp-generation-reliability-oJvKnk/tests.json` |
| `node test/workflow-budgets/run.mjs` | Preceding acceptance: 180/180; 10 files, 10 metric scenarios; not rerun for sizing | `/tmp/tsp-workflow-budgets-lp5Qfq/tests.json` |
| Vite + esbuild + precompression | Pass; 25 compressed assets | `/tmp/tsp-button-sizing-build-RmSvUI/summary.json` |

The fresh UX JSON was read back: every suite/assertion passed, zero failures/
skips/todos. Reliability/budget reports were verified in the preceding acceptance;
they are historical, not new sizing runs. Suites overlap; do not sum counts. Exact-whitelist runners
disable root test setup and env-file loading and sanitize child environments.
Providers are mocked; reliability/budget Redis is owned and disposable. Root
unrestricted tests must not be substituted because their setup is DB-oriented.

Compilation used a sanitized child with `NODE_ENV=production`, Vite
`envFile:false`, `envDir:false`, an owned temporary outDir, exported
`serverBuildOptions()` with a temporary outfile, and `precompressAssets()`.
It did not invoke the destructive `buildAll()` entry point or replace `dist`.
The existing nonfatal PostCSS missing-`from` warning remains. This compiles but
does not start or certify a production-configured server.

## Browser and workflow evidence

91 actual-App captures are in
`/tmp/tsp-ux-priority-WxLfmk/screenshots/actual-app-98200/`.
Representative files: `loaded-article-1440-light.png`,
`loaded-idea-375-light.png`, `zoom200-settings-375-os-dark.png`,
`journey-calendar-confirmed-1440.png`.

Automated rendered-state checks cover the six dashboard pages (both Create
modes), 320/375/768/1024/1440px, landmarks, header/body alignment, keyboard/focus,
local clipping/hit-testing, loading/empty/error/conflict states, long text,
200% text-only zoom, OS-dark preference, forced colours and reduced motion.
Loaded screenshot sets are at 375/1440px; not every state has every viewport.
Capture and computed-style/geometry/interaction assertions passed; complete
human pixel review, real devices, assistive technology, other browser engines
and production webfont rendering are **not certified**.

The actual-App journey verifies sequential generation, partial/uncertain
recovery, source/new/resume boundaries, completed-card actions, save/revision
conflicts, exact links beyond 500, handoff failures/ownership, approval/target/
timezone confirmation and tenant isolation using mocked API boundaries.
SQL mocks verify scoped predicates and CAS/consent lock ordering, not actual
PostgreSQL contention. Real-DB workflow/reload suites and the updated
`e2e/content-workflow.spec.ts` were not executed in this checkpoint.

Budget metrics are mocks, not dollar or throughput commitments: 16 posts plus
repair use 32 calls/224 mock output tokens; fallback uses 96 transports with
64 failed primary; deadline probe starts 6/completes 4/aborts 2; shared Redis
admits 4 of 40 burst requests and 2 later with zero remaining leases; 24 duplicate
intents become 3 work items/21 rejections. No paid benchmark was performed.

## Disclosed limits

- Admin colours/navigation migrated, but admin page layout/landmark/gutter
  cleanup is outside the six-page scope and remains follow-up work.
- Idea keeps all tools and plain-text/literal-Markdown storage. Rich styling is
  preview-only. Existing `execCommand` deprecation and native-textbox diagnostic
  are disclosed, not a global lint-clean claim.
- Provider logos, user media/preview colours and categorical charts remain
  intentional exceptions. No blanket chart contrast or inbox-client email proof.
- Recovery remains pointer-only, not durable draft autosave/cross-device recovery.
  Lost first-save acknowledgement is not an exactly-once save guarantee.
- The broader reliability roadmap's durable recovery, failover, capacity and
  representative latency/spend benchmarks remain open.

## Mandatory operator gates — all open

Release scope, maintenance drain and paid-test bounds were requested at this
checkpoint. The response indicated the user was unavailable and asked for
autonomous work; it supplied no specific release/window/spend decisions. The
safe disposition is to retain the verified local handoff, make **no production
changes and no paid calls**, and leave UX-28/COLOR-12 open for operator review.
This is not recorded as a user-approved zero-dollar production acceptance plan.

| Gate | Required decision/evidence before execution |
|---|---|
| Release scope | Explicitly approve this runtime/UI release, target environment, maintenance window and rollback owner. Freeze a reviewed file manifest; do not deploy the whole dirty worktree incidentally. |
| Invitations/schema | Last production audit had invitations disabled and migration 0049 pending. Explicitly include or exclude that separate work; retaining it disabled does not authorize a migration or email. Revalidate ledger/recovery if schema rollout is selected. |
| Drained AI cutover | Approve gating **all** AI producers and worker pickup, including onboarding/background tasks and no-traffic revisions. Observe active transports settling or being fenced before any old worker can coexist with new lease code. |
| Lease safety | Old Lua sets the shared lease-key TTL to 30s; a new 120s lease first renews at 40s. Mixed revisions are unsafe. Never flush/delete live keys, change the shared key to evade the cap or infer worker shutdown from 0% traffic. |
| Rollback | Verify a Gemini-Pro-only artifact/configuration and fresh rollback revision/digest. Rollback must also drain first. The historical Flash/OpenRouter fallback is not equivalent. |
| Live acceptance | Approved test account/source/platforms and a numeric AI spend ceiling plus maximum attempts (or explicit zero paid tests). Publication, email and payment remain excluded unless separately scoped. Authenticate directly; never put secrets in chat. |
| Runtime/compatibility | Keep concurrency/instance limits unchanged. Revalidate queue/lease/config health; external PATCH and scheduling preconditions now fail closed, so notify stale clients to preserve text and reload/review rather than automatically retrying writes. |
| Post-deploy proof | Record exact deployed digest/revision, health/config, desktop/mobile authenticated journey and monitored async outcomes. HTTP 202 or healthy anonymous GETs do not prove generation or delivery. |

If a drained cutover cannot be guaranteed, deployment stays blocked; a separately
reviewed compatibility bridge retaining the short provider budget is required
first. See [mandatory drain contract](PRODUCTION_GENERATION_RELIABILITY_2026-09-30.md#mandatory-release-gate-drained-cutover-not-overlapping-revisions).

Last-known production reference, **not freshly queried here**: Cloud Run
`tsp-app`, project `tsp-social-pundit`, `asia-south1`, revision
`tsp-app-r260930-ffba2a064ee6`, image digest
`sha256:8d9ede10f4c4bbee7edff436d695505ce75350d427dc5532f2aa1323d85d7f5a`.
Use [Cloud Run runbook](production-cloud-run.md), not retired Vercel/Render
instructions in the historical release handoff. No gate above has been executed.