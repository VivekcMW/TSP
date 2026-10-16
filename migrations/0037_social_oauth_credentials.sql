-- Parent-coordinated only. Do not apply independently of the migration owner.
ALTER TABLE social_accounts ADD COLUMN credential_version integer NOT NULL DEFAULT 0
  CHECK (credential_version >= 0);

CREATE TABLE social_oauth_states (
  tenant_id varchar NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state_digest varchar(64) PRIMARY KEY CHECK (state_digest ~ '^[0-9a-f]{64}$'),
  provider varchar NOT NULL CHECK (provider IN ('twitter', 'reddit', 'linkedin')),
  session_binding varchar(64) NOT NULL CHECK (session_binding ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL
);
CREATE INDEX idx_social_oauth_expiry ON social_oauth_states (tenant_id, user_id, expires_at);
ALTER TABLE social_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_oauth_states FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON social_oauth_states
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, DELETE ON social_oauth_states TO tsp_app;