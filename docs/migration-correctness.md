# Roadmap 27: migration correctness and gated acceptance

## Status and boundaries

**Authorized isolated fresh-chain acceptance passed on 2026-09-19.** All 38 SQL
files, including unchanged 0022 and corrective 0038, actually executed on the
separate disposable cluster `127.0.0.1:60053/thesocialpundit_acceptance_test`.
Ledger checksums, read-only dry run, body/ledger rollback, second-run no-op,
drift refusal and actual 0022→0038 keyword repair probes passed. Evidence and
retained-cluster cleanup instructions: [isolated acceptance](isolated-acceptance.md).
No existing database, env file, live provider, deployment or commit was used.
0038 is **applied only in that isolated rehearsal**, not to the shared database
or production. Shared 0022 history reconciliation and production-shaped-data
rehearsal remain pending; fresh empty-chain success is not rollout authorization.

Owned files: `script/migrate.ts`, `script/migration-sql.ts`,
`script/migration-runner.ts`, `script/migration-acceptance-guard.ts`,
`script/migration-acceptance.ts`, `test/migration-runner.test.ts`,
`migrations/0038_repair_legacy_keyword_wrappers.sql`, this document and the
migration README. No shared schema/runtime/UI change is needed. Historical SQL,
including 0022 and applied 0023–0037, is untouched.

## Read-only inventory and original checksums

All 37 existing SQL files were read before changes; 0038 makes 38. There is no
0031 SQL: credential encryption originally needed no schema change. Missing
numbers are not invented migrations or ledger gaps. Number uniqueness is checked.
`meta/_journal.json` is not this runner's ledger.

| Historical file prefix | Original SHA256 first 16 | Outer controls |
| --- | --- | --- |
| 0000 | bd2b94f3d2289518 | none |
| 0001 | 26067a0bee61ac3a | pair |
| 0002 | e2dd0012a4ab2e65 | pair |
| 0003 | d1c2d700f745e7a0 | pair |
| 0004 | 779526f9f5eeb6c4 | pair |
| 0005 | 877f3197287317fb | pair |
| 0006 | ac814501ae1b0d78 | none |
| 0007 | f10456c4951a19fb | none |
| 0008 | b096783d52518a78 | none |
| 0009 | 3281a04783dda9c4 | none |
| 0010 | 5247564fc5bbd0bd | none |
| 0011 | f4c863bcbd76bb2a | none |
| 0012 | 7b6e976630b6a608 | none |
| 0013 | 86da84d5117aac4f | pair |
| 0014 | ec5b8f5f67017f2a | pair |
| 0015 | 8c1429461160092e | pair |
| 0016 | ccab8d8c6ce43579 | orphan terminal COMMIT |
| 0017 | 13d20a29bd422041 | none |
| 0018 | ec6a8abbf18eec95 | none |
| 0019 | 38a3a890f8eec9ee | pair |
| 0020 | 76b29abbd668133c | pair |
| 0021 | bb25561efb0a16f9 | pair |
| 0022 | a5a289395263dadf | pair |
| 0023 | 5c0933147779f53e | none |
| 0024 | 98830b70dca86d6e | none |
| 0025 | 75bbe23cddb79c00 | none |
| 0026 | 53f4e1a1b8b9a3c1 | none |
| 0027 | 30f679c738c07871 | none |
| 0028 | ecb77728db896159 | none |
| 0029 | 159898b15d9b9628 | none |
| 0030 | 1174e7427b8211a7 | none |
| 0032 | 5434586818a90707 | pair |
| 0033 | de5bfc7795180fa6 | none |
| 0034 | cf0af2d38ef69367 | none |
| 0035 | 7c6a6db5fd14af0a | none |
| 0036 | feb422df6780ac7d | pair |
| 0037 | 6dc6738d14c1fcb4 | none |

The offline regression compares **all** these historical hashes. The runner's
ledger continues to use SHA256(original UTF-8 file), truncated to 16 hex chars.
It never substitutes a normalized-body checksum or modifies an old ledger row.

## Runner design

- `script/migrate.ts --preflight` reads and lexically preflights **every SQL file**
  without reading connection variables, importing pg, loading dotenv or connecting.
  It prints filename, original checksum, statement count and removed-control count.
  `--only` does not narrow preflight or checksum verification.
