import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, boolean, jsonb, index, integer, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export * from "./models/auth";
export * from "./models/tenancy";

// Kept in sync by hand with server/services/punditBrain.ts's PlatformKey —
// that file is the source of truth for what a platform IS (spec/limits),
// this is only the list of valid keys for the enabled-platforms preference.
export const ALL_PLATFORM_KEYS = [
  "linkedin", "twitter", "threads", "bluesky", "substack", "medium", "reddit",
  "mastodon", "devto", "hashnode", "quora", "facebook", "telegram", "discord",
  "farcaster", "xiaohongshu", "weibo", "wechat", "maimai", "vk", "line", "naver", "xing",
] as const;

export const userProfiles = pgTable("user_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  /** Owning tenant. Every query must be scoped by this. */
  tenantId: varchar("tenant_id").notNull(),
  focusDescription: text("focus_description"),
  onboardingStatus: varchar("onboarding_status").default("pending").notNull(),
  publications: jsonb("publications").$type<string[]>().default([]),
  keywords: jsonb("keywords").$type<string[]>().default([]),
  influencers: jsonb("influencers").$type<string[]>().default([]),
  companies: jsonb("companies").$type<string[]>().default([]),
  /** Which draft-generation platforms this user has enabled, for the Plugins page. */
  enabledPlatforms: jsonb("enabled_platforms").$type<string[]>().notNull().default(ALL_PLATFORM_KEYS as unknown as string[]),
  defaultPlatform: varchar("default_platform"),
  defaultTone: varchar("default_tone").notNull().default("professional"),
  preferredPublishTime: varchar("preferred_publish_time").notNull().default("09:00"),
  timezone: varchar("timezone").notNull().default("UTC"),
  requirePublishReview: boolean("require_publish_review").notNull().default(true),
  autoPublish: boolean("auto_publish").notNull().default(false),
  dailyDigest: boolean("daily_digest").notNull().default(true),
  contentAlerts: boolean("content_alerts").notNull().default(false),
  productUpdates: boolean("product_updates").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  unique("uniq_user_profiles_tenant_user").on(table.tenantId, table.userId),
  index("idx_user_profiles_tenant").on(table.tenantId),
]);

export const inboxItems = pgTable("inbox_items", {
  /** Owning tenant. Every query must be scoped by this. */
  tenantId: varchar("tenant_id").notNull(),
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  headline: text("headline").notNull(),
  source: varchar("source").notNull(),
  articleUrl: text("article_url").notNull(),
  matchedKeywords: jsonb("matched_keywords").$type<string[]>().default([]),
  summary: text("summary"),
  status: varchar("status").default("active").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_inbox_user").on(table.userId),
  index("idx_inbox_tenant_status").on(table.tenantId, table.status, table.createdAt),
]);

export const drafts = pgTable("drafts", {
  /** Owning tenant. Every query must be scoped by this. */
  tenantId: varchar("tenant_id").notNull(),
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  inboxItemId: varchar("inbox_item_id"),
  platform: varchar("platform").notNull(),
  tone: varchar("tone").notNull(),
  content: text("content").notNull(),
  status: varchar("status").default("draft").notNull(),
  publishStatus: varchar("publish_status").default("draft").notNull(),
  media: jsonb("media").$type<Array<{ id: string; type: "image" | "video" | "audio"; name: string; url: string }>>().default([]),
  platformPublishRules: jsonb("platform_publish_rules").$type<Record<string, boolean>>().default({}),
  scheduledAt: timestamp("scheduled_at"),
  publishedAt: timestamp("published_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_drafts_user").on(table.userId),
  index("idx_drafts_tenant_status").on(table.tenantId, table.status, table.updatedAt),
  index("idx_drafts_publish_status").on(table.publishStatus),
  index("idx_drafts_tenant_publish_status").on(table.tenantId, table.publishStatus, table.scheduledAt),
]);

export const INDUSTRY_SLUGS = [
  "media_advertising",
  "product_marketing",
  "technology_saas",
  "finance_banking",
  "healthcare_pharma",
  "consulting_services",
  "ecommerce_retail",
  "real_estate",
  "education_edtech",
  "manufacturing",
  "energy_sustainability",
  "legal_services",
  "nonprofit_ngo",
  "government_public",
  "hospitality_travel",
  "entertainment_media",
  "telecommunications",
  "agriculture",
  "other",
] as const;

