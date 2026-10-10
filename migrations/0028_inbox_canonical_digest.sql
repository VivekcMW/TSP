-- 0027 is immutable. Full URL B-tree entries can exceed PostgreSQL's index limit
-- even for valid legacy URLs, rolling back every attempt to backfill that scope.
-- md5(text) is built in; no extension, new column, or history deletion is needed.
-- Nonunique by design: preserve legacy duplicate IDs and draft references.
-- Digest equality is ONLY an accelerator; queries must also compare exact URLs.
DROP INDEX idx_inbox_canonical;
CREATE INDEX idx_inbox_canonical ON inbox_items (tenant_id, user_id, md5(canonical_url));