-- 0006: Background jobs logging and metrics
--
-- Adds tables for tracking background job executions, particularly for:
-- - Inbox refresh job history
-- - Job queue metrics (for monitoring and debugging)
-- - Scheduled refresh tracking

-- Job execution log — tracks every background job run for auditing and debugging
CREATE TABLE IF NOT EXISTS "job_execution_logs" (
  "tenant_id" varchar NOT NULL,
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "job_id" varchar NOT NULL,
  "job_type" varchar NOT NULL, -- e.g., 'inbox_refresh', 'generate_draft', etc.
  "user_id" varchar,
  "status" varchar NOT NULL, -- 'completed', 'failed', 'retrying'
  "priority" varchar DEFAULT 'normal' NOT NULL, -- 'high', 'normal', 'low'
  "triggered_by" varchar NOT NULL, -- 'manual', 'cron', 'scheduler'
  "progress_data" jsonb DEFAULT '{}'::jsonb, -- { articlesProcessed, articlesMatched, etc. }
  "error_message" text,
  "attempts_made" integer DEFAULT 0,
  "max_attempts" integer DEFAULT 3,
  "started_at" timestamp DEFAULT now(),
  "completed_at" timestamp,
  "duration_ms" integer
);

CREATE INDEX IF NOT EXISTS "job_execution_logs_tenant_id_idx" ON "job_execution_logs"("tenant_id");
CREATE INDEX IF NOT EXISTS "job_execution_logs_job_id_idx" ON "job_execution_logs"("job_id");
CREATE INDEX IF NOT EXISTS "job_execution_logs_user_id_idx" ON "job_execution_logs"("user_id");
CREATE INDEX IF NOT EXISTS "job_execution_logs_status_idx" ON "job_execution_logs"("status");
CREATE INDEX IF NOT EXISTS "job_execution_logs_created_at_idx" ON "job_execution_logs"("started_at" DESC);

-- Scheduled refresh tracking — tracks which users/tenants got pre-warmed by the cron scheduler
CREATE TABLE IF NOT EXISTS "scheduled_refreshes" (
  "tenant_id" varchar NOT NULL,
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "job_execution_log_id" varchar NOT NULL,
  "schedule_run_id" varchar NOT NULL, -- Groups all jobs from one cron cycle
  "schedule_type" varchar NOT NULL, -- 'active_users', 'top_engagement'
  "priority" varchar DEFAULT 'low' NOT NULL,
  "status" varchar NOT NULL DEFAULT 'queued', -- 'queued', 'processing', 'completed', 'failed'
  "articles_processed" integer DEFAULT 0,
  "articles_created" integer DEFAULT 0,
  "queued_at" timestamp DEFAULT now(),
  "completed_at" timestamp
);

CREATE INDEX IF NOT EXISTS "scheduled_refreshes_tenant_id_idx" ON "scheduled_refreshes"("tenant_id");
CREATE INDEX IF NOT EXISTS "scheduled_refreshes_schedule_run_id_idx" ON "scheduled_refreshes"("schedule_run_id");
CREATE INDEX IF NOT EXISTS "scheduled_refreshes_status_idx" ON "scheduled_refreshes"("status");
CREATE INDEX IF NOT EXISTS "scheduled_refreshes_schedule_type_idx" ON "scheduled_refreshes"("schedule_type");

-- Queue health metrics — aggregated stats for monitoring queue performance
-- This table is updated periodically by the job handlers for dashboarding
CREATE TABLE IF NOT EXISTS "queue_metrics" (
  "tenant_id" varchar NOT NULL,
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "metric_time" timestamp DEFAULT now(),
  "pending_jobs" integer DEFAULT 0,
  "active_jobs" integer DEFAULT 0,
  "completed_jobs_1h" integer DEFAULT 0,
  "failed_jobs_1h" integer DEFAULT 0,
  "average_processing_time_ms" integer DEFAULT 0,
  "oldest_pending_job_age_seconds" integer
);

CREATE INDEX IF NOT EXISTS "queue_metrics_tenant_id_idx" ON "queue_metrics"("tenant_id");
CREATE INDEX IF NOT EXISTS "queue_metrics_metric_time_idx" ON "queue_metrics"("metric_time" DESC);

-- Row-Level Security (implemented in 0002_rls.sql or here if needed)
-- These tables follow the standard pattern of tenant_id + user_id for access control
