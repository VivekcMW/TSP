-- 0022: Add keyword weighting, relevance scoring, and recommended industry tracking
BEGIN;

-- Add recommended_industry column to user_profiles
ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "recommended_industry" varchar;

-- Add relevance_score and relevance_reason columns to inbox_items
ALTER TABLE "inbox_items" ADD COLUMN IF NOT EXISTS "relevance_score" numeric DEFAULT 0.5;
ALTER TABLE "inbox_items" ADD COLUMN IF NOT EXISTS "relevance_reason" text;

-- Migrate existing keywords array to weighted keyword objects
-- Old format: ["keyword1", "keyword2", ...]
-- New format: [{keyword: "keyword1", weight: 0.8}, ...]
UPDATE "user_profiles"
SET "keywords" = COALESCE(
  (SELECT jsonb_agg(
    jsonb_build_object(
      'keyword', keyword_str,
      'weight', 0.7  -- Default weight for migrated keywords
    )
  )
  FROM jsonb_array_elements("keywords") AS keyword_str
  WHERE keyword_str IS NOT NULL),
  '[]'::jsonb
)
WHERE jsonb_typeof("keywords") = 'array' 
  AND (
    SELECT COUNT(*)
    FROM jsonb_array_elements("keywords") AS elem
    WHERE jsonb_typeof(elem) = 'string'
  ) > 0;

-- Create index on recommended_industry for faster filtering
CREATE INDEX IF NOT EXISTS "idx_user_profiles_recommended_industry"
  ON "user_profiles"("recommended_industry");

-- Create index on relevance_score for sorting inbox by relevance
CREATE INDEX IF NOT EXISTS "idx_inbox_items_relevance_score"
  ON "inbox_items"("user_id", "relevance_score" DESC);

COMMIT;
