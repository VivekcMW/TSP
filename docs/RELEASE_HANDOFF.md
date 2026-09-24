# Core-brain release handoff — 2026-09-19

> **Retired hosting (2026-09-23):** production now runs on Cloud Run. Vercel and Render references below describe the retired setup. See [production-cloud-run.md](production-cloud-run.md).

The user has now authorized committing, pushing, deploying and testing the fixes.
This supersedes earlier statements that deployment approval was not requested;
it does **not** supply missing infrastructure access or migration evidence.

## Release preparation

- Target repository: existing `tsp` remote, `VivekcMW/TSP`, matching prior
  deployment records. Separate branch: `release/core-brain-2026-09-19`.
  Existing `main` and `feat/enterprise-foundation` are not rollout targets yet.
- Vercel automatic deployments are disabled for this exact release branch.
  Existing rewrites target the production Render API, so an automatically built
  preview must not be mistaken for isolated staging. Other branches are unchanged.
- npm lockfile now includes the declared S3 SDK dependency. Both added dependency
  specifiers match the manifest; the pnpm lockfile is also included.
- Historical SQL files are unchanged. Fifteen new migrations require the
  approved migration/backfill process before releasing the new runtime.
  The production ledger audit below also finds historical 0022 unrecorded,
  making sixteen files pending according to that ledger.
- Root environment files, uploads, generated reports and local artifacts are
  excluded. Root `.env` was not read. Generated coverage/browser reports are ignored.

## Verification before commit

- `/tmp/tsp-offline-build-JlxatZ/summary.json`: 33 standalone tests passed,
  zero failures/skips/cancellations/todos.
- `/tmp/tsp-offline-build-ngVdsV/summary.json`: build, design, project and migrator
  TypeScript checks passed; 35 scratch artifacts, four recognized **denied** tsx
  IPC attempts and no unexpected violations. Watched inputs unchanged.
- The earlier 3,976-test isolated application acceptance is recorded in
  `LOCAL_ROADMAP_ACCEPTANCE.md`; it was not rerun against production.
- Existing billing EOF whitespace warning remains. It is not a runtime error;
  repeated editor patch attempts did not remove it. No terminal file rewrite was used.

## Deployment and remaining roadmap gates

At preparation time, GitHub CLI and Vercel CLI were unauthenticated; no Vercel
project was linked locally. Git authentication did work: commit
`185d0157ffbe98528c4e01f0cca0a992762fa864` was pushed to the release branch,
and its remote SHA was independently verified. No production branch was updated.
A commit/push is not deployment success.

## Authenticated hosting audit — September 19

- Both Vercel and Render project access are restored. Browser authentication
  does not establish CLI authentication. Release branch local HEAD and remote
  `tsp` both match `a5abd15a77c708a691a9437d7b4d99493f6819af`; the worktree
  was clean before this documentation update.
- Current Vercel production is **Ready** and Render is **Live**, both showing
  `598351c` from `feat/enterprise-foundation`. The remote branch resolves to
  `598351cdee5e4b33e32cb5a31bcd14f6cbd056ff`. The supplied September 17 links
  identify older successful `d461449` deployments, not the current release.
- Render TSP (`srv-dal6nae7bikc73eit630`) uses
  `npm install --include=dev && npm run build`, then `npm run start`.
  Its pre-deploy command is empty and auto-deploy is **On Commit**. Do not
  push the new runtime to its production branch before completing migrations.
- The inspected Render workspace contains the ungrouped TSP web service and
  `tsp-redis` in the project's Production environment; no isolated staging
  resource was identified there.
- Vercel lists Neon `neon-amber-queen` and Upstash
  `upstash-kv-yellow-lantern`, each connected to **Preview and Production**.
  This is not evidence of an isolated preview database. The user subsequently
  confirmed Render uses this same database; no connection secret was inspected
  to independently compare endpoints.
- The initial external Vercel-to-Neon sign-in handoff required email verification.
  **This is not a blocker for embedded SQL access:** Vercel's own Query editor
  successfully connects to `neondb` as `neondb_owner`, PostgreSQL 18.6, with
  read-only transactions. A separate Neon login is unnecessary for this audit.
  Backup/branch/restore controls were not found in the inspected embedded
  resource settings, and no backup or recovery procedure has been verified.
