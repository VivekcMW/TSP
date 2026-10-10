# Production on Cloud Run

Verified 2026-09-23. This replaces the Vercel + Render setup described in older
documents, which has been retired.

## Topology

- `www.thesocialpundit.com` and `thesocialpundit.com` resolve to a Google Cloud
  HTTPS load balancer (`34.117.52.220`, forwarding rule `tsp-app-https-rule`).
  DNS is hosted at GoDaddy (`domaincontrol.com`); mail is Google Workspace.
- The load balancer fronts the Cloud Run service **`tsp-app`**
  (project `tsp-social-pundit`, region `asia-south1`). The same container
  serves the API and the built frontend.
- Configuration comes from Secret Manager and plain service environment
  variables. `DATABASE_URL` points to Neon project `aged-breeze-22174577`
  (endpoint `ep-quiet-field-azkwtx6k`, pooled). `REDIS_URL` points to the
  Redis Cloud database `tsp-production`.
- Service settings: minimum and maximum 1 instance, CPU always allocated,
  `BACKGROUND_JOBS_ENABLED=true`, `CRON_SCHEDULER=true`. With one instance
  there is exactly one scheduler. `EMAIL_DIGEST_ENABLED` is unset, so digest
  emails are off.
- The shared article index crawl (`jobs/pool-crawl.ts`) runs under the same
  scheduler every `POOL_CRAWL_INTERVAL` minutes (default 15) unless
  `POOL_CRAWL_ENABLED=false`. Its log line is `[pool-crawl] N publications
  (F failed), S new stories, R readable + U unreadable bodies, P pruned`.
  Migration 0045 creates its tables (`publications`, `pooled_articles`); 0046 adds
  discovery (`discovered_sites`, `watch_terms`) and WebSub columns. Related settings,
  all optional: `GDELT_ENABLED=false`, `WEBSUB_ENABLED=false`, `INDEX_ONLY_THRESHOLD`
  (default 40; index candidates above which the search engines are skipped). WebSub
  hubs call back at `${APP_URL}/api/websub/:id`. `GET /api/admin/index` shows counts.
