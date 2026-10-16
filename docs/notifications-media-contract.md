# Roadmap 25/26: notifications and private media

## Superseding local acceptance — 2026-09-19

This supersedes earlier **local** migration/test status below, not rollout prerequisites. Earlier counts, failed attempts and “not run/not applied” statements are historical authoring records.

- Saved combined report `/tmp/tsp-acceptance.2e4C5P/final-all-1789783547962-vitest.json`: **`success: true`, 165 files, 3,976 passed, 0 failed, 0 skipped**, with all nine DB/browser/crash/reload gates enabled and passing.
- Genuine fresh isolated cluster `127.0.0.1:60053`: **38 migrations / 38 ledger rows**, including **0022 and 0038**; all original ledger checksums postverified against disk and unchanged after the combined run.
- Saved project TypeScript, migrator TypeScript, production build and design checks: **exit 0**. Repository `git diff --check`: **exit 2**, only `server/routes/billing.ts:140` extra blank line at EOF. The sibling `-summary.json` also records four blocked socket attempts and aggregate `success: false`; this is not an all-clean aggregate claim.

This does **not** prove development/production migrations, resolve the shared **0022 ledger gap**, apply legacy credential backfill, or establish live-provider, real S3/R2 bucket, email, merchant or OAuth readiness. External providers remained mocked. No tests or database operations were rerun for this documentation update. See [isolated acceptance](isolated-acceptance.md) for scope/history and [local roadmap acceptance](LOCAL_ROADMAP_ACCEPTANCE.md) for parent-owned rollout tracking.

## Historical authoring rollout status and ownership

Implementation is present; production readiness is **not** claimed. `0034_notifications_media.sql` is reserved exclusively for this work and **has not been applied**. Database integration tests below were created but **not run**. No live email/object-store requests, deployment, or commit were performed. Publishing/billing/other agents' changes remain owned by those agents; scheduler changes only add the digest job, and shared schema/storage changes are confined to email/media regions.

Parent coordinator must approve an exclusive migration window and disposable PostgreSQL validation before enabling this feature. Stop old email senders during migration: old code interprets marketing as a global switch and cannot safely coexist with the new contract. Apply 0034 once via the existing migration runner, then deploy all new senders/API workers together. Do not edit already-applied SQL or roll back to the old sender after enabling new preferences. Confirm application role grants for new columns and existing email tables, and FORCE RLS on media/inbox. Back up data first.

The existing root `.env` was detected without reading or modifying it. `.env.example` contains placeholders only; copy missing settings deliberately, never overwrite configured values. It is now exempted from the `.env.*` ignore rule. SDK dependency `@aws-sdk/client-s3` was installed with pnpm; keep `pnpm-lock.yaml`. Do not remove the existing npm lockfile or overwrite parallel dependency additions (including `htmlparser2`).

## One authoritative notification store

`email_preferences` is **account-wide**, keyed uniquely by authenticated user ID, not by tenant. Settings, `/api/email-preferences` GET/PATCH, compatibility profile routes, and every sender read/write this store. Email tables are not tenant RLS tables; application code must enforce account identity. Clients cannot supply a user ID. GET is no-store; strict PATCH rejects unknown fields, non-booleans, invalid IANA zones, and times other than `HH:mm`.

Settings submits only edited fields, preserving concurrent changes to untouched categories. Failed saves retain edits; refetches do not overwrite dirty drafts. Atomic upserts update only supplied fields. Marketing opt-out is not global unsubscribe. `unsubscribeAll: true` disables all optional categories and records `unsubscribed_at`; an explicit true category clears that marker while leaving sibling categories disabled. Timezone/time edits alone do not opt the user back in. Essential delivery is not controlled by `required`: that flag selects direct transport, not preference bypass.

