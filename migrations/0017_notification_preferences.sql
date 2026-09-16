ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS daily_digest boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS content_alerts boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS product_updates boolean NOT NULL DEFAULT true;