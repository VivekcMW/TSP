# Publishing safety contract — roadmap 18, 19, 20, 22

## Superseding local acceptance — 2026-09-19

This supersedes earlier **local** migration/test status below, not rollout prerequisites. Earlier counts, failed attempts and “not run/not applied” statements are historical authoring records.

- Saved combined report `/tmp/tsp-acceptance.2e4C5P/final-all-1789783547962-vitest.json`: **`success: true`, 165 files, 3,976 passed, 0 failed, 0 skipped**, with all nine DB/browser/crash/reload gates enabled and passing.
- Genuine fresh isolated cluster `127.0.0.1:60053`: **38 migrations / 38 ledger rows**, including **0022 and 0038**; all original ledger checksums postverified against disk and unchanged after the combined run.
- Saved project TypeScript, migrator TypeScript, production build and design checks: **exit 0**. Repository `git diff --check`: **exit 2**, only `server/routes/billing.ts:140` extra blank line at EOF. The sibling `-summary.json` also records four blocked socket attempts and aggregate `success: false`; this is not an all-clean aggregate claim.

This does **not** prove development/production migrations, resolve the shared **0022 ledger gap**, apply legacy credential backfill, or establish live-provider, real S3/R2 bucket, email, merchant or OAuth readiness. External providers remained mocked. No tests or database operations were rerun for this documentation update. See [isolated acceptance](isolated-acceptance.md) for scope/history and [local roadmap acceptance](LOCAL_ROADMAP_ACCEPTANCE.md) for parent-owned rollout tracking.

## Historical authoring rollout status

Implementation is local and uncommitted. **Not a completed production rollout.** Migration `0033_publishing_safety.sql` is reserved for this work and written, **not applied**. Parent coordinates all database application, including the billing handoff's pending `0032`. No earlier migration was edited. No environment secrets were read, live publishing/AI/email/payment calls made, or deployment/commit performed.

## Outcomes, modes, receipts and counts

Every newly admitted target persists `executionMode` (`sandbox`, `dry-run`, `live`) and `intent` (`publish`, `schedule`). Unset runtime mode means sandbox; an invalid mode denies. Execution must match the admitted mode; changing an environment setting cannot silently convert a queued simulation into live delivery. Legacy NULL mode is not inferred and cannot pass worker authorization.

| Target outcome | Meaning | Live published count / Published email |
| --- | --- | --- |
| `simulated` | Sandbox/dry-run completed without invoking the adapter; no provider ID | Neither |
| `published` | Live adapter returned a nonempty, nonsynthetic provider post ID and the claim completion committed | Count eligible; best-effort email after commit |
| `accepted_unverified` | Slack webhook returned `ok`; no message ID/receipt is available | Neither |
| `unknown` | External outcome ambiguous; automatic replay blocked | Neither |
| `manual_published` | Owner's explicit, audited manual claim with a receipt reference, **not provider verification** | Neither |
| `failed` | Pre-effect denial/failure, or explicit manual not-delivered decision | Neither; separate policy-checked retry available |
| `legacy_unverified` (read projection) | Historical published flag lacks new live target receipt evidence | Neither |

No sandbox adapter or legacy mock adapter fabricates IDs. Receipt UI labels mode, unavailable receipts, manual evidence, actor and legacy uncertainty. Parent status remains derived atomically from its targets; all-simulated is `simulated`, never `published`. New nonlive outcomes never set `publishedAt`. Mixed delivery retains individual receipts and cannot be treated as complete live delivery.

Draft lists, published lists, published-schedule counts and status snapshots exclude historical claims without receipt-backed live target evidence. Stored legacy flags/logs are not rewritten or guessed. Historical receipt recovery requires a separately reviewed operator backfill; the reconciliation API does not fabricate mode or verification for those records. Failed siblings may still be recovered separately. Old historical publishing metrics outside these draft/schedule reads are not retroactively repaired.

Published email is emitted only after successful receipt-backed completion CAS. Progress reporting/email failure cannot downgrade the committed outcome or trigger another post. Email is best effort, not a transactional outbox; this work does not promise exactly-once external delivery or notification.

## Common server policy

`server/services/publishing-policy.ts` runs under the owned draft row lock at schedule, reschedule, bulk-item admission and explicit retry, and again after claim immediately before publisher dispatch. Publish-now dispatch checks policy even when reusing an existing due generation. Queue/scheduler paths cannot bypass the execution check.

Checks cover authenticated tenant/user ownership, one to four distinct targets, current runtime/admitted mode, an explicitly enabled global integration, enabled user preferences, user and draft publishing rules, nonempty content and min/max character rules, supported adapter, attached-media count/unique IDs, tenant/user-owned media MIME/type/size and deletion state, account activation/scopes/expiry/identity, and successful credential decryption. MIME and size authority is stored upload metadata, not the draft's client-supplied type or URL. Missing media fails rather than silently publishing without it.

`assertTenantEntitlement(tenantId, "publish", { transaction: tx })` is always authoritative; scheduled intent also asserts `"schedule"` with the same transaction. Denial is 403 `entitlement_required`; resolution outage is 503, never permission granted. No prices, tier names, or arbitrary free-plan denial are implemented here. Current billing service semantics (including its free-plan limits) are consumed unchanged. The execution check catches expiry/revocation while queued. UI availability is advisory; current server checks remain authoritative.

`requirePublishReview` requires server-owned approval of the exact draft. POST `/api/drafts/:id/approve-publishing` requires own-write permission and exact `content` plus `updatedAt`; mismatches return 409. The server stores a hash of content, attachments and draft platform rules, actor and approval time. Content edits clear approval. Client status/approval fields cannot mark delivery complete. The Content publishing dialog shows full text and attachment names and requires an explicit approval click; publishing never auto-approves. Copying creates an unapproved, unscheduled draft.

## Fencing and manual reconciliation

Existing owned-draft locking, target generation IDs, due timestamp checks, sibling preservation, atomic target/log/aggregate commits and single-snapshot status reads are retained. Claims additionally carry a fresh token and increment a revision. Completion requires the exact token, current publishing state and matching admitted mode. Retry replaces the failed generation ID. Old completions after retry/reconciliation cannot overwrite the newer target.

POST `/api/drafts/:id/schedule/targets/:targetId/reconcile` requires authentication and `draft:write:own`; tenant/user always come from the session, never supplied evidence. Strict input: `expectedRevision`, `decision` (`delivered`, `not_delivered`, `unresolved`), 10–1000-character `note`, optional 1–300-character `receipt`, and boolean `workerStopped`. Extra fields such as `providerVerified` or `tenantId` are rejected.

- Only `unknown`, `accepted_unverified`, or a `publishing` claim older than five minutes can be reconciled. Five minutes is a minimum guard, **not proof the worker stopped**.
- Delivered requires a receipt reference and a live admitted mode; stores `manual_published`, never provider-verified `published`.
- Not delivered requires explicit stopped-worker acknowledgement and stores `failed`; saving the decision never enqueues anything. A separate retry rechecks all policy.
- Unresolved stores `unknown` and keeps replay blocked.
- Revision CAS permits one concurrent decision. Claim token is cleared and revision increments. Audit logs retain target ID, actor, prior status/revision, mode, old claim, note, decision and receipt reference in the same transaction as aggregation.
- No delivery-verification adapter is currently implemented: `verifyDelivery:false` is truthful for every platform. Connection validation is not delivery verification. No automatic unknown/stuck replay or guessed provider result exists.

Cancellation cannot erase uncertain, simulated, accepted, manual or live-completed targets. Legacy parent-status helpers cannot manufacture publication without a target receipt. Rescheduling/retry leave audit events; completed siblings retain their IDs. Individual deletion refuses publishing records; bulk clear removes only untouched drafts with no schedule/log. Account deletion/retention procedures remain separately governed.

## Shared implemented capability matrix

`shared/publishing-capabilities.ts` drives server admission, publisher dispatch, integration catalog, client readiness/limits, platform metadata and Connections descriptions. Application scheduling is supported for the ten real adapters; it is not a claim of provider-native scheduling or analytics. Other catalog platforms are manual-copy only. Generation keys remain separate: adding Slack publishing does not claim Slack AI generation.

Application ceilings (not an exhaustive provider API specification):

| Platform | Characters | Attachments | Receipt |
| --- | ---: | --- | --- |
| LinkedIn | 3000 | 1 JPEG/PNG/WebP, 5 MiB | Provider ID |
| X | 280 | None | Provider ID |
| Reddit | 5000 | None; self/text posts only | Provider ID |
| Bluesky | 300 | 4 JPEG/PNG/WebP, 1,000,000 bytes each | Provider URI |
| Mastodon | 500 | Up to 4 images; audio/video must be alone, 8 MiB each | Provider ID |
| Dev.to | 5000 | 1 JPEG/PNG/WebP, 5 MiB | Provider ID |
| Hashnode | 5000 | None | Provider ID |
| Telegram | 4096 | None | Provider message ID |
| Discord | 2000 | Up to 8, 8 MiB each | Provider message ID |
| Slack | 4000 | None | Unavailable; accepted-unverified only |

Mastodon/Discord allow JPEG/PNG/WebP/GIF, MP4, MPEG audio and WAV in this adapter matrix; the upload service may enforce stricter installation-wide MIME limits. Slack is included in preferences, scheduling and Connections, seeded globally **disabled** by 0033. Reddit is visible, not silently hidden by a hardcoded staging list. Credentials, application approval, publication/channel permissions and global enablement remain real prerequisites. Connecting a webhook/Telegram account may send a real test message in normal application use; tests here mock those boundaries.

## Remaining prerequisites and limits

1. Historical local prerequisite, superseded by the acceptance note above: parent review/application of 0033 and restricted-role DB validation. `server/storage.scheduling.test.ts` intentionally mocks policy to isolate storage; the combined run also passed all three `server/publishing-pool.integration.test.ts` cases covering real policy/entitlement reads under concurrent PostgreSQL draft locks and pool acquisition timeout. Development/production migration and rollout verification remain separately required.
2. Recheck current global preferences/credentials/entitlements immediately before effects, but they cannot be atomically locked together with an external provider. An operator must stop/quiesce old workers and settle in-flight requests before recording not-delivered. The UI acknowledgement is an audited assertion, not a remote process-stop mechanism. Provider idempotency/verification adapters remain future work.
3. Historical nested-transaction/pool-deadlock caveat is fixed locally: `assertPublishingPolicy` passes `{ transaction: tx }` for both entitlement checks; `getTenantEntitlements` forwards it to `readEntitlementState`, which reads on that transaction instead of opening `tenantBilling`. This path no longer acquires a second pool connection while holding the draft transaction. Production pool sizing/contention still needs operational evaluation; this is not a blanket deadlock-free guarantee.
4. Test actual provider capability/permission/media behavior in an explicitly authorized staging exercise before enabling live rollout. Conservative local limits cannot guarantee every federated instance or provider account accepts a post. Some non-webhook adapters still rely on operational worker timeout/reconciliation for hung requests; no blanket provider-timeout guarantee is claimed.
5. Legacy NULL modes/receipts must be inspected through a separately reviewed operator process. Never backfill live mode from an old synthetic ID or treat a successful queue job as proof of delivery.
6. Review existing dashboards/exports and old persisted metrics for legacy success claims outside the updated draft/schedule reads. No historical mass rewrite was performed. Use documented live receipt criteria, not legacy `status` alone.

## Historical authoring validation (superseded above)

Focused mocked/network-isolated validation only: **17 files, 183 tests passed, 0 failed** in the final run. Browser tests use actual React/Radix/Query with mocked fetch and blocked browser networking; they do not launch the application server or access a provider. All Vitest runs disable environment-file loading and use a hard filename include allowlist. Database tests are authored for the parent but were **not run**.

| Exact file | Tests |
| --- | ---: |
| `shared/publishing-safety.test.ts` | 9 |
| `server/services/publishing-policy.test.ts` | 15 |
| `server/jobs/handlers/publish-draft.test.ts` | 15 |
| `server/services/publishers/publishing-safety.test.ts` | 17 |
| `server/routes/drafts.publishing-safety.test.ts` | 10 |
| `server/routes/drafts.scheduling.test.ts` | 17 |
| `client/src/lib/publishing.test.ts` | 32 |
| `client/src/pages/publishing-ux.test.ts` | 38 |
| `server/services/webhookPublisher.safety.test.ts` | 4 |
| `server/services/publishers/providerSandbox.test.ts` | 5 |
| `server/services/publishers/providerAdapter.test.ts` | 3 |
| `server/services/publishers/providerLifecycle.test.ts` | 3 |
| `server/services/publishers/linkedin.test.ts` | 4 |
| `server/services/publishers/bluesky.test.ts` | 1 |
| `server/services/publishers/mastodon.test.ts` | 2 |
| `server/services/publishers/devto.test.ts` | 2 |
| `server/services/publishers/telegram.test.ts` | 6 |

Final `tsc --noEmit --incremental false` and publishing-scoped `git diff --check` passed. Earlier concurrent email-test diagnostics disappeared without editing those files. Editor checks still report cognitive-complexity advisories in policy/worker code; no TypeScript compiler errors remain in the final check. This is not a claim that the full repository suite, real authentication middleware, PostgreSQL enforcement or external provider delivery has been verified by these mocks.

One new browser case initially timed out on an overly exact accessible-label selector; matching its combobox role/name resolved it. A reporter-name setup failure executed no tests and is not counted. Dedicated JSON reports were used to distinguish these runs from other agents' interleaved terminal output.