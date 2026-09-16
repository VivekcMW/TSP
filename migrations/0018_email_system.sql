CREATE TABLE IF NOT EXISTS email_preferences (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL UNIQUE,
  marketing boolean NOT NULL DEFAULT true,
  product_updates boolean NOT NULL DEFAULT true,
  daily_digest boolean NOT NULL DEFAULT true,
  content_alerts boolean NOT NULL DEFAULT true,
  unsubscribed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_deliveries (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar,
  recipient varchar NOT NULL,
  type varchar NOT NULL,
  dedupe_key varchar UNIQUE,
  status varchar NOT NULL DEFAULT 'pending',
  provider_message_id varchar,
  error_message text,
  sent_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_deliveries_user ON email_deliveries(user_id);
CREATE INDEX IF NOT EXISTS idx_email_deliveries_type_status ON email_deliveries(type, status);