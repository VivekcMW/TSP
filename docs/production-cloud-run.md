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

The production database was fully migrated on 2026-09-23 (38 files, 0 pending).
Run migrations with the migration tool against the direct (non-pooler)
endpoint, with an explicit `:5432` and only `sslmode=require` in the URL. The
tool rejects other parameters and needs a session-level connection:

```bash
OWNER_DATABASE_URL='postgresql://neondb_owner:<password>@ep-quiet-field-azkwtx6k.c-3.ap-southeast-1.aws.neon.tech:5432/neondb?sslmode=require' \
  pnpm run db:migrate:dry
```

## Open follow-ups

- `TRUSTED_PROXY_CIDRS` is not set, so Express sees the Google front end as
  every client. Better Auth's sign-in and sign-up rate limits, and IP-keyed
  limits for signed-out requests, are therefore shared by all users.
- The app connects as `neondb_owner`, which bypasses row-level security.
  It should use the restricted `tsp_app` role.
- Redis Cloud has TLS off, `volatile-lru` eviction and no persistence. Bull
  needs `noeviction`.
- Local development and production share one Gemini API key. Gemini's
  free-tier quota is per Google Cloud project.
