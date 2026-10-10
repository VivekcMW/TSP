# Isolated local acceptance — 2026-09-19

## Final combined follow-up — supersedes earlier local checkpoints

The saved `final-all-1789783547962-vitest.json` reports **165 files / 3,976
passed / zero failures or skipped tests**, suite exit 0. All nine opt-in gates
were enabled together, including actual Chromium workflows, process-crash/Bull
and unfinished-job reload reattachment. Project and migrator TypeScript,
production build and design checks exited 0; the transient billing TS1005 below
was fixed before this run. All 38 ledger checksums remained unchanged and fixture
postchecks passed. Historical sections below describe earlier stages, not gaps
in that combined suite.

The aggregate runner is **not wholly green**: the billing EOF blank line remains
in `git diff --check`, and four socket attempts were blocked during subsequent
build/design phases. `tsx` parent IPC initialization strongly explains the
denials, but the saved log lacks destination/stack evidence to prove each one.
See `LOCAL_ROADMAP_ACCEPTANCE.md` for exact caveats and the remaining release
gates. No denied socket call was allowed through to make checks pass.

A later scoped diagnostic established the reproducible tsx parent-IPC mechanism
with exact destination/stack/thread records: two denials on import alone and
four during build/design, all still denied. Build/design/both typechecks exited
0; 21 negative guard assertions passed with no unexpected violations. Evidence:
`/tmp/tsp-ipc-diagnostic.g6tsQH6i/run-2/verification-summary.md`. See the scoped
follow-up in `LOCAL_ROADMAP_ACCEPTANCE.md`; historical logs remain unchanged,
the full suite was not repeated, and the EOF formatting warning remains.

The isolated cluster is now **stopped**, with the complete datadir and reports
retained. Final results are in `/tmp/tsp-acceptance.2e4C5P/` under prefix
`final-all-1789783547962` (`-summary.json`, `-progress.json`, `-vitest.json`,
phase logs/exits and child-process records). Do not sum historical totals.

## Result and scope

- Genuine fresh migration chain: **38 files / 38 ledger rows**, including 0022
  and 0038, original SHA256 prefixes matched; no skipped files or fabricated rows.
- Migration harness passed read-only dry run, body/ledger failure atomicity,
  second-run no-op, checksum drift rejection, real 0022→0038 repair fixtures,
  repair idempotence and malformed-data rollback.
- Dedicated authenticated server workflow: **1 file / 10 passed / 0 failed / 0 skipped**.
- Full Vitest suite, all DB gates enabled, serial: **161 files / 3,936 passed /
  0 failed / 0 skipped**.
- Project nonincremental TypeScript and standalone migration CLI/harness
  TypeScript checks: exit 0. Historical SQL tracked diff: empty; all 38 retained
  ledger checksums reverified against disk after the suite.
- Repository-wide `git diff --check`: exit 2, **only unrelated existing
  `server/routes/billing.ts:140` blank line at EOF**. Left untouched.
- Task-scoped tracked `git diff --check`: exit 0.
- Editor warning on the pre-existing `tsp_app_local` test fallback password in
  `test/database-safety.ts` remains; no new TypeScript errors found.

This pass did not connect to existing databases (including ports 5432/5433), read
env files, call external providers, deploy or commit. External boundaries were
mocked; local PostgreSQL, fixture-owned Redis and loopback HTTP were real. No
Chromium/Playwright/browser acceptance was run in that initial pass. Test filenames containing
`browser` in Vitest are not proof of a real composed browser journey.

### Subsequent thin-browser follow-up (same retained cluster)

The separate roadmap28 follow-up ran actual headless Chromium with the original
React App and real API/session middleware: **1 file / 2 passed / 0 failed / 0 pending**.
The shared fixture regression separately passed **1 file / 10 tests / 0 failed /
0 pending**, and project nonincremental TypeScript passed. The full suite and
migration harness were **not rerun** in this follow-up.

