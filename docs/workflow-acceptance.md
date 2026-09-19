# Local authenticated workflow acceptance — roadmap 28

## Status: local server/browser and process-crash/Bull acceptance passed

On 2026-09-19 the authorized **separate disposable PostgreSQL cluster** at
`127.0.0.1:60053/thesocialpundit_acceptance_test` passed all ten cases. Its real
38-file migration chain includes unchanged 0022 and 0038, with matching original
checksums. No existing database was used in this acceptance pass. The older
shared `localhost:5433/thesocialpundit_test` ledger gap remains unresolved and
must not be inferred repaired by these results.

Saved report: `/tmp/tsp-acceptance.2e4C5P/workflow-final.json` (summary and log
alongside it; repository report `test-results/workflow-acceptance.json`).

| Measure | Result |
| --- | --- |
| Files selected | 1 (`test/workflow/composed.test.ts`) |
| Suite setup | Passed |
| Tests collected | 10 |
| Passed / failed test bodies | 10 / 0 |
| Skipped/pending | 0 |
| Overall success | true |

The guarded full suite also passed **161 files / 3,936 tests / zero failures or
skips**, with every database opt-in enabled. Project and standalone migration
TypeScript checks passed. Repository-wide whitespace checking reports only an
unrelated blank line at EOF in `server/routes/billing.ts`, left untouched.
See [isolated acceptance evidence](isolated-acceptance.md) for gates, logs,
retained cluster and cleanup instructions. Those full-suite counts are historical;
the browser follow-up below did not rerun the full suite or certify production readiness.

## Thin Chromium follow-up — 2026-09-19

The original React `App` now runs in installed headless Chromium against the
same retained database, real Better Auth session handling, middleware, repositories,
quota ledger and private Redis/Bull workers. Results in separate scoped runs:

| Check | Files | Passed | Failed | Pending |
| --- | --- | --- | --- | --- |
| `test/workflow/browser.test.ts` | 1 | 2 | 0 | 0 |
| `test/workflow/composed.test.ts` (shared fixture regression) | 1 | 10 | 0 | 0 |

Project `tsc --noEmit --incremental false` also passed. Browser evidence:
`test-results/workflow-browser-acceptance.json`, `/tmp/tsp-roadmap28-browser.log`;
server regression: `test-results/workflow-acceptance.json`,
`/tmp/tsp-roadmap28-composed.log`; TypeScript: `/tmp/tsp-roadmap28-browser-tsc.log`.
These are **separate runs**, not a new full-suite total.

1. UI registration/onboarding → Home → Discover/refresh → selected-article
  asynchronous generation (four tones, one consumed operation) → explicit save
  → exact content/revision approval → UI schedule. The real worker first rejects
  premature delivery. Only the owned schedule timestamp is then made due, retaining
  schedule/target identity and policy state. Direct sandbox worker delivery yields
  one simulated receipt, repeated delivery skips, and reload shows simulation in
  Attention with zero verified Published entries and no additional generation/save.
2. Provider-boundary failure → UI “Retry same request” reads the original failed
  job without another POST, operation or provider call → reload without automatic
  replay → explicit new generation reaches the provider → UI cancellation aborts
  it, commits a consumed cancelled operation and exposes no result/draft → reload
  without replay → explicit successful generation/save/review/schedule → UI schedule
  cancellation. Its now-due stale delivery skips; reload retains the saved content
  with one draft, three total generation operations and no publishing logs/send.

`browser-transport.ts` bundles the original App and styles with installed esbuild
and Tailwind, serving an ephemeral IPv4 loopback origin. It forwards relative
`/api` bytes to the real Express listener, preserving Origin and Cookie. The actual
front origin is configured before Better Auth loads. Chromium requests are
same-origin-only, service workers/WebSockets blocked; CSP and DNS restrictions
provide additional isolation. No `/api` response fulfillment or UI/auth/cache mocks.
The server fixture retains its outbound socket/fetch guard. No `.env` loading,
default Playwright configuration, localhost:4300 server, downloads or live traffic.

Run `node test/workflow/run-browser.mjs` from the repository root with explicit
`WORKFLOW_DB_TESTS=true`, `WORKFLOW_BROWSER_TESTS=true`, and matching
`TEST_DATABASE_URL=postgresql://tsp_app:localtestpass@127.0.0.1:60053/thesocialpundit_acceptance_test`
and `OWNER_TEST_DATABASE_URL=postgresql://vivekanandchoudhari@127.0.0.1:60053/thesocialpundit_acceptance_test`.
Do not source an env file. This runner additionally rejects any target other than
that exact retained host/port/database; it selects exactly the two browser cases,
removes stale JSON, disables config/env loading and validates exact result counts.

