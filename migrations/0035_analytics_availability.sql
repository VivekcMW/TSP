-- Roadmap 23. Parent-coordinated rollout only; do not infer legacy provenance.
-- Existing metrics/top_posts remain intact for audit, but readers treat them as unknown.
ALTER TABLE social_analytics ADD COLUMN metric_availability jsonb;
ALTER TABLE social_analytics ADD CONSTRAINT social_analytics_availability_object
  CHECK (metric_availability IS NULL OR
    (jsonb_typeof(metric_availability) = 'object' AND octet_length(metric_availability::text) <= 32768));