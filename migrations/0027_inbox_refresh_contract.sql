-- Additive only. Legacy duplicate rows, IDs and draft references are retained.
ALTER TABLE inbox_items ADD COLUMN canonical_url text;
ALTER TABLE inbox_items ADD COLUMN version integer NOT NULL DEFAULT 0;
CREATE INDEX idx_inbox_canonical ON inbox_items (tenant_id, user_id, canonical_url);

-- Canonical backfill is performed in bounded batches by the SAME TypeScript
-- normalizer under the inbox writer lock, before any historical dedupe query.
-- NULL means not processed; empty string means invalid legacy HTTP(S) URL.
CREATE TABLE inbox_refresh_receipts (
  tenant_id varchar NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation_id varchar(200) NOT NULL,
  auto_refresh boolean NOT NULL,
  result jsonb NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id, operation_id)
);
ALTER TABLE inbox_refresh_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbox_refresh_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON inbox_refresh_receipts
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON inbox_refresh_receipts TO tsp_app;