export type IndustrySlug = typeof INDUSTRY_SLUGS[number];

/**
 * Platform-curated reference feeds, kept only as an opt-in suggestion catalog
 * (surfaced via /api/sources/suggestions) that a user can choose to add to
 * their own `userSources` list. Never fetched or auto-applied on a user's
 * behalf — Discover is driven exclusively by userSources + the user's own
 * keywords/companies/influencers.
 */
export const industrySources = pgTable("industry_sources", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  industry: varchar("industry").notNull(),
  name: varchar("name").notNull(),
  feedUrl: text("feed_url").notNull(),
  feedType: varchar("feed_type").default("rss").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  priority: integer("priority").default(0),
  lastFetchedAt: timestamp("last_fetched_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [index("idx_industry_sources_industry").on(table.industry)]);

/** A user's own explicitly-added content sources — the only thing Discover fetches from besides live keyword search. */
export const userSources = pgTable("user_sources", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  /** Owning tenant. Every query must be scoped by this. */
  tenantId: varchar("tenant_id").notNull(),
  userId: varchar("user_id").notNull(),
  name: varchar("name").notNull(),
  feedUrl: text("feed_url").notNull(),
  /** "feed" = a real RSS/Atom/JSON feed at feedUrl, parsed by universalFeedParser. "webpage" = no feed exists; feedUrl is a plain page scraped directly instead. */
  sourceType: varchar("source_type").notNull().default("feed"),
  /** How this row was created: typed directly by the user, resolved from a Publications entry, or added from the suggestions catalog. */
  addedVia: varchar("added_via").notNull().default("manual"),
  isActive: boolean("is_active").default(true).notNull(),
  lastFetchedAt: timestamp("last_fetched_at"),
  lastFetchStatus: varchar("last_fetch_status"),
  lastFetchError: text("last_fetch_error"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_user_sources_tenant_user").on(table.tenantId, table.userId),
  unique("uniq_user_sources_tenant_user_feed").on(table.tenantId, table.userId, table.feedUrl),
]);

/** Platform-wide feature flags for the Super Admin surface — not tenant-scoped. */
export const featureFlags = pgTable("feature_flags", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  key: varchar("key").notNull().unique(),
  description: text("description"),
  enabled: boolean("enabled").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const emailPreferences = pgTable("email_preferences", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().unique(),
  marketing: boolean("marketing").notNull().default(true),
  productUpdates: boolean("product_updates").notNull().default(true),
  dailyDigest: boolean("daily_digest").notNull().default(true),
  contentAlerts: boolean("content_alerts").notNull().default(true),
  unsubscribedAt: timestamp("unsubscribed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const emailDeliveries = pgTable("email_deliveries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id"),
  recipient: varchar("recipient").notNull(),
  type: varchar("type").notNull(),
  dedupeKey: varchar("dedupe_key").unique(),
  status: varchar("status").notNull().default("pending"),
  providerMessageId: varchar("provider_message_id"),
  errorMessage: text("error_message"),
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertFeatureFlagSchema = createInsertSchema(featureFlags).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertFeatureFlag = z.infer<typeof insertFeatureFlagSchema>;
export type FeatureFlag = typeof featureFlags.$inferSelect;

export const billingPlans = pgTable("billing_plans", {
  id: varchar("id").primaryKey(),
  key: varchar("key").notNull().unique(),
  name: varchar("name").notNull(),
  description: text("description"),
  amount: integer("amount").notNull(),
  currency: varchar("currency").notNull().default("INR"),
  interval: varchar("interval").notNull().default("monthly"),
  razorpayPlanId: varchar("razorpay_plan_id"),
  features: jsonb("features").$type<string[]>().default([]),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const billingCustomers = pgTable("billing_customers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().unique(),
  razorpayCustomerId: varchar("razorpay_customer_id").notNull().unique(),
  email: varchar("email").notNull(),
  name: varchar("name").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const subscriptions = pgTable("subscriptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  billingCustomerId: varchar("billing_customer_id").notNull(),
  planId: varchar("plan_id").notNull(),
  razorpaySubscriptionId: varchar("razorpay_subscription_id").unique(),
  status: varchar("status").notNull().default("created"),
  currentPeriodStart: timestamp("current_period_start"),
  currentPeriodEnd: timestamp("current_period_end"),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  pausedAt: timestamp("paused_at"),
  endedAt: timestamp("ended_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [index("idx_subscriptions_tenant").on(table.tenantId), index("idx_subscriptions_status").on(table.status)]);

export const payments = pgTable("payments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  subscriptionId: varchar("subscription_id"),
  razorpayPaymentId: varchar("razorpay_payment_id").notNull().unique(),
  razorpayOrderId: varchar("razorpay_order_id"),
  amount: integer("amount").notNull(),
  currency: varchar("currency").notNull().default("INR"),
  status: varchar("status").notNull(),
  method: varchar("method"),
  failureCode: varchar("failure_code"),
  failureDescription: text("failure_description"),
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [index("idx_payments_tenant_created").on(table.tenantId, table.createdAt)]);

export const paymentMethods = pgTable("payment_methods", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  razorpayTokenId: varchar("razorpay_token_id"),
  type: varchar("type").notNull(),
  cardNetwork: varchar("card_network"),
  lastFour: varchar("last_four"),
  upiVpaMasked: varchar("upi_vpa_masked"),
  isDefault: boolean("is_default").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [index("idx_payment_methods_tenant").on(table.tenantId)]);

export const billingWebhookEvents = pgTable("billing_webhook_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  eventId: varchar("event_id").notNull().unique(),
  eventType: varchar("event_type").notNull(),
  payloadHash: varchar("payload_hash").notNull(),
  processingStatus: varchar("processing_status").notNull().default("processed"),
  errorMessage: text("error_message"),
  processedAt: timestamp("processed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type BillingPlan = typeof billingPlans.$inferSelect;
export type BillingCustomer = typeof billingCustomers.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type PaymentMethod = typeof paymentMethods.$inferSelect;

/**
 * Platform-wide integration availability (a global kill switch per posting
 * platform) — separate from `userProfiles.enabledPlatforms`, which is a
 * subscriber's own preference among whatever IS globally available.
 */
export const platformIntegrations = pgTable("platform_integrations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  key: varchar("key").notNull().unique(),
  label: varchar("label").notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  notes: text("notes"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type PlatformIntegration = typeof platformIntegrations.$inferSelect;

export const engineRunLogs = pgTable("engine_run_logs", {
  /** Owning tenant. Every query must be scoped by this. */
  tenantId: varchar("tenant_id").notNull(),
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  industry: varchar("industry").notNull(),
  userId: varchar("user_id"),
  status: varchar("status").notNull(),
  articlesProcessed: integer("articles_processed").default(0),
  articlesMatched: integer("articles_matched").default(0),
  errorMessage: text("error_message"),
  durationMs: integer("duration_ms"),
  startedAt: timestamp("started_at").defaultNow(),
  completedAt: timestamp("completed_at"),
}, (table) => [
  index("idx_engine_runs_industry").on(table.industry),
  index("idx_engine_runs_user").on(table.userId),
  index("idx_engine_runs_tenant").on(table.tenantId),
]);

export const insertIndustrySourceSchema = createInsertSchema(industrySources).omit({
  id: true,
  createdAt: true,
});

export const insertUserSourceSchema = createInsertSchema(userSources).omit({
  id: true,
  tenantId: true,
  userId: true,
  createdAt: true,
  lastFetchedAt: true,
  lastFetchStatus: true,
  lastFetchError: true,
});

export const insertEngineRunLogSchema = createInsertSchema(engineRunLogs).omit({
  id: true,
  startedAt: true,
});

export const insertUserProfileSchema = createInsertSchema(userProfiles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertInboxItemSchema = createInsertSchema(inboxItems).omit({
  id: true,
  createdAt: true,
});

export const insertDraftSchema = createInsertSchema(drafts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertUserProfile = z.infer<typeof insertUserProfileSchema>;
export type UserProfile = typeof userProfiles.$inferSelect;

export type InsertInboxItem = z.infer<typeof insertInboxItemSchema>;
export type InboxItem = typeof inboxItems.$inferSelect;

export type InsertDraft = z.infer<typeof insertDraftSchema>;
export type Draft = typeof drafts.$inferSelect;

/** Public profile URLs only; OAuth credentials remain in socialAccounts. */
export const profileSocialLinks = pgTable("profile_social_links", {
  tenantId: varchar("tenant_id").notNull(),
  userId: varchar("user_id").notNull(),
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  platform: varchar("platform").notNull(),
  label: varchar("label").notNull(),
  url: text("url").notNull(),
  isPrimary: boolean("is_primary").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  unique("uniq_profile_social_links_tenant_user_platform").on(table.tenantId, table.userId, table.platform),
  index("idx_profile_social_links_tenant_user").on(table.tenantId, table.userId),
]);

export type ProfileSocialLink = typeof profileSocialLinks.$inferSelect;
export type InsertProfileSocialLink = typeof profileSocialLinks.$inferInsert;

/** Durable tenant-owned upload metadata. Files are stored by an adapter, never by a client-supplied path. */
export const mediaAssets = pgTable("media_assets", {
  tenantId: varchar("tenant_id").notNull(),
  id: varchar("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  fileName: varchar("file_name").notNull(),
  contentType: varchar("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  storageKey: text("storage_key").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_media_assets_tenant_user").on(table.tenantId, table.userId),
]);

export type MediaAsset = typeof mediaAssets.$inferSelect;

export const publishingRules = pgTable("publishing_rules", {
  tenantId: varchar("tenant_id").notNull(),
  userId: varchar("user_id").notNull(),
  platform: varchar("platform").notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  minCharacters: integer("min_characters"),
  maxCharacters: integer("max_characters"),
  autoOptimizeTone: boolean("auto_optimize_tone").default(true).notNull(),
  preferScheduling: boolean("prefer_scheduling").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  unique("uniq_publishing_rules_tenant_user_platform").on(table.tenantId, table.userId, table.platform),
  index("idx_publishing_rules_tenant_user").on(table.tenantId, table.userId),
]);

export type PublishingRule = typeof publishingRules.$inferSelect;

export type InsertIndustrySource = z.infer<typeof insertIndustrySourceSchema>;
export type IndustrySource = typeof industrySources.$inferSelect;
export type InsertUserSource = z.infer<typeof insertUserSourceSchema>;
export type UserSource = typeof userSources.$inferSelect;

export type InsertEngineRunLog = z.infer<typeof insertEngineRunLogSchema>;
export type EngineRunLog = typeof engineRunLogs.$inferSelect;

/** Background job execution history. Tenant-scoped and protected by RLS. */
export const jobExecutionLogs = pgTable("job_execution_logs", {
  tenantId: varchar("tenant_id").notNull(),
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  jobId: varchar("job_id").notNull(),
  jobType: varchar("job_type").notNull(),
  userId: varchar("user_id"),
  status: varchar("status").notNull(),
  priority: varchar("priority").default("normal").notNull(),
  triggeredBy: varchar("triggered_by").notNull(),
  progressData: jsonb("progress_data").$type<Record<string, unknown>>().default({}),
  errorMessage: text("error_message"),
  attemptsMade: integer("attempts_made").default(0),
  maxAttempts: integer("max_attempts").default(3),
  startedAt: timestamp("started_at").defaultNow(),
  completedAt: timestamp("completed_at"),
  durationMs: integer("duration_ms"),
}, (table) => [
  index("job_execution_logs_tenant_id_idx").on(table.tenantId),
  index("job_execution_logs_job_id_idx").on(table.jobId),
  index("job_execution_logs_user_id_idx").on(table.userId),
  index("job_execution_logs_status_idx").on(table.status),
  index("job_execution_logs_created_at_idx").on(table.startedAt),
]);

export const scheduledRefreshes = pgTable("scheduled_refreshes", {
  tenantId: varchar("tenant_id").notNull(),
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  jobExecutionLogId: varchar("job_execution_log_id").notNull(),
  scheduleRunId: varchar("schedule_run_id").notNull(),
  scheduleType: varchar("schedule_type").notNull(),
  priority: varchar("priority").default("low").notNull(),
  status: varchar("status").default("queued").notNull(),
  articlesProcessed: integer("articles_processed").default(0),
  articlesCreated: integer("articles_created").default(0),
  queuedAt: timestamp("queued_at").defaultNow(),
  completedAt: timestamp("completed_at"),
}, (table) => [
  index("scheduled_refreshes_tenant_id_idx").on(table.tenantId),
  index("scheduled_refreshes_schedule_run_id_idx").on(table.scheduleRunId),
  index("scheduled_refreshes_status_idx").on(table.status),
  index("scheduled_refreshes_schedule_type_idx").on(table.scheduleType),
]);

export const queueMetrics = pgTable("queue_metrics", {
  tenantId: varchar("tenant_id").notNull(),
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  metricTime: timestamp("metric_time").defaultNow(),
  pendingJobs: integer("pending_jobs").default(0),
  activeJobs: integer("active_jobs").default(0),
  completedJobs1h: integer("completed_jobs_1h").default(0),
  failedJobs1h: integer("failed_jobs_1h").default(0),
  averageProcessingTimeMs: integer("average_processing_time_ms").default(0),
  oldestPendingJobAgeSeconds: integer("oldest_pending_job_age_seconds"),
}, (table) => [
  index("queue_metrics_tenant_id_idx").on(table.tenantId),
  index("queue_metrics_metric_time_idx").on(table.metricTime),
]);

export const publishMetrics = pgTable("publish_metrics", {
  tenantId: varchar("tenant_id").notNull(),
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  metricTime: timestamp("metric_time").defaultNow(),
  scheduledCount: integer("scheduled_count").default(0),
  publishingCount: integer("publishing_count").default(0),
  publishedToday: integer("published_today").default(0),
  failedCount: integer("failed_count").default(0),
  averagePublishTimeMs: integer("average_publish_time_ms"),
  platformsEnabled: jsonb("platforms_enabled").$type<string[]>().default([]),
}, (table) => [
  index("idx_publish_metrics_tenant").on(table.tenantId),
  index("idx_publish_metrics_time").on(table.metricTime),
]);

// Social media accounts for analytics integration
export const socialAccounts = pgTable("social_accounts", {
  /** Owning tenant. Every query must be scoped by this. */
  tenantId: varchar("tenant_id").notNull(),
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  provider: varchar("provider").notNull(), // 'linkedin' | 'twitter'
  providerAccountId: varchar("provider_account_id").notNull(),
  accountName: varchar("account_name"),
  accountHandle: varchar("account_handle"),
  profileImageUrl: varchar("profile_image_url"),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  tokenExpiresAt: timestamp("token_expires_at"),
  scopes: jsonb("scopes").$type<string[]>().default([]),
  isActive: boolean("is_active").default(true).notNull(),
  lastSyncAt: timestamp("last_sync_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_social_accounts_user").on(table.userId),
  index("idx_social_accounts_tenant").on(table.tenantId),
  index("idx_social_accounts_provider").on(table.provider),
]);

// Analytics metrics interface
export interface SocialMetrics {
  followers: number;
  following: number;
  posts: number;
  impressions: number;
  engagements: number;
  engagementRate: number;
  likes: number;
  comments: number;
  shares: number;
  clicks: number;
  profileViews?: number;
}

// Social analytics snapshots
export const socialAnalytics = pgTable("social_analytics", {
  /** Owning tenant. Every query must be scoped by this. */
  tenantId: varchar("tenant_id").notNull(),
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  socialAccountId: varchar("social_account_id").notNull(),
  provider: varchar("provider").notNull(), // 'linkedin' | 'twitter'
  snapshotDate: timestamp("snapshot_date").notNull(),
  metrics: jsonb("metrics").$type<SocialMetrics>().notNull(),
  topPosts: jsonb("top_posts").$type<Array<{
    postId: string;
    content: string;
    impressions: number;
    engagements: number;
    likes: number;
    comments: number;
    shares: number;
    postedAt: string;
  }>>().default([]),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_social_analytics_user").on(table.userId),
  index("idx_social_analytics_tenant_provider").on(table.tenantId, table.provider, table.snapshotDate),
  index("idx_social_analytics_account").on(table.socialAccountId),
  index("idx_social_analytics_date").on(table.snapshotDate),
]);

export const insertSocialAccountSchema = createInsertSchema(socialAccounts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertSocialAnalyticsSchema = createInsertSchema(socialAnalytics).omit({
  id: true,
  createdAt: true,
});

export type InsertSocialAccount = z.infer<typeof insertSocialAccountSchema>;
export type SocialAccount = typeof socialAccounts.$inferSelect;

export type InsertSocialAnalytics = z.infer<typeof insertSocialAnalyticsSchema>;
export type SocialAnalyticsSnapshot = typeof socialAnalytics.$inferSelect;

// Article publishing scheduler
export const draftSchedules = pgTable("draft_schedules", {
  /** Owning tenant. Every query must be scoped by this. */
  tenantId: varchar("tenant_id").notNull(),
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  draftId: varchar("draft_id").notNull(),
  scheduledPublishAt: timestamp("scheduled_publish_at").notNull(),
  publishedAt: timestamp("published_at"),
  status: varchar("status").default("scheduled").notNull(), // 'scheduled', 'queued', 'publishing', 'published', 'cancelled', 'failed'
  retryCount: integer("retry_count").default(0),
  maxRetries: integer("max_retries").default(3),
  lastError: text("last_error"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  unique("uniq_draft_schedules_draft_id").on(table.draftId),
  index("idx_draft_schedules_tenant").on(table.tenantId),
  index("idx_draft_schedules_status").on(table.status),
  index("idx_draft_schedules_publish_at").on(table.scheduledPublishAt),
]);

export const draftScheduleTargets = pgTable("draft_schedule_targets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  draftScheduleId: varchar("draft_schedule_id").notNull(),
  platform: varchar("platform").notNull(),
  status: varchar("status").default("scheduled").notNull(),
  publishedAt: timestamp("published_at"),
  retryCount: integer("retry_count").default(0),
  maxRetries: integer("max_retries").default(3),
  lastError: text("last_error"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  unique("uniq_schedule_targets_schedule_platform").on(table.draftScheduleId, table.platform),
  index("idx_schedule_targets_tenant").on(table.tenantId),
  index("idx_schedule_targets_schedule").on(table.draftScheduleId),
  index("idx_schedule_targets_status").on(table.status),
]);

export const publishJobLogs = pgTable("publish_job_logs", {
  /** Owning tenant. Every query must be scoped by this. */
  tenantId: varchar("tenant_id").notNull(),
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  draftId: varchar("draft_id").notNull(),
  draftScheduleId: varchar("draft_schedule_id"),
  platform: varchar("platform").notNull(),
  status: varchar("status").notNull(), // 'pending', 'success', 'failed', 'retrying'
  publishedPostId: varchar("published_post_id"),
  errorMessage: text("error_message"),
  attempt: integer("attempt").default(1),
  maxAttempts: integer("max_attempts").default(3),
  startedAt: timestamp("started_at").defaultNow(),
  completedAt: timestamp("completed_at"),
}, (table) => [
  index("idx_publish_logs_tenant").on(table.tenantId),
  index("idx_publish_logs_draft").on(table.draftId),
  index("idx_publish_logs_status").on(table.status),
  index("idx_publish_logs_platform").on(table.platform),
]);

export const insertDraftScheduleSchema = createInsertSchema(draftSchedules).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  status: true,
  retryCount: true,
});

export const insertPublishJobLogSchema = createInsertSchema(publishJobLogs).omit({
  id: true,
  startedAt: true,
});

export type InsertDraftSchedule = z.infer<typeof insertDraftScheduleSchema>;
export type DraftSchedule = typeof draftSchedules.$inferSelect;
export const insertDraftScheduleTargetSchema = createInsertSchema(draftScheduleTargets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  status: true,
  retryCount: true,
});
export type InsertDraftScheduleTarget = z.infer<typeof insertDraftScheduleTargetSchema>;
export type DraftScheduleTarget = typeof draftScheduleTargets.$inferSelect;

export type InsertPublishJobLog = z.infer<typeof insertPublishJobLogSchema>;
export type PublishJobLog = typeof publishJobLogs.$inferSelect;