Execution exposed a genuine client bug: terminal “Retry same request” created a
fresh request intent and second consumed operation. `use-editorial-generation.ts`
now preserves the original state for retry, while explicit Generate remains a new
intent. The browser test is its regression. The shared crawler mock also now
implements the real typed `CrawlPage.headers` contract rather than `contentType`.

Fixture setup still seeds signed sessions, billing entitlement and a Mastodon
connection; this is not login/signup, payment or OAuth acceptance. Reload coverage
is saved-content restoration and no replay after terminal failure/cancellation,
**not reattachment to unfinished in-memory generation**. Worker delivery is direct,
not scheduler/cron or Bull publish transport. No schema, role or migration-ledger
changes; only exact owned fixtures are cleaned. No deployment or commit.

Read-only postcheck confirmed the exact IPv4 address/port/database, restricted
`tsp_app` (no superuser/BYPASSRLS/CREATEDB/CREATEROLE), unchanged owner privileges,
38 disk migrations / 38 ledger rows with zero checksum mismatches, and no remaining
users, sessions, tenants, generation operations or drafts for the final two browser
actors. Scoped `git diff --check` passed. The retained cluster stays running.

## Process-crash and actual Bull follow-up — 2026-09-19

`test/workflow/crash.test.ts` adds seven isolated cases. Run only
`node test/workflow/run-crash.mjs` with `WORKFLOW_DB_TESTS=true`,
`WORKFLOW_CRASH_TESTS=true`, and the explicit runtime/owner URLs from the browser
section above. The runner rejects every target except the retained port 60053
database and owner `vivekanandchoudhari`; it selects exactly crash + composed
(**2 files / 17 passed / 0 failed / 0 pending**, verified runner exit 0).
Seven new crash/Bull cases and ten composed regressions passed in the same focused
run; suite teardown reverified all 38 original migration checksums. The fresh
report start time is `1789783170395` (Unix milliseconds).

Acceptance checklist:

- [x] SIGKILL exact fixture child after mock Mastodon acceptance but before receipt
  return/DB completion; real Bull restart redelivery skips the durable claim.
  Fresh reconciliation is blocked for five minutes; only the owned target's
  `updated_at` is aged six minutes using explicit UTC SQL. Concurrent explicit
  manual-delivered reconciliation has one CAS winner and audit; old-token
  completion fails. No verified Published entry or Published email.
- [x] SIGKILL after real authorization before dispatch remains conservatively
  `publishing`, not automatically retried. After observed child exit and timestamp
  aging, explicit not-delivered reconciliation requires `workerStopped:true`;
  retry rechecks current policy and replaces the target generation.
- [x] SIGKILL before claim leaves `scheduled`, no token and zero attempts in DB.
  Real Bull stalled recovery acquires once and commits one simulated completion.
- [x] Real `runSchedulerCycle` → `publishDueDrafts` → configured private Redis
  `publish_draft` queue → actual handler. A controlled post-authorization/pre-send
  exception exercises a safe Bull retry, not crash evidence. Duplicate queue IDs,
  fresh duplicate deliveries and concurrent old-receipt CAS calls cannot double
  complete. Persisted receipt IDs, attempts, target and schedule agree.
- [x] Cancelled queued target and policy-disabled admitted target remain fenced
  after child restart; permanent policy failure discards retries.
- [x] Mock-live provider ID completes once; sandbox has its own simulated count,
  null provider ID, no verified Published entry and no extra Published email.
  The live case records one **mocked** email invocation; nothing is sent.
- [x] Cancelled waiting editorial work consumes zero after restart. SIGKILL after
  durable reservation leaves `started`/`in_progress_or_unknown`, consumes once,
  returns no result/draft and never replays started AI calls. Losing only the
  exact owned Redis record/dedupe still cannot bypass the same-intent DB ledger.

