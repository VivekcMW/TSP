# Recommended next steps — execution record

Date: 2026-10-10

## Completed

- UI consistency audit committed as `7e38e00`.
- Cross-browser consistency is wired into CI with retained HTML, JSON, trace,
  and screenshot artifacts.
- The consistency matrix covers 25 public/auth/preference routes, 6 workspace
  routes, and 8 role-protected admin routes in Chromium, Firefox, and WebKit at
  320px, 375px, 768px, and 1440px.
- Admin coverage uses read-only browser fixtures. It does not elevate the
  development user or weaken server authorization.
- Non-landing public routes use lazy route boundaries. The application entry
  chunk decreased from 591.81 kB to 491.33 kB minified
  (171.23 kB to 145.01 kB gzip).
- The complete Vitest suite passed: 5,918 passed, 77 skipped.
- The standard Playwright suite passed: 29 passed, 14 explicitly gated.
- The expanded consistency suite passed: 117 passed.
- TypeScript, design-token drift, production build, and whitespace checks pass.
- Offline migration preflight passed for all 51 migration files.
- Local `/healthz` and `/readyz` pass; database and Redis report healthy.

## Controlled live acceptance

`.github/workflows/live-acceptance.yml` provides a manually approved
`workflow_dispatch` job against an explicit HTTPS candidate origin. It always
runs authenticated route acceptance and exposes separate opt-ins for:

- draft/media/scheduling/cancellation workflows
- billed live AI generation

The workflow uses the protected `live-acceptance` GitHub environment and an
isolated test account. Paid/provider operations never run on ordinary pull
requests.

## External prerequisites still required

The local shell does not have these values, so the corresponding live checks
were not represented as passed:

- `E2E_TEST_EMAIL`
- `E2E_TEST_PASSWORD`
- `E2E_BLUESKY_HANDLE`
- `E2E_BLUESKY_APP_PASSWORD`
- an explicit candidate `E2E_BASE_URL`
- production secrets required by `pnpm check:production`

Production environment validation correctly fails closed when those values are
absent. A production migration ledger check, database restore rehearsal,
provider posting, billed AI generation, email delivery, payment checkout, and
Cloud Run traffic movement require the appropriate protected infrastructure
access and cannot be truthfully completed from this local shell.

## Production execution sequence

1. Create or select a no-traffic Cloud Run candidate revision with workers and
   scheduler disabled.
2. Run `pnpm check:production` in the protected deployment environment.
3. Verify a current recoverable backup and rehearse restore into an isolated
   database.
4. Run the migration tool with `--dry` against the direct owner endpoint,
   review pending files, apply them, and verify zero pending.
5. Add the candidate origin to a candidate-only allowlist and run deployment
   smoke plus the manually approved live-acceptance workflow.
6. Move traffic only after the exact candidate revision passes.
7. Restore workers in the final revision, verify queue/scheduler health, and
   retain the previous revision for rollback.