- `PLAN_LIMITS_ENABLED=false` (set 2026-09-24 at the user's request): Free
  accounts get Pro access (unlimited generations, publishing, scheduling and
  analytics). Remove the variable, or set it to `true`, to restore Free-plan
  limits. The per-hour anti-abuse rate limits still apply.

CPU must stay always allocated. With request-only CPU, an idle instance cannot
keep its Redis connections alive, so background jobs stall and scheduled posts
do not publish.

## Deploy

Cloud Build is not enabled; images are built locally for `linux/amd64`.

### Protected GitHub release workflow

The preferred release path is the manually dispatched
[`Cloud Run release`](../.github/workflows/cloud-run-release.yml) workflow. It
never deploys on push and separates the release into three explicit operations:

- `candidate` builds an immutable full-SHA image and deploys a tagged,
  no-traffic revision with background workers and the scheduler disabled.
- `promote` requires the protected `production` environment, verifies the exact
  candidate image, validates production configuration, runs migration dry-run /
  apply / dry-run, and promotes the same image. If readiness verification fails,
  traffic is automatically restored to the previously active revision.
- `rollback` requires the protected `production` environment, the exact existing
  revision name, and the `ROLLBACK` confirmation.

Configure these GitHub environments before the first run:

| Environment | Variables | Secrets |
| --- | --- | --- |
| `release-candidate` | `GCP_PROJECT_ID`, `GCP_REGION`, `GCP_CLOUD_RUN_SERVICE`, `GCP_ARTIFACT_REPOSITORY`, `VITE_SENTRY_DSN` | `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_DEPLOY_SERVICE_ACCOUNT` |
| `production` | All candidate variables plus `PRODUCTION_URL`, `PRODUCTION_ALLOWED_ORIGINS`, `RESEND_FROM_EMAIL` | Candidate secrets plus `DATABASE_URL`, `OWNER_DATABASE_URL`, `BETTER_AUTH_SECRET`, `WEBHOOK_ENCRYPTION_SECRET`, `DIAGNOSTICS_TOKEN`, `OAUTH_STATE_SECRET`, `RESEND_API_KEY`, `REDIS_URL`, Razorpay secrets, and the configured AI provider key |

Set required reviewers on the `production` environment. The deploy service
account needs only Artifact Registry push, Cloud Run deploy/traffic, and revision
read permissions. Workload Identity Federation is required; do not add a
long-lived Google service-account JSON key.

Run `candidate` with the exact 40-character release SHA, then run the separate
`Live acceptance` workflow against the candidate URL recorded in the job
summary. The candidate job also sends a request with the candidate browser
`Origin` and fails unless that exact origin is allowed by CORS and Better Auth.
If it fails at that gate, follow the candidate-only `ALLOWED_ORIGINS` procedure
below and rerun; the tag URL remains stable while each attempt gets a distinct
revision.

Only after CI and live acceptance pass should an approver run `promote` with
the same SHA, the exact candidate revision from the successful candidate job,
the successful Live acceptance run ID, the confirmation `PROMOTE`, and
`BACKUP VERIFIED`. Promotion verifies that both CI and the specified
live-acceptance run passed for that exact commit; an acceptance run from another
commit cannot authorize the release.

The commands below remain the owner-operated fallback when GitHub environments
or Workload Identity Federation are unavailable.

```bash
SHA=$(git rev-parse --short HEAD)
IMAGE=asia-south1-docker.pkg.dev/tsp-social-pundit/tsp-repo/tsp-app:$SHA
CANDIDATE=tsp-app-rc-$SHA
FINAL=tsp-app-r-$SHA
# The browser DSN is public and is inlined by Vite at build time.
DSN=$(gcloud run services describe tsp-app --region asia-south1 --format=json \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const e=JSON.parse(d).spec.template.spec.containers[0].env.find(x=>x.name==="VITE_SENTRY_DSN");process.stdout.write(e?.value??"")})')
docker buildx build --platform linux/amd64 --build-arg VITE_SENTRY_DSN="$DSN" -t "$IMAGE" --push .

# Tagged candidates must not start a second scheduler against production.
gcloud run deploy tsp-app --region asia-south1 --image "$IMAGE" --no-traffic --tag "rc-$SHA" \
  --revision-suffix "rc-$SHA" \
  --update-env-vars BACKGROUND_JOBS_ENABLED=false,CRON_SCHEDULER=false
```

Test the tagged URL (`https://rc-<sha>---tsp-app-yxmmzfzara-el.a.run.app`):
`/readyz` must return `"status":"ok"`. Cloud Run reserves `/healthz` on
`*.run.app` URLs, so it returns a Google 404 there; check it through the
domain instead. Also open the candidate in a browser: anonymous HTTP smoke does
not exercise module loading or browser `Origin` headers.

The tagged origin is not automatically in the production CORS allowlist. For
browser QA, add that exact HTTPS origin to a **candidate-only** `ALLOWED_ORIGINS`
binding while retaining the production origins. Do not modify the shared
secret's latest version. Cloud Run CLI update flags reject changing an existing
secret binding to a literal; a declarative service replacement or the regional
Cloud Run API can make that change atomically. Preserve the existing production
traffic allocation and both disabled-worker flags during the replacement.
Verify JavaScript and CSS return 200 with the candidate `Origin` header.

Once candidate checks and CI pass, move traffic to the checked
candidate, then restore workers in a production revision of the same image.
Scheduled dispatch briefly pauses during this handover rather than running a
candidate scheduler alongside the live scheduler. Keep the previous production
revision available for rollback, and remove the temporary candidate tag:

Require CI on the exact release commit, including the Linux browser/text-zoom
regressions. Database tests still require a loopback client URL, the designated
test database, and the restricted role with no RLS bypass. On GitHub Actions,
the PostgreSQL service may report a Docker bridge address rather than loopback;
the shared test guard permits that only for the explicitly authorized CI target.

An explicit `BACKGROUND_JOBS_ENABLED=false` disables inbox, publishing,
editorial-generation, and email queue consumers, plus email recovery maintenance.
Queue producers remain available so requests can be admitted without a second
worker in the candidate. Unset retains the existing local/legacy worker behavior;
use explicit flags for both candidate and production revisions. Check candidate
startup logs for the worker-disabled messages before promotion.

Relevance scoring reuses each article field's Unicode span projection and only
advances it through matched text. Batch scoring yields between articles so HTTP
requests and Bull lock-renewal timers remain responsive during large refreshes.
Check for missed-cron and lost-queue-heartbeat warnings as well as HTTP readiness;
a successful readiness response alone does not prove responsiveness.

Feed parsing uses an independent XML parser per operation, including WebSub,
shared-index crawling, and Google/Bing discovery. Reusing the underlying XML
parser can leave rootless responses pending or mix concurrent feed results.
After deployment, check signed WebSub delivery latency as well as readiness:
healthy database probes do not detect a stalled feed parser.

If validation created a configuration-only successor, update `CANDIDATE` to
that exact checked revision before moving traffic. Restore the original
`ALLOWED_ORIGINS` Secret Manager binding in the final revision; do not carry the
candidate-only literal allowlist into production.

```bash
gcloud run services update-traffic tsp-app --region asia-south1 --to-revisions "$CANDIDATE=100"
gcloud run deploy tsp-app --region asia-south1 --image "$IMAGE" --no-traffic \
  --revision-suffix "r-$SHA" \
  --update-env-vars BACKGROUND_JOBS_ENABLED=true,CRON_SCHEDULER=true
gcloud run services update-traffic tsp-app --region asia-south1 --to-revisions "$FINAL=100"
gcloud run services update-traffic tsp-app --region asia-south1 --remove-tags "rc-$SHA"
E2E_BASE_URL=https://www.thesocialpundit.com E2E_API_BASE_URL=https://www.thesocialpundit.com \
  pnpm exec playwright test --config=playwright.deployment.config.ts
```

## Roll back

Previous revisions stay deployed. Send traffic back to one:

```bash
gcloud run revisions list --service tsp-app --region asia-south1
gcloud run services update-traffic tsp-app --region asia-south1 --to-revisions <revision>=100
```

## Database migrations

The saved-document editor requires `0051_creation_sessions.sql` before its
revision receives traffic. The release preflight also checks any earlier
pending migrations, including `0049_friend_invitations.sql` and
`0050_tenant_invitations.sql`; do not skip dependencies or bypass ledger checks.
Run the migration tool's read-only `--dry` check first, apply the reviewed
additive migrations, and repeat it to verify zero pending migrations.

The production database was fully migrated on 2026-09-23 (39 files, 0 pending).
Run migrations with the migration tool against the direct (non-pooler)
endpoint, with an explicit `:5432` and only `sslmode=require` in the URL. The
tool rejects other parameters and needs a session-level connection:

```bash
OWNER_DATABASE_URL='postgresql://neondb_owner:<password>@ep-quiet-field-azkwtx6k.c-3.ap-southeast-1.aws.neon.tech:5432/neondb?sslmode=require' \
  pnpm run db:migrate:dry
```

### 0041: empty duplicate personal workspaces

A race on a user's first sign-in could create two personal workspaces (one production
user was affected; their data is in the newer one). Code from `fix(tenancy)` onward
serialises creation and looks up the personal workspace deterministically, so **apply
0041 before sending traffic to a revision with that code**: 0041 deletes only duplicates
holding no data (besides the membership and an untouched pending profile) and leaves
users whose duplicates both hold data unchanged, with a NOTICE. Rehearsed on the local
dev database on 2026-09-24 (5 users repaired, no data rows changed).

