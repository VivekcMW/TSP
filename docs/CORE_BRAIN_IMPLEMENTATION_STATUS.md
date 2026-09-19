# Core-brain implementation tracker

## Delivery rules

- Implement the approved roadmap incrementally; this file is not a claim that all gaps are closed.
- Preserve the original four-step onboarding and existing application design.
- Validate each increment before proceeding. Do not use real paid generation, email, payments or public posting for automated tests.
- No production data changes or deployment in these development increments. Staging/provider verification and deployment require their own controlled rollout.
- A pushed branch or successful local build is not proof of a deployed release.

## Increment 1 — profile contracts and application baseline

Completed:

- Replaced the deleted `ProfileSetupPage` reference with a redirect to existing content Settings; incomplete profiles still go through original onboarding.
- Restricted sessionless account queries to the explicit, development-only frontend bypass. Logout no longer refetches cleared account data. Local bypass requires both frontend `VITE_DEV_AUTH_BYPASS=true` and backend `DEV_AUTH_BYPASS=true`; it is unavailable in production builds.
- Added shared profile validation. Completion requires trimmed 10–500-character focus. Optional lists accept up to 20 nonblank entries of at most 100 characters, with case-insensitive deduplication. Invalid request types/counts return 400 before persistence rather than silent truncation.
- Preserved mixed legacy/weighted keywords, explicit zero weights and bounded topical categories (existing categories such as `Infrastructure` remain valid).
- Settings reconciles label-only changes against stored keyword metadata. Only new terms get the default weight of 0.7.
- Original onboarding validates individual AI keyword suggestions, retains metadata through deselection/reselection, and submits weighted keywords. Optional steps, cancellation, failed saves and retries remain covered.
- Default Vitest discovery now includes the three integration-security suites in `test/`.
- Corrected stale Settings assertions for the existing Full Name field; expanded HTTP error-status boundary coverage. The current server error handler passed without implementation changes.

Verification:

- Full suite: **76 files / 1,868 tests passed** using the isolated local `thesocialpundit_test` database on port 5433; application tests use the restricted role.
- Focused profile/onboarding/Settings/security/safeguards run: **10 files / 487 tests passed**.
- TypeScript without incremental cache, production build, design token check and diff whitespace check passed.
- Production build still emits the existing PostCSS missing-`from` warning. Provider availability and deployed frontend/backend versions were not tested.
- No migrations, production deployment, live provider calls or production database changes performed.

## Increment 2 — publication candidates and source lifecycle

Completed:

- Retained publication names separately from candidate URLs in AI suggestions, original onboarding, profile validation and Settings. Legacy names remain editable; explicit legacy URLs work without guessing domains from names.
- Added nonthrowing shared HTTP(S) URL validation, credential rejection, fragment normalization and canonical-length limits. Invalid AI URL metadata does not discard valid siblings.
- Added tenant/user-scoped durable discovery claims, token/lease checks and oldest-attempt-first rotation: at most four candidates, two workers and a six-second crawl budget, using existing SSRF-protected discovery.
- Added read-only publication status feedback, distinguishing missing URL, pending, checking, failed, connected, paused and removed. Crawlability is not represented as verified publisher identity.
- Selection changes pause exclusively publication-managed old sources, preserving manual sources and selected shared aliases. Deleted sources cannot be recreated by later completion/retry; explicit canonical-feed reconnect repairs scoped tombstones without automatic reactivation.
- Added migrations `0023_publication_resolution.sql`, `0024_publication_source_lifecycle.sql` and `0025_user_source_deletions.sql`, including forced RLS and lifecycle/concurrency regressions.

Verification:

- Full suite: **79 files / 2,010 tests passed**, using restricted runtime and owner connections exclusively to local `thesocialpundit_test` on port 5433.
- TypeScript without incremental cache, production build, design token check and diff whitespace check passed. Unrelated editor lint/configuration diagnostics remain outside this increment.
- Migrations `0023`–`0025` applied **only to the isolated test database**. Development/staging/production must apply these migrations before running the new backend.
- Existing deleted legacy sources without recoverable canonical identity remain conservatively removed; no speculative name/host relinking.
- No deployment, production database changes or live provider calls. Work remains local and uncommitted.

## Increment 3 — unified lexical relevance

Completed:

