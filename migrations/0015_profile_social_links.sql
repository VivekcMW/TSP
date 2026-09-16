-- 0015: Safe public social profile links, separate from connected credentials.

BEGIN;

CREATE TABLE IF NOT EXISTS profile_social_links (
  tenant_id varchar NOT NULL,
  user_id varchar NOT NULL,
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  platform varchar NOT NULL,
  label varchar NOT NULL,
  url text NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT uniq_profile_social_links_tenant_user_platform UNIQUE (tenant_id, user_id, platform)
);
CREATE INDEX IF NOT EXISTS idx_profile_social_links_tenant_user ON profile_social_links(tenant_id, user_id);

ALTER TABLE profile_social_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_social_links FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON profile_social_links
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

COMMIT;