# Production Runbook

> **Retired hosting (2026-09-23):** production now runs on Cloud Run. Vercel and Render references below describe the retired setup. See [production-cloud-run.md](production-cloud-run.md).

## Required services

- Managed PostgreSQL with SSL, automated backups, point-in-time recovery, and a separate migration owner role.
- Managed Redis for Bull queues and shared rate limiting.
- One API instance (or more) running `npm start`.
- One worker-capable instance with `BACKGROUND_JOBS_ENABLED=true`.
- Exactly one scheduler instance with `CRON_SCHEDULER=true`.
- HTTPS domain with DNS, TLS renewal, and the production auth/payment callback URLs registered.

## Required environment variables

Set these in the deployment secret manager, never in the repository:

`DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `APP_URL`, `ALLOWED_ORIGINS`, `OAUTH_STATE_SECRET`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `OPENROUTER_API_KEY` or `GEMINI_API_KEY`, `REDIS_URL`, `BACKGROUND_JOBS_ENABLED=true`, `CRON_SCHEDULER=true` on one instance, `PUBLISHING_MODE=live`, and the required provider credentials.

For payments also set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET` after the merchant account and webhook endpoint are configured.

### Email sender and replies

- Set `RESEND_FROM_EMAIL=hello@thesocialpundit.com` in the existing local configuration and on every email-sending API/worker service (currently Render). An explicit environment value overrides the code default; updating `.env.example` does not update an existing environment.
- Restart local processes or redeploy the approved backend release after changing the setting. The sender is read at startup. Missing or blank values default to `hello@thesocialpundit.com`.
- Verify `thesocialpundit.com` in the Resend account used by `RESEND_API_KEY`, including its required DNS records. Changing the sender within that domain does not create an inbox.
- Create or confirm the `hello` mailbox/alias with the domain's email host so contact links and replies reach the team. Retain forwarding from the previous address if needed. Do not replace existing inbound-mail MX records just to configure outbound sending.
- After provider setup and deployment, use an explicitly authorized test recipient to verify delivery, the visible From address, and replies. Mocked unit tests do not establish provider or mailbox readiness.

## Deploy sequence

1. Provision the managed services listed above and add their secrets to the deployment secret manager.
2. Run `npm run check:production` in each release environment. Set `PROCESS_ROLE=scheduler` only on the single scheduler process; the validator then requires `CRON_SCHEDULER=true` for that process.
3. Build the artifact with `npm run build`.
4. Run `npm run db:migrate` using the migration-owner connection.
5. Verify `GET /healthz` returns 200.
6. Verify `GET /readyz` returns 200. In production with background jobs enabled, this confirms Redis is reachable and both queues initialized.
7. Start the API/worker process with `npm start`.
8. Start exactly one scheduler process with `CRON_SCHEDULER=true`.
9. Run authenticated smoke tests for sign-in, onboarding, inbox refresh, draft generation, publishing, integrations, and billing.

## Backup and restore

- Enable managed PostgreSQL daily backups, point-in-time recovery, encryption at rest, and a retention period appropriate for the business (30 days is a reasonable starting point).
- Restrict backup access to the production operations group and enable provider audit logs.
- Test a restore to an isolated database at least monthly; record restore time and the latest recoverable timestamp.
- Keep migration files and the deployed commit identifier with each backup record.
- Do not restore production data over the live database without an incident approval and rollback plan.
- Redis is operational state; PostgreSQL is the source of truth. Queued work may need replay after a Redis loss.

## Monitoring and alerts

Monitor `/healthz` for liveness and `/readyz` for database/Redis readiness. Alert when:

- `/healthz` or `/readyz` returns non-2xx for 2 consecutive checks.
- Queue backlog grows continuously for 10 minutes or failed jobs exceed 1% in 15 minutes.
- Any payment webhook signature failure occurs, or payment recording failures occur.
- API 5xx responses exceed 2% for 5 minutes.
- Database pool utilization exceeds 80% for 10 minutes.
- AI provider errors exceed 5% in 10 minutes or spend crosses the configured budget.
- RSS source failures exceed 30% in a refresh cycle.

Send alerts to an on-call channel and include the deployment version, environment, endpoint, and correlation/request ID. Do not include tokens, payment credentials, or raw personal data in alert payloads.

## Integration capability policy

- **Direct publishing**: credentials are connected and the provider adapter publishes in live mode.
- **Manual copy/paste**: the app generates platform-ready content and opens the provider, but does not publish through an API.
- **Coming soon**: the UI intentionally disables the action until the provider integration is production-ready.

The product must not describe manual or sandbox publishing as automatic publishing.