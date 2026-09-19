# P1 Mastodon SSRF and publishing pool handoff

## Changes

- `server/services/safeOutbound.ts` shares the crawler's DNS validation/pinning. Every request rejects any non-public DNS answer, pins the selected public address, and retains normal Host/TLS SNI/certificate validation. There is no unpinned/private fallback.
- `crawlerFetch.ts` reuses the extracted agent and preserves its existing per-hop redirect validation, budgets, queue and response limits.
- Mastodon credential verification, multipart media uploads and JSON status creation all use the pinned transport. Instance inputs must be HTTPS DNS hostnames (no IP literals, userinfo, localhost/internal/local names). Stored origins are revalidated on publishing; DNS is resolved again for each request.
- Authenticated requests reject **all redirects**, including same-origin redirects. No credential/body forwarding, automatic retries, HTTP downgrade, cookies or proxy-env routing. Responses are limited to 1 MiB by default, with a 15-second deadline covering DNS, upload and body consumption; sockets/bodies are cleaned up. Provider/transport errors are sanitized.
- `integrations.ts` edits are confined to the Mastodon URL-validation region and its helper import. Concurrent refresh work is untouched by this change.
- `assertPublishingPolicy` passes `{ transaction: tx }` to the existing entitlement API for both publish and schedule checks. No billing semantics/repository changes.

## Pool configuration

`server/db.ts` applies validated defaults at pool construction. `scripts/verify-production-env.ts` uses the same validation. Overrides must be decimal integers from 1 to the listed maximum; zero/unlimited, empty, nonfinite, fractional and malformed overrides fail closed, reporting names rather than values.

| Variable | Default | Maximum | Purpose |
| --- | ---: | ---: | --- |
| `DB_POOL_MAX` | 10 | 100 | Pool connection count |
| `DB_CONNECTION_TIMEOUT_MS` | 5000 | 30000 | pg acquisition/connection deadline |
| `DB_IDLE_TIMEOUT_MS` | 30000 | 300000 | Idle pooled-client lifetime |
| `DB_STATEMENT_TIMEOUT_MS` | 30000 | 300000 | PostgreSQL statement deadline |
| `DB_IDLE_TRANSACTION_TIMEOUT_MS` | 30000 | 300000 | PostgreSQL idle-transaction deadline |

Root `.env` exists; its contents were **not read or modified**. No additional environment variables are required because all new settings have defaults.

## Verification (2026-09-19)

Exact mocked-only selection, isolated environment, no Vite env-file loading, no setup files, explicit aliases and no database/provider connections:

| File | Passed |
| --- | ---: |
| `server/lib/db-pool-config.test.ts` | 52 |
| `server/routes/integrations.mastodon.mock.test.ts` | 15 |
| `server/services/crawlerFetch.test.ts` | 48 |
| `server/services/publishing-policy.test.ts` | 15 |
| `server/services/publishing-pool.mock.test.ts` | 3 |
| `server/services/safeOutbound.test.ts` | 32 |
| `server/services/publishers/mastodon.test.ts` | 31 |
| `server/services/publishers/publishing-safety.test.ts` | 17 |
| **Total: 8 files** | **213** |

Verified JSON report: `/tmp/tsp-p1-ssrf-verified.json` (`success: true`, zero failed tests/suites). Nonincremental TypeScript check passed. Scoped `git diff --check` passed. An intermediate isolated-run alias misconfiguration prevented four suites from loading; the corrected absolute-alias run above supersedes it.

## Deferred database regression — parent must run later

`server/publishing-pool.integration.test.ts` contains **3 unrun tests**, enabled only by `PUBLISHING_POOL_DB_TESTS=true`:

1. Two simultaneous publish policy checks, each already holding its own draft lock and connection.
2. The same for schedule policy (both authoritative entitlement checks).
3. Third acquisition times out while two clients are held; waiter removal and subsequent pool recovery are checked.

Run this file separately after the parent's schema/grant readiness checks, with explicit restricted-runtime `DATABASE_URL` pointing only to `localhost:5433/thesocialpundit_test`, and env-file loading disabled. It sets pool size 2 and acquisition timeout 1000 ms before importing the DB module, checks non-superuser/non-bypass-RLS, and requires an existing active `pro_monthly` plan plus globally enabled Mastodon integration. Fixtures are unique and transactionally rolled back; no global catalog updates, migrations or providers are invoked. A barrier proves both distinct PostgreSQL connections are occupied before policy evaluation.

No database test, migration, live Mastodon/provider call, production action, deployment or commit was performed in this task. No production-readiness claim is made until the deferred DB tests and parent integration checks pass.