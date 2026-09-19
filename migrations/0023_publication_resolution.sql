-- Additive metadata; publications remains the selected string[] contract.
-- The runner wraps this whole file and its checksum record in one transaction.
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS publication_candidates jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS publication_resolutions (
  tenant_id varchar NOT NULL,
  user_id varchar NOT NULL,
  url text NOT NULL,
  last_attempt_at timestamp NOT NULL,
  status varchar NOT NULL,
  error varchar(300),
  -- No source FK: deleted sources must retain their resolved tombstones.
  source_id varchar,
  claim_token varchar,
  lease_until timestamp,
  PRIMARY KEY (tenant_id, user_id, url),
  CONSTRAINT publication_resolutions_profile_fk FOREIGN KEY (tenant_id, user_id)
    REFERENCES user_profiles (tenant_id, user_id) ON DELETE CASCADE,
  CONSTRAINT publication_resolutions_status_check CHECK (status IN ('checking', 'failed', 'resolved')),
  CONSTRAINT publication_resolutions_url_check CHECK (length(url) BETWEEN 1 AND 2048),
  CONSTRAINT publication_resolutions_lease_check CHECK (
    (status = 'checking' AND claim_token IS NOT NULL AND lease_until IS NOT NULL)
    OR (status <> 'checking' AND claim_token IS NULL AND lease_until IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_publication_resolutions_retry
  ON publication_resolutions (tenant_id, user_id, last_attempt_at);

ALTER TABLE publication_resolutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE publication_resolutions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON publication_resolutions;
CREATE POLICY tenant_isolation ON publication_resolutions
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON publication_resolutions TO tsp_app;