- Without `--preflight`, supply `OWNER_DATABASE_URL` (preferred) or `DATABASE_URL`
  explicitly through the approved process environment. URL must include user,
  hostname, port and database. There is **no implicit dotenv loading**, including
  the default invocation; `--no-dotenv` remains an accepted compatibility flag.
  Unknown/duplicate options fail before connecting. Target/credentials are never
  printed. Only optional `sslmode=disable|require|verify-full` is accepted; TLS modes
  use certificate verification. Socket paths, query host/options overrides and
  implicit PGHOST/PGUSER/PGDATABASE/PGPASSWORD fallback are not supported. The
  password callback also avoids pgpass fallback for an intentionally empty password.
- The executor receives one dedicated idle connection, never a pool's `query`.
  CLI owns its connect/end lifecycle. Fixed startup lexical mode and explicit
  per-file `SET LOCAL` use standard-conforming strings and public search path.
- Apply uses a session advisory lock `(727027, 1)` spanning per-file commits.
  Cooperating runners serialize and read history after taking the lock. Old
  runners and arbitrary direct SQL do not cooperate: stop them for rollout.
- Each pending file has one runner-owned transaction: BEGIN → local settings →
  ledger CREATE IF NEEDED → normalized body → original checksum INSERT → COMMIT.
  A body/ledger failure rolls back that file, including first-time ledger creation,
  and stops subsequent files. Previously committed files stay applied.
  An uncertain COMMIT/network outcome needs ledger/data inspection; never assume
  a client error proves rollback or blindly bypass checksums to retry.
- `--dry` starts `BEGIN READ ONLY`, queries `to_regclass` for the public ledger,
  reads ledger rows only if it exists, then rolls back. No CREATE, INSERT, UPDATE,
  advisory lock or migration body is issued. Missing ledger means all files are
  pending, **not proof that an existing schema is safe to migrate**.
- Every recorded filename/checksum must match the disk inventory, including
  unselected files. Missing historical files and drift fail closed before writes.

### Lexical normalization, not SQL rewriting

The small splitter understands semicolon boundaries, standard/escape strings
(including doubled quotes and newline continuation), quoted identifiers,
tagged/untagged dollar quotes, line comments and nested block comments. Bodies
and literal `COMMIT`/`BEGIN` text are opaque and unchanged. Only recognized
outer-control tokens are blanked with same-length spaces; even comments inside
the wrapper survive. No regex removes arbitrary BEGIN/COMMIT text.

Accepted outer opening statements: plain BEGIN, BEGIN WORK, BEGIN TRANSACTION,
START TRANSACTION. Accepted closings: plain COMMIT/END, optionally WORK or
TRANSACTION. Only one outer pair is allowed. Nested/middle/unmatched controls,
SAVEPOINT/RELEASE, ROLLBACK/ABORT, prepared transactions, transaction modes and
AND CHAIN are rejected. **One reviewed exception** allows the terminal COMMIT
of exact `0016_profile_social_links_rls_fix.sql` with checksum `ccab8d8c6ce43579`.
Changing any byte or renaming that file invalidates the exception.

Unterminated literals/comments fail offline. COPY, CALL, psql metacommands,
unquoted BEGIN ATOMIC bodies and unsupported lexical/session changes fail closed.
This is not a general PostgreSQL grammar parser or a sandbox for malicious SQL.
DO/function bodies are not rewritten or semantically audited; PostgreSQL must
reject illegal transaction control inside the runner transaction. Trusted SQL
still needs review for dynamic SQL, external effects and nontransactional objects.
New migrations should omit wrappers and use quoted procedural bodies.

## 0022 mixed-array damage and forward repair 0038

0022's predicate finds an array containing **any string**, then wraps **every**
element with `{keyword: originalElement, weight: 0.7}`. A weighted object remains
structurally available inside `keyword`, but application readers expect a string.
Its original inner weight/category have not necessarily been lost.

