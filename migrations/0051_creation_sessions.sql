CREATE TABLE creation_sessions (
  tenant_id varchar NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  state jsonb CHECK (state IS NULL OR (jsonb_typeof(state) = 'object' AND octet_length(state::text) <= 1000000)),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);
ALTER TABLE creation_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE creation_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY creation_session_owner ON creation_sessions
  USING (tenant_id = current_setting('app.tenant_id', true) AND user_id = current_setting('app.user_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true) AND user_id = current_setting('app.user_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON creation_sessions TO tsp_app;
