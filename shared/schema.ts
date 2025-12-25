import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, boolean, jsonb, index } from "drizzle-orm/pg-core";
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