- Replaced competing selection/storage scorers with one bounded, deterministic lexical scorer. Weighted keywords (including explicit zero), company names and influencer names produce deduplicated evidence. Unicode-normalized full-phrase boundaries avoid substring matches such as `AI` in `paid` or `Meta` in `metadata`.
- Positive evidence uses a monotonic `sum / (1 + sum)` score, quantized to four decimals with a minimum positive value of `0.0001`. Scores are ranking values, not probabilities or confidence percentages. Companies/influencers use the existing default weight of `0.7`.
- Ranking, persisted score, matched labels and explanation all use the same result, including matches beyond the displayed 500-character summary. No raw-article fallback when text fails to match.
- Source-only selection is explicitly distinguished from topic matching: it requires provenance from an active user source and no positive configured textual interests. Search metadata or publication-name resemblance cannot establish this provenance.
- Inbox retrieval sorts numerically by stored relevance before pagination, then creation time and ID for stable ties. Other history/trend callers retain chronological retrieval. Original UI now displays the stored explanation, with a legacy keyword fallback for older rows.
- Manually added trends are labeled unscored and do not invent keyword evidence from their topic label. No historical rows were rewritten or silently rescored.
- Added pure scoring, exact engine persistence, numeric ordering/tenant isolation, browser explanation and real sync-route/worker parity regressions.

Verification:

- Full suite: **85 files / 2,096 tests passed** against isolated local `thesocialpundit_test` on port 5433. After adding the final manual-trend assertion, the focused scorer/engine/route run passed **3 files / 65 tests**, and TypeScript/whitespace checks passed again.
- Nonincremental TypeScript, production build, design token and whitespace checks passed. Existing PostCSS missing-`from` warning remains.
- No new migration for this increment. Earlier `0023`–`0025` remain test-only and must be applied outside the test environment before running the changed backend.
- No live providers, production changes, deployment or commit. Focus/semantic matching, query balancing, date/freshness handling, historical dedup/capacity and safe refresh replacement remain separate queued work; legacy scores remain as stored.

## Increments 4–6 — query planning, atomic refresh and bounded cache

- Item 7: durable profile-locked balanced query windows, weighted ordering and eleven supported provider editions. At most eight queries, two workers and twenty seconds; failed/partial batches are not cached. Weights prioritize order, not frequency. First-dispatch coverage is bounded by nonempty groups times the largest group size. Editions are preferences, not strict geographic/language filters or translation. Original onboarding remains unchanged.
- Items 8 and 12: canonical historical dedup before capacity selection; shared tenant/user writer locks; SQL ten-active capacity; version-fenced minimal replacement only after successful fetching; atomic operation receipts and truthful sync/worker/UI outcomes. Active status filtering precedes pagination. Saved/dismissed history does not resurface. See `inbox-refresh-contract.md` for policy and rollout limitations.
- Canonical indexes use bounded digests with exact comparison, including long legacy URLs and digest collisions. Failed retained queue jobs support bounded explicit recovery; completed retries do not display stale failure reasons.
- Item 15: process-local TTL/LRU cache bounded to 128 entries, 8 MiB total, 512 KiB per entry, eight fetches and 128 consumers. Failures are uncached; callers receive independent copies; user-source provenance is rejected. This is not a distributed cache or a heap-memory guarantee.
- Added test-target guards and a regression-tested explicit IPv4 Supertest transport after reproducing macOS wildcard/IPv4 listener collisions. Application security assertions were not relaxed.

Verification:

- Full suite after the review fixes and cache changes: **97 files / 2,652 tests passed**, actual exit zero, isolated `thesocialpundit_test` on localhost:5433. Earlier query-planning checkpoint: **92 files / 2,514 tests**.
- Scoped TypeScript and whitespace checks passed; production build/design checks passed before the latest inbox/cache changes and remain part of final acceptance.
- Migrations `0026`–`0028` applied only to the isolated test database; `0023`–`0028` remain pending outside that environment. Never edit applied checksummed migrations. The test database's existing `0022` ledger gap is recorded, not silently repaired.
- No live providers, deployment, production changes or commit. Legacy overcapacity is not destructively reconciled; coordinated writer rollout, lazy historical-backfill latency and receipt retention remain operational considerations.

## Later increments — quality, delivery and service boundaries

- Items 9–11, 13–14: nullable provenance-bearing publication dates distinct from discovery, explicit freshness policy retaining older relevant content, bounded concept/focus matching, conservative ordered story grouping, post-history diversity, personal discovery-window trends and traceable contiguous excerpts. The small synthetic matching evaluation retains ambiguity errors; this is not general semantic understanding or factual verification. See `inbox-quality-contract.md`.
- Items 16–17: explicitly approved, editable/removable voice samples and source-span claim-support checks with human-review states. Voice is not source evidence. See `voice-claims-contract.md`.
- Items 18–22: persisted sandbox/live modes and distinct outcomes; shared admission/execution policy and capability matrix; revision-fenced manual reconciliation; encrypted credentials, session-bound single-use OAuth, stale-refresh CAS, and DNS-pinned Mastodon requests. Manual delivery claims are not provider verification. See `publishing-safety-contract.md` and `credential-storage-contract.md`.
- Items 23–26: nullable measured analytics, tenant-bound billing lifecycle and durable generation quotas, authoritative notification preferences and fenced delivery states, private S3/R2 media with repair/migration tools and bounded upload admission. See the respective analytics, billing, notifications/media and resource-budget contracts.
- Local acceptance includes an unchanged 38-file fresh migration chain in a separate temporary PostgreSQL cluster, authenticated composed workflows, real Chromium journeys, process termination/restart, Bull delivery and reload recovery. External provider boundaries remain mocked and unconfigured services are not represented as verified.
- Earlier contract sections saying database/browser checks were not run are historical handoffs; `isolated-acceptance.md`, `workflow-acceptance.md` and `editorial-reload-recovery.md` record later evidence. The latest combined regression result is recorded in `LOCAL_ROADMAP_ACCEPTANCE.md`.

