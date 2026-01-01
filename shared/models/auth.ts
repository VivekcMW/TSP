import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, timestamp, varchar, unique } from "drizzle-orm/pg-core";

// Session storage table.
// (IMPORTANT) This table is mandatory for session management, don't drop it.
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)]
);

// User storage table.
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique().notNull(),
  passwordHash: varchar("password_hash"),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  city: varchar("city"),
  country: varchar("country"),
  registrationCompleted: timestamp("registration_completed"),
  resetToken: varchar("reset_token"),
  resetTokenExpiry: timestamp("reset_token_expiry"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// OAuth accounts linked to users (Google, LinkedIn, etc.)
export const authAccounts = pgTable("auth_accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: varchar("provider").notNull(), // 'google' | 'linkedin'
  providerUserId: varchar("provider_user_id").notNull(),
  accessToken: varchar("access_token"),
  refreshToken: varchar("refresh_token"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_auth_accounts_user").on(table.userId),
  index("idx_auth_accounts_provider").on(table.provider, table.providerUserId),
  unique("unique_provider_account").on(table.provider, table.providerUserId),
]);

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

export type AuthAccount = typeof authAccounts.$inferSelect;
export type InsertAuthAccount = typeof authAccounts.$inferInsert;
