# Migrations

```bash
npm run db:migrate        # apply pending migrations
npm run db:migrate:dry    # show what would run, change nothing
```

Runs as an explicitly supplied `OWNER_DATABASE_URL` (or `DATABASE_URL`) —
migrations create policies/grants that the restricted application role cannot.
The runner no longer loads `.env`; URLs require explicit user, host, port and
database. `--no-dotenv` remains accepted for compatibility.

`script/migrate.ts --preflight` performs offline lexical validation of every SQL
file without connecting. `--dry` uses a read-only transaction and does not create
the ledger. Plain historical outer transaction controls are normalized only in
memory; original checksums remain authoritative. New SQL should omit wrappers.

See [migration correctness and rollout](../docs/migration-correctness.md) for the
exact 0016 exception, unresolved 0022 ledger gap, SQL inventory and gated disposable
fresh-chain harness. **The authorized isolated rehearsal applied all 38 files,
including 0038, and passed fresh-chain acceptance on 2026-09-19.** This applies
only to `127.0.0.1:60053/thesocialpundit_acceptance_test`, not shared or production
databases. See [retained evidence](../docs/isolated-acceptance.md); no general
database/cluster/role provisioning or rollout is authorized by this result.

## Rules

1. **Never edit an applied migration.** The migrator stores a checksum and
   refuses to run if a recorded file changed, because that means environments
   have silently diverged. Add a new file instead.
2. **Write migrations idempotently** (`IF NOT EXISTS`, `WHERE NOT EXISTS`,
   `DO $$ … EXCEPTION WHEN duplicate_object`). The databases predate this
   system, so files must be safe to apply to a schema that already has the
   change.
3. **Each file gets its own transaction.** A failure leaves nothing partial.

## Do not use `drizzle-kit push`

`push` diffs the Drizzle schema against the live database. It was observed
reporting "Changes applied" against a migration-built database and **dropping
the `tenant_isolation` RLS policies** in the process. In CI that would leave
the cross-tenant isolation tests passing against an unprotected schema, which
is the most dangerous outcome available.

`npm run db:push` therefore refuses and points here. If you genuinely want it
for local iteration, run `npx drizzle-kit push` directly and re-apply
`0002_rls.sql` afterwards.

## Files

| File | Purpose |
|---|---|
| `0000_baseline.sql` | Full table/index schema. Generated with `drizzle-kit generate`, then made idempotent. Verified byte-equivalent to a push-built schema. |
| `0001_tenancy.sql` | Introduces tenancy: tables, `tenant_id` columns, and the backfill that stamps existing rows. A no-op on a fresh database, where `0000` already has the final shape. |
| `0002_rls.sql` | The `tsp_app` role, grants, and the `tenant_isolation` policies. Drizzle cannot express any of these. |
| `0013_sync_tenant_rls_and_constraints.sql` | Adds RLS to tenant tables introduced after `0002` and enforces non-null draft publication status. |
| `0014_billing.sql` | Adds Razorpay-ready tenant billing plans, customers, subscriptions, payments, methods, and webhook idempotency records. |
| `0015_profile_social_links.sql` | Adds tenant/user-scoped public social profile URLs, separate from OAuth credentials. |
| `0023_publication_resolution.sql` | Adds `user_profiles.publication_candidates` (JSONB, non-null `[]`) and durable tenant/user/URL discovery leases, safe error text, and resolved tombstones under FORCE RLS. |
| `0024_publication_source_lifecycle.sql` | Adds nullable durable `resolved_feed_url` and backfills exact scoped source references, without altering migration 0023. |
| `0025_user_source_deletions.sql` | Persists tenant/user/canonical-feed deletion intent independently of publication discovery under FORCE RLS. |
| `0026_search_query_planning.sql` | Adds checked `search_edition` (text, non-null `en-US`) and server-owned `search_query_state` (JSONB object, non-null `{}`) to profiles. |
| `0027_inbox_refresh_contract.sql` | Adds canonical inbox identity, mutation versions, a nonunique scoped index and durable refresh receipts under FORCE RLS. |
| `0038_repair_legacy_keyword_wrappers.sql` | Forward-only repair of exact recoverable 0022 nested keyword objects; preserves zero/category/original metadata and fails on ambiguous data. Applied only in the isolated acceptance rehearsal. |

