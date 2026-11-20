-- Phase 5: industry moments, watchlists and watch alerts, and three new email
-- preference toggles. Additive only.
--
-- industry_moments is global, admin-curated reference data (not tenant data).
-- Everyone may read it; inserts and updates are only accepted inside a
-- transaction that sets app.moments_admin = 'on', which only the audited
-- platform-admin routes do. Rows are archived, never deleted.
CREATE TABLE IF NOT EXISTS industry_moments (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CONSTRAINT industry_moments_title_length CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  starts_on date NOT NULL,
  ends_on date,
  region varchar(16) NOT NULL DEFAULT 'global'
    CONSTRAINT industry_moments_region_check CHECK (region IN ('global', 'US', 'UK', 'EU', 'IN', 'AU', 'CA', 'BR', 'JP')),
  tags text[] NOT NULL DEFAULT '{}' CONSTRAINT industry_moments_tags_count CHECK (cardinality(tags) <= 10),
  lead_days integer NOT NULL DEFAULT 14 CONSTRAINT industry_moments_lead_days_range CHECK (lead_days BETWEEN 1 AND 90),
  url text CONSTRAINT industry_moments_url_check CHECK (url IS NULL OR (char_length(url) <= 2048 AND url ~* '^https?://')),
  description text CONSTRAINT industry_moments_description_length CHECK (description IS NULL OR char_length(description) <= 500),
  archived boolean NOT NULL DEFAULT false,
  created_by varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT industry_moments_dates_check CHECK (ends_on IS NULL OR ends_on >= starts_on)
);
CREATE INDEX IF NOT EXISTS idx_industry_moments_window ON industry_moments (starts_on, ends_on) WHERE NOT archived;

ALTER TABLE industry_moments ENABLE ROW LEVEL SECURITY;
ALTER TABLE industry_moments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS industry_moments_read ON industry_moments;
CREATE POLICY industry_moments_read ON industry_moments FOR SELECT USING (true);
DROP POLICY IF EXISTS industry_moments_admin_insert ON industry_moments;
CREATE POLICY industry_moments_admin_insert ON industry_moments FOR INSERT
  WITH CHECK (current_setting('app.moments_admin', true) = 'on');
DROP POLICY IF EXISTS industry_moments_admin_update ON industry_moments;
CREATE POLICY industry_moments_admin_update ON industry_moments FOR UPDATE
  USING (current_setting('app.moments_admin', true) = 'on')
  WITH CHECK (current_setting('app.moments_admin', true) = 'on');
GRANT SELECT, INSERT, UPDATE ON industry_moments TO tsp_app;
-- Default privileges may also grant DELETE/TRUNCATE; archived rows are kept instead.
REVOKE DELETE, TRUNCATE ON industry_moments FROM tsp_app;

-- Which profile companies, people and topics one tenant member watches.
CREATE TABLE IF NOT EXISTS user_watchlists (
  tenant_id varchar NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  terms jsonb NOT NULL DEFAULT '[]'::jsonb
    CONSTRAINT user_watchlists_terms_check CHECK (jsonb_typeof(terms) = 'array' AND jsonb_array_length(terms) <= 30),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

-- One row per admitted story and watched term. email_slot claims a batch for
-- one idempotent alert email; emailed_at closes it.
CREATE TABLE IF NOT EXISTS watch_alerts (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  inbox_item_id varchar NOT NULL REFERENCES inbox_items(id) ON DELETE CASCADE,
  term text NOT NULL CONSTRAINT watch_alerts_term_length CHECK (char_length(term) BETWEEN 1 AND 80),
  kind varchar(16) NOT NULL CONSTRAINT watch_alerts_kind_check CHECK (kind IN ('company', 'person', 'topic')),
  created_at timestamptz NOT NULL DEFAULT now(),
  seen_at timestamptz,
  email_slot varchar(16),
  emailed_at timestamptz,
  CONSTRAINT uniq_watch_alerts_item_term UNIQUE (tenant_id, user_id, inbox_item_id, term)
);
CREATE INDEX IF NOT EXISTS idx_watch_alerts_user_created ON watch_alerts (tenant_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_watch_alerts_unemailed ON watch_alerts (tenant_id, user_id, created_at)
  WHERE seen_at IS NULL AND emailed_at IS NULL;

ALTER TABLE user_watchlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_watchlists FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON user_watchlists;
CREATE POLICY tenant_isolation ON user_watchlists
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE watch_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE watch_alerts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON watch_alerts;
CREATE POLICY tenant_isolation ON watch_alerts
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON user_watchlists, watch_alerts TO tsp_app;

-- New optional email categories. People who unsubscribed from everything stay off.
ALTER TABLE email_preferences ADD COLUMN IF NOT EXISTS monday_plan boolean NOT NULL DEFAULT true;
ALTER TABLE email_preferences ADD COLUMN IF NOT EXISTS top_picks_weekly boolean NOT NULL DEFAULT false;
ALTER TABLE email_preferences ADD COLUMN IF NOT EXISTS watchlist_alerts boolean NOT NULL DEFAULT true;
UPDATE email_preferences SET monday_plan = false, watchlist_alerts = false
  WHERE unsubscribed_at IS NOT NULL AND (monday_plan OR watchlist_alerts);
