# Roadmap 8 + 12: atomic inbox refresh contract

## Identity and history

`shared/canonical-url.ts` is the only inbox URL normalizer. It accepts absolute
HTTP(S) URLs without credentials, uses WHATWG host/default-port normalization,
removes fragments and only the explicitly listed tracking parameters. Meaningful
query encoding/order/duplicates, path case, trailing slash and HTTP vs HTTPS remain
distinct. Unknown tracking-looking keys remain. There is no network unwrapping.

All statuses participate in deduplication. Existing saved/dismissed rows are returned
unchanged by manual addition, never resurrected. Before deduplication, storage drains
every NULL canonical key in 200-row batches using that same helper. Invalid legacy
URLs receive `""`; duplicate IDs and draft references are retained. The canonical
index is deliberately nonunique. A bounded ranked pool (600 maximum) is scanned
past historical matches before applying the ten-item quota.

## Transaction contract

Every application inbox writer uses one transaction-scoped PostgreSQL advisory lock
keyed by tenant AND user: create/manual add, status/relevance update, reactivation,
clear and batch refresh. Capacity is an SQL active count, not a paginated list.
Active growth stops at ten; legacy overcapacity is left intact and blocks growth.
Explicit saves/dismissals remain allowed. Owner/raw-SQL maintenance must obey this
same contract; no database trigger enforces the cap against arbitrary direct SQL.

Automatic refresh takes the oldest active IDs AND mutation versions before fetch,
then releases its transaction. Crawling holds no inbox lock. After a wholly
successful source/search batch, one locked commit deduplicates all history, fills
free slots first, and dismisses only the minimum number of unchanged, still-active
snapshot rows needed for its new inserts. Every status update increments the version,
including save/reactivate ABA edits. New additions and edited rows cannot be replaced.
Empty, historical-only or failed automatic refreshes dismiss nothing.

Dismissals, inserts and the scoped operation receipt commit together or all roll
back. Receipt replay returns the original committed result, not today's live inbox
count; saves or explicit clear after the commit cannot cause a second replacement.
Clear retains its existing explicit deletion semantics (including removal of inbox
history), but does not delete receipts. Receipt retention is intentionally indefinite.

## Engine and callers

- Source and search batches are bounded and fail closed on any partial/deadline
  failure. All started application crawl/discovery work and cleanup is awaited.
  The existing low-level DNS cancellation fence discards uncancellable Node DNS
  results; it cannot send a late request or persist a late source.
- Discovery-only failures are safe `discoveryWarnings`, separate from fetch failure.
  Failed fetches do not commit inbox rows/receipts. Search reservations and source
  fetch-status metadata retain their existing independent persistence behavior.
- `InboxRefreshResult` carries `success`, `outcome` (`updated`, `capacity`, `no_new`,
  `needs_setup`, `failure`), committed `count`/`items`/`activeCount`/`replacedCount`,
  and the existing processed/matched/new-item counters. On a precommit failure,
  inserted/replaced counts are zero and activeCount is the prefetch observation.
- Sync refresh and admin rerun validate optional UUID operation IDs, bind them to
  server-derived tenant/user scope, and check receipts before enqueue/fetch. Reuse
  with a different committed mode is a conflict. Clients retrying an uncertain
  request must reuse the same operation ID; omitted IDs denote new operations.
- Workers use the supplied operation ID or a stable hash of the Bull job ID and
  check receipts before profile/fetch. Failed engines throw for Bull retry. Progress
  delivery failure after commit cannot repeat the transaction on retry. Logging is
  awaited best-effort and cannot turn a successful commit into a failed operation.
- Sync/admin results and queued completion use the shared outcome contract.
  Existing authentication, permission, onboarding-profile preconditions and queue
  admission HTTP envelopes are preserved. No prefetch mass dismissal remains.
- The active UI refresh hook displays the shared outcomes rather than inventing new
  articles for capacity/no-new/setup results. Its existing uncertain-admission guard
  still blocks automatic re-enqueue; browser recovery with a persisted operation ID
  is not introduced here.

## Migration and validation record

Only `0027_inbox_refresh_contract.sql` was applied, via the existing migrator with
explicit `--no-dotenv --only=0027_inbox_refresh_contract.sql`, to
`localhost:5433/thesocialpundit_test`. Owner: `vivekanandchoudhari`; restricted
runtime: `tsp_app`. Runtime role has neither superuser nor BYPASSRLS.

0027 SHA256: `30f679c738c0787137de27c27565e14e6b85376d1cff6b196536542697ef081d`.
Recorded 16-character checksum: `30f679c738c07871`.
Receipt RLS is enabled AND forced; SELECT/INSERT/UPDATE/DELETE grants were verified.
The recorded checksums for untouched 0023–0026 match their files:
`5c0933147779f53e`, `98830b70dca86d6e`, `75bbe23cddb79c00`, `53f4e1a1b8b9a3c1`.

The isolated database already had 0022's columns but no 0022 ledger entry. That gap
was not repaired, and 0022 was not executed. The explicit single-file migrator flag
does not waive checksum verification or claim earlier migrations are applied.

Final focused regression: **14 named files / 241 tests passed**. TypeScript no-emit
check and `git diff --check` passed. These are not a full-suite claim.

Test files:
- `shared/canonical-url.test.ts`
- `server/storage.inbox-refresh.test.ts`
- `server/storage.inbox-relevance.test.ts`
- `server/storage.tenant-isolation.test.ts`
- `server/rls.test.ts`
- `server/services/engines/baseEngine.relevance.test.ts`
- `server/services/engines/baseEngine.search.test.ts`
- `server/services/engines/baseEngine.crawler.test.ts`
- `server/services/publicationSources.test.ts`
- `server/routes/inbox.relevance.test.ts`
- `server/routes/inbox.refresh-contract.test.ts`
- `client/src/lib/ux-audit.test.ts`
- `client/src/pages/ux-audit.test.ts`
- `client/src/components/dashboard/inbox-detail.relevance.browser.test.ts`

Coverage includes >500-row history, meaningful URL variants, ranked fill, mixed
concurrent writers, legacy overcapacity, rollback, receipt/RLS isolation, minimum
replacement, user-save/ABA fencing, no locks during blocked fetch, actual database
worker postcommit replay, partial/deadline failures, safe errors, caller parity and
fully mocked Chromium outcome rendering. Providers and queue admission are mocked;
there was no live Redis-worker/provider or deployment validation.

## Files and rollout limits

Core: `shared/canonical-url.ts`, `shared/inbox-refresh.ts`, `shared/schema.ts`,
`server/storage.ts`, migration 0027. Integration: engine `baseEngine.ts`/`types.ts`,
`publicationSources.ts`, inbox/admin routes, `jobs/queue.ts`, inbox worker and
`client/src/hooks/use-inbox-refresh-job.ts`. Test adapter: `test/inbox-refresh-fixture.ts`.
Migration tooling/documentation: `script/migrate.ts`, `migrations/README.md`, this file.

Deploy 0027 before the corresponding application code and coordinate all writers:
an old application instance would not take the new advisory lock. First access to
a very large legacy scope may spend longer under the lock draining its history.
Receipt storage grows until a separately designed retention policy is introduced.
Profile-precondition responses remain outside the engine outcome contract.
No production/development migration, env-file access, provider/email/payment/posting
call, deployment or commit was performed. Existing uncommitted work was retained.