### Publication resolution (0023)

- Required before deploying code that reads `publicationCandidates`. Existing
   `publications: string[]` values are unchanged; no discovery or source creation runs in the migration.
- The custom runner discovers numbered SQL files directly and records checksums
   in `schema_migrations`; `meta/_journal.json` is not used and needs no change.
- All claim/completion/profile-update operations lock the same profile row.
   Claims lease for 30 seconds; stale tokens cannot finish or create sources.
   Deselection invalidates checking claims, including across reselection.
- Failed attempts keep `lastAttemptAt` for retry rotation. Resolved rows remain
   tombstones when a source is deleted; an existing paused source is linked, not reactivated.
   Deleting the profile cascades its resolutions. Database errors propagate except
   the explicitly targeted tenant/user/feed uniqueness conflict.
- Validation for this increment is restricted to `thesocialpundit_test` on
   `localhost:5433`: runtime `tsp_app`, owner `vivekanandchoudhari`.
   Do not run migrations on development or production as part of this task.

### Publication source lifecycle (0024)

- Deploy this additive migration before the corresponding storage code. Run as
   the migration owner with FORCE-RLS visibility; `row_security = off` fails
   rather than silently performing an incomplete backfill. It does not disable
   table RLS or change application-role privileges.
- Backfill joins existing sources by ID **and tenant and user**, only for resolved
   rows with a NULL canonical URL. Repeated execution is safe. Old tombstones whose
   sources were already deleted remain NULL and cannot automatically reconnect;
   the status stays conservatively removed, even after adding a similarly named URL.
- Profile edits pause only publication-created sources with no remaining selected
   source/canonical-feed alias (including explicitly selected feed URLs). They never
   delete or reactivate sources; manual and suggestion sources are independent.
- Source create/update/delete share the profile lock with claims and completion.
   Deletion fences outstanding claims in that profile without resetting attempt
   times (their canonical feeds are not yet known), and preserves resolved rows.
   Later discovery of another alias of a known removed feed retains the tombstone.
- Explicit manual/suggestion creation repairs missing-source references only for
   the identical `resolved_feed_url` in the same tenant/user transaction. It never
   guesses from a name or host, rewrites attempt times, or reactivates another row.
   Status GETs remain read-only projections, never repair paths.
- Validation is restricted to `thesocialpundit_test`, `localhost:5433`, runtime
   `tsp_app` and owner `vivekanandchoudhari`. Apply only 0024 for this increment;
   do not modify 0023 or migrate development/production databases.

### Canonical deletion before discovery (0025)

- Apply this additive migration before the corresponding storage code; 0023/0024
   are unchanged. Validation uses only `localhost:5433/thesocialpundit_test`, runtime
   `tsp_app` and owner `vivekanandchoudhari`, never development/production or `.env`.
- A separate canonical-keyed table is necessary: a `publication_resolutions.url`
   row for that URL may already resolve to a different feed. Reusing it would
   overwrite that resolution/tombstone. The marker stores the deleted source ID
   even before the first claim, independently of failed/reclaimed discovery leases.
- Delete persists the marker and fences outstanding claims atomically. Completion
   checks the exact canonical feed in the same tenant/user under the profile lock,
   records a resolved-but-removed alias tombstone, and never inserts a source when
   a marker exists. Existing resolved tombstones remain a guard for legacy data.
- Explicit manual/suggestion creation clears only its exact scoped marker and
   relinks known aliases in the same transaction. It preserves paused intent and
   attempt times. GETs and the UI are unchanged and never repair storage.
- Markers have cascading tenant/user identity FKs, not a profile/source FK: manual
   deletion before profile creation must also persist. There is no speculative
   backfill for older pre-resolution deletions whose identity was already lost.

### Search query planning (0026)

