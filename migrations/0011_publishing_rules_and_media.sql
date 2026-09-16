-- Durable tenant-owned media metadata and per-platform publication preferences.
CREATE TABLE IF NOT EXISTS "media_assets" (
  "tenant_id" varchar NOT NULL,
  "id" varchar PRIMARY KEY NOT NULL,
  "user_id" varchar NOT NULL,
  "file_name" varchar NOT NULL,
  "content_type" varchar NOT NULL,
  "size_bytes" integer NOT NULL,
  "storage_key" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_media_assets_tenant_user" ON "media_assets"("tenant_id", "user_id");

ALTER TABLE "drafts" ADD COLUMN IF NOT EXISTS "media" jsonb DEFAULT '[]'::jsonb;
ALTER TABLE "drafts" ADD COLUMN IF NOT EXISTS "platform_publish_rules" jsonb DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS "publishing_rules" (
  "tenant_id" varchar NOT NULL,
  "user_id" varchar NOT NULL,
  "platform" varchar NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "min_characters" integer,
  "max_characters" integer,
  "auto_optimize_tone" boolean DEFAULT true NOT NULL,
  "prefer_scheduling" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "uniq_publishing_rules_tenant_user_platform" UNIQUE("tenant_id", "user_id", "platform")
);
CREATE INDEX IF NOT EXISTS "idx_publishing_rules_tenant_user" ON "publishing_rules"("tenant_id", "user_id");

-- These are application-owned rows and use the same fail-closed tenant policy.
ALTER TABLE "media_assets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "media_assets" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "media_assets";
CREATE POLICY tenant_isolation ON "media_assets" USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
ALTER TABLE "publishing_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "publishing_rules" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "publishing_rules";
CREATE POLICY tenant_isolation ON "publishing_rules" USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));