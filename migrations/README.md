# Migrations

```bash
npm run db:migrate        # apply pending migrations
npm run db:migrate:dry    # show what would run, change nothing
```

Runs as `OWNER_DATABASE_URL` — migrations create roles and policies, which the
restricted application role cannot do.

## Rules

1. **Never edit an applied migration.** The migrator stores a checksum and
   refuses to run if a recorded file changed, because that means environments
   have silently diverged. Add a new file instead.
2. **Write migrations idempotently** (`IF NOT EXISTS`, `WHERE NOT EXISTS`,
   `DO $$ … EXCEPTION WHEN duplicate_object`). The databases predate this
   system, so files must be safe to apply to a schema that already has the
   change.
3. **Each file gets its own transaction.** A failure leaves nothing partial.

## Do not use `drizzle-kit push`

`push` diffs the Drizzle schema against the live database. It was observed
reporting "Changes applied" against a migration-built database and **dropping
the `tenant_isolation` RLS policies** in the process. In CI that would leave
the cross-tenant isolation tests passing against an unprotected schema, which
is the most dangerous outcome available.

`npm run db:push` therefore refuses and points here. If you genuinely want it
for local iteration, run `npx drizzle-kit push` directly and re-apply
`0002_rls.sql` afterwards.

## Files

| File | Purpose |
|---|---|
| `0000_baseline.sql` | Full table/index schema. Generated with `drizzle-kit generate`, then made idempotent. Verified byte-equivalent to a push-built schema. |
| `0001_tenancy.sql` | Introduces tenancy: tables, `tenant_id` columns, and the backfill that stamps existing rows. A no-op on a fresh database, where `0000` already has the final shape. |
| `0002_rls.sql` | The `tsp_app` role, grants, and the `tenant_isolation` policies. Drizzle cannot express any of these. |
| `0013_sync_tenant_rls_and_constraints.sql` | Adds RLS to tenant tables introduced after `0002` and enforces non-null draft publication status. |
| `0014_billing.sql` | Adds Razorpay-ready tenant billing plans, customers, subscriptions, payments, methods, and webhook idempotency records. |
| `0015_profile_social_links.sql` | Adds tenant/user-scoped public social profile URLs, separate from OAuth credentials. |

## Adding a migration

Change `shared/schema.ts`, then either write the SQL by hand or generate a diff
and adapt it:

```bash
npx drizzle-kit generate --config <temporary config pointing elsewhere>
```

Name it with the next number, make it idempotent, and verify it builds a
database from empty:

```bash
createdb scratch
OWNER_DATABASE_URL=postgresql://localhost:5433/scratch npm run db:migrate
```
