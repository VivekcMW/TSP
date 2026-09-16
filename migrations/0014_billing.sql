-- 0014: Tenant billing foundation for Razorpay.

BEGIN;

CREATE TABLE IF NOT EXISTS billing_plans (
  id varchar PRIMARY KEY,
  key varchar NOT NULL UNIQUE,
  name varchar NOT NULL,
  description text,
  amount integer NOT NULL,
  currency varchar NOT NULL DEFAULT 'INR',
  interval varchar NOT NULL DEFAULT 'monthly',
  razorpay_plan_id varchar,
  features jsonb DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS billing_customers (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar NOT NULL UNIQUE,
  razorpay_customer_id varchar NOT NULL UNIQUE,
  email varchar NOT NULL,
  name varchar NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar NOT NULL,
  billing_customer_id varchar NOT NULL,
  plan_id varchar NOT NULL,
  razorpay_subscription_id varchar UNIQUE,
  status varchar NOT NULL DEFAULT 'created',
  current_period_start timestamp,
  current_period_end timestamp,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  paused_at timestamp,
  ended_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant ON subscriptions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

CREATE TABLE IF NOT EXISTS payments (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar NOT NULL,
  subscription_id varchar,
  razorpay_payment_id varchar NOT NULL UNIQUE,
  razorpay_order_id varchar,
  amount integer NOT NULL,
  currency varchar NOT NULL DEFAULT 'INR',
  status varchar NOT NULL,
  method varchar,
  failure_code varchar,
  failure_description text,
  paid_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payments_tenant_created ON payments(tenant_id, created_at);

CREATE TABLE IF NOT EXISTS payment_methods (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar NOT NULL,
  razorpay_token_id varchar,
  type varchar NOT NULL,
  card_network varchar,
  last_four varchar,
  upi_vpa_masked varchar,
  is_default boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payment_methods_tenant ON payment_methods(tenant_id);

CREATE TABLE IF NOT EXISTS billing_webhook_events (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id varchar NOT NULL UNIQUE,
  event_type varchar NOT NULL,
  payload_hash varchar NOT NULL,
  processing_status varchar NOT NULL DEFAULT 'processed',
  error_message text,
  processed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);

INSERT INTO billing_plans (id, key, name, description, amount, currency, interval, features)
VALUES
  ('plan_free', 'free', 'Free', 'Explore the core publishing workflow.', 0, 'INR', 'monthly', '["10 curated articles per day", "3 AI post generations", "Draft workspace"]'::jsonb),
  ('plan_pro_monthly', 'pro_monthly', 'Pro Monthly', 'Build your professional authority consistently.', 4900, 'INR', 'monthly', '["Unlimited AI post generations", "All supported platforms", "Scheduling and publishing", "Performance insights"]'::jsonb)
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['billing_customers', 'subscriptions', 'payments', 'payment_methods'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    EXECUTE format($policy$
      CREATE POLICY tenant_isolation ON %I
        USING (tenant_id = current_setting('app.tenant_id', true))
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true))
    $policy$, table_name);
  END LOOP;
END $$;

COMMIT;
