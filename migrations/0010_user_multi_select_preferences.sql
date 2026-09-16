-- 0010: Preserve every industry and country selected during onboarding.
ALTER TABLE users ADD COLUMN IF NOT EXISTS industries jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS countries jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE users SET industries = jsonb_build_array(industry) WHERE industry IS NOT NULL AND industries = '[]'::jsonb;
UPDATE users SET countries = jsonb_build_array(country) WHERE country IS NOT NULL AND countries = '[]'::jsonb;