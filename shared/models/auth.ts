import { sql } from "drizzle-orm";
import { boolean, jsonb, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";

// User storage table.
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique().notNull(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  name: varchar("name").default("").notNull(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  country: varchar("country"),
  industry: varchar("industry"),
  countries: jsonb("countries").$type<string[]>().default([]).notNull(),
  industries: jsonb("industries").$type<string[]>().default([]).notNull(),
  registrationCompleted: timestamp("registration_completed"),
  /**
   * Platform staff role, or null for ordinary users. Separate from tenant
   * roles because it crosses tenant boundaries; see models/tenancy.ts.
   */
  platformRole: varchar("platform_role"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;
