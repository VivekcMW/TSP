# Friend invitations

Settings → Invite friends (`/dashboard/settings?tab=invitations`) sends one
invitation after an explicit click. Email is required; first name is optional
(“Hi there” fallback). Permission confirmation is required. Preview uses the
same server-owned content as delivery. There is no contact import, reminder,
newsletter enrollment, referral reward, workspace membership, or automatic payment.

## Enablement

Sending defaults ON when the required email/auth URL configuration is present.
Before rollout on the API and email worker:

1. Apply `0049_friend_invitations.sql` with the existing migration-owner workflow
   (`pnpm db:migrate`) against the intended database after normal backup/review.
   Never use `db:push`. This change does not apply migrations to development or
   production automatically.
2. Configure an explicit canonical `APP_URL` (HTTPS in production),
   `BETTER_AUTH_SECRET` (at least 32 characters), `RESEND_API_KEY`, and a verified
   `RESEND_FROM_EMAIL` sending domain. Existing `.env` is left unchanged.
3. Review the sender identity, provider permissions, and consent/legal requirements
   for one-off friend invitations in the countries served. The checkbox alone is
   not a substitute for that review. Add any required business-address disclosure.
4. Leave `INVITATIONS_ENABLED` unset or set it to `true`. Production senders must
   have verified accounts. Local development bypass is accepted only when
   `NODE_ENV=development`, the canonical origin and direct TCP peer are loopback,
   and no forwarding headers are present. Do not expose a bypass server through
   a tunnel or reverse proxy. Set
   `INVITATIONS_ENABLED=false` as an emergency kill switch; preview remains available.
5. Restart the backend. For queued delivery, configure `REDIS_URL` and
   `EMAIL_QUEUE_ENABLED=true` and ensure the existing email worker is running.
   Without the optional email queue the same delivery service sends synchronously.
6. Verify delivery with an explicitly approved test recipient before release.
   This implementation's tests use mocks and isolated databases, not live emails.

## Content and pricing

`server/services/invitation-content.ts` owns the preview and HTML/plain-text copy.
It follows the supplied invitation structure but describes only supported
capabilities: content for 20+ networks, direct publishing where supported,
explicitly approved voice samples, and calendar-based planning.

The proposed $20/month lifetime founding offer, $79 comparison price, first-100
scarcity, 14-day card-required trial, and Autopilot promise are **not activated**.
The current invitation instead links to signup/free plan and current subscription
options. Before adding the offer, implement/verify the billing plan, trial and
cancellation behavior, concurrent seat allocation, currency treatment, and whether
cancellation forfeits the lifetime price. Do not turn on scarcity with a static
counter or imply all supported networks permit automatic publishing.

## API and delivery semantics

- `GET /api/invitations/template`: authenticated plain-text preview and availability.
- `POST /api/invitations`: authenticated, verified account, same-origin request;
  strict body `{email, firstName?, consent: true, requestId: UUID}`. The sender and
  link origin cannot be supplied by the caller.
- Success: generic HTTP 202 for eligible, duplicate, or suppressed requests; this
  means accepted for processing, **not inbox delivery**. No recipient-membership
  status is returned. 400 validation, 403 auth/origin, 409 changed idempotent request,
  429 quota, 503 configuration/storage/transport failure.
- `POST /api/public/invitations/unsubscribe`: `{token}` without login. An email's
  fragment token is removed from browser history after capture. Merely visiting
  the link does not opt out; a recipient must confirm. Repeated confirmation is
  idempotent. No account is created and no recipient data is returned.
- Signup URLs contain no email or auth token; they never create membership in
  the inviter's workspace. The opt-out token cannot authenticate or subscribe.

Delivery uses the existing durable `email_deliveries` identity and lease policy.
Invitations are NOT essential mail and cannot inherit the inviter's marketing
preferences. A matching reservation and recipient opt-out check are required at
enqueue and before provider dispatch. Provider acceptance is recorded as `sent`;
transport timeouts/missing receipts are `unknown` and cannot be blindly replayed.
Request retries retain the same identity and token. A changed IP/name/auth-secret
can cause a retry conflict; never invent a new request to replay an unknown send.

## Limits, privacy, and retention

PostgreSQL transaction/advisory lock enforces across all app instances:
- 5 reservations per inviter in a rolling 24 hours.
- 20 per HMAC-hashed IP/subnet per UTC day.
- 200 total per UTC day.
- 7-day normalized-recipient cooldown across all inviters.
- Existing accounts and globally opted-out recipients are suppressed.

Additional request limits use the existing Redis-backed limiter (memory in local
development). Both valid and invalid attempts are request-throttled. Quotas count
reservations even when delivery fails; retries do not spend a second slot.

These are private service-managed global tables (like newsletter subscriptions),
not tenant-shared invitation lists. Global cooldowns/unauthenticated opt-out need
cross-inviter access; there is no public listing API or arbitrary table API.
Only trusted server code queries them; inviter receipts are scoped by session ID.
Database privileges prohibit runtime UPDATE and suppression DELETE/TRUNCATE.

Names/email/reservations and corresponding invitation delivery records are pruned
after 90 days by hourly backend maintenance. Queued job retention remains the
existing email queue's 1-day success/7-day failure retention. Opt-out hashes persist
independently so deleting an account or old invitation cannot re-enable email.
An old link becomes invalid when its reservation is pruned; already recorded
opt-outs remain effective. Hashes are pseudonymous data, not anonymous data.
Never log raw addresses, IPs, opt-out tokens, or recipient suppression reasons.

## Verification

Focused mocked API/email/Chromium regression suite (no shared DB setup):
`env -i PATH="$PATH" HOME="$HOME" TMPDIR="$TMPDIR" node node_modules/vitest/vitest.mjs run --config test/invitations/vitest.config.ts`

Real disposable PostgreSQL concurrency, grants, cleanup and SQL checks:
`env -i PATH="$PATH" HOME="$HOME" TMPDIR="$TMPDIR" INVITATIONS_DB_TESTS=true node test/invitations/run.mjs`

See `test/invitations/README.md` for scratch-database safety. `pnpm check` checks
TypeScript. Migration 0049 was also applied to local `thesocialpundit_dev` on
port 5433 on 2026-09-30. No production migration or deployment was performed,
and no live invitation email was sent during verification.