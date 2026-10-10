# Local roadmap acceptance

Status as of 2026-09-19. This records recovered, saved combined-run evidence,
not production acceptance or approval to deploy. **27 items locally complete,
one partial and two blocked; not all 30 complete.** The original four-step
onboarding and established Settings interface are retained.

## Roadmap status

| Items | Status | Acceptance boundary |
| --- | --- | --- |
| 1–26 | Local implementation verified | Combined local evidence below; not proof of staging or production readiness. |
| 27 | Partial | Fresh migrations, security/concurrency and synthetic resource checks passed. Production-shaped legacy migration/backfill rehearsal and agreed representative load/cost acceptance remain. Final runner caveats are disclosed below. |
| 28 | Locally verified | Authenticated composed workflows, actual Chromium journeys, controlled worker SIGKILL/Bull recovery and same-tab reload reattachment. External boundaries mocked; infrastructure disaster recovery excluded. |
| 29–30 | Blocked | No staging environment or rollout approval is available. |

## Final combined local verification

Evidence prefix: `/tmp/tsp-acceptance.2e4C5P/final-all-1789783547962`.
The `-vitest.json` and `-summary.json` are authoritative; earlier per-feature
results overlap and must not be added to this total.

- **165 files / 3,976 passed / 0 failed / 0 skipped**, suite exit 0.
- All nine DB/workflow/browser/crash/reload opt-in gates enabled; serial files,
  one worker, explicit restricted-runtime and owner connections to the isolated
  `127.0.0.1:60053/thesocialpundit_acceptance_test` database.
- Project and standalone migrator TypeScript, production build and design checks
  each exited 0. Historical tracked SQL diff empty.
- Earlier fresh-chain rehearsal passed **38 migrations**, including unchanged
  0022 and corrective 0038. Final postcheck reverified the unchanged ledger and
  checksums; no workflow actors/connections or spawned fixture children remained.
- The process-crash cases deliberately terminate child workers; those kills
  were successful test actions, not crashed acceptance runs.

**Do not describe the aggregate runner as all green:** its whitespace check
still reports `server/routes/billing.ts:140: new blank line at EOF` (exit 2).
Four socket attempts were also blocked after the suite, during build/design.
Installed `tsx` initializes a parent IPC pipe that this guard disallows, which
strongly explains these records; the original log captured only PID and
`socket`, not destination/stack, so exact attribution remains unconfirmed.
Connections were denied before the original socket call. No guard was relaxed
to force a pass. The earlier transient billing syntax error was restored;
the final TypeScript check passed.

### Scoped follow-up: build socket origin established

New evidence: `/tmp/tsp-ipc-diagnostic.g6tsQH6i/run-2/verification-summary.md`,
`summary.json`, `events.jsonl` and `build-outputs.json`. The corrected diagnostic
runner exited **0**. Current production build, design check, project TypeScript
and migrator TypeScript each exited **0**. The recent `package.json` changes
were preserved (before/after hashes match); no dependency or application logic
changes were made. The full 3,976-test suite was not rerun in this follow-up.

Destination, PID, thread and stack evidence identifies **six denied local IPC
attempts**: two from importing `tsx/esm` alone, two during build and two during
design checking. Each main/loader-thread pair originates in installed tsx
4.23.13 `connectToServer`, targeting exactly the computed parent pipe under
the private scratch directory. **No connection exemption was added.** All
**21 negative guard assertions passed**, with zero unexpected violations.
The private harness's initial worker-`chdir` failure was corrected and its
evidence retained. Native subprocesses are not fully covered by Node hooks;
this is not an OS-sandbox certification.

This establishes the reproducible build-tool mechanism without rewriting the
historical bare socket records as destination-level proof. Historical aggregate
failure remains recorded above. Billing EOF-only patch attempts still leave
extra final newlines; the code's `trimEnd()` SHA-256 stayed unchanged
(`78992548065b74a00d8901b46f95d1cb1999865c7e0d5f8269659e95eba0d822`), and
editor diagnostics are clear. The formatting warning remains pending an
editor cleanup or explicit permission for an EOF-only terminal edit.

### Repository-owned offline reproduction