| Preference | Types | New-account default |
| --- | --- | --- |
| marketing | welcome | true |
| dailyDigest | daily_digest | true |
| contentAlerts | content_alert | false |
| productUpdates | product_update, maintenance, incident | true |
| publishing | draft_generated, draft_failed, post_scheduled, post_published, post_failed | true |
| accountAlerts | oauth_connected, usage_warning | true |
| weeklySummary | weekly_summary (no weekly scheduler added) | false |
| essential, always allowed | verification, password_reset, password_changed, payment_succeeded, payment_failed, subscription_cancelled, token_expired | always |

Optional messages without an attributable account ID fail closed. Security links can be sent before an account is available. No development verification/reset links or provider credential/error payloads are logged. Legacy `emailService.ts` delegates delivery; its connectivity function indicates configuration presence only, not a provider health check.

### Explicit legacy profile mapping and precedence

0034 maps `user_profiles.daily_digest/content_alerts/product_updates` to the same three email preference columns. It reads each membership tenant with transaction-local `app.tenant_id`, rather than assuming FORCE RLS can be bypassed. Across legacy tenant profiles and any existing email row, **false wins ambiguous conflicts**. Generic profile `updated_at` does not prove when a notification toggle was changed, so it is deliberately not used for last-write precedence. Existing values are preserved if no profile exists. For a wholly new preference row without a profile, content alerts default false. Timezone comes from the first valid legacy profile in tenant-ID order, otherwise UTC; digest time starts at 09:00.

Existing `unsubscribed_at` means the old sender globally suppressed optional messages. Migration preserves that intent by disabling every optional category once. After migration, an authenticated explicit category PATCH is authoritative; legacy columns never override it again. `/api/profile` GET overlays the authoritative three fields, and notification PATCH fields are removed before the tenant profile write and mapped to the preference service. Other profile behavior is unchanged. Mixed legacy profile+notification PATCH spans separate existing profile and preference transactions: a failed response may have saved profile-only fields, but never silently claims notification success. New Settings uses the dedicated single-store endpoint.

## Daily digest and durable delivery

Automatic digests require the existing production scheduler gates (`NODE_ENV=production`, `BACKGROUND_JOBS_ENABLED=true`, `CRON_SCHEDULER=true`, Redis) **and** `EMAIL_DIGEST_ENABLED=true`. They run every minute using the existing scheduler advisory lock/Redis marker without changing publishing jobs. `EMAIL_QUEUE_ENABLED` is optional; digest delivery invokes the real sender directly, not a placeholder or an unbounded broadcast.

Each cycle examines at most one keyset page of 100 active tenant/user memberships, with a 45-second admission budget between scopes (an in-flight provider call may add up to 30 seconds; DB timeouts remain an operational prerequisite). Cursor rotation is process-local; correctness/dedupe is not. Each eligible scope loads only the user's email and five active, ranked, explicitly tenant+user scoped inbox items under RLS. Selected fields are bounded: source 120, headline 300, summary 600, URL 2048 characters. There are no whole-user credential selects, social tokens, secret configuration fields, or provider calls in discovery. Non-web and credentialed URLs are omitted, templates escape content, and empty eligible inboxes do not send or consume a slot.

The durable slot is `daily-digest-v1 + tenant + user + local YYYY-MM-DD`, SHA-256 hashed before persistence. It becomes due at the configured IANA local time, not a fixed UTC offset. Spring gaps catch up at the first valid later local time; fall folds have the same calendar-date key and cannot send twice. Late cycles may send the current day's digest, never backfill prior dates. Multi-tenant users receive independently scoped digests per tenant. Changing time/timezone does not reset an already sent local-date slot; there is no exactly-at-the-minute guarantee.

Delivery states:

- **pending:** advisory-locked unique dedupe claim, random fencing token, 120-second lease, incremented attempt count. Active pending claims request a retry, not a silent successful dequeue.
- **sending:** preference rechecked after claim, then token/unexpired-pending-fenced transition before the provider boundary. Optional unsubscribe suppresses the claimed delivery.
- **sent:** provider returned a message ID and receipt was persisted. This means provider acceptance, not proof of inbox arrival.
- **failed:** explicit known rejection only; retry after at least 60 seconds, maximum four claims. Bull uses four attempts with 65-second exponential initial backoff and keeps a stable hashed job identity, including calls without a supplied key.
- **unknown:** transport exception, 30-second deadline, SDK application/internal error, missing receipt, stale sending lease, or ambiguous old pending/failed delivery. **Never automatically replayed.** A late response after deadline does not reclassify the outcome.
- **suppressed:** preference opted out after claim; no dispatch.

Recovery runs in bounded batches of 100 per state, before digest cycles and every minute after email initialization even when optional sending is disabled. Expired pending claims are safe to retry; stale sending/ambiguous legacy claims become unknown. Fencing prevents an expired worker from sending or finalizing another worker's claim. Failed receipt persistence leaves sending for conservative recovery, never marks an accepted send retryable. A timeout cannot revoke an email already accepted remotely.

**Recovery limits:** delivery rows intentionally do not persist message bodies/security links. Bull must have durable Redis retention for non-digest payload retries; a lost queue payload is not reconstructed from delivery metadata. Digests regenerate from scoped current data on later cycles. Direct transactional callers must retry using the same logical dedupe key where available. Completed unknown jobs remain represented in PostgreSQL, not an automatic resend queue. Before resolving an unknown delivery, an operator must stop the relevant worker, check provider logs/receipts and retained job evidence, and record a reviewed decision. Do not clear dedupe rows or change unknown to failed merely because a client timed out. No blind-replay or automated provider-reconciliation command is supplied.

### Retained keyless jobs: conservative quarantine (P2)

The worker requires a nonblank string `dedupeKey` already present in the retained payload **before** calling the sender. Missing, null, empty, whitespace-only or malformed keys cause quarantine for **all** retained jobs, including essential/`required` emails and jobs reporting zero attempts. `attemptsMade = 0` is not proof that a crashed/stalled old worker never dispatched. Neither a fresh UUID nor a hash of the Bull job ID can reconnect a legacy job to its old null-key delivery row, so neither is synthesized at dequeue/retry time.

Quarantine calls Bull `discard()` and throws the fixed error `Email job quarantined: missing durable delivery identity; manual reconciliation required; not sent`. The warning is likewise fixed text: no recipient, job ID, payload, security link, dedupe key or provider error is logged. This is a terminal **failed queue job**, not a successful delivery and not a new database status. It uses the job's existing failure-retention policy (new queues default to seven days); retain evidence externally before expiry if review needs longer. The worker makes no delivery claim, creates no replacement row, leaves historical unknown rows untouched and makes zero provider calls on repeated attempts or worker restart. Manually retrying the unchanged job remains blocked; do not bypass quarantine by adding a key or re-enqueueing as a new request without reviewed reconciliation.

New `sendAppEmail` requests preserve valid supplied keys or generate a UUID **before enqueueing**; the key stays in the durable payload, and the SHA-256 user/recipient+type+key hash is shared by the queue ID and delivery lookup. The store rejects keyless claims before any database work, rather than silently skipping lookup. Existing unknown/sent/suppressed dedupe, opt-out rechecks, claim fencing and known-rejection retry limits remain unchanged.

**Direct-call distinction:** `sendAppEmail` and direct `deliverAppEmail` calls without a valid key represent fresh requests and receive a key before claiming. This preserves direct verification/password-reset delivery, including before a user ID exists and with the queue enabled. `required` still cannot bypass optional-category preferences. Generated keys do **not** deduplicate separate direct invocations: callers retrying one logical operation must retain and reuse an explicit key, and must not replay an unknown outcome as a fresh keyless request.

