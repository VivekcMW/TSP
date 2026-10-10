-- Optional, explicitly approved voice only. No imports/backfill from draft history.
CREATE TABLE editorial_voices (
  tenant_id varchar NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  PRIMARY KEY (tenant_id, user_id)
);
CREATE TABLE editorial_voice_samples (
  id uuid PRIMARY KEY,
  tenant_id varchar NOT NULL,
  user_id varchar NOT NULL,
  slot smallint NOT NULL CHECK (slot BETWEEN 1 AND 5),
  text text NOT NULL CHECK (char_length(btrim(text)) BETWEEN 20 AND 1000 AND octet_length(text) <= 4000),
  origin text NOT NULL CHECK (origin IN ('explicit-sample', 'approved-edit')),
  approved_at timestamptz NOT NULL,
  deleted_at timestamptz,
  FOREIGN KEY (tenant_id, user_id) REFERENCES editorial_voices(tenant_id, user_id) ON DELETE CASCADE,
  UNIQUE (tenant_id, user_id, slot)
);
ALTER TABLE editorial_voices ENABLE ROW LEVEL SECURITY;
ALTER TABLE editorial_voices FORCE ROW LEVEL SECURITY;
CREATE POLICY voice_owner ON editorial_voices
  USING (tenant_id = current_setting('app.tenant_id', true) AND user_id = current_setting('app.user_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true) AND user_id = current_setting('app.user_id', true));
ALTER TABLE editorial_voice_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE editorial_voice_samples FORCE ROW LEVEL SECURITY;
CREATE POLICY voice_sample_owner ON editorial_voice_samples
  USING (tenant_id = current_setting('app.tenant_id', true) AND user_id = current_setting('app.user_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true) AND user_id = current_setting('app.user_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON editorial_voices, editorial_voice_samples TO tsp_app;