-- 0019: User-driven Discover sources.
--
-- Replaces the static per-industry RSS feed lists (previously hardcoded in
-- server/services/engines/verticals/*.ts) with a per-user source list, so
-- Discover fetches only what each user explicitly added or searched for via
-- their own keywords/companies/influencers. industry_sources is kept as a
-- read-only, opt-in "suggestions" catalog — never auto-applied.

BEGIN;

CREATE TABLE IF NOT EXISTS "user_sources" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" varchar NOT NULL,
  "user_id" varchar NOT NULL,
  "name" varchar NOT NULL,
  "feed_url" text NOT NULL,
  "added_via" varchar DEFAULT 'manual' NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "last_fetched_at" timestamp,
  "last_fetch_status" varchar,
  "last_fetch_error" text,
  "created_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_user_sources_tenant_user" ON "user_sources"("tenant_id", "user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_user_sources_tenant_user_feed" ON "user_sources"("tenant_id", "user_id", "feed_url");

ALTER TABLE "user_sources" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_sources" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "user_sources";
CREATE POLICY tenant_isolation ON "user_sources"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "user_sources" TO tsp_app;

COMMIT;
