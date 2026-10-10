-- Additive, profile-local query rotation. Existing profile RLS/grants are retained.
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS search_edition text NOT NULL DEFAULT 'en-US',
  ADD COLUMN IF NOT EXISTS search_query_state jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$ BEGIN
  ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_search_edition_check
    CHECK (search_edition IN ('en-US', 'en-GB', 'en-IN', 'hi-IN', 'fr-FR', 'de-DE', 'es-ES', 'pt-BR', 'ja-JP', 'en-AU', 'en-CA'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_search_query_state_object_check
    CHECK (jsonb_typeof(search_query_state) = 'object');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;