See [workflow acceptance](workflow-acceptance.md#thin-chromium-follow-up--2026-09-19)
for exact gates, UI actions, fixture setup and limitations. Evidence is
`test-results/workflow-browser-acceptance.json`, `/tmp/tsp-roadmap28-browser.log`,
`/tmp/tsp-roadmap28-composed.log`, and `/tmp/tsp-roadmap28-browser-tsc.log`.
Only external boundaries are mocked; no browser API response fixtures. A genuine
same-intent retry bug was fixed locally, and the crawler mock was corrected to its
typed Headers contract. The retained schema/roles/migration ledger were not edited.
No existing database, dev server, env file, paid provider, deploy or commit was used.

Reload acceptance means no automatic replay after failure/cancellation and saved
content restoration, not unfinished-job reattachment. Sandbox delivery invokes the
real worker directly after making its owned schedule due. Those thin-browser cases
alone do not establish scheduler/Bull delivery or process-crash recovery.

### Subsequent process-crash/Bull follow-up (same retained cluster)

The guarded `test/workflow/run-crash.mjs` passed **2 files / 17 tests / zero
failures or pending**, exit 0: seven new cases plus ten composed regressions.
Real SIGKILL/IPC barriers cover pre-claim, authorized/pre-dispatch and mock-provider
acceptance before receipt commit. Production due-target discovery and actual
private Redis/Bull transport exercise bounded stalled recovery, retries, duplicate
receipts, current policy, cancellation and distinct sandbox/live counts/emails.
Killed started editorial work remains consumed and cannot replay, even after loss
of its exact Redis record. Explicit stale reconciliation preserves the five-minute
gate and records observed worker exit; only owned timestamps are aged for testing.

See [crash acceptance checklist](workflow-acceptance.md#process-crash-and-actual-bull-follow-up--2026-09-19)
and `/tmp/tsp-roadmap28-crash-confirmed-summary.json` (report/log alongside).
All 38 original migration checksums passed the postcheck; no SQL/history/role
changes. Guards reported no blocked operations; fixture teardown passed and the
cluster remains running. Global TypeScript currently fails on unrelated
`server/routes/billing.ts:140` (`TS1005`), left untouched. Full suite remains the
parent task, not rerun here. External providers are mocked; cron startup and
host/Redis/PostgreSQL crash recovery are not accepted by this follow-up.

The older shared-database 0022 ledger gap is **still unresolved**. This fresh
empty-chain rehearsal does not prove production-shaped legacy data repair,
general infrastructure crash recovery, live OAuth/AI/payment/media/publishing, performance at
production scale, or production readiness. Keep roadmap gaps explicit.

## Retained independent cluster

| Property | Value |
| --- | --- |
| Evidence/base directory | `/tmp/tsp-acceptance.2e4C5P` |
| Data directory | `/tmp/tsp-acceptance.2e4C5P/data` |
| Address | `127.0.0.1:60053` (IPv4 loopback only) |
| Server PID | `33503` (recheck before manual cleanup) |
| Database | `thesocialpundit_acceptance_test` |
| Migration/fixture owner | `vivekanandchoudhari`, BYPASSRLS, no superuser/CREATEDB/CREATEROLE |
| Runtime | `tsp_app`, no superuser/BYPASSRLS/CREATEDB/CREATEROLE |
| Bootstrap admin | `tsp_cluster_admin`, confined to this new cluster |
| PostgreSQL | Homebrew 14.18 |

Provisioned with Homebrew `initdb`/`pg_ctl`, private temporary datadir/socket,
locale C/UTF8 and template0. Role/database provisioning and identity/ledger
inspection used Node `pg`, never `psql`. Runtime password is disposable
`localtestpass`; cluster-local authentication is trust, not a production setup.
Datadir realpath and server address/port/database were verified before provisioning
and again after the full suite. It was retained running for follow-ups, then
stopped after final combined verification; data and reports are retained.

## Exact gates and runners

Migration harness received:

- `MIGRATION_ACCEPTANCE=fresh-chain`
- `MIGRATION_TEST_DATABASE_URL=postgresql://vivekanandchoudhari@127.0.0.1:60053/thesocialpundit_acceptance_test`
- `MIGRATION_CONFIRM_DATABASE=thesocialpundit_acceptance_test`

Workflow/full suite received explicit matching URLs:

- Runtime `DATABASE_URL` / `TEST_DATABASE_URL`:
  `postgresql://tsp_app:localtestpass@127.0.0.1:60053/thesocialpundit_acceptance_test`
- Owner `OWNER_DATABASE_URL` / `OWNER_TEST_DATABASE_URL`:
  `postgresql://vivekanandchoudhari@127.0.0.1:60053/thesocialpundit_acceptance_test`
- `BILLING_DB_TESTS=true`, `CREDENTIALS_DB_TESTS=true`,
  `NOTIFICATIONS_MEDIA_DB_TESTS=true`, `NOTIFICATIONS_MEDIA_MIGRATION_TESTS=true`,
  `PUBLISHING_POOL_DB_TESTS=true`, `WORKFLOW_DB_TESTS=true`.

Private launchers: `workflow-run.mjs`, `full-suite.mjs`, `final-verification.mjs`
under the evidence directory. The full runner sanitizes inherited environment,
uses installed Vitest with `envFile:false` / `envDir:false`, one worker and serial
files, and preloads `offline-guard.cjs` in child processes. That guard blocks
external DNS/TCP, existing DB ports and `.env*` reads; allows only spawned
socket-only nonpersistent Redis fixtures for Unix sockets. No blocked operations
were recorded on the passing full run. Normal test timeout defaults are retained;
the real workflow retry/backoff test declares its own 20-second timeout.

**Do not rerun the fresh-only migration harness against this now-populated DB.**
Its committed schema and ledger are retained evidence, not disposable setup to
silently reset. Reproduction of fresh migration acceptance requires another
explicitly authorized new cluster/database. The full suite can mutate/delete its
own fixtures in this isolated database; do not point it at shared data.

## Corrections and failed attempts

1. Provisioning shell quoting lost password quotes; replaced by a private JS
   orchestration script. Initial failure and logs retained.
2. PostgreSQL `inet::text` includes `/32`; migration harness now uses `host()`.
3. Workflow startup awaited Bull's worker-lifetime promise, not readiness; fixed
   readiness/lifetime error handling. Receipt comparison now uses wire dates.
4. Draft-save failure originally assumed an absent FK. It now exercises real NUL
   text rejection and verifies clean save without another AI call.
5. First full run: 3,678 passed / 2 failed / 194 pending, 160 files. Nine suites
   hard-coded the old shared DB; private Redis Unix sockets were overblocked;
   the workflow retry exceeded Vitest's default timeout.
6. Next full run: 3,929 passed / 7 failed / 0 pending, 161 files. All remaining
   failures were lock-wait observation queries: non-superuser owner cannot see
   runtime query details in `pg_stat_activity`. Observers now use the runtime
   pool to inspect sessions belonging to their own role; **no privileges added**.
7. Shared-terminal interference returned unrelated 68-test reports and interrupted
   an early run. Those are not acceptance evidence. A separate test-child process
   group and uniquely persisted reports produced the verified complete runs.

Source changes are test guards/fixtures and migration-harness address validation;
historical SQL and application behavior were not rewritten to make tests pass.
`requireLocalTestDatabase` has pure rejection tests for omitted/mismatched URLs,
roles, query overrides, remote/aliased acceptance hosts, unsafe ports and PGOPTIONS.

Final full-run opt-in counts (all passed, none skipped): billing generation 7;
credentials 32; notifications/media migration 1; notifications/media 6;
publishing pool 3; composed workflow 10. Final full run completed at
`2026-09-19T01:27:30.515Z`; saved reports, not interleaved terminal summaries,
are authoritative.

## Evidence files

All under `/tmp/tsp-acceptance.2e4C5P`:

- `cluster.json`, `initdb.log`, `postgres.log`, `provision.log`.
- `migration-acceptance.json` / `.log` (complete ledger and harness outcomes).
- `workflow-final.json`, `workflow-final-summary.json`, `workflow-final.log`.
- `full-suite.json`, `full-suite-summary.json`, `full-suite.log`, `full-suite.exit`.
- Timestamp-prefixed previous full-suite reports and blocked-operation evidence.
- `final-verification.json`, `typecheck.log`, `script-typecheck.log`,
  `diff-check.log`, `scoped-diff-check.log`, `sql-diff.log`, `workspace-status.log`.

Post-run process inspection also observed orphan Redis PIDs `40006`
(`127.0.0.1:60119`) and `50130` (socket under `editorial-test-Tdfiqy`). These may
be from earlier interrupted/blocked fixture runs, but ownership was not
conclusively established in the shared environment. They were **not killed**;
review provenance before cleanup. Passing-run fixture teardown succeeded.

## Final cleanup — stop executed, deletion NOT executed

Verified canonical datadir, pidfile/process identity and port 60053, and that the
final runner was no longer running. The exact `pg_ctl` stop below succeeded;
the pidfile is gone and no TCP listener remains on 60053. No other database or
Redis service was stopped. Datadir/evidence deletion below is optional and was
**not** performed.

First preserve any evidence needed for review. Stop only this cluster:

`/opt/homebrew/opt/postgresql@14/bin/pg_ctl -D /tmp/tsp-acceptance.2e4C5P/data -m fast -w stop`

Only after confirming it stopped and preserving the reports, remove its exact
private directory if desired:

`rm -rf -- /tmp/tsp-acceptance.2e4C5P`

Do not stop any other PostgreSQL/Redis service, and do not use port 5432 or 5433
for cleanup. No cleanup is scheduled or automatic.