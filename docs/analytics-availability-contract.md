# Roadmap 23 — analytics availability contract

## Superseding local acceptance — 2026-09-19

This supersedes earlier **local** migration/test status below, not rollout prerequisites. Earlier counts, failed attempts and “not run/not applied” statements are historical authoring records.

- Saved combined report `/tmp/tsp-acceptance.2e4C5P/final-all-1789783547962-vitest.json`: **`success: true`, 165 files, 3,976 passed, 0 failed, 0 skipped**, with all nine DB/browser/crash/reload gates enabled and passing.
- Genuine fresh isolated cluster `127.0.0.1:60053`: **38 migrations / 38 ledger rows**, including **0022 and 0038**; all original ledger checksums postverified against disk and unchanged after the combined run.
- Saved project TypeScript, migrator TypeScript, production build and design checks: **exit 0**. Repository `git diff --check`: **exit 2**, only `server/routes/billing.ts:140` extra blank line at EOF. The sibling `-summary.json` also records four blocked socket attempts and aggregate `success: false`; this is not an all-clean aggregate claim.

This does **not** prove development/production migrations, resolve the shared **0022 ledger gap**, apply legacy credential backfill, or establish live-provider, real S3/R2 bucket, email, merchant or OAuth readiness. External providers remained mocked. No tests or database operations were rerun for this documentation update. See [isolated acceptance](isolated-acceptance.md) for scope/history and [local roadmap acceptance](LOCAL_ROADMAP_ACCEPTANCE.md) for parent-owned rollout tracking.

## Historical authoring scope and handoff

Implemented locally; not deployed or committed. Ownership: analytics services,
analytics routes, Performance UI, shared analytics helper, their tests, and the
analytics-only schema addition below. Publishing, storage, main entry points,
Connections and other UI were not edited by this work. Other agents are changing
the shared workspace; their schema/code changes must be preserved.

**Parent coordination required:** migration `0035_analytics_availability.sql` is
reserved for this increment and has **not been applied anywhere**. Do not apply
it independently. Parent must coordinate the ordered migration rollout with the
other agents. No DB tests, DB operations, environment-file/credential reads,
live LinkedIn requests, production operations, deployment or commits were used.
The existing root `.env` was checked for existence only and was not changed.

## Schema changes and dependencies

- `social_analytics.metric_availability`: nullable JSONB, no default and no
  backfill. SQL `NULL` is legacy/unverified provenance.
- `social_analytics_availability_object`: accepts SQL NULL or a JSON object at
  most 32 KiB. Per-field semantics are validated by the shared runtime helper.
- Existing `metrics` JSONB remains NOT NULL, but its known numeric members now
  allow JSON null in the shared `SocialMetrics` type. `profileViews` remains
  optional for source compatibility. No numeric column changes are needed.
- Existing `top_posts` already allows SQL NULL; new profile-only snapshots use
  null, not an empty measured list. Old rows are not rewritten or deleted.
- No new tables, indexes, privileges or RLS policies. Existing tenant/user
  scoped storage methods are reused without modification.
- **Apply 0035 before starting the new backend**, through the parent-authorized
  migration process: Drizzle selects/inserts now reference the added column.
  Do not drop the column while this backend is running. Rollback to old code
  restores the old misleading-zero behavior, so it is not an analytics-safe
  fallback without disabling the old analytics surface.
- No new packages or environment variables. Uses the existing Zod dependency.

## Values, provenance and time

`shared/analytics-availability.ts` defines the allowlisted fields: followers,
following, posts, impressions, engagements, engagementRate, likes, comments,
shares, clicks and profileViews. Missing, unsupported, malformed or unproven
values are **null**, never zero. Explicit provider-measured zero remains `0`.

Each field has independent availability:

- `status`: measured or unavailable; `reason`: a bounded reason code, null only
  for measured evidence.
- `supported`: capability of that field in the saved evidence, not a promise
  implied by a connected account. `supportedFields` is derived from this data.
- `measuredAt`: explicit ISO instant normalized to UTC, never request time,
  snapshot insertion time, or the account's profile-sync timestamp.
- `source: provider_response`, nonblank bounded `endpoint` and `sourceField`:
  server-owned provenance required before a numeric value can be exposed.
- `period`: null for an account snapshot, otherwise explicit UTC start/end
  instants, start inclusive/end exclusive. The period must precede or end at
  the observation timestamp. Adapters must not omit an actual reporting period.

Counts must be finite, nonnegative safe integers; engagementRate must be a
finite percentage in 0–100. Strings, booleans, negative counts, fractional
counts, NaN, Infinity and unsafe integers are rejected without coercion.
Timezone-less, invalid-calendar and future measurement timestamps are rejected;
offset timestamps are normalized to UTC. Invalid fields do not suppress valid
siblings. `invalid_metric`, `invalid_timestamp` and `invalid_provenance` remain
distinct from `unsupported`, `no_snapshot`, `legacy_unverified`,
`account_mismatch` and `fetch_failed`.

**All legacy values without per-field provenance remain unknown**, including
nonzero historical demo values and zero-filled OIDC placeholders. A snapshot
date, profile sync, current token or successful connection is not retrospective
proof. Legacy top-post payloads are never returned as verified observations.
There is no client endpoint to submit provenance or analytics measurements.

## Current provider behavior (not new collection capability)

LinkedIn callback and manual sync use only the existing OIDC identity endpoint.
It verifies identity/profile metadata, **not audience or engagement**. Both
initial connection and reconnect store null metrics, unsupported availability,
null measuredAt and null topPosts. Sync rejects inactive/missing connections,
invalid responses and mismatched member IDs before writing. Metric-looking
fields in an identity response are ignored; followers never become engagement.