Test-only child bundle substitutes Mastodon, AI and email boundaries, and inserts
one checked phase barrier after real `authorizePublishClaim`; no storage, auth,
entitlement or policy mocks. The other barrier is before the real handler's claim.
IPC phases, PID and observed SIGKILL exit are saved per child. The fixture uses
bounded Bull test timings: 1,200ms lock, 300ms renewal, 500ms stalled scan, maximum
one stalled recovery. Production job policy stays three attempts with 2,000ms
exponential backoff. Tests use 30s limits; IPC waits are capped at 12s. Four-tone
editorial work may start one or two parallel AI calls before death; neither may
replay. Editorial replay is explicit `EditorialJobs.process` in fresh children
against actual Redis/DB, not automatic stalled editorial queue retry.

Guards preload before Vitest/child imports, reject env-file reads and external
DNS/TCP, and permit only 60053 plus fixture-owned Redis/HTTP ports. Parent-to-child
environment is allowlisted; no owner URL goes into the runtime worker. Redis is
fresh, password protected and nonpersistent. No existing Redis is used. Before
scheduler invocation, foreign pending schedules cause failure rather than being
delivered. Cleanup kills only retained child objects, observes their exits, and
deletes exact actor fixtures; the existing cluster stays running. All 38 migration
checksums are checked without applying or modifying SQL/history.

Evidence: `test-results/workflow-crash-acceptance.json`,
`test-results/workflow-crash-child-<pid>.json`,
`/tmp/tsp-roadmap28-crash-confirmed.json`,
`/tmp/tsp-roadmap28-crash-confirmed-summary.json` and
`/tmp/tsp-roadmap28-crash-confirmed.log`. Any
`test-results/workflow-crash-blocked.log` entry fails the runner. Initial failures
were harness issues: overly broad env-filename matching, timezone-sensitive
timestamp aging, assuming one AI call despite bounded parallel tone work,
reusing a live-mode child for sandbox work (correctly rejected by policy), and
counting the legitimate mocked onboarding welcome email as a Published email.
Editor diagnostics for the five new test/runner files and scoped whitespace
checks passed. Current global nonincremental TypeScript is blocked by unrelated
`server/routes/billing.ts:140` (`TS1005: 'try' expected`), left untouched;
see `/tmp/tsp-roadmap28-crash-typecheck-final.log`. Earlier clean TypeScript
results above are historical, not a claim about this current workspace.
Final read-only audit: `/tmp/tsp-roadmap28-crash-confirmed-audit-final.json`
confirms matching report timestamps, all 15 passing-run children recorded
SIGKILL and no longer exist, no worker bundle directories remain, the guard log
is absent/empty, and scoped whitespace checking exits 0. Private Redis shutdown
is verified by successful fixture teardown awaiting its owned child's exit,
not by stopping or probing any pre-existing Redis service.
No production bug fix was needed for these changes. Full-suite execution remains
the parent task; these tests do not certify production readiness, actual cron
startup, real providers, host/Redis/PostgreSQL failure or exactly-once external
delivery. Manual evidence is never promoted to a verified provider receipt.

## Running against an explicitly authorized migrated target

Use `node test/workflow/run.mjs` from the repository root with all three variables
explicitly exported in the invoking shell:

- `WORKFLOW_DB_TESTS=true`
- `TEST_DATABASE_URL`: restricted `tsp_app` URL for
  `postgresql://tsp_app:<local-password>@localhost:5433/thesocialpundit_test`
- `OWNER_TEST_DATABASE_URL`: owner URL for that **same database**, e.g.
  `postgresql://vivekanandchoudhari@localhost:5433/thesocialpundit_test`

The shared guard also accepts the exact basename
`thesocialpundit_acceptance_test` on literal `127.0.0.1` with an explicit port
other than 5432/5433. Runtime and owner must match host, port and database. This
pass used 60053; do not use the old shared target for reproducing this pass.

Do not source an env file. The runner does not use the application dev server,
normal Vite/Vitest setup, dotenv, or the existing Playwright configuration. Do not
replace this command with an unrestricted full-suite run. Local installed
dependencies and `redis-server` are prerequisites; it downloads nothing.

The shared database's missing historical ledger entry still requires separate
investigation/authorization. This suite refuses to repair schema/history.
The disposable cluster instead executed the complete genuine fresh chain.

## Isolation design (exercised locally)

- Explicit opt-in, exact database/host/port validation, explicit runtime and owner
  identities; reject URL query overrides and `PGOPTIONS`.
- Child process environment allowlist removes inherited provider keys, dev-auth
  bypasses, Redis configuration and live publishing mode. Fixed test-only secrets;
  default publishing mode is sandbox.
