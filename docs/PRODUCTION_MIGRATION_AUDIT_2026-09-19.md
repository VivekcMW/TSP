# Production migration audit — 2026-09-19

## Scope and decision

Read-only metadata and aggregate queries were executed in Vercel's embedded
Neon Query editor around 18:09–18:11 UTC. Read-only stayed enabled; the server
reported `transaction_read_only=on`. No user identifiers, keyword text, tokens,
connection passwords or individual application records were returned.

The user confirmed Render uses this database and authorized production rollout.
This audit does not independently compare the Render connection endpoint.
**Decision: hold migration/runtime rollout until a recoverable backup and
production-shaped isolated rehearsal are verified.** Permission to write is
available, but is not evidence that a particular migration is safe.

## Target and privilege evidence

- Vercel team/project: `the-social-pundit/thesocialpundit`.
- Resource: `neon-amber-queen`; Neon project `wispy-bar-54273174`.
- PostgreSQL database `neondb`, server version `18.6 (6569466)`.
- Query role `neondb_owner`: not superuser; BYPASSRLS, CREATEDB and CREATEROLE.
- `has_table_privilege` returned true for UPDATE on `public.user_profiles` and
  INSERT on `public.schema_migrations`; CREATE on schema `public` is granted.
- `default_transaction_read_only=off`; this session is read-only because of
  the editor option. No option was disabled and no write capability was tested
  by changing data or issuing rollback-only DDL.
- `tsp_app` exists without superuser, BYPASSRLS, CREATEDB or CREATEROLE.
  Its existence does not prove the deployed backend connects as this role.
- The inspected resource Settings page has name/configuration, secret rotation,
  allowed-environment and deletion controls, but no backup/restore/branch control.
  None of those settings was changed. This does not prove the provider lacks
  backups; the target's retention, restore access and recovery remain unverified.

## Ledger comparison

The table `public.schema_migrations` contains filename, checksum and applied_at.
It records **22 files, 0000 through 0021 inclusive**. All 22 original-file SHA256
first-16 checksums match local release files: **zero mismatches**. Local worktree
was clean at HEAD `4ca42d113575edbb8fd7f4f1057251cabd49cd80` before this report.

There are **38 release SQL files**, hence **16 unrecorded files** below. Number
0031 is intentionally unused, not a missing file. No later recorded migration
exists after 0022, so this is not the runner's interleaved-ledger-gap condition;
the separate problem is pre-existing 0022 schema without its execution record.

| Pending according to ledger | Original checksum |
| --- | --- |
| 0022_keyword_weighting_and_relevance_scoring.sql | a5a289395263dadf |
| 0023_publication_resolution.sql | 5c0933147779f53e |
| 0024_publication_source_lifecycle.sql | 98830b70dca86d6e |
| 0025_user_source_deletions.sql | 75bbe23cddb79c00 |
| 0026_search_query_planning.sql | 53f4e1a1b8b9a3c1 |
| 0027_inbox_refresh_contract.sql | 30f679c738c07871 |
| 0028_inbox_canonical_digest.sql | ecb77728db896159 |
| 0029_inbox_article_quality.sql | 159898b15d9b9628 |
| 0030_editorial_voice.sql | 1174e7427b8211a7 |
| 0032_billing_lifecycle.sql | 5434586818a90707 |
| 0033_publishing_safety.sql | de5bfc7795180fa6 |
| 0034_notifications_media.sql | cf0af2d38ef69367 |
| 0035_analytics_availability.sql | 7c6a6db5fd14af0a |
| 0036_billing_generation_usage.sql | feb422df6780ac7d |
| 0037_social_oauth_credentials.sql | 6dc6738d14c1fcb4 |
| 0038_repair_legacy_keyword_wrappers.sql | 275f3102ae9b1224 |

## Existing 0022 state

Catalog inspection found all three columns already present:

- `public.user_profiles.recommended_industry`: character varying, no default.
- `public.inbox_items.relevance_score`: numeric, default 0.5.
- `public.inbox_items.relevance_reason`: text, no default.

Both named indexes exist, with the expected visible definitions:

- `idx_user_profiles_recommended_industry`: btree on recommended_industry.
- `idx_inbox_items_relevance_score`: btree on user_id, relevance_score DESC.

These observations do not establish when/by whom the changes were made, whether
the original data conversion ran, or whether the complete migration committed.
Do not insert a fabricated ledger record or edit 0022 to hide this discrepancy.

Aggregate keyword inspection, with owner BYPASSRLS visibility:

- Seven profiles, all with JSON array keywords.
- 24 string elements and three objects with string keyword/numeric weight.
- Three profiles satisfy 0022's string-element predicate and would be updated.
- One profile has objects but no strings; zero profiles mix strings and objects.
- No nested keyword-object shape was observed. This is not full keyword input
  validation: numeric bounds, lengths and all metadata were not checked here.

Historical 0022 wraps every element in any array containing a string. The current
snapshot does not exhibit the mixed-array case, but writers can change this
before rollout. The existing 0038 repair and all other pending migrations must
be rehearsed with representative copied data and checked together. See
`migration-correctness.md` for the runner and repair contracts.

## Required continuation

1. Establish a named recoverable snapshot or protected logical backup, verify
   its restore path, and provision a separate rehearsal target without exposing
   copied private data or pointing a staging runtime at production resources.
2. Preserve the original ledger and inspect provenance of the unrecorded schema.
   Rehearse the unchanged files through the migration runner on that copy;
   verify keyword before/after equivalence, constraints, RLS, credential/media
   backfills, rollback and repeat-run behavior. Do not fake historical execution.
3. Finish isolated staging/provider and representative load/cost acceptance.
   No real external messages, charges or publishing are authorized by this audit.
4. Coordinate API/profile writers, queue workers and the single scheduler;
   recheck the ledger and data shapes under the rollout window, then execute
   the reviewed migration procedure. A health check is not a migration check.
5. Deploy the intended release to both hosts, verify actual source commits,
   health/readiness/auth flows and recovery before resuming normal scheduling.

No production data, schema, ledger, infrastructure configuration or deployment
was changed by this audit. Existing public deployment remains the earlier release.