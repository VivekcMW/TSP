# Same-tab unfinished generation recovery

## Source contract — 2026-10-01

Create is the `/dashboard/create` workbench, not a modal-owned session.
`CreatePostProvider` is mounted above dashboard route transitions and keyed by
account plus the server-resolved tenant in `App.tsx`. Ordinary dashboard
navigation retains source inputs, selection and platform/tone versions **in
memory**. Leaving the authenticated provider, reload or sign-out does not retain
that working text. The recovery pointer below is a separate, narrower facility.

Current local mocked/browser acceptance passes in the 24-file, 1,150-test UX
run. See [adoption notes](UI_UX_IMPLEMENTATION_2026-10-01.md) for reports and
limits. The 2026-09-19 real-DB results below remain historical; they were not
rerun for this checkpoint. No current production acceptance is claimed.

Same-user tenant switches also reset **query ownership**, not only the provider
key. `account-cache.ts` gates descendants, aborts the old request lifetime,
cancels/clears query and mutation caches, and restores only accepted account and
profile state into fresh query objects. It preserves errors/timestamps so an
outage does not enable writes. Revision fencing rejects stale transitions and
late responses; unchanged tenant/session refresh does not discard the creation.
The actual-App tenant regression and 29 cache tests verify this boundary locally.

## Pointer-only reload contract

- `sessionStorage["tsp:editorial-recovery:v1"]` stores **exactly** `tenantId`,
  `userId`, `jobId`, and `requestIntent`. No source URL, article/post text,
  attachments, prompts, tokens, credentials, or generated results are persisted
  in web storage. No `localStorage` fallback.
- The authenticated Create provider waits for the account and server-resolved
  profile tenant before loading the pointer. A matching pointer reactivates the
  creation session and reads the **existing** job status/result; it does not
  force navigation from another dashboard route. Open Create to review it.
  Reload recovery never submits a POST,
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
  mounted composer while recoverable preserves the original intent/job identity.
  Transport retry retains that identity even for a terminal job; the composer
  exposes recovery for unresolved requests, not a new attempt disguised as retry.
  After terminal failure, an explicit Generate/Generate again starts new work
  and may count toward usage. Neither mounting nor restoring a pointer does so.

## Source and generation guards

`use-create-post-composer.ts` owns source transitions and operation locks, rather
than relying only on disabled buttons:

- Replacing a story, existing URL-backed creation, mode or whole creation checks
  outstanding saves/uploads/generation/batch ownership, including same-turn
  requests and uncertain admission/cancellation. Resolve the owned request
  before replacement; changing source is not an implicit DELETE or replay.
- Existing cards, selected stories or relevant source inputs require explicit
  discard confirmation. Cancelling that prompt preserves the creation. Editing
  a fresh pasted URL does not prompt on every keystroke; replacing URL-backed
  work does. Ordinary Idea source editing retains existing version state rather
  than silently creating a new saved revision.
- Start new resets source/cards/selections only after its guard/confirmation;
  already saved drafts remain in Content. Incoming story navigation links seed
  fresh sessions only and are consumed from history, never overwrite work.
- Article batches select at most four platforms and execute sequentially.
  Reservations protect the active sequence; completed, unlocked cards remain
  usable. Stop after current retains completed cards. Continue starts only the
  original batch's unattempted targets with matching source/tone/format, not
  completed or failed cards. Failed cards require an explicit new attempt.
- Regenerating edited versions requires confirmation. Failed, empty or malformed
  results retain prior usable text; late responses are fenced by source/scope
  and operation ownership. No silent overwrite, autosave or automatic replay.
- `beforeunload` warns for dirty/busy/recoverable work, but is not persistence.
  Closing Create has a separate warning; route navigation alone is not closing
  or resetting the persistent provider.

## Saved revisions: CAS and explicit reconciliation

This is separate from job recovery. Source of truth:
`shared/draft-revision.ts`, `server/routes/drafts.ts`, `server/storage.ts`, the
composer, and Content's editor in `client/src/pages/drafts.tsx`.

1. A first explicit save POSTs a draft; later saves PATCH that exact saved ID
   with `content`, **`expectedContent` and `expectedUpdatedAt`**. Preconditions
   describe the last acknowledged server row, not the current local edit.
   Baseline content is not trimmed; a legacy timestamp `null` is a real
   precondition, not omission. New submitted content is normalized by the server;
   the validated response supplies the canonical saved text/revision.
2. Storage compares content and timestamp under the scoped draft row lock. A
   stale baseline produces HTTP 409 `draft_conflict`, not last-write-wins.
   Publishing immutability is a separate HTTP 409 `draft_immutable`.
   Content edits without both preconditions are invalid requests.
3. Create re-entry and returning to a visible tab trigger fresh saved-version
   reads when no owning operation blocks them. Explicit Check latest draft in
   either editor uses GET `/api/drafts/:id/editing-snapshot` with `no-store` and
   validates ID/platform/tone. Neither list invalidation nor cached data is proof
   of a current saved revision. Reads never silently replace working text or
   adopt a changed baseline, even when local and remote text happen to match.
4. A conflict shows the acknowledged baseline, latest saved text/revision and
   local working text. The choices have distinct effects:

   | Choice | Effect |
   |---|---|
   | Load latest | Explicitly adopts remote text/baseline; confirms discarding differing local edits where necessary; no write |
   | Keep local text | Keeps local text and leaves the conflict unresolved; Save remains blocked |
   | Use reviewed latest as baseline | Adopts the reviewed baseline while preserving local text; Save changes is a separate action if text differs |
   | Check latest draft | Reads again; does not retry a write |

5. Checking, conflict, refresh failure, immutability or a missing baseline blocks
   saving. Failed reads/missing records retain local text and do not recreate the
   draft. Interrupted writes are unconfirmed: check Content/latest status before
   explicitly retrying, particularly after a first-save response was lost.
   A generic failed save is not automatically replayed. Another writer after
   baseline adoption can still cause a new CAS conflict.
6. "Saved" requires acknowledged text/revision state, not merely a saved ID.
   Copy/voice consent/publishing approval/scheduling are not implied. Content's
   editor separately guards dirty navigation and pending saves.

Confirmed saved versions expose `/dashboard/content?draft=<encoded-id>` and
`/dashboard/calendar?draft=<encoded-id>`. Content selects/highlights the exact
draft; Calendar opens its ready-draft confirmation or shows its existing
schedule. Independent scoped GET `/api/drafts/:id/details` uses `no-store` and
receipt-aware status projection, filtering ID before the result limit. It
therefore reaches owned drafts beyond the first 500 without broadening scope.
Neither link saves, approves or delivers. Missing/forbidden records and failed
reads have distinct recovery; neither substitutes another draft automatically.

## Limitations (intentional)

- Requires an acknowledged queued `jobId`. Reload before the admission response
  cannot recover an unknown ID; uncertain-admission same-request retry remains
  in-memory only. Do not infer an unacknowledged attempt was free.
- This is **not draft autosave**. Once delivered, text and edits are still in
  memory until explicitly saved. A second reload after delivery loses unsaved
  text. Other tone/platform versions, form fields, and the original Discover
  item association are not restored. A recovered explicit save is a standalone
  draft with the server-returned article/evidence available for review.
- Idea source is plain text and Markdown remains literal. Its full formatting
  toolbar is preserved, but font/colour/rich styling affects only the editor
  preview and is not submitted or restored on navigation. Uploaded attachments
  are separate session state, not inspected factual evidence; the pointer stores
  neither attachments nor formatting.
- Results are retained by Redis for 300 seconds after terminal completion; inputs
  have a 600-second TTL and the server enforces a persisted 300-second deadline.
  Reattaching or reopening client monitoring does not renew that deadline.
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

## Historical verification — 2026-09-19 (not current acceptance)

The following record is retained from the earlier recovery work. Artifacts were
not rerun or revalidated for UX-25; these counts and the old typecheck blocker
must not be reported as the latest final outcome.

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

### Historical re-run gates (parent authorization required)

These describe the earlier isolated fixture, not permission to reuse a database
or evidence that a current run finished. The parent must confirm the target and
current runner contract before any execution. No runner or environment changes
are part of this documentation task.

Run `node script/test-editorial-reload.mjs` from the repository root with explicit:

- `WORKFLOW_DB_TESTS=true`
- **New:** `EDITORIAL_RELOAD_BROWSER_TESTS=true`
- `TEST_DATABASE_URL=postgresql://tsp_app:localtestpass@127.0.0.1:60053/thesocialpundit_acceptance_test`
- `OWNER_TEST_DATABASE_URL=postgresql://vivekanandchoudhari@127.0.0.1:60053/thesocialpundit_acceptance_test`

The runner rejects every other database host/port/name, sanitizes the child
environment, disables config/env-file loading, uses exact test includes, and
requires a fresh successful JSON report with exactly nine cases and no skips
for that historical suite. No extra runtime feature flag was needed for that
run. The historical record reports no `.env` access, live provider/production
traffic, migration, deployment or commit. Current combined mocked/browser
acceptance is `/tmp/tsp-ux-priority-sUHyaB/tests.json` (1,150/1,150); it does not
replace this historical real-DB proof or establish fresh PostgreSQL contention
coverage. Current type/token/build checks pass; production release remains open.