-- 0007: Article publishing scheduler
--
-- Adds tables and schema modifications for scheduling draft articles for 
-- publication across multiple platforms with retry logic and audit trails.

-- Track scheduled draft publications
CREATE TABLE IF NOT EXISTS "draft_schedules" (
  "tenant_id" varchar NOT NULL,
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "draft_id" varchar NOT NULL,
  "scheduled_publish_at" timestamp NOT NULL,
  "published_at" timestamp,
  "status" varchar DEFAULT 'scheduled' NOT NULL, -- 'scheduled', 'queued', 'publishing', 'published', 'cancelled', 'failed'
  "retry_count" integer DEFAULT 0,
  "max_retries" integer DEFAULT 3,
  "last_error" text,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_draft_schedules_tenant_id" ON "draft_schedules"("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_draft_schedules_draft_id" ON "draft_schedules"("draft_id");
CREATE INDEX IF NOT EXISTS "idx_draft_schedules_status" ON "draft_schedules"("status");
CREATE INDEX IF NOT EXISTS "idx_draft_schedules_publish_at" ON "draft_schedules"("scheduled_publish_at");
CREATE INDEX IF NOT EXISTS "idx_draft_schedules_created_at" ON "draft_schedules"("created_at" DESC);
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_draft_schedules_draft_id" ON "draft_schedules"("draft_id");

-- Audit trail for publish job executions
CREATE TABLE IF NOT EXISTS "publish_job_logs" (
  "tenant_id" varchar NOT NULL,
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "draft_id" varchar NOT NULL,
  "draft_schedule_id" varchar,
  "platform" varchar NOT NULL,
  "status" varchar NOT NULL, -- 'pending', 'success', 'failed', 'retrying'
  "published_post_id" varchar,
  "error_message" text,
  "attempt" integer DEFAULT 1,
  "max_attempts" integer DEFAULT 3,
  "started_at" timestamp DEFAULT now(),
  "completed_at" timestamp
);

CREATE INDEX IF NOT EXISTS "idx_publish_logs_tenant_id" ON "publish_job_logs"("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_publish_logs_draft_id" ON "publish_job_logs"("draft_id");
CREATE INDEX IF NOT EXISTS "idx_publish_logs_draft_schedule_id" ON "publish_job_logs"("draft_schedule_id");
CREATE INDEX IF NOT EXISTS "idx_publish_logs_status" ON "publish_job_logs"("status");
CREATE INDEX IF NOT EXISTS "idx_publish_logs_platform" ON "publish_job_logs"("platform");
CREATE INDEX IF NOT EXISTS "idx_publish_logs_created_at" ON "publish_job_logs"("started_at" DESC);

-- Add columns to drafts table to track publication state
ALTER TABLE "drafts" ADD COLUMN IF NOT EXISTS "scheduled_at" timestamp;
ALTER TABLE "drafts" ADD COLUMN IF NOT EXISTS "published_at" timestamp;
ALTER TABLE "drafts" ADD COLUMN IF NOT EXISTS "publish_status" varchar DEFAULT 'draft'; 
-- 'draft', 'scheduled', 'queued', 'publishing', 'published', 'failed', 'cancelled'

CREATE INDEX IF NOT EXISTS "idx_drafts_publish_status" ON "drafts"("publish_status");
CREATE INDEX IF NOT EXISTS "idx_drafts_scheduled_at" ON "drafts"("scheduled_at");
CREATE INDEX IF NOT EXISTS "idx_drafts_tenant_publish_status" ON "drafts"("tenant_id", "publish_status", "scheduled_at");

-- Publishing metrics/stats for monitoring queue health
CREATE TABLE IF NOT EXISTS "publish_metrics" (
  "tenant_id" varchar NOT NULL,
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "metric_time" timestamp DEFAULT now(),
  "scheduled_count" integer DEFAULT 0,
  "publishing_count" integer DEFAULT 0,
  "published_today" integer DEFAULT 0,
  "failed_count" integer DEFAULT 0,
  "average_publish_time_ms" integer,
  "platforms_enabled" jsonb DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS "idx_publish_metrics_tenant" ON "publish_metrics"("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_publish_metrics_time" ON "publish_metrics"("metric_time" DESC);
