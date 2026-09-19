# Core-brain release handoff — 2026-09-19

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
project was linked locally. Git remote read access succeeded but does not prove
push access. A commit/push is not deployment success; verify its result separately.

1. **#27 partial:** supply an approved production-shaped isolated database copy,
   backup/restore evidence and 0022 provenance; coordinate writers and credential
   migration. Agree representative load and cost thresholds before measurement.
2. **#29 blocked:** authenticate deployment tooling, identify isolated staging
   frontend/API projects, configure credentials in the platform secret manager,
   and designate provider test accounts, merchant test plans and recipients.
   No real posts, charges or emails are authorized merely by running smoke tests.
3. **#30 authorized but blocked:** after #27/#29, record the release SHA, rollout
   window and rollback owner; validate migrations/configuration and coordinate
   API, workers and the single scheduler. Then deploy and verify the actual SHA.

Do not start schedulers or run the full local fixture suite against production.
Do not use the shared localhost dashboard as isolated acceptance evidence.
The existing deployment smoke suite has skipped flows and swallowed/unawaited
checks; it is not sufficient proof of authenticated release acceptance.

These gates require operator access/data, not additional synthetic pass counts.