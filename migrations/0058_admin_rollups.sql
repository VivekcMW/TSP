-- Count-only platform read model; collection still reads source tables under
-- tenant RLS. Never stores content, addresses, credentials or provider errors.
CREATE TABLE IF NOT EXISTS admin_tenant_rollups (
  tenant_id varchar PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  inbox_items integer NOT NULL CHECK (inbox_items >= 0),
  drafts integer NOT NULL CHECK (drafts >= 0),
  engine_runs integer NOT NULL CHECK (engine_runs >= 0),
  failed_schedules integer NOT NULL CHECK (failed_schedules >= 0),
  observed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_rollups_observed ON admin_tenant_rollups(observed_at, tenant_id);
GRANT SELECT, INSERT, UPDATE ON admin_tenant_rollups TO tsp_app;
