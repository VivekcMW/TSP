-- Discover reading state and cross-device visit marker. Additive only.
-- A row in inbox_reads means the user explicitly opened the item; automatic
-- selection never writes one. discover_visits keeps the previous visit start,
-- which defines "New" (discovered after it and still unread).
CREATE TABLE IF NOT EXISTS inbox_reads (
  tenant_id varchar NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  inbox_item_id varchar NOT NULL REFERENCES inbox_items(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id, inbox_item_id)
);
CREATE INDEX IF NOT EXISTS idx_inbox_reads_item ON inbox_reads (inbox_item_id);

CREATE TABLE IF NOT EXISTS discover_visits (
  tenant_id varchar NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  current_visit_at timestamptz NOT NULL,
  previous_visit_at timestamptz,
  PRIMARY KEY (tenant_id, user_id)
);

ALTER TABLE inbox_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbox_reads FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON inbox_reads;
CREATE POLICY tenant_isolation ON inbox_reads
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE discover_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE discover_visits FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON discover_visits;
CREATE POLICY tenant_isolation ON discover_visits
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON inbox_reads, discover_visits TO tsp_app;