## Approved roadmap

Statuses: **Done** = locally implemented and verified within the documented contract, not production-certified; **Partial** = named acceptance remains; **Blocked** = requires external access/approval. Historical increment counts above are checkpoints, not current totals.

| # | Capability | Status |
|---|---|---|
| 1 | Verified baseline and regression coverage | Done |
| 2 | Remove stale setup reference; preserve original gate/dashboard routing | Done |
| 3 | Shared profile validation before sanitization | Done |
| 4 | Preserve keyword suggestions and metadata end-to-end | Done |
| 5 | Separate publication names/URLs; validate sources; unresolved feedback and rotation | Done |
| 6 | Unified relevance selection, storage, ordering and explanations | Done |
| 7 | Weighted, balanced and rotating queries with language/region | Done |
| 8 | Historical dedup before quotas; canonical URLs, concurrency and capacity | Done |
| 9 | Publication versus discovery dates; recency and evergreen handling | Done — older relevant material remains eligible; no inferred evergreen claim |
| 10 | Bounded semantic/synonym/acronym matching with evaluated lexical fallback | Done — bounded concept matching, not embeddings/general semantics |
| 11 | Source/topic/story diversity without irrelevant filler | Done |
| 12 | Truthful sync/queued refresh outcomes and safe replacement/retries | Done |
| 13 | Windowed personal trends with velocity and source diversity | Done — admitted-content coverage, not market trends |
| 14 | Grounded coherent summaries and explicit extractive fallback | Done |
| 15 | Bounded shared caches, coalescing and secure crawl limits | Done |
| 16 | Optional editable/deletable voice from explicit samples and approved edits | Done |
| 17 | Claim-support checks with honest verification states and human review | Done — textual support, not factual verification |
| 18 | Separate sandbox/live publishing statuses, receipts, counts and emails | Done |
| 19 | Server publishing rules across immediate/scheduled/retry/worker paths | Done |
| 20 | Audited uncertain-delivery reconciliation without blind replay | Done — audited manual decisions, not invented provider verification |
| 21 | Credential verification/encryption across all connection paths | Done — production credential backfill remains a controlled rollout prerequisite |
| 22 | Shared publishing/media capability matrix, including Reddit/Slack | Done |
| 23 | Unavailable versus zero analytics and timestamped supported metrics | Done |
| 24 | Subscription lifecycle, webhook idempotency and server entitlements | Done locally — real merchant/configuration acceptance belongs to staging |
| 25 | Authoritative email preferences and timezone-aware deduplicated jobs | Done |
| 26 | Durable S3/R2 media with ownership, limits, cleanup and migration | Done locally — real private bucket acceptance remains required |
| 27 | Backward-compatible migration/security/concurrency/performance/cost validation | Partial — local fresh-chain/security/concurrency/resource checks passed; production-shaped legacy rehearsal and agreed load/cost acceptance require operator access and targets |
| 28 | Full workflow success/failure/cancellation/duplicate/recovery acceptance tests | Done locally — authenticated APIs, Chromium, real SIGKILL/Bull recovery and reload reattachment; external services mocked |
| 29 | Controlled staging/environment/provider verification | Blocked — configured staging and provider credentials/permissions must be verified without unintended external effects |
| 30 | Approved deployment with actual commit/build/health/auth checks and rollback | Blocked — completed release acceptance and rollout approval; no current deployment claim |

## Remaining prerequisites

Current completion: **27/30 locally complete** (1–26 and 28), **27 partial**, **29–30 blocked**. Do not relabel this as all 30 complete. Review `LOCAL_ROADMAP_ACCEPTANCE.md` for final regression evidence and explicit release gates. A production-shaped data copy/backup, agreed load/cost limits, staging credentials and permissions, and explicit rollout approval are needed to finish the remaining acceptance. Existing development/production databases and the shared test database's historical 0022 ledger gap were not repaired by the disposable fresh-chain rehearsal.