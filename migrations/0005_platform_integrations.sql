-- Wave 4: platform-wide integration availability, for the Super Admin
-- Integration Management surface.
--
-- Global, not tenant-scoped: this is "is LinkedIn available on the platform
-- at all right now" (an admin kill switch, e.g. during an outage or policy
-- change), separate from `user_profiles.enabled_platforms` (a subscriber's
-- own preference among whatever IS globally available). Same category as
-- `feature_flags` — no RLS.

BEGIN;

CREATE TABLE IF NOT EXISTS platform_integrations (
  id          varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  key         varchar NOT NULL UNIQUE,
  label       varchar NOT NULL,
  enabled     boolean NOT NULL DEFAULT true,
  notes       text,
  updated_at  timestamp NOT NULL DEFAULT now()
);

INSERT INTO platform_integrations (key, label) VALUES
  ('linkedin', 'LinkedIn'),
  ('twitter', 'Twitter/X'),
  ('threads', 'Threads'),
  ('bluesky', 'Bluesky'),
  ('substack', 'Substack Notes'),
  ('medium', 'Medium'),
  ('reddit', 'Reddit'),
  ('mastodon', 'Mastodon'),
  ('devto', 'Dev.to'),
  ('hashnode', 'Hashnode'),
  ('quora', 'Quora'),
  ('facebook', 'Facebook'),
  ('telegram', 'Telegram'),
  ('discord', 'Discord'),
  ('farcaster', 'Farcaster'),
  ('xiaohongshu', 'Xiaohongshu'),
  ('weibo', 'Weibo'),
  ('wechat', 'WeChat'),
  ('maimai', 'Maimai'),
  ('vk', 'VK'),
  ('line', 'LINE'),
  ('naver', 'Naver Blog'),
  ('xing', 'Xing')
ON CONFLICT (key) DO NOTHING;

COMMIT;
