-- Phase 3 topic discovery. Additive only: three new per-member tables.
-- content_strategies: one strategy per tenant member (jsonb validated by the app's zod schema;
--   revision guards concurrent saves). experience_checkins: one weekly check-in per member and
--   week (week_start = Monday in the profile time zone). topic_idea_states: saved / dismissed /
--   drafted state per deterministic idea id, with an optional snapshot of a saved idea.
CREATE TABLE IF NOT EXISTS content_strategies (
  tenant_id varchar NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  strategy jsonb NOT NULL CONSTRAINT content_strategies_strategy_bounded
    CHECK (jsonb_typeof(strategy) = 'object' AND octet_length(strategy::text) <= 16384),
  revision integer NOT NULL DEFAULT 1 CONSTRAINT content_strategies_revision_positive CHECK (revision >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS experience_checkins (
  tenant_id varchar NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start date NOT NULL CONSTRAINT experience_checkins_monday CHECK (extract(isodow FROM week_start) = 1),
  answers jsonb NOT NULL CONSTRAINT experience_checkins_answers_bounded
    CHECK (jsonb_typeof(answers) = 'object' AND octet_length(answers::text) <= 8192),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id, week_start)
);

CREATE TABLE IF NOT EXISTS topic_idea_states (
  tenant_id varchar NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idea_id varchar(16) NOT NULL CONSTRAINT topic_idea_states_id_format CHECK (idea_id ~ '^[0-9a-f]{16}$'),
  state varchar(16) NOT NULL CONSTRAINT topic_idea_states_state CHECK (state IN ('saved', 'dismissed', 'used')),
  idea jsonb CONSTRAINT topic_idea_states_idea_bounded
    CHECK (idea IS NULL OR (jsonb_typeof(idea) = 'object' AND octet_length(idea::text) <= 4096)),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id, idea_id)
);
CREATE INDEX IF NOT EXISTS idx_topic_idea_states_recent ON topic_idea_states (tenant_id, user_id, updated_at DESC);

ALTER TABLE content_strategies ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_strategies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON content_strategies;
CREATE POLICY tenant_isolation ON content_strategies
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE experience_checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE experience_checkins FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON experience_checkins;
CREATE POLICY tenant_isolation ON experience_checkins
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE topic_idea_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE topic_idea_states FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON topic_idea_states;
CREATE POLICY tenant_isolation ON topic_idea_states
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE ON content_strategies TO tsp_app;
GRANT SELECT, INSERT, UPDATE ON experience_checkins TO tsp_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON topic_idea_states TO tsp_app;
