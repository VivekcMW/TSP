-- Triage feedback: "Not relevant" reasons, calibration votes and the feed
-- preferences learned from them. Additive only. Future refreshes skip muted
-- sources and scale keyword weights by (1 + delta); no row means no change.
CREATE TABLE IF NOT EXISTS inbox_feedback (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  inbox_item_id varchar REFERENCES inbox_items(id) ON DELETE SET NULL,
  kind varchar(20) NOT NULL CONSTRAINT inbox_feedback_kind CHECK (kind IN ('dismiss', 'calibration_up', 'calibration_down')),
  reason varchar(40) CONSTRAINT inbox_feedback_reason
    CHECK (reason IS NULL OR reason IN ('not_my_topic', 'wrong_audience', 'untrusted_source', 'old_news', 'already_covered')),
  source varchar(200),
  keywords jsonb NOT NULL DEFAULT '[]'::jsonb CONSTRAINT inbox_feedback_keywords
    CHECK (jsonb_typeof(keywords) = 'array' AND jsonb_array_length(keywords) <= 20),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inbox_feedback_tenant_user_created ON inbox_feedback (tenant_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inbox_feedback_item ON inbox_feedback (inbox_item_id) WHERE inbox_item_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS feed_preferences (
  tenant_id varchar NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  muted_sources jsonb NOT NULL DEFAULT '[]'::jsonb CONSTRAINT feed_preferences_muted_sources
    CHECK (jsonb_typeof(muted_sources) = 'array' AND jsonb_array_length(muted_sources) <= 100),
  keyword_adjustments jsonb NOT NULL DEFAULT '{}'::jsonb CONSTRAINT feed_preferences_keyword_adjustments
    CHECK (jsonb_typeof(keyword_adjustments) = 'object' AND octet_length(keyword_adjustments::text) <= 32768),
  revision integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

ALTER TABLE inbox_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbox_feedback FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON inbox_feedback;
CREATE POLICY tenant_isolation ON inbox_feedback
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE feed_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_preferences FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON feed_preferences;
CREATE POLICY tenant_isolation ON feed_preferences
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON inbox_feedback TO tsp_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON feed_preferences TO tsp_app;
