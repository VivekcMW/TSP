-- 0020: Allow one scheduled draft to publish independently to multiple platforms.
BEGIN;

CREATE TABLE IF NOT EXISTS "draft_schedule_targets" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" varchar NOT NULL,
  "draft_schedule_id" varchar NOT NULL,
  "platform" varchar NOT NULL,
  "status" varchar DEFAULT 'scheduled' NOT NULL,
  "published_at" timestamp,
  "retry_count" integer DEFAULT 0,
  "max_retries" integer DEFAULT 3,
  "last_error" text,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_schedule_targets_schedule_platform"
  ON "draft_schedule_targets"("draft_schedule_id", "platform");
CREATE INDEX IF NOT EXISTS "idx_schedule_targets_tenant"
  ON "draft_schedule_targets"("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_schedule_targets_schedule"
  ON "draft_schedule_targets"("draft_schedule_id");
CREATE INDEX IF NOT EXISTS "idx_schedule_targets_status"
  ON "draft_schedule_targets"("status");

ALTER TABLE "draft_schedule_targets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "draft_schedule_targets" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "draft_schedule_targets";
CREATE POLICY tenant_isolation ON "draft_schedule_targets"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "draft_schedule_targets" TO tsp_app;

COMMIT;
