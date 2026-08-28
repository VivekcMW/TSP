import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, boolean, jsonb, index, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export * from "./models/auth";

export const userProfiles = pgTable("user_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().unique(),
  focusDescription: text("focus_description"),
  onboardingStatus: varchar("onboarding_status").default("pending").notNull(),
  publications: jsonb("publications").$type<string[]>().default([]),
  keywords: jsonb("keywords").$type<string[]>().default([]),
  influencers: jsonb("influencers").$type<string[]>().default([]),
  companies: jsonb("companies").$type<string[]>().default([]),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const inboxItems = pgTable("inbox_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  headline: text("headline").notNull(),
  source: varchar("source").notNull(),
  articleUrl: text("article_url").notNull(),
  matchedKeywords: jsonb("matched_keywords").$type<string[]>().default([]),
  summary: text("summary"),
  status: varchar("status").default("active").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [index("idx_inbox_user").on(table.userId)]);

export const drafts = pgTable("drafts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  inboxItemId: varchar("inbox_item_id"),
  platform: varchar("platform").notNull(),
  tone: varchar("tone").notNull(),
  content: text("content").notNull(),
  status: varchar("status").default("draft").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [index("idx_drafts_user").on(table.userId)]);

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

export const engineRunLogs = pgTable("engine_run_logs", {
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
]);

export const insertIndustrySourceSchema = createInsertSchema(industrySources).omit({
  id: true,
  createdAt: true,
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

export type InsertIndustrySource = z.infer<typeof insertIndustrySourceSchema>;
export type IndustrySource = typeof industrySources.$inferSelect;

export type InsertEngineRunLog = z.infer<typeof insertEngineRunLogSchema>;
export type EngineRunLog = typeof engineRunLogs.$inferSelect;

// Social media accounts for analytics integration
export const socialAccounts = pgTable("social_accounts", {
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
