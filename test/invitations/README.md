# Isolated invitation PostgreSQL verification

From the repository root, run:

`env -i PATH="$PATH" HOME="$HOME" TMPDIR="$TMPDIR" INVITATIONS_DB_TESTS=true node test/invitations/run.mjs`

Without the exact opt-in flag, the launcher skips without connecting. No Vite
or Vitest config is loaded (so env-file loading and shared setup are absent).
The child loads the actual exported store and database module through `tsx`.

Requirements: existing local PostgreSQL at **127.0.0.1:5433**, owner
`vivekanandchoudhari` with `password: ''`, permission to create/drop databases
and `SET ROLE tsp_app`, and an existing non-superuser/non-BYPASSRLS `tsp_app`.
No role creation, alteration, or membership grants are performed.

Each run creates its own random `tsp_invitation_<24 hex digits>_test` database
from template0. Only minimal users/email-deliveries fixtures and the current
`0049_friend_invitations.sql` are applied, directly using pg and readFileSync.
The postgres admin connection performs only create/drop and the exact-name
cleanup catalog check. No shared application databases are accessed.

The runtime pool authenticates explicitly as the OS owner then queues `SET ROLE
tsp_app` on every new connection before store queries. Ten distinct restricted
sessions are verified. Fixtures and timestamp adjustments use the scratch owner
connection; store SQL, quotas, dispatch guards, opt-out, and pruning are real.
No delivery function or email/provider SDK is invoked. A preloaded tripwire
denies environment-file reads, unapproved database names and non-Postgres TCP
connections. This is defense in depth, not an OS-level sandbox.

Output includes each case, aggregate counts, exact store/migration SHA-256s,
child exit, and verified database deletion. Concurrent edits to either source
invalidate the run, requiring a rerun. The email-delivery retention regression
expects pruning of friend_invitation deliveries older than 90 days; it fails
if that implementation is not yet present rather than silently skipping it.

Cleanup: the child closes its real pool and fixture client in finally; the
parent drops **only its successfully created database** in finally, including
test/import failures and SIGINT/SIGTERM of the launcher. DROP WITH (FORCE)
handles leftover child connections. SIGKILL, machine failure, or loss of the
Postgres server cannot guarantee in-process cleanup; any cleanup error reports
the exact owned database name and fails the run. Never substitute production
or another shared database when local access is unavailable.