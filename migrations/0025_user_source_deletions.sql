-- Canonical deletion intent must not depend on discovery ever having completed.
-- Do not reuse publication_resolutions.url: that input URL can already resolve
-- to a different canonical feed, whose existing identity must be preserved.
CREATE TABLE IF NOT EXISTS user_source_deletions (
  tenant_id varchar NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feed_url text NOT NULL,
  -- No source FK; the source is deleted in the same transaction as this insert.
  source_id varchar NOT NULL,
  deleted_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id, feed_url)
);

-- No profile FK: manually added sources can be removed before a profile exists.
-- Legacy resolved tombstones remain authoritative in storage; no speculative
-- backfill is possible for deletions whose canonical identity was already lost.
ALTER TABLE user_source_deletions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_source_deletions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON user_source_deletions;
CREATE POLICY tenant_isolation ON user_source_deletions
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON user_source_deletions TO tsp_app;