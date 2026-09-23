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

CPU must stay always allocated. With request-only CPU, an idle instance cannot
keep its Redis connections alive, so background jobs stall and scheduled posts
do not publish.

## Deploy

Cloud Build is not enabled; images are built locally for `linux/amd64`.

```bash
SHA=$(git rev-parse --short HEAD)
IMAGE=asia-south1-docker.pkg.dev/tsp-social-pundit/tsp-repo/tsp-app:$SHA
# The browser DSN is public and is inlined by Vite at build time.
DSN=$(gcloud run services describe tsp-app --region asia-south1 --format=json \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const e=JSON.parse(d).spec.template.spec.containers[0].env.find(x=>x.name==="VITE_SENTRY_DSN");process.stdout.write(e?.value??"")})')
docker buildx build --platform linux/amd64 --build-arg VITE_SENTRY_DSN="$DSN" -t "$IMAGE" --push .

# New revision with no traffic, reachable at a tagged URL for testing.
gcloud run deploy tsp-app --region asia-south1 --image "$IMAGE" --no-traffic --tag "rc-$SHA"
```

Test the tagged URL (`https://rc-<sha>---tsp-app-yxmmzfzara-el.a.run.app`):
`/readyz` must return `"status":"ok"`. Cloud Run reserves `/healthz` on
`*.run.app` URLs, so it returns a Google 404 there; check it through the
domain instead. Then move traffic and verify through the domain:

```bash
gcloud run services update-traffic tsp-app --region asia-south1 --to-latest
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

The production database was fully migrated on 2026-09-23 (39 files, 0 pending).
Run migrations with the migration tool against the direct (non-pooler)
endpoint, with an explicit `:5432` and only `sslmode=require` in the URL. The
tool rejects other parameters and needs a session-level connection:

```bash
OWNER_DATABASE_URL='postgresql://neondb_owner:<password>@ep-quiet-field-azkwtx6k.c-3.ap-southeast-1.aws.neon.tech:5432/neondb?sslmode=require' \
  pnpm run db:migrate:dry
```

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
- To offer USD once Razorpay enables International Payments: create a live
  plan for USD 2000 monthly and USD 20000 yearly (interval 1), set each plan's
  ID in `razorpay_plan_id`, and set `is_active = true` for `pro_monthly` and
  `pro_yearly`. Checkout refuses a plan whose Razorpay amount, currency or
  period differ from the catalog.
- Reddit is not configured (`REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`). Its
  redirect URL is `https://www.thesocialpundit.com/auth/reddit/callback`.
- The X app must register `https://www.thesocialpundit.com/auth/twitter/connect/callback`.
- Redis Cloud has TLS off, `volatile-lru` eviction and no persistence. Bull
  needs `noeviction`.
- Local development and production share one Gemini API key. Gemini's
  free-tier quota is per Google Cloud project.
