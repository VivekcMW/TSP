-- Additive follow-up: never change checksummed migration 0023.
ALTER TABLE publication_resolutions ADD COLUMN IF NOT EXISTS resolved_feed_url text;

-- Run as the migration owner with visibility across FORCE RLS. Fail rather than
-- silently backfilling only the current tenant when the role cannot bypass RLS.
SET LOCAL row_security = off;
UPDATE publication_resolutions AS resolution
SET resolved_feed_url = source.feed_url
FROM user_sources AS source
WHERE resolution.status = 'resolved'
  AND resolution.resolved_feed_url IS NULL
  AND resolution.source_id = source.id
  AND resolution.tenant_id = source.tenant_id
  AND resolution.user_id = source.user_id;
-- Already-deleted legacy sources remain NULL: no name/host/URL guessing.