# Production readiness checklist

Use this checklist before enabling automated publishing in production.

## Required environment

- [ ] `DATABASE_URL` uses the restricted application role.
- [ ] `OWNER_DATABASE_URL` is available only to migrations/administration jobs.
- [ ] `BETTER_AUTH_SECRET` is unique, at least 32 characters, and stored as a deploy secret.
- [ ] `WEBHOOK_ENCRYPTION_SECRET` is unique, at least 32 characters, and stored as a deploy secret. Never rotate it without a credential re-encryption migration.
- [ ] `APP_URL` and `BETTER_AUTH_URL` use the final HTTPS origin.
- [ ] `ALLOWED_ORIGINS` contains only trusted browser origins.
- [ ] `PUBLISHING_MODE=live` is set only after provider connections have been tested.

## Queue and scheduler

- [ ] Provision managed Redis and set `REDIS_URL` using TLS where available.
      Vercel's Upstash-for-Redis marketplace integration injects a prefixed
      var instead (e.g. `TSP_REDIS_REDIS_URL`) — `server/lib/env-aliases.ts`
      aliases it to `REDIS_URL` automatically, no manual copy needed.
- [ ] Set `BACKGROUND_JOBS_ENABLED=true`.
- [ ] Run exactly one scheduler worker with `CRON_SCHEDULER=true`.
- [ ] Run one or more API/worker instances with `CRON_SCHEDULER` unset.
- [ ] Confirm `/api/jobs/overview` reports an online queue.
- [ ] Add an alert for failed or overdue schedules; overdue means more than five minutes past its publish time.

## Browser tests and CI

- [ ] Add `E2E_TEST_EMAIL` and `E2E_TEST_PASSWORD` as repository secrets.
- [ ] Use an isolated verified test account with no real social connections.
- [ ] Confirm CI runs typecheck, migrations, Vitest, Playwright, and build.

## HTTPS and browser security

- [ ] Terminate TLS at the load balancer/CDN and redirect HTTP to HTTPS.
- [ ] Mark authentication cookies `Secure` in production.
- [ ] Keep the response headers enabled: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and `Permissions-Policy`.
- [ ] Add a Content-Security-Policy at the edge after enumerating trusted image, font, OAuth, and analytics origins.

## Provider go-live checks

- [ ] Reconnect each provider after production callback URLs are configured.
- [ ] Publish one disposable text post and one media post per provider.
- [ ] Confirm provider tokens/webhooks are encrypted at rest and excluded from logs.
- [ ] Rotate any credential ever exposed outside the secret manager.
