-- Roadmap 24: parent-coordinated rollout only. NOT applied by implementation agent.
BEGIN;
CREATE TABLE IF NOT EXISTS billing_generation_operations (
  tenant_id varchar NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  operation_id varchar(36) NOT NULL,
  user_id varchar NOT NULL,
  kind varchar(32) NOT NULL,
  input_hash varchar(64) NOT NULL,
  plan_key varchar NOT NULL,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  status varchar NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (tenant_id, operation_id),
  CONSTRAINT billing_generation_period_check CHECK (period_end > period_start),
  CONSTRAINT billing_generation_status_check CHECK (status IN ('started', 'succeeded', 'failed', 'cancelled')),
  CONSTRAINT billing_generation_completion_check CHECK ((status = 'started') = (completed_at IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_billing_generation_usage ON billing_generation_operations (tenant_id, created_at);
ALTER TABLE billing_generation_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_generation_operations FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
CREATE POLICY tenant_isolation ON billing_generation_operations
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
-- No hard-coded runtime role: parent grants SELECT/INSERT/UPDATE to its restricted
-- application role using the existing role-provisioning procedure. No DELETE grant
-- is needed: these small dedupe tombstones must outlive Redis job/result TTLs.
COMMIT;