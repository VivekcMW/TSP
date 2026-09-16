ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS default_platform varchar;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS default_tone varchar NOT NULL DEFAULT 'professional';
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS preferred_publish_time varchar NOT NULL DEFAULT '09:00';
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS timezone varchar NOT NULL DEFAULT 'UTC';
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS require_publish_review boolean NOT NULL DEFAULT true;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS auto_publish boolean NOT NULL DEFAULT false;