With dependencies already installed, run `node script/verify-offline-build.mjs --self-test`
and then `node script/verify-offline-build.mjs`. The runner resolves the repository
independently of the working directory and prints a unique private evidence directory.
It does not install dependencies, start the application, run DB fixtures or contact
providers. Guarded phases receive an allowlisted environment; dotenv reads are
denied and Vite environment-file loading is disabled. For an additionally clean
entry process, launch Node from an environment without inherited loaders.

Latest evidence (separate from the 3,976 Vitest results above):

- `/tmp/tsp-offline-build-WROFWu/summary.json`: **33 standalone Node tests passed**,
  no failures, cancellations, skips or todos. Controls cover swallowed denials,
  child/worker guard inheritance, missing artifacts and missing or failing Node
  child completion evidence. Guard initialization alone cannot establish success.
- `/tmp/tsp-offline-build-ZCNwk7/summary.json`: build, design, project TypeScript
  and migrator TypeScript each exited **0**; **35 artifacts** inventoried with
  SHA-256 hashes; watched input hashes unchanged. **Four recognized tsx IPC
  attempts remained denied**, zero unexpected violations and zero incomplete
  Node child records. Existing build warnings remain in the phase logs.

Build output stays in scratch storage, not shared `dist`. The verifier reuses
the server build options and Vite configuration, overriding output destinations,
disabling environment files and using native configuration loading. Unexpected
denials fail verification even when caught by the attempted caller. The tsx
classifier matches specific installed client filenames and stacks; dependency
changes can require review rather than silently broadening the classification.

These Node hooks are **not an OS sandbox**: native esbuild/addons, symlink
aliases, inherited descriptors and unpatched internals are not fully covered.
Native esbuild exit callbacks can be unobserved; phase exits and artifact checks
establish compilation only. Editor analyzer assertion-recognition warnings in
the Node tests and a temporary-directory review notice were reviewed: the tests
contain explicit assertions and evidence directories are created privately with
mode 0700. Neither these checks nor this reproduction close roadmap item 27,
verify staging or approve deployment. Historical aggregate caveats above remain.

See `isolated-acceptance.md`, `workflow-acceptance.md`,
`editorial-reload-recovery.md` and `workflow-budgets.md` for reproducibility and
limits. Local resource/call ceilings are not production throughput or dollar
cost certification. The separate cluster was stopped after verification;
its datadir and evidence remain in the temporary directory above.

## Configuration and database boundaries

- The environment example contains placeholders only; it is not evidence of
  configured external services. The actual root `.env` was left untouched.
  No environment files were read or edited for this update.
- The shared test database's `0022` migration gap remains unmodified.
- Pending development and production migrations remain unapplied; local
  fresh-database verification must not be treated as acceptance for those databases.
- The security credentials backfill has not been applied.
- Paid recurring billing configuration, S3/R2 storage, Resend email, OAuth, and
  staging configuration and verification are still required.

## Deployment gate — do not deploy

**Do not deploy until a legacy-data migration/backfill rehearsal has succeeded
and all affected writers and their owners have been coordinated.** The rehearsal
must cover the existing migration history, credential backfill, data correctness,
and recovery/rollback procedures rather than only an empty database.

Before any rollout, finish item 27, reconcile migration gaps and pending
migrations through an approved process, configure and verify the required external
services in staging, and obtain explicit rollout approval for items 29–30.

| Gate | Required operator input | Evidence needed to close |
| --- | --- | --- |
| #27 legacy rehearsal | Approved isolated production-shaped copy, backup/restore access and migration provenance | Reconciled 0022 history without fabricated ledger entries; migration/backfill results and recovery verification with coordinated writers |
| #27 load/cost acceptance | Representative workload, concurrency/latency targets and approved spend limits | Measured results against agreed thresholds; provider usage/cost evidence, not synthetic call counts alone |
| #29 staging | Designated staging URLs, test accounts, OAuth permissions, merchant plans/webhooks, private bucket and approved email recipients | Controlled real-service success/failure evidence; no public posting or charges without explicit scope |
| #30 deployment | Explicit approval, release revision, rollout window and rollback owner | Verified release/build, migrations, health/auth/workflow checks and recorded rollback procedure |

The later user request authorizes committing, pushing, deploying and testing;
see `RELEASE_HANDOFF.md` for release preparation and remaining access/data gates.
This does not authorize unscoped provider posts, charges or unsafe database
changes. Production completion remains unclaimed.