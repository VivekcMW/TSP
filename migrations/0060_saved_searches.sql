-- Followed ("saved") keyword news searches, shown like Gmail labels in the Inbox
-- folder nav. Additive only. One row per member and query (case-insensitive);
-- the 25-per-member cap is enforced by the application under a per-user lock.
CREATE TABLE IF NOT EXISTS saved_searches (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL CONSTRAINT saved_searches_name_length CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  query text NOT NULL CONSTRAINT saved_searches_query_length CHECK (char_length(btrim(query)) BETWEEN 1 AND 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_viewed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS saved_searches_user_query_key ON saved_searches (tenant_id, user_id, lower(query));

ALTER TABLE saved_searches ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_searches FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON saved_searches;
CREATE POLICY tenant_isolation ON saved_searches
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON saved_searches TO tsp_app;
