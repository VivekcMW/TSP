-- Shared index, Stage 2: publisher discovery and push updates.
-- discovered_sites: every publisher domain seen behind a search result, an outbound link or a
--   GDELT record; the crawler probes the most-seen ones for a feed and registers them.
-- watch_terms: the topics, companies and people across all accounts (no account attached),
--   used to pick stories out of global feeds such as GDELT.
-- publications gains WebSub columns so hubs can push new stories instead of being polled.

CREATE TABLE IF NOT EXISTS discovered_sites (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  origin text NOT NULL UNIQUE,
  seen_via varchar(20) NOT NULL DEFAULT 'search' CHECK (seen_via IN ('search', 'link', 'gdelt')),
  seen_count integer NOT NULL DEFAULT 1,
  first_seen_at timestamp NOT NULL DEFAULT now(),
  last_seen_at timestamp NOT NULL DEFAULT now(),
  status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'registered', 'no-feed', 'blocked')),
  probed_at timestamp,
  publication_id varchar REFERENCES publications (id) ON DELETE SET NULL,
  note text
);

CREATE INDEX IF NOT EXISTS discovered_sites_due_idx ON discovered_sites (status, seen_count DESC, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS watch_terms (
  term text PRIMARY KEY,
  kind varchar(20) NOT NULL CHECK (kind IN ('keyword', 'company', 'person')),
  seen_count integer NOT NULL DEFAULT 1,
  last_seen_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE publications
  ADD COLUMN IF NOT EXISTS hub_url text,
  ADD COLUMN IF NOT EXISTS websub_secret text,
  ADD COLUMN IF NOT EXISTS websub_subscribed_at timestamp,
  ADD COLUMN IF NOT EXISTS websub_lease_expires_at timestamp;

GRANT SELECT, INSERT, UPDATE ON discovered_sites TO tsp_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON watch_terms TO tsp_app;
