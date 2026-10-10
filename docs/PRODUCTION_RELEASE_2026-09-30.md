# Production release — 2026-09-30

## Verified live state

- Public origin: `https://www.thesocialpundit.com`.
- Google Cloud project `tsp-social-pundit`, region `asia-south1`, service `tsp-app`.
- Revision `tsp-app-r260930-ffba2a064ee6` received 100% traffic at approximately **16:19 UTC**.
- Image tag: `asia-south1-docker.pkg.dev/tsp-social-pundit/tsp-repo/tsp-app:cc3d91e-ffba2a064ee6`.
- Deployed immutable digest: `sha256:8d9ede10f4c4bbee7edff436d695505ce75350d427dc5532f2aa1323d85d7f5a`.
- Temporary candidate and drain tags removed. No percentage traffic split remains.
- At **16:22 UTC**, the legacy editorial worker was disconnected; Redis had 10 connections including the short-lived audit connection.
- No new severe/request-failure/queue-connection/startup/retention errors were found in the inspected post-cutover logs.

This record supersedes older release/model/configuration observations, not the operational procedures in `production-cloud-run.md`.

## Shipped functionality and configuration

- Create Article social-preview bento cards, sequential platform generation, per-card recovery, responsive layout and six-pixel corners.
- Gemini Pro generation handling and publisher/source provenance improvements.
- Exact-current-text **Copy & open** handoff, including clipboard and popup failure handling. LinkedIn prefill remains best effort; opening its composer is not automatic publication. See `platform-compose-handoff.md`.
- Production editorial queue partitioning by canonical model/provider/fallback identity and pipeline version. Invalid production provider configuration fails closed before constructing the queue.
- Active queue: `editorial_generation-production-edec0e6d6213`; shared scoped polling/result keys remain `editorial:v1:*`.

Explicit runtime changes:

| Setting | Deployed value |
| --- | --- |
| `AI_PROVIDER` | `gemini` (retained) |
| `GEMINI_MODEL` | `gemini-3.1-pro-preview` |
| `AI_FALLBACK_PROVIDER` | Empty; fallback disabled |
| `INVITATIONS_ENABLED` | `false` |

The existing `GEMINI_API_KEY:2` secret reference was retained. The paid AI project **TSPAI** (`gen-lang-client-0282627825`) is separate from the hosting project.

All other existing environment entries and secret references were compared before/after deployment and preserved. In particular:

- `PUBLISHING_MODE=live`, `BACKGROUND_JOBS_ENABLED=true`, `CRON_SCHEDULER=true`.
- **`EMAIL_DIGEST_ENABLED=true`** and `PLAN_LIMITS_ENABLED=false` (older deployment documentation may differ).
- Canonical/auth origins, payment secrets, encryption secrets and provider connections unchanged.
- Restricted runtime database secret `DATABASE_URL_APP`, with role `tsp_app`; no owner credential injected into the runtime.
- One CPU, 1 GiB, revision min/max instances 1, always-allocated CPU, and existing service account unchanged.
- Production browser Sentry DSN retained at build time; no development auth bypass.

## Invitation migration deliberately deferred

**No production migration was applied and invitation sending is disabled.**

Read-only migration audit found 49 migration files, matching recorded checksums, no ledger gaps, and only `0049_friend_invitations.sql` pending (checksum `056777aaec919577`). Both invitation tables were absent. Startup maintenance safely checks table existence before pruning.

Backup/PITR/restore evidence and an approved invitation test recipient were not available. User-unavailable responses were not treated as confirmation. Before enabling invitations:

1. Verify current recovery coverage and a usable restoration procedure.
2. Revalidate migration state and rehearse/apply `0049` through the owner-only migration runner.
3. Verify grants, disabled/enabled route behavior and recipient opt-out handling.
4. Obtain approval for a controlled recipient test and verify delivery before general enablement.

Do not enable the flag against the unmigrated database. No invitation test email was sent during this deployment.

## Acceptance evidence

- **600 passed / 14 files**, zero failed: focused queue, provider, writer, composer/recovery, handoff and publishing regressions.
- Exact test includes; dotenv disabled; writer imports used an unreachable dummy database URL. The Bull overlap test used disposable local Redis, not production.
- `pnpm check`, `git diff --check`, and Linux AMD64 Docker build passed.
- Candidate `/readyz`: database OK, Redis reachable, queues initialized, jobs required.
- Candidate anonymous protected endpoints returned 401. Authenticated machine diagnostics confirmed production/live publishing and enabled background jobs/scheduler without exposing the token.
- Both old and new editorial workers were observed on different queue names before cutover. Legacy editorial, publishing, inbox and email queues had no active work; legacy editorial had no waiting/delayed/paused work.
- **9/9** canonical anonymous HTTP smoke checks passed after promotion.
- Direct, unmodified production Chromium sign-in checks passed at **320, 768 and 1440 px**, with no page exceptions or horizontal overflow. Anonymous Create navigation redirected to sign-in.
- Canonical JS/CSS filenames and byte sizes matched the candidate; deployed Cloud Run image matched the immutable artifact digest.
- Both editorial queues and shared queues were checked again before removing drain tags. No jobs were deleted, moved or replayed.

### Tagged-origin browser limitation

Initial direct browser visits to the temporary `run.app` tag produced asset 500s because browser module requests carried that unapproved Origin. Identical assets returned 200 with the approved canonical Origin. The existing allowlist was **not widened**.

Candidate browser acceptance used a fresh anonymous browser at the canonical origin with read-only requests forwarded to the candidate. After promotion, the real canonical browser was tested without forwarding or header changes and passed. The pre-cutover tag-origin probe errors must not be confused with post-cutover production errors.

### Scope limits

This deployment verification did not exercise authenticated production Create generation, onboarding, social-account publication, payment charging, or email delivery. Earlier paid Gemini Create acceptance was local, not production. The focused regression suite is not a claim that the entire repository test suite was rerun. Existing unrelated lint findings were not modified.

Normal production schedulers/workers remained enabled during rollout; a no-traffic revision was not treated as an inert staging environment.

## Source and artifact traceability

The image was built from **823 frozen source files**, including uncommitted/untracked release files based on Git `cc3d91e`; it is not the unchanged `cc3d91e` image. No Git commit or push was performed.

- Canonical inventory SHA-256: `ffba2a064ee6e45df90b6da2f8fae9a639928f1e8c7cb026857dd8f70de4bc56`.
- Source archive SHA-256: `ba3321454a02f405bfab1f0a48a53b20d9703e48b1495747bd4d5ccee9ec8b4a`.
- Durable local evidence directory: `~/Library/Application Support/TheSocialPundit/releases/2026-09-30-ffba2a064ee6/`.
- It contains `context.tar.gz`, per-file hashes in `release.json`, build metadata/log, candidate/promotion/production checks, worker-retirement evidence and screenshots.
- Build context excluded environment files (except `.env.example`), local package/editor configuration, Git metadata, uploads and generated artifacts.
- This post-deployment document was written after the source freeze and is not claimed to be inside the deployed image.

## Rollback readiness

- Previous revision retained and Ready: **`tsp-app-00082-kib`**.
- Previous immutable image digest: `sha256:b894112e43f5a0058f6823a27dc8fd1c6c04e4c1994c7a0b01297a58166ececb` in the same Artifact Registry repository.
- No schema rollback is required for this release because no migration was applied.
- Rollback was not executed as a test. The old revision restores its own Gemini Flash/OpenRouter fallback configuration, not the new Pro/no-fallback settings.

For an incident rollback, first confirm current traffic/configuration and Redis headroom. Retain the current revision under a temporary drain tag while directing traffic to the exact old revision:

`gcloud run services update-traffic tsp-app --project=tsp-social-pundit --region=asia-south1 --to-revisions=tsp-app-00082-kib=100 --update-tags=drain-r260930=tsp-app-r260930-ffba2a064ee6`

Then verify canonical health/readiness and inspect both editorial queues plus active publishing/email work. Remove `drain-r260930` only when retiring those workers is safe. Preserve shared result records; never move/replay jobs to force drainage. Recheck Redis connections and remove unnecessary tags, since tagged revision-level minimum instances retain workers.