P2 verification: **61 tests passed in exactly four files**, with project configuration/setup and environment-file loading disabled; only mocked DB/Redis/provider I/O. `delivery.test.ts` covers invalid-key quarantine (including zero attempts), fixed secret-free warnings, essential/required non-bypass, new enqueue key retention, direct auth compatibility and the existing opt-out/unknown boundaries. `delivery-store.test.ts` covers pre-DB key rejection plus existing hashing, lease/fencing/recovery and no-replay rules. `delivery-worker.test.ts` exercises the real worker/sender/store over an in-memory DB mock: historical null-key unknown evidence gets zero further provider calls across retries/restart; a newly keyed timeout gets one total provider call despite retries/restart/late receipt; known rejection still retries on the same row after backoff. `policy.test.ts` remains unchanged and passing. No database/integration tests, migrations, environment-file reads, live provider requests, production operations, deployment or commits were performed for this fix.

## Private durable media

`STORAGE_PROVIDER=local|s3|r2` selects **new writes only**. AWS SDK v3 speaks to S3/R2 privately; no public ACL, bucket URL, unauthenticated download, or permanent public presign is returned. Configure backend-specific `*_BUCKET`, `*_REGION`, `*_ACCESS_KEY_ID`, `*_SECRET_ACCESS_KEY`; R2 also requires `R2_ENDPOINT`. Endpoints must be HTTPS without credentials/query/fragment/path. Credentials are explicit, never persisted in locators or emitted in errors. SDK connections time out after 5 seconds; requests/abort signal after 30 seconds, maximum two SDK attempts. Provision private buckets, block public access, TLS, encryption-at-rest and least-privilege access restricted to the application prefix.

Each asset persists backend plus bucket/region/optional endpoint and a versioned `media:v1:` key locator. Object namespace is `tsp-media/v1/<tenant>/<user>/<UUID>`. Existing publishers continue using `readMedia(storageKey)` unchanged. Legacy three-component keys always resolve locally even after switching the active provider. Keep old backend configuration and local volume available until every referenced asset has been explicitly migrated; changing a configured bucket/endpoint fails closed for old locators rather than sending credentials elsewhere.

Ownership is resolved from the authenticated tenant+user DB row before read/delete. `/api/media/:id` proxies bytes with private/no-store, nosniff, and sandbox CSP headers. Missing, foreign, and deletion-pending assets are not readable. Upload responses contain only asset ID/type/name/authenticated proxy path/size, not internal locators. Local paths validate components and realpath containment; remote reads validate locator namespace and bound actual streamed bytes, not only Content-Length.

Limits: eight files per multipart request, 50 MiB maximum per file (configurable downward), 50 MiB aggregate parsed payload, 200 assets per tenant/user under a shared PostgreSQL advisory lock. File MIME allowlist and byte signatures must agree for JPEG/PNG/WebP/MP4/WebM/MP3/WAV. Signature checks are not malware scanning or full codec validation; add quarantine/scanning before accepting untrusted public uploads at scale. These existing per-request/asset limits are unchanged.

### Process-local upload admission

`POST /api/media/upload` acquires a permit **after authentication and draft-write permission, before Multer/body buffering**. One module-level pool is shared by users, tenants and route registrations in the process. Every admitted request reserves the worst-case **50 MiB parsed payload**, regardless of Content-Length, actual size or configured per-file limit. It has no queue or per-user map. Defaults are **two active requests, 100 MiB reserved payload**; both ceilings apply independently.

Optional startup configuration (no secret or environment-file change required):

| Variable | Default | Valid integer range |
| --- | ---: | ---: |
| `MEDIA_UPLOAD_MAX_ACTIVE` | 2 | 1–8 |
| `MEDIA_UPLOAD_MAX_BYTES` | 104857600 | 52428800–419430400 bytes |
| `MEDIA_UPLOAD_PARSE_TIMEOUT_MS` | 30000 | 1000–120000 ms |

Malformed/out-of-range settings fail initialization rather than disable admission. Byte budgets reserve full 50 MiB batches (75 MiB allows one, not a partially reserved second). Configuration changes require a process restart. Saturation returns **503**, `Retry-After: 5`, `Cache-Control: no-store` with fixed text and no parser/provider/DB work. The five seconds is a minimum retry suggestion, not a guarantee that capacity will be available. Authentication/permission failures still return 401/403 first. Media GET/DELETE and unrelated routes do not acquire upload permits.