0038 unwraps exactly one object layer only when the outer object has exactly
`keyword` and `weight`, weight is JSON number 0.7, and the inner object has a
nonblank bounded string keyword, optional numeric weight 0–1 and optional nonblank
bounded string category. Entire inner objects survive, including **weight 0**,
topical categories and additional metadata. Already-valid entries, ordering,
duplicates, SQL NULL and empty arrays remain unchanged. Plain legacy strings are
preserved, not assigned new defaults by this repair. No dedup/trim/truncation,
JSON-text parsing, numeric casts, or rewriting of profile timestamps occurs.

Nonarray JSON (including JSON null), invalid elements/weights/categories, nested
wrappers, changed outer weights and extra outer metadata **abort the whole file**.
There is no silent quarantine/drop or partial-success ledger record. Original
data stays in place after rollback for access-controlled manual review; fixed
exceptions contain no user IDs or keyword content. Rows are locked in ID order.
`SET LOCAL row_security=off` makes inadequate FORCE-RLS visibility an error rather
than a silently incomplete repair; it does not disable policies or grant bypass.

The known shape is evidence of recoverability, **not proof of historical origin**.
Overwritten/deleted values cannot be reconstructed. Unknown structures require a
reviewed per-row decision, not recursive unwrapping or converting objects to text.
SQL character bounds are structural guards, not complete current JS input-schema
normalization (UTF-16 limits/whitespace may differ). Large profiles are not silently
truncated to today's API list limit.

On a future fresh chain, historical 0022 still executes unchanged and may
temporarily create these wrappers; 0038 restores the recoverable originals.
Keep application/profile writers stopped until the full chain finishes. If 0022
itself fails on unsupported legacy data, 0038 cannot repair a chain that never
reaches it. Rehearse actual production-shaped data separately from an empty chain.

## Known test-ledger gap: unresolved, not papered over

Prior handoffs report 0022 columns exist on `thesocialpundit_test` but its ledger
entry is absent. This task did not query that database or establish provenance.
Columns alone cannot prove that the data conversion, indexes or complete file
committed. Never insert a fake ledger row, alter a historical checksum, rewrite
0022, or execute a transformed body under 0022's original checksum.

Default apply now refuses a missing **existing file** before a later applied file.
Dry-run reports such gaps. Explicit `--only=<later-pending-file>` remains available
for a separately authorized increment, reports the gap, and does not validate
skipped dependencies. Selecting the gap itself is refused. Applying 0038 alone
does not close the 0022 ledger gap or make a default migration run safe.

**Manual reconciliation remains pending:** stop writers/old runners, preserve a
verified backup and original ledger, inspect exact column types/defaults/nullability,
indexes and every keywords shape with complete RLS visibility, then rehearse on
an explicitly approved disposable production-shaped copy. Review per-row before/
after evidence for valid strings, weighted-only, mixed and malformed arrays and
prove rollback/retry. Decide a provenance-preserving reconciliation procedure in
a separate review. No gap-override/mark-applied/transformed-0022 tool is supplied
because that equivalence has not been proved. Do not remove later ledger rows to
evade the guard. An absent ledger on a pre-existing schema needs the same review.

## Acceptance harness — passed on the isolated cluster

Entry point: `script/migration-acceptance.ts` via the existing tsx loader. It never
loads environment files or imports the application. All three explicit environment
gates are required before importing pg:

1. `MIGRATION_ACCEPTANCE=fresh-chain` (parent approval must precede this).
2. `MIGRATION_TEST_DATABASE_URL`: already-provisioned, literal loopback/localhost,
   explicit user/port, database named `tsp_migration_<disposable-name>_test`.
  Also accepted: exact `thesocialpundit_acceptance_test` on literal `127.0.0.1`
  and an explicit non-5432/non-5433 port, as used by the authorized rehearsal.
   `localhost` is pinned to 127.0.0.1. URL query overrides cannot redirect it.
3. `MIGRATION_CONFIRM_DATABASE`: exact same database name. No fallback to any
   application/owner URL; the shared `thesocialpundit_test` is rejected.

