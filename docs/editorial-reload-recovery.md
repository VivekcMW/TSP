# Same-tab unfinished generation recovery

## Contract

- `sessionStorage["tsp:editorial-recovery:v1"]` stores **exactly** `tenantId`,
  `userId`, `jobId`, and `requestIntent`. No source URL, article/post text,
  attachments, prompts, tokens, credentials, or generated results are persisted
  in web storage. No `localStorage` fallback.
- The authenticated Create provider waits for the account and server-resolved
  profile tenant before loading the pointer. A matching pointer reopens Create
  and reads the **existing** job status/result. Recovery never submits a POST,
  re-enqueues work, invents a new intent, or calls a provider directly.
- Lifecycle unmount detaches monitoring rather than cancelling the admitted
  server job. Explicit Cancel still uses DELETE. A cancellation is confirmed only
  by `status: "cancelled"`, not merely an HTTP 200; queued/active/unknown responses
  and network failures remain unconfirmed. Completion winning the cancellation
  race is reported as finished, not cancelled, and retains the pointer until
  the result is retrieved. An already-reserved attempt can
  remain consumed; the UI does not promise a refund.
- Logout clears the pointer before the sign-out request, including failed logout.
  External account changes and tenant mismatch clear it as well. Storage is
  untrusted: strict shape/ID checks are convenience guards, **not authorization**.
  The existing server ownership checks on status/result/DELETE still require both
  authenticated user and tenant; copying/forging a job ID grants no access.
- Terminal delivery/failure/cancellation/expiry clears the stored pointer.
  Transient polling failures retain it and offer same-job retry. Retrying in the
  mounted composer preserves the prior agent's original intent/job identity,
  including terminal failure/cancellation. Only explicit Generate begins new work.

## Limitations (intentional)

- Requires an acknowledged queued `jobId`. Reload before the admission response
  cannot recover an unknown ID; uncertain-admission same-request retry remains
  in-memory only. Do not infer an unacknowledged attempt was free.
- This is **not draft autosave**. Once delivered, text and edits are still in
  memory until explicitly saved. A second reload after delivery loses unsaved
  text. Other tone/platform versions, form fields, and the original Discover
  item association are not restored. A recovered explicit save is a standalone
  draft with the server-returned article/evidence available for review.
- Results are retained by Redis for 300 seconds after terminal completion; inputs
  have a 600-second TTL and the server enforces its existing 300-second deadline.
  Loss/expiry of either record or result reports **expired or unavailable**,
  warns that the prior attempt may have been charged, and never regenerates.
  The durable operation ledger records consumed outcomes, not recoverable text.
- Storage denial/quota exhaustion leaves ordinary in-memory generation working
  but disables reload recovery. Session storage is normally tab-lifetime; browser
  session restore/duplicate-tab behavior varies. A copied pointer can only read
  the same owned job, not create another operation. No cross-device recovery.
- Recovery monitoring has a bounded window; another explicit same-job retry can
  read authoritative server status even after an earlier client timer expired.
  Worker/process crash recovery is a separate workstream, not claimed here.

## Verification — 2026-09-19

- Focused pure/storage/transport and mocked Chromium controls: **3 files, 61
  passed, 0 failed, 0 skipped** (`/tmp/tsp-editorial-reload-controls-final2.json`).
- Real original React App + Better Auth + Express + restricted PostgreSQL +
  private Redis/Bull + durable quota ledger: **1 file, 9 passed, 0 failed,
  0 skipped** (`test-results/editorial-reload-browser.json`,
  `/tmp/tsp-editorial-reload-browser-verified.log`).
- Covers queued and active/reserved reload, already-completed retained delivery,
  deleted Redis result/record, waiting versus reserved cancellation, foreign
  forged pointers, account change, real UI logout, and explicit recovered save.
  Assertions correlate job/intent/ledger IDs and provider-call counts and reject
  additional admission POSTs. Waiting cancellation consumes zero; reserved
  cancellation consumes once. No implicit draft save or publication.
- Actual project `tsc --noEmit --incremental false` was run and is **blocked** by
  pre-existing/concurrently edited `server/routes/billing.ts:140`, TS1005 (`try`
  expected, stray trailing `catch`). That unrelated file was left untouched.
  Evidence: `/tmp/tsp-editorial-reload-final-audit.txt`; scoped tracked-file
  `git diff --check` passed. This is not a passing project-wide typecheck claim.

The new suite/runner are `test/editorial-reload.browser.test.ts` and
`script/test-editorial-reload.mjs`. They reuse `test/workflow/fixture.ts`,
`boundaries.ts`, and `browser-transport.ts` **without modifying those files**.
Only external crawler/AI/email/publisher boundaries are mocked. No API response
fulfillment, fake auth, query-cache injection, repository mocks, or queue mocks.
The browser loss cases deliberately disconnect Chromium and delete only exact
job keys in the fixture-owned private Redis. Actors use unique fixture IDs;
cleanup never truncates shared tables or stops the retained PostgreSQL cluster.

### Re-run gates

Run `node script/test-editorial-reload.mjs` from the repository root with explicit:

- `WORKFLOW_DB_TESTS=true`
- **New:** `EDITORIAL_RELOAD_BROWSER_TESTS=true`
- `TEST_DATABASE_URL=postgresql://tsp_app:localtestpass@127.0.0.1:60053/thesocialpundit_acceptance_test`
- `OWNER_TEST_DATABASE_URL=postgresql://vivekanandchoudhari@127.0.0.1:60053/thesocialpundit_acceptance_test`

The runner rejects every other database host/port/name, sanitizes the child
environment, disables config/env-file loading, uses exact test includes, and
requires a fresh successful JSON report with exactly nine cases and no skips.
No extra runtime feature flag is needed. No `.env` was read or changed, no live
provider/production traffic, migration, deployment, or commit was performed.