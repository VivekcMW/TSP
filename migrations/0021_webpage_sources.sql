-- 0021: Support non-feed webpage sources in Discover.
--
-- Not every site a user wants to add has an RSS/Atom/JSON feed. sourceType
-- distinguishes a real feed (parsed by universalFeedParser) from a plain
-- webpage (scraped directly by webpageScraper) so Discover can pull content
-- from any public URL, not only ones with a discoverable feed.

BEGIN;

ALTER TABLE "user_sources" ADD COLUMN IF NOT EXISTS "source_type" varchar NOT NULL DEFAULT 'feed';

COMMIT;
