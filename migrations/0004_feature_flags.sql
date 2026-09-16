-- Wave 3: platform-wide feature flags for the Super Admin surface.
--
-- Deliberately NOT tenant-scoped — this is global reference/control data
-- (the `platform` module per the architecture spec), same category as
-- `industry_sources`, so no RLS policy applies here.

BEGIN;

CREATE TABLE IF NOT EXISTS feature_flags (
  id          varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  key         varchar NOT NULL UNIQUE,
  description text,
  enabled     boolean NOT NULL DEFAULT false,
  created_at  timestamp NOT NULL DEFAULT now(),
  updated_at  timestamp NOT NULL DEFAULT now()
);

COMMIT;
