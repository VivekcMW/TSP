-- Wave 2: per-user platform preferences, for the Plugins configuration page.
--
-- Defaults to every platform enabled so existing users see no behaviour
-- change until they actively disable something.

BEGIN;

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS enabled_platforms jsonb NOT NULL DEFAULT
    '["linkedin","twitter","threads","bluesky","substack","medium","reddit","mastodon","devto","hashnode","quora","facebook","telegram","discord","farcaster","xiaohongshu","weibo","wechat","maimai","vk","line","naver","xing"]'::jsonb;

COMMIT;