External prerequisites, not automatically performed: provision a disposable empty
database and its owner with **BYPASSRLS but no superuser/CREATEROLE/CREATEDB**, and
an existing `tsp_app` without those four elevated capabilities. The harness verifies
actual server address/port/database/current role/ownership, role capabilities,
empty public relations/functions/types and no other application schemas. 0002's
conditional CREATE ROLE therefore has no work to do; a missing role fails before
the chain, and the owner cannot create it. No credential rotation, role changes,
new cluster/database, schema reset or automatic cleanup is performed by the
harness itself. This authorized acceptance pass provisioned a separate cluster
outside the harness. Address verification uses `host(inet_server_addr())`;
PostgreSQL's direct inet-to-text cast includes `/32` and falsely rejected IPv4.

Assertions actually passed in the isolated rehearsal:

- Missing-ledger dry-run leaves the actual catalog empty.
- Synthetic wrapped DDL/data followed by body failure or injected PostgreSQL
  division-by-zero at ledger insertion leaves neither probe nor ledger table.
- Execute all current files through the actual runner, verify original ledger
  checksums, second-run no-op and drift rejection.
- In UUID-named rollback-only scratch schemas, execute actual normalized 0022
  then actual 0038 over string/weighted/mixed/empty/SQL-NULL fixtures. Verify zero,
  category, metadata, duplicates and order; second repair retains CTIDs (no update).
- Malformed/ambiguous cases abort; rolling back the test savepoint retains all
  fixture values, including the earlier recoverable row. Scratch schemas disappear
  on final rollback. Harness savepoints are test controls, never migration SQL.

The full chain **commits to the disposable database** and is deliberately retained
for operator inspection/cleanup. Failed chains may retain earlier committed files;
do not rerun this fresh-only harness on a nonempty database or auto-drop evidence.
Run it exclusively, never concurrently with the parent/shared full DB workflow.
This harness does not certify restricted-role RLS behavior, production backups,
cross-process races, large-data performance, live providers or production rollout.

## Verification evidence and rollout checklist

Initial offline-only evidence (superseded by the isolated run below):
`test/migration-runner.test.ts`, selected by exact filename
filter **and include**, no project config/setup, Node environment, environment-file
loading disabled (`envFile:false`, `envDir:false`), sanitized `env -i`. Report:
`/tmp/tsp-roadmap27-mocked-final.json`: **1 file, 88 passed, 0 failed, 0 skipped**.
PostgreSQL was not contacted. The suite checks
transaction call ordering/failures, dry-run queries, drift/gaps, CLI/URL safety,
all historical hashes and all-file preflight. Static SQL assertions are explicitly
not execution evidence. Final offline preflight passed **38 files / 301 executable
statements / 29 normalized control statements** (14 outer pairs plus 0016's single
terminal COMMIT). All 37 historical hashes match the pre-edit baseline;
`git diff --name-only -- 'migrations/*.sql'` reports no tracked historical changes.
Project nonincremental TypeScript and explicit standalone CLI/harness TypeScript
checks both exited 0; scoped `git diff --check` exited 0.

Subsequent authorized evidence: pure migration guard/regression tests **93/93**;
actual fresh chain **38/38** with complete retained ledger; workflow **10/10**;
all-DB-gates full suite **161 files / 3,936 passed / zero failed or skipped**.
Post-suite inspection rechecked all original ledger checksums. Both TypeScript
checks passed again. Full-tree whitespace checking still flags an unrelated
`server/routes/billing.ts` EOF blank line; no historical SQL changed.

Parent/operator still must:

1. Review runner change, 0038 and the now-retained isolated harness report,
   inventory/checksums and failed-attempt evidence before accepting rollout work.
2. Resolve the known 0022 gap through the separate reviewed rehearsal above.
3. Rehearse 0038 on backed-up production-shaped data with full visibility; review
   candidate/ambiguous counts, lock duration, statement/lock timeouts and recovery.
   No global migration timeout/performance guarantee is claimed by this change.
4. Stop all old runners and profile writers, deploy tooling first, inspect an
   explicitly targeted read-only dry-run, and authorize each rollout separately.
5. Apply only after prerequisites pass; verify ledger and before/after keyword
   metadata in every tenant, plus existing application normalization/search tests.
   Resume writers only after completion. Recovery is backup/forward correction,
   never editing historical SQL or deleting ledger records.

No UI changed in this pass and no browser acceptance was run. Operational
manual checks above remain mandatory for rollout; the broader roadmap tracker
is intentionally unchanged.