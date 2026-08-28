-- 0000: baseline schema.
--
-- Generated with `drizzle-kit generate` from shared/schema.ts, then made
-- idempotent so it can be applied to a database that already has these tables
-- (the dev and test databases predate this migration system).
--
-- Tables and indexes only. Roles, grants and Row-Level Security are in 0002,
-- because drizzle-kit models tables and cannot express them.

CREATE TABLE IF NOT EXISTS "drafts" (
	"tenant_id" varchar NOT NULL,
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"inbox_item_id" varchar,
	"platform" varchar NOT NULL,
	"tone" varchar NOT NULL,
	"content" text NOT NULL,
	"status" varchar DEFAULT 'draft' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "engine_run_logs" (
	"tenant_id" varchar NOT NULL,
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"industry" varchar NOT NULL,
	"user_id" varchar,
	"status" varchar NOT NULL,
	"articles_processed" integer DEFAULT 0,
	"articles_matched" integer DEFAULT 0,
	"error_message" text,
	"duration_ms" integer,
	"started_at" timestamp DEFAULT now(),
	"completed_at" timestamp
);

CREATE TABLE IF NOT EXISTS "inbox_items" (
	"tenant_id" varchar NOT NULL,
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"headline" text NOT NULL,
	"source" varchar NOT NULL,
	"article_url" text NOT NULL,
	"matched_keywords" jsonb DEFAULT '[]'::jsonb,
	"summary" text,
	"status" varchar DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "industry_sources" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"industry" varchar NOT NULL,
	"name" varchar NOT NULL,
	"feed_url" text NOT NULL,
	"feed_type" varchar DEFAULT 'rss' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 0,
	"last_fetched_at" timestamp,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "social_accounts" (
	"tenant_id" varchar NOT NULL,
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"provider" varchar NOT NULL,
	"provider_account_id" varchar NOT NULL,
	"account_name" varchar,
	"account_handle" varchar,
	"profile_image_url" varchar,
	"access_token" text,
	"refresh_token" text,
	"token_expires_at" timestamp,
	"scopes" jsonb DEFAULT '[]'::jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_sync_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "social_analytics" (
	"tenant_id" varchar NOT NULL,
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"social_account_id" varchar NOT NULL,
	"provider" varchar NOT NULL,
	"snapshot_date" timestamp NOT NULL,
	"metrics" jsonb NOT NULL,
	"top_posts" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "user_profiles" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"tenant_id" varchar NOT NULL,
	"focus_description" text,
	"onboarding_status" varchar DEFAULT 'pending' NOT NULL,
	"publications" jsonb DEFAULT '[]'::jsonb,
	"keywords" jsonb DEFAULT '[]'::jsonb,
	"influencers" jsonb DEFAULT '[]'::jsonb,
	"companies" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "uniq_user_profiles_tenant_user" UNIQUE("tenant_id","user_id")
);

CREATE TABLE IF NOT EXISTS "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar NOT NULL,
	"first_name" varchar,
	"last_name" varchar,
	"profile_image_url" varchar,
	"country" varchar,
	"industry" varchar,
	"registration_completed" timestamp,
	"platform_role" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);

CREATE TABLE IF NOT EXISTS "audit_log" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" varchar,
	"actor_platform_role" varchar,
	"tenant_id" varchar,
	"action" varchar NOT NULL,
	"resource_type" varchar,
	"resource_id" varchar,
	"justification" text,
	"correlation_id" varchar,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "tenant_members" (
	"tenant_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"role" varchar DEFAULT 'member' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_members_tenant_id_user_id_pk" PRIMARY KEY("tenant_id","user_id")
);

CREATE TABLE IF NOT EXISTS "tenants" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" varchar DEFAULT 'personal' NOT NULL,
	"name" varchar NOT NULL,
	"clerk_org_id" varchar,
	"status" varchar DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_clerk_org_id_unique" UNIQUE("clerk_org_id")
);

DO $$ BEGIN
  ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "tenant_members" ADD CONSTRAINT "tenant_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "tenant_members" ADD CONSTRAINT "tenant_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS "idx_drafts_user" ON "drafts" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "idx_drafts_tenant_status" ON "drafts" USING btree ("tenant_id","status","updated_at");
CREATE INDEX IF NOT EXISTS "idx_engine_runs_industry" ON "engine_run_logs" USING btree ("industry");
CREATE INDEX IF NOT EXISTS "idx_engine_runs_user" ON "engine_run_logs" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "idx_engine_runs_tenant" ON "engine_run_logs" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_inbox_user" ON "inbox_items" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "idx_inbox_tenant_status" ON "inbox_items" USING btree ("tenant_id","status","created_at");
CREATE INDEX IF NOT EXISTS "idx_industry_sources_industry" ON "industry_sources" USING btree ("industry");
CREATE INDEX IF NOT EXISTS "idx_social_accounts_user" ON "social_accounts" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "idx_social_accounts_tenant" ON "social_accounts" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_social_accounts_provider" ON "social_accounts" USING btree ("provider");
CREATE INDEX IF NOT EXISTS "idx_social_analytics_user" ON "social_analytics" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "idx_social_analytics_tenant_provider" ON "social_analytics" USING btree ("tenant_id","provider","snapshot_date");
CREATE INDEX IF NOT EXISTS "idx_social_analytics_account" ON "social_analytics" USING btree ("social_account_id");
CREATE INDEX IF NOT EXISTS "idx_social_analytics_date" ON "social_analytics" USING btree ("snapshot_date");
CREATE INDEX IF NOT EXISTS "idx_user_profiles_tenant" ON "user_profiles" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_audit_tenant_created" ON "audit_log" USING btree ("tenant_id","created_at");
CREATE INDEX IF NOT EXISTS "idx_audit_actor_created" ON "audit_log" USING btree ("actor_user_id","created_at");
CREATE INDEX IF NOT EXISTS "idx_audit_action" ON "audit_log" USING btree ("action");
CREATE INDEX IF NOT EXISTS "idx_tenant_members_user" ON "tenant_members" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "idx_tenants_status" ON "tenants" USING btree ("status");