## Security settings (2026-09-23)

- The app connects as the restricted `tsp_app` role through secret
  `DATABASE_URL_APP`, so row-level security isolates tenants. The owner
  credentials in secret `DATABASE_URL` are kept only for migrations and for
  rolling back to revisions older than `tsp-app-00013`.
- `TRUSTED_PROXY_CIDRS=169.254.0.0/16,34.117.52.220,35.191.0.0/16,130.211.0.0/22`
  trusts Cloud Run's internal proxy (the container sees `169.254.169.126`),
  the load balancer and Google front ends. Express therefore resolves the
  real visitor IP, which rate limits and sessions depend on.
- Stored provider credentials are encrypted with their own secret,
  `WEBHOOK_ENCRYPTION_SECRET`. Without it they fall back to
  `BETTER_AUTH_SECRET`. To rotate the key, keep old values in
  `WEBHOOK_ENCRYPTION_PREVIOUS_SECRETS`.

## Billing (2026-09-23)

- Razorpay runs in live mode from revision `tsp-app-00019`: `RAZORPAY_KEY_ID`,
  `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` reference the
  `RAZORPAY_LIVE_*` secrets. The unprefixed secrets still hold the test keys
  that older revisions use. Rolling back past `tsp-app-00019` therefore returns
  checkout to test mode, where the live plan IDs in the catalog don't exist.
- Migration 0039 sets the catalog to $20/month and $200/year, with ₹999/month
  and ₹9,999/year for India. Razorpay plan IDs are linked per environment
  (`billing_plans.razorpay_plan_id`), not in migrations. Live plans:
  `pro_monthly_inr` → `plan_TfQTPZIQY7fzvp`, `pro_yearly_inr` →
  `plan_TfQTPip40kjwRD`.