- Additive, idempotent profile columns; no new table, provider calls, or changes
   to existing selections, RLS, or grants. Apply before code reads these columns.
   Do not edit applied migrations 0023–0025. The runner discovers 0026 automatically.
- `reserveSearchQueryPlan(scope)` locks the current tenant/user profile row in
   the same transaction as the cursor update, sharing the existing profile-edit
   lock. It derives queries from the locked row, not an earlier caller snapshot,
   and returns `{ queries: string[], searchEdition: string }`. Missing profiles
   throw; failed external fetches still consume their reserved turn.
- `planSearchQueries(profile, state)` returns `{ queries, state }`, max eight
   unique NFKC/case/whitespace-normalized labels. Positive keywords take precedence
   over company then influencer duplicates; zero keywords do not suppress a
   same-label company. Legacy input is bounded to 100 entries/type and 100 chars/term.
   Invalid signals yield no queries; malformed cursor state resets safely.
- Balanced group round robin redistributes unused slots and rotates the starting
   group. Keywords sort by descending weight, then canonical label; persistent
   cursors traverse every eligible term (at most 100 refreshes with unchanged
   selections). Weights prioritize **order within a cycle**, not probability or
   long-run frequency. Full-list next-nonseen scans prevent wrap/duplicate starvation.
- Versioned state stores a bounded canonical selection/weight signature and three
   cursors. Reordering distinct selections or changing categories does not reset it;
   substantive edits do. Conflicting duplicate metadata is first-seen, like relevance.
   Neither profile creation nor update accepts caller-supplied cursor resets.
- Supported editions: `en-US`, `en-GB`, `en-IN`, `hi-IN`, `fr-FR`, `de-DE`, `es-ES`,
   `pt-BR`, `ja-JP`, `en-AU`, `en-CA`. Storage validates exact values on create/update.
- This increment applies **only 0026** to verified `localhost:5433/thesocialpundit_test`
   as owner `vivekanandchoudhari`, with restricted runtime `tsp_app`. No `.env`,
   development/production migration, live provider call, deployment, or commit.

### Atomic inbox refresh (0027)

- Apply before deploying the corresponding storage/schema code. It retains all
   existing IDs, statuses and draft references; duplicate canonical URLs are legal
   historical rows, not migration errors. No provider calls run in the migration.
- Historical canonical keys are populated lazily by the shared TypeScript helper,
   in 200-row batches under the inbox writer lock. Every historical row is processed
   before a dedupe decision; there is no 500-row blind spot. Invalid legacy URLs
   receive an empty-string sentinel and remain intact.
- Only `0027` was applied for this increment, to
   `localhost:5433/thesocialpundit_test` as `vivekanandchoudhari`; runtime tests use
   `tsp_app`. No development/production database or `.env` was accessed.
- The existing test ledger lacks `0022` despite its columns being present.
   `script/migrate.ts --no-dotenv --only=0027_inbox_refresh_contract.sql` explicitly
   selects the authorized file while still checking every recorded checksum.
   It does **not** reconcile that older gap or validate skipped dependencies.
   At that time default migration ordering and dotenv behavior were unchanged.
   Roadmap 27 now disables implicit dotenv and blocks default apply across known
   ledger gaps; later-only selection still does not reconcile them.
- SHA256: `30f679c738c0787137de27c27565e14e6b85376d1cff6b196536542697ef081d`;
   ledger checksum: `30f679c738c07871`. Applied SQL must not be edited.
- See [inbox refresh contract](../docs/inbox-refresh-contract.md) for concurrency,
   idempotency, validation and rollout limitations.

## Adding a migration

Change `shared/schema.ts`, then either write the SQL by hand or generate a diff
and adapt it:

```bash
npx drizzle-kit generate --config <temporary config pointing elsewhere>
```

Name it with the next unused number, make it idempotent where appropriate, and
run offline preflight first. Never modify historical SQL to make a rehearsal pass.
Fresh-chain testing requires parent authorization and a separately provisioned,
explicitly confirmed disposable target; follow the gated harness prerequisites in
[migration correctness](../docs/migration-correctness.md). The harness does not
create databases/roles/clusters or silently use the shared test database.