- Fresh anonymous GET-only smoke checks passed **9/9**, zero failures/skips,
  in 7.9 seconds at `2026-09-19T18:00:46Z`. Report:
  `/var/folders/p7/7tzcz0851_dc7jgmg7ndmtp00000gn/T/tmp.VRTdpCDKVR/report.json`.
  This checks the existing deployment, not the new release branch.
- No production configuration, database, provider or deployment writes were
  performed. No paid resources were provisioned. Requests for copy scope and
  staging budget received an unavailable-user response, not specific target
  or spending instructions.

## Production migration audit — September 19, 18:09–18:11 UTC

See [the migration audit](PRODUCTION_MIGRATION_AUDIT_2026-09-19.md).
The 22 recorded migrations (0000–0021) all match release checksums. Sixteen
files are unrecorded, including 0022, whose three columns and two indexes already
exist. This establishes unrecorded schema state, not proof of a fully applied
migration. Read-only grants inspection confirms write privileges are available;
no write test or migration was executed. Current keyword shape counts do not
show mixed arrays, but three profiles would be updated by 0022.

The user explicitly reconfirmed production rollout authorization. The decision
is to hold execution pending a recoverable backup, copied-data rehearsal and
coordinated writer shutdown, not to request generic deployment approval again.
No fake ledger entry, edited historical migration or ad-hoc production repair
is an acceptable substitute. The audit was made against documentation commit
`4ca42d113575edbb8fd7f4f1057251cabd49cd80`, whose runtime remains the a5abd15 release.

## Read-only smoke follow-up

The old deployment suite's unawaited steps, swallowed failures and skipped
placeholder journey were replaced with nine explicit anonymous GET checks.
`playwright.deployment.config.ts` requires both `E2E_BASE_URL` and
`E2E_API_BASE_URL`, accepts HTTPS origins (HTTP only on loopback), and starts no
local server. It loads no dotenv or authentication state, follows no redirects,
and performs no retries. Requests time out after five seconds. Default discovery
without this dedicated configuration explicitly skips rather than passing.

Run Playwright with `--config=playwright.deployment.config.ts` and the two explicit
origins in a clean environment. No test credentials are required. Run the local
negative controls separately with `node --test test/deployment-smoke/controls.test.mjs`.

- **24/24 controls passed**, recorded in `/tmp/tsp-smoke-final.lmV5pF/controls.log`.
  These verify healthy results, 503/error readiness, HTML fallback, unauthorized
  endpoint 200/404, redirects, timeouts, invalid/missing origins and no-opt-in
  skips. All mock traffic is loopback-only; cookies are not reused between checks.
- **9/9 public checks passed** against the previous deployment (since retired):
  direct/proxied health/readiness, sign-in HTML and 401/403 responses for anonymous
  draft/integration access. CLI exit 0, duration 6.4 seconds; output directory
  `/tmp/tsp-release-http-smoke-185d015`. This was not a deployment of this branch.
- An earlier shell attempt never launched Playwright because its `PATH` could
  not resolve `env`; the empty report is not evidence. The successful run used
  absolute executable paths. Its stray wrong-remote lookup was stopped.

These tests do not verify authenticated workflows, browser rendering, providers,
load/cost, queue execution or the deployed SHA. They do not close #29 or #30.

## Outstanding operator gates

1. **#27 partial:** supply an approved production-shaped isolated database copy,
   backup/restore evidence and 0022 provenance; coordinate writers and credential
   migration. Agree representative load and cost thresholds before measurement.
2. **#29 blocked:** hosting and Vercel-native SQL access work. Establish
  isolated staging frontend/API/database/Redis resources and verified recovery
  access. Configure any required deployment tooling and credentials in the platform secret manager,
   and designate provider test accounts, merchant test plans and recipients.
   No real posts, charges or emails are authorized merely by running smoke tests.
3. **#30 authorized but blocked:** after #27/#29, record the release SHA, rollout
   window and rollback owner; validate migrations/configuration and coordinate
   API, workers and the single scheduler. Then deploy and verify the actual SHA.

Do not start schedulers or run the full local fixture suite against production.
Do not use the shared localhost dashboard as isolated acceptance evidence.

These gates require operator access/data, not additional synthetic pass counts.