- Verify every existing migration checksum, including 0038, before fixture writes. Existing
  active `pro_monthly` and enabled Mastodon catalog rows are prerequisites, not
  mutated global fixtures.
- Unique actor/tenant/session/operation IDs. Cleanup uses exact owned tenant/user
  predicates in transactions, never `TRUNCATE` or global data deletion. Failed
  cleanup retains actor tracking and reports an error while closing resources.
- Dedicated password-protected loopback Redis with persistence disabled, plus a
  disposable loopback Express HTTP listener. No scheduler cron is started.
- Outbound fetch/socket guard permits the database, private Redis and fixture
  HTTP endpoint only. Unexpected attempted provider access fails the suite.
- JSON report must be newly generated, successful, contain exactly the selected
  file, have passing tests and no pending tests. Stale reports are removed first.

## Composition boundaries

The fixture is designed to run stored Better Auth sessions and signed cookies,
the actual Better Auth handler, `requireDbUser`, membership/permissions,
entitlements, profile/inbox/generation/draft routes, restricted repositories,
quota ledger, Redis/Bull editorial and inbox processing, and publishing policy
and worker code. There are **no auth, repository, quota or policy mocks**.

Only crawler fetch, AI provider calls, outbound email and the Mastodon publisher
adapter are mocked. Live-mode cases still use that mocked adapter; they cannot
make real social posts. Payment-provider and object-storage lifecycles are not exercised;
their credentials are absent and outbound traffic is guarded. Paid entitlement
is fixture-seeded billing state, not a payment-provider acceptance claim.

The original composed publishing tests directly invoke the real worker with a Bull-shaped job envelope
containing IDs from the real schedule API. They do not prove production scheduler
or Bull publish-job delivery; the separate crash follow-up exercises those real
modules and transport. Waiting/running generation cancellation uses the
real editorial queue and worker implementation.

## Cases — ten passed locally

1. Original registration and identity onboarding → persisted profile → refresh
   article → generate → explicit save → exact-revision review → schedule → sandbox
   receipt. Correlate IDs and assert no verified Published entry.
2. Anonymous, forged/revoked session and foreign-tenant rejection.
3. Refresh failure preserves inbox; repeated committed operation/worker delivery
   reuses receipt without another crawl.
4. Successful/failed generation consumes once; same-intent retries do not produce
   another result or save a draft.
5. Real PostgreSQL NUL-text insert failure preserves inbox and generation state; corrected
   explicit save reuses generated content without another generation charge.
6. Stale approval rejection and approval invalidation after edit.
7. Scoped publishing rule disabled after admission blocks dispatch; re-enabled
   explicit retry replaces the target and fences the old job.
8. Rescheduled/cancelled stale jobs and concurrent/repeated worker deliveries.
9. Mock live acceptance followed by throw remains unknown and blocks replay;
   scoped concurrent reconciliation has one CAS winner and an operator audit,
   without a verified publication claim.
10. Waiting cancellation consumes zero; cancellation after reservation consumes
    once and does not expose a result, save a draft or replay provider work.

## Harness corrections established by execution

- Await Bull readiness, not the `queue.process()` worker-lifetime promise; capture
  lifetime errors for teardown. Awaiting it prevented setup from completing.
- Compare worker receipt dates through JSON serialization, matching the HTTP
  representation rather than comparing Date objects to strings.
- `drafts.inbox_item_id` has no FK in this schema. The save-failure case uses a
  genuine PostgreSQL text encoding rejection, then explicitly saves clean content
  and verifies the AI call count is unchanged. No fake FK or schema change.
- Give the real refresh retry/backoff case 20 seconds (its inner wait is 15 seconds),
  rather than the ordinary Vitest five-second default.

## Explicit gaps

- Chromium now covers the two thin journeys above. The PostgreSQL save-failure
  case remains server-only; it does not prove browser recovery from a failed save.
- Process-crash/Bull scope and execution evidence are tracked separately above.
  A mock adapter throw is still not a process crash. Recovery never invents a
  result for a killed, durably started generation operation.
- Cron startup/timing, external OAuth/login flow, live providers, payment and
  media-storage lifecycle are not accepted by these local cases.
- No deployed application or shared database was changed. The follow-up includes
  the local retry fix above, not acceptance of every roadmap item or production readiness.