No X metrics collector was added. There is **no currently verified numeric
collector** introduced by this increment. Numeric fixtures demonstrate the
contract, not live provider permissions or successful live collection. A future
approved adapter must validate the actual response, field meaning, account,
reporting window and observation instant before setting provider provenance.
Do not relabel OIDC or historical placeholders to activate numeric displays.

## API and aggregation

- Existing GET summary/provider routes retain `requireDbUser` and actual
  `analytics:read:own` permission enforcement. Every storage call uses the
  resolved tenant AND user, not query/body scope overrides. Responses are
  `Cache-Control: no-store`; no credentials/raw errors are returned.
- Summary retains `connected`, `linkedin`, `twitter`, `combined`, `lastSync`.
  `combined` values are now nullable. Per-provider payloads include normalized
  `metrics`, `availability`, `supportedFields`, `snapshotDate`, safe account
  metadata and `topPosts: null`. `lastSync` remains **profile sync only**.
- Only owned active LinkedIn/X accounts participate. Snapshot tenant/user,
  provider and account ID must match the active account. Stale disconnected
  accounts cannot contribute; no-connection values remain null.
- Combined `availability` is per field, with `expectedAccounts`,
  `measuredAccounts`, `measuredFrom`, `measuredThrough` coverage. A count is
  summed only when every participating account has a valid value and reporting
  periods agree. Partial/missing coverage returns null, not a partial total.
  No connections is `not_connected`, not a measured zero.
- Aggregate `measuredAt` is the **oldest contributing observation**, not a claim
  that all accounts were observed simultaneously. Coverage exposes the full
  observation-time span. Safe-integer overflow is unavailable.
- Engagement rates are never summed/averaged and are never derived from
  followers. A single account's verified rate can pass through; multi-account
  rates remain `not_additive` pending a compatible denominator-aware adapter.
- Failed snapshot lookup affects that provider only. Healthy provider values
  remain available; combined coverage becomes incomplete. Failed account-list
  or provider-history lookup returns 500, not successful empty analytics.
- Provider history accepts integer `days` 1–365 (default 30) and delegates its
  legacy server-calendar lookback query to storage. It is not the Performance
  page's local publishing date filter. History validates and normalizes every
  field; invalid/future snapshot dates and foreign-account rows are excluded
  with explicit `historyCoverage` counts. An empty `current` is now an explicit
  unavailable object, not a fake zero snapshot.
- Storage's latest lookup is still provider-scoped. With multiple active rows
  for one provider, mismatched snapshots stay unavailable rather than being
  reused/double-counted; coverage includes all active rows. Existing top-level
  provider/Connections UI still has one row per provider. Full multi-account
  selection/history is not added in this increment.

## Performance and publishing-agent dependency

Performance keeps successful local empty-list counts at genuine zero. Failed,
loading or malformed draft responses never become empty-list success. Analytics
failures have separate retry feedback and do not hide loaded activity. Malformed
or legacy summary metadata cannot display numeric values as measured.

Latest combined coverage and per-provider supported fields are visible; valid
provider measurements survive another provider's failure. UTC measurement and
period timestamps are labeled explicitly. Unavailable metrics are not drawn as
zeroes. Followers alone cannot cause the engagement section to claim engagement
measurement. No fake reach, growth, rate or post analytics are generated.

Local publishing counts are the authenticated user's **loaded records in the
current workspace**, capped by the existing drafts endpoint (up to 500), not
account-wide history or tenant-wide counts. Each published draft counts once,
not once per delivery. The 7/30/90-day selector applies only to publishing
activity: local calendar days through now, shared count/chart boundaries.
Future or invalid/missing publication dates do not count.

**Publishing-agent integration contract:** `publishStatus === "published"`
must mean live publication only. Simulation/unknown statuses must not use that
value. Performance consumes the existing `buildPublishingActivity` helper;
neither that helper, publishing schema/status transitions nor storage was edited
here. Parent must integrate and verify the other agent's simulated-publishing
exclusion and historical-status policy. No extra publish-mode column dependency
was introduced by analytics.

## Historical authoring verification (superseded above)

Focused pure/mock run: **5 files / 112 tests passed**, including 12 mocked
Chromium Performance tests; actual exit zero. Files:

- `shared/analytics-availability.test.ts` — 39
- `server/routes/analytics.test.ts` — 30
- `server/services/linkedinAnalytics.test.ts` — 16
- `server/services/linkedinAnalyticsAuth.test.ts` — 15
- `client/src/pages/performance.analytics.test.ts` — 12

Runs use a clean `env -i` environment with only PATH/HOME/TMPDIR and NODE_ENV=test,
Vitest's programmatic `startVitest` with the exact named files, `config:false`,
`setupFiles:[]`, `fileParallelism:false`, explicit source aliases and Vite
`envFile:false, envDir:false`. No default DB setup or implicit `.env` loading.
OAuth tests use synthetic fixture settings only. All persistence/credential/
provider transport boundaries are mocked; browser network is aborted. Route
tests invoke handlers captured from the real registration function and retain
the real permission middleware; callback tests invoke the real signed-state
callback and OAuth verification function. These are not DB/RLS or live OAuth
acceptance tests.

Analytics-scoped whitespace check passed. Nonincremental full-project TypeScript
was run; the final observed run was blocked by two TS2322 diagnostics in
concurrently edited `server/services/email/delivery-store.test.ts` (57, 61):
fixture tokens `stale` and `fence` do not satisfy the UUID template-literal type.
No analytics-owned diagnostics in that compiler output. Earlier concurrent
AI/media/platform errors had cleared by that run. Parent must rerun TypeScript
after integrating the other agents. No full suite, build, DB migration validation
or live-provider verification is claimed.