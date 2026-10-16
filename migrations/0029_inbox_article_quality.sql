-- Additive only. Historical publication/discovery/quality are unknown: no backfill.
ALTER TABLE inbox_items
  ADD COLUMN published_at timestamptz,
  ADD COLUMN discovered_at timestamptz,
  ADD COLUMN ranking_score numeric,
  ADD COLUMN quality_metadata jsonb;

ALTER TABLE inbox_items ADD CONSTRAINT inbox_quality_metadata_bounded
  CHECK (quality_metadata IS NULL OR
    (jsonb_typeof(quality_metadata) = 'object' AND octet_length(quality_metadata::text) <= 262144));
ALTER TABLE inbox_items ADD CONSTRAINT inbox_ranking_score_range
  CHECK (ranking_score IS NULL OR (ranking_score >= 0 AND ranking_score <= 1));

CREATE INDEX idx_inbox_discovery_window ON inbox_items (tenant_id, user_id, discovered_at, id)
  WHERE discovered_at IS NOT NULL;