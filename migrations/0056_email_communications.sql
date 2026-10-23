-- Global communication metadata, governed by audited platform-admin routes.
-- Billing outbox recipients come only from a validated persisted customer binding.
CREATE TABLE IF NOT EXISTS email_campaigns (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  content jsonb NOT NULL,
  status varchar NOT NULL DEFAULT 'draft',
  created_by varchar NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz
);
CREATE TABLE IF NOT EXISTS email_campaign_recipients (
  campaign_id varchar NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  outcome varchar,
  retry_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_email_campaign_pending
  ON email_campaign_recipients(campaign_id, retry_at, user_id) WHERE outcome IS NULL;

CREATE TABLE IF NOT EXISTS billing_email_notifications (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar NOT NULL,
  payment_id varchar NOT NULL UNIQUE,
  recipient varchar NOT NULL,
  recipient_name varchar NOT NULL,
  outcome varchar,
  retry_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_billing_email_pending
  ON billing_email_notifications(retry_at, id) WHERE outcome IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON email_campaigns, email_campaign_recipients, billing_email_notifications TO tsp_app;