The parse deadline stops input and returns 408 when still writable, then closes the connection; the caller may observe a reset. Aborted/incomplete bodies destroy the request and wait for Multer's callback/cleanup. Normal request close after a complete body does not cancel processing. Once async persistence starts, request/response close, finish, errors and elapsed parse deadlines **never** release early: the wrapper awaits handler completion (including provider/DB failures, compensation and lock/transaction settlement), discards buffers and releases exactly once in `finally`. There is no processing-lease expiry; a non-settling provider/DB operation keeps its bounded slot. Operational provider/DB timeouts remain necessary.

**Not a 100 MiB memory or deployment-wide cap:** parser chunks/concat copies, SDK buffers, GC lag, media reads, sockets, pre-auth requests and upstream proxy buffers are outside payload accounting. The original two-upload test measured ~196 MiB external memory including its client fixture. Workers/replicas each have independent pools, and a serverless host may buffer before Express. Keep ingress body/connection/rate/concurrency/time limits and sufficient memory headroom; use shared admission or streaming storage for larger multi-process deployments. No production load certification is claimed.

Follow-up verification: `node test/workflow-budgets/run.mjs --media-only` passed **68 tests in exactly five files**, zero failed/skipped; full-project nonincremental TypeScript passed. Pure mocked auth/DB/provider dependencies, real local Express/Multer sockets, no environment-file loading, DB, Redis or live providers. Coverage includes independent byte/count bounds, denied requests never parsing, saturated auth ordering, GET/DELETE exemptions, shared process scope, 50 MiB batches plus rejected third upload, real abort/timeout recovery, connection close while processing still retains buffers, duplicate release, parser errors, failed DB/provider work and awaited cleanup. See `docs/workflow-budgets.md` for reproduction and budget caveats. No migration, deployment or commit was performed.

Upload/metadata failures compensate uploaded objects before transaction rollback. A timed-out PUT is best-effort deleted. Cleanup failure and uncertain DB commit outcomes leave possible orphans for aged, reference-checked maintenance; do not delete blindly after an uncertain commit. Delete commits a tombstone before object I/O, then deletes object followed by metadata under the writer lock. Failures return a retryable 503, retain intent, deny reads, and can be repaired; missing object/row deletion is idempotent.

## Explicit bounded maintenance

Entry point: `script/media-maintenance.ts`, executed with the project's `pnpm exec tsx` and an explicitly approved environment. It does not load dotenv. Required options are `--tenant` and `--user`; operations `migrate` and `orphans` additionally require `--backend s3|r2`. `repair` handles deletion intent. Default is **dry-run**; only `--apply` permits writes/deletes. Unknown/duplicate flags and malformed scopes are rejected. Supply returned `nextAfter` as `--after` until `done`; each invocation handles at most 100 rows/keys. Logs contain counters/cursors only, never credentials. These operator commands were not run during implementation.

- **migrate:** explicit local-to-selected-backend only. Confirms ownership, local size, deterministic target key, and SHA-256 read-back equality before updating the existing asset ID/locator. Already migrated/deleting rows are skipped. **Local originals are retained even with --apply**; there is no delete-local flag. Failed/uncertain commits can be resumed; unreferenced remote copies age into cleanup eligibility.
- **repair:** only deletion-requested rows in the exact tenant/user page; remote/local object first, metadata second. A failed batch can safely retry the same cursor.
- **orphans:** LIST restricted to the exact owner application prefix, never bucket-root/unrelated prefixes. Requires generated UUIDv4 basename, at least 24-hour age, no scoped DB reference to that locator, and a fresh HEAD age check before deletion. It shares the same scoped writer lock as uploads/migration/delete. Dry-run lists and checks references but never deletes. Retain the application-owned prefix exclusively; out-of-band writes that ignore the lock are not supported. Bucket versioning may retain deleted object versions; this tool does not purge versions. Local retained migration originals are intentionally outside this remote orphan sweep.

## Historical authoring verification and remaining rollout prerequisites

Mocked tests run with environment-file loading disabled, explicit filenames only, provider SDK mocks and external-network guards. Browser fixtures intercept all API/provider traffic and use a loopback fixture server, not the application/DB. Verified result: **387 server tests passed in nine files; three notification browser tests passed** (40 unrelated browser cases skipped). TypeScript and scoped whitespace checks passed. This is not a production certification.

| Tests | Contract covered |
| --- | --- |
| `server/services/email/policy.test.ts` | category isolation, essential exceptions, validation, half-hour offset, DST gap/fold and date boundary |
| `server/services/email/preferences.test.ts` | defaults, atomic partial upsert fields, explicit global unsubscribe and selective re-opt-in |
| `server/services/email/delivery.test.ts` | actual sender/queue opt-out recheck, required not bypassing policy, timeout/late response, known rejection vs unknown, missing receipt and receipt-write failure |
| `server/services/email/delivery-store.test.ts` | hashed identities, leases, fencing, bounded attempts, safe pre-dispatch recovery vs no replay |
| `server/jobs/email-digest.test.ts` | real delivery invocation, five-row/minimal selects, safe URLs, due/opt-in gating and one-page scheduling |
| `server/services/media-storage.test.ts` | mocked S3/R2 SDK private writes/read/delete, immutable backend selection, JSON property order, credential endpoint rejection, streamed-byte bound and PUT compensation |
| `server/services/media-maintenance.test.ts` | dry-run/resume, read-back verification, no local deletion, aged scoped orphan safeguards, repair and CLI validation |
| `server/routes/notifications-media.test.ts` | auth/permissions/ownership, private response, signatures, eight-file/aggregate limit, DB-insert compensation and deletion retries |
| `server/routes/profile.preferences.test.ts` | existing profile contracts plus explicit notification compatibility mapping |
| `client/src/components/settings/__tests__/settings.browser.test.ts` notification subset | authoritative saves/reloads, independent categories, timezone/time, failed saves/refetch preservation and untouched opt-out intent |

**Historical: created but not run at authoring; both suites passed in the combined run above:**

- `server/notifications-media.integration.test.ts`: requires parent-approved `NOTIFICATIONS_MEDIA_DB_TESTS=true`, explicit disposable `DATABASE_URL` and `OWNER_TEST_DATABASE_URL`, previously applied 0034, non-superuser/non-BYPASSRLS application role, working RLS/grants. Covers concurrent category upserts, single concurrent slot claim, expired-fence rejection, sent/unknown dedupe, same-user cross-tenant and different-user isolation, tombstones/idempotent delete, concurrent 200-asset cap. Unique fixtures and targeted cleanup only; no truncation or auto-migration.
- `server/notifications-media-migration.integration.test.ts`: separate `NOTIFICATIONS_MEDIA_MIGRATION_TESTS=true` and explicit disposable owner URL. Applies exact 0034 SQL only in a randomly named scratch schema inside a rollback-only transaction; validates legacy mapping precedence, no-profile explicit intent, global suppression and ambiguous delivery state conversion. Requires CREATE SCHEMA permission. This does **not** certify full historical schema/FORCE-RLS rollout; parent must also validate the real migration against a disposable production-shaped copy.

Before enabling: parent runs both DB suites in isolation; verify migration runner ordering and existing grants, rollback/forward recovery plan, queued legacy payload handling and provider receipt reconciliation; validate S3 and R2 with a dedicated private test bucket and Resend with an approved sandbox recipient; simulate process death at pre-send/after-provider and failed DB commits; verify ingress/memory limits, durable Redis, DB query/lock timeouts, deletion repair and orphan dry-runs. None of those live-provider/DB prerequisites were silently performed here.