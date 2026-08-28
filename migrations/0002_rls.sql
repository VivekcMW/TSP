-- Wave 1: Row-Level Security as the second isolation layer.
--
-- Layer 1 is the tenant-scoped repository, which is mutation-tested. This is
-- the backstop for a future query that forgets the predicate.
--
-- It only works with a dedicated role. The app previously connected as a
-- superuser that also owned the tables, and superusers bypass RLS
-- unconditionally — FORCE ROW LEVEL SECURITY does not apply to them. Policies
-- written without this role change would never fire.
--
-- Verified behaviour, as tsp_app, on a query with no WHERE clause:
--   app.tenant_id = A  -> only A's rows
--   app.tenant_id = B  -> only B's rows
--   unset              -> no rows (fails closed)

BEGIN;

-- 1. the application role ---------------------------------------------------

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tsp_app') THEN
    -- Local development password. Real environments provision this role with a
    -- managed secret; the app never connects as an owner or superuser again.
    CREATE ROLE tsp_app LOGIN PASSWORD 'tsp_app_local' NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO tsp_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tsp_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO tsp_app;
-- So tables added by later migrations are reachable without another GRANT.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tsp_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO tsp_app;

-- 2. tenant isolation policies ----------------------------------------------

-- FORCE so the policy applies even when the connecting role owns the table,
-- which protects against a future deployment that reverts to an owner
-- connection string.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'user_profiles', 'inbox_items', 'drafts',
    'social_accounts', 'social_analytics', 'engine_run_logs'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($fmt$
      CREATE POLICY tenant_isolation ON %I
        USING (tenant_id = current_setting('app.tenant_id', true))
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true))
    $fmt$, t);
  END LOOP;
END $$;

-- 3. tenancy and audit tables ----------------------------------------------
--
-- tenants and tenant_members are deliberately NOT under the tenant policy:
-- resolving "which tenants may this user act in?" happens before a tenant is
-- known, so a tenant-scoped policy would make login impossible. They are
-- reached only through the tenancy service.
--
-- audit_log is append-only from the application's perspective.

REVOKE UPDATE, DELETE ON audit_log FROM tsp_app;

COMMIT;
