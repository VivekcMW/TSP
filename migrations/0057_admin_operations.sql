-- Durable platform controls. Tenant allowances retain FORCE RLS; global
-- operational records are accessible only through audited staff routes.
CREATE TABLE IF NOT EXISTS admin_incidents (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  signal varchar NOT NULL UNIQUE,
  severity varchar NOT NULL CHECK (severity IN ('warning', 'critical')),
  state varchar NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'acknowledged', 'resolved')),
  summary varchar NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_by varchar,
  resolved_at timestamptz,
  version integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_admin_incidents_state ON admin_incidents(state, last_seen_at DESC, id);

CREATE TABLE IF NOT EXISTS admin_quota_grants (
  id varchar PRIMARY KEY,
  tenant_id varchar NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  additional integer NOT NULL CHECK (additional BETWEEN 1 AND 1000),
  created_by varchar NOT NULL REFERENCES users(id),
  reason varchar NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '30 days')
);
CREATE INDEX IF NOT EXISTS idx_admin_quota_grants_tenant ON admin_quota_grants(tenant_id, expires_at);
ALTER TABLE admin_quota_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_quota_grants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admin_quota_grants_isolation ON admin_quota_grants;
CREATE POLICY admin_quota_grants_isolation ON admin_quota_grants
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE feature_flags ADD COLUMN IF NOT EXISTS owner varchar;
ALTER TABLE feature_flags ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE feature_flags ADD COLUMN IF NOT EXISTS tenant_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE feature_flags ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;
CREATE TABLE IF NOT EXISTS admin_flag_history (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_key varchar NOT NULL,
  actor_id varchar NOT NULL REFERENCES users(id),
  reason varchar NOT NULL,
  operation varchar NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_flag_history_key ON admin_flag_history(flag_key, created_at DESC, id);

CREATE TABLE IF NOT EXISTS ai_attempt_observations (
  id varchar PRIMARY KEY,
  tenant_id varchar NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider varchar NOT NULL,
  model varchar,
  outcome varchar NOT NULL CHECK (outcome IN ('succeeded', 'failed')),
  input_tokens integer,
  output_tokens integer,
  provider_cost_usd numeric(20, 10),
  duration_ms integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (input_tokens IS NULL OR input_tokens >= 0),
  CHECK (output_tokens IS NULL OR output_tokens >= 0),
  CHECK (provider_cost_usd IS NULL OR provider_cost_usd >= 0),
  CHECK (duration_ms >= 0)
);
CREATE INDEX IF NOT EXISTS idx_ai_observations_tenant_created ON ai_attempt_observations(tenant_id, created_at);
ALTER TABLE ai_attempt_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_attempt_observations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_observations_isolation ON ai_attempt_observations;
CREATE POLICY ai_observations_isolation ON ai_attempt_observations
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE INDEX IF NOT EXISTS idx_email_deliveries_admin_created ON email_deliveries(created_at DESC, id);
CREATE INDEX IF NOT EXISTS idx_email_deliveries_admin_user ON email_deliveries(user_id, created_at DESC, id);
CREATE INDEX IF NOT EXISTS idx_email_deliveries_admin_status ON email_deliveries(status, created_at DESC, id);
GRANT SELECT, INSERT, UPDATE ON admin_incidents, admin_quota_grants TO tsp_app;
GRANT SELECT, INSERT ON admin_flag_history, ai_attempt_observations TO tsp_app;
