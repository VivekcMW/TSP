-- Shared article index (docs/superpowers/specs/2026-09-28-shared-article-index-design.md).
-- One crawl serves every account: publications any person has picked as a source are
-- polled on a schedule, and every story seen is kept for 30 days with its body, so
-- refreshes read candidates here and generation reads text here instead of live.
-- Neither table is tenant-scoped (like industry_sources), so no RLS policy applies.

CREATE TABLE IF NOT EXISTS publications (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar NOT NULL,
  site_url text NOT NULL DEFAULT '',
  feed_url text NOT NULL UNIQUE,
  source_type varchar(20) NOT NULL DEFAULT 'feed' CHECK (source_type IN ('feed', 'webpage')),
  added_via varchar(40) NOT NULL DEFAULT 'user-source',
  is_active boolean NOT NULL DEFAULT true,
  last_crawled_at timestamp,
  last_crawl_status varchar(20),
  last_crawl_error text,
  consecutive_failures integer NOT NULL DEFAULT 0,
  etag text,
  last_modified text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS publications_due_idx ON publications (is_active, last_crawled_at);

CREATE TABLE IF NOT EXISTS pooled_articles (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_id varchar REFERENCES publications (id) ON DELETE SET NULL,
  canonical_url text NOT NULL UNIQUE,
  title text NOT NULL,
  source varchar NOT NULL,
  source_origin text,
  content text NOT NULL DEFAULT '',
  input_kind varchar(20) NOT NULL DEFAULT 'feed_excerpt' CHECK (input_kind IN ('page_body', 'feed_excerpt')),
  -- NULL until the body has been fetched; then whether the page held readable article prose.
  readable boolean,
  published_at timestamp,
  fetched_at timestamp NOT NULL DEFAULT now(),
  body_fetched_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  -- English stemming so "prices of medical devices" matches "medical device pricing"; other languages still match exact words.
  search tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(title, '') || ' ' || left(coalesce(content, ''), 20000))) STORED,
  -- Lets the crawler spot a site's boilerplate: the same body under several headlines.
  body_hash text GENERATED ALWAYS AS (md5(content)) STORED
);

CREATE INDEX IF NOT EXISTS pooled_articles_search_idx ON pooled_articles USING GIN (search);
CREATE INDEX IF NOT EXISTS pooled_articles_published_idx ON pooled_articles (published_at DESC);
CREATE INDEX IF NOT EXISTS pooled_articles_pending_body_idx ON pooled_articles (created_at) WHERE readable IS NULL;
CREATE INDEX IF NOT EXISTS pooled_articles_body_hash_idx ON pooled_articles (source_origin, body_hash);

GRANT SELECT, INSERT, UPDATE ON publications TO tsp_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON pooled_articles TO tsp_app;