- The USD plans (`pro_monthly`, `pro_yearly`) are inactive because Razorpay
  rejects USD until International Payments is enabled on the live account.
  While only INR is active, every visitor sees INR and the currency switch is
  hidden.

## Monitoring

Uptime check `TSP readyz` requests `/readyz` every 5 minutes from six regions.
Alert policies email `hello@thesocialpundit.com` when the site is down, on
HTTP 5xx errors, on ERROR logs, and on Redis or queue connection failures.

## Open follow-ups

- LinkedIn publishing is configured (revision `tsp-app-00017`).
  `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET` reference the same secrets
  as sign-in (`LINKEDIN_AUTH_CLIENT_ID`, `LINKEDIN_AUTH_CLIENT_SECRET`). That
  LinkedIn app is authorized for `w_member_social` and has
  `/auth/linkedin/analytics/callback` registered: LinkedIn accepted both, and
  it rejected an unregistered redirect and an unauthorized scope in control
  requests. No customer has connected an account yet.
- From revision `tsp-app-00024`, Create generates one post per click (one
  platform, one tone), X counts each link as 23 characters, and the length
  retry states exact numbers. LinkedIn, Threads and Substack generate reliably;
  X succeeded in 2 of 3 checks. The remaining failure is Gemini latency: one AI
  call and its OpenRouter fallback share a 20-second budget
  (`AI_REQUEST_TIMEOUT_MS`), so when Gemini stalls the fallback never runs and
  the user sees "AI generation timed out".
- From revision `tsp-app-00050`, onboarding is one workspace: Pundit's
  conversation on the left, "Your setup" filling in live on the right (tabs on
  phones). The user describes their work in the chat box;
  `POST /api/onboarding/understand` (one short Gemini call) returns the
  editable summary. "Build my setup" opens a server-sent event stream,
  `POST /api/onboarding/agent`, which researches sources, then topics, then
  people from Google News (last 30 days), streams real progress, and
  pre-selects 6 sources, 8 topics, 4 people and 4 companies with reasons,
  evidence, a note and up to three suggested follow-up requests. A full build
  takes about 25 seconds and roughly 6 Gemini calls; steering one section takes
  about 7 seconds. `/api/onboarding/suggestions` serves "more like your picks"
  and the finish-screen headlines (no AI call). "Write a post" on a headline
  opens Create with the story link (`history.state.createFromUrl`). All three
  routes share 60 requests per user per hour. Answers are cached for 6 hours in
  Redis (`onboarding:suggestions:v<N>:`, `onboarding:understand:v<N>:`); bump
  the `CACHE_VERSION` constants when prompts change. A 402/429 from Gemini
  starts a provider cooldown of at least a minute (`server/services/openRouter.ts`);
  the agent then says "The AI service is busy right now" and logs
  `[onboarding-agent] <step> failed: <code>`.
- To offer USD once Razorpay enables International Payments: create a live
  plan for USD 2000 monthly and USD 20000 yearly (interval 1), set each plan's
  ID in `razorpay_plan_id`, and set `is_active = true` for `pro_monthly` and
  `pro_yearly`. Checkout refuses a plan whose Razorpay amount, currency or
  period differ from the catalog.
- Reddit is not configured (`REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`). Its
  redirect URL is `https://www.thesocialpundit.com/auth/reddit/callback`.
- The X app must register `https://www.thesocialpundit.com/auth/twitter/connect/callback`.
- Redis Cloud has TLS off, `volatile-lru` eviction and no persistence. Bull
  needs `noeviction`. The plan allows 30 connections and each app instance uses
  about 10 (three Bull queues at three connections each, plus one shared), so a
  deploy briefly needs about 20. On 2026-09-24 the retired Render service still
  held the rest, and new revisions failed `/readyz` with `ERR max number of
  clients reached` until it was suspended. Nothing else may connect to this
  database. After switching traffic, remove every `rc-*` tag: a tagged revision
  can keep its own instance, scheduler and Redis connections alive.
- Production's `GEMINI_API_KEY` (secret version 2, pinned on the service since
  revision `tsp-app-00036`) is the `TSPAIPRO` key from the AI Studio project
  `TSPAI` (`gen-lang-client-0282627825`), which bills to "TSP Google Billing
  Account" (014828-788CA6-B9FDD3). Version 1 was a free-tier key (20 requests
  a day) from another Google account's project; local `.env` still uses it.
  To check a key's tier, make one small request and read
  `error.details[].violations[].quotaId`: a `-FreeTier` suffix means unbilled.
