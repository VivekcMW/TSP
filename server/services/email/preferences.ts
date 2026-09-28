import { eq } from "drizzle-orm";
import { db } from "../../db";
import { emailPreferences } from "@shared/schema";
import { emailCategoryKeys, emailPreferenceDefaults, emailPreferencePatch, type EmailPreferencePatch } from "@shared/email-preferences";
import { timezoneSchema } from "@shared/profile-preferences";

// Account-wide authoritative row. Migration 0034 performs the one-time legacy mapping.
export async function getEmailPreferences(userId: string) {
  const [row] = await db.select().from(emailPreferences).where(eq(emailPreferences.userId, userId)).limit(1);
  return row ?? { userId, ...emailPreferenceDefaults, unsubscribedAt: null };
}
export async function updateEmailPreferences(userId: string, input: EmailPreferencePatch) {
  const { unsubscribeAll, ...patch } = emailPreferencePatch.parse(input);
  const categories = unsubscribeAll ? Object.fromEntries(emailCategoryKeys.map(key => [key, false])) : {};
  const subscription: { unsubscribedAt?: Date | null } = {};
  if (unsubscribeAll) subscription.unsubscribedAt = new Date();
  else if (emailCategoryKeys.some(key => patch[key] === true)) subscription.unsubscribedAt = null;
  const data = { ...patch, ...categories, ...subscription, updatedAt: new Date() };
  const [row] = await db.insert(emailPreferences).values({ userId, ...emailPreferenceDefaults, ...data })
    .onConflictDoUpdate({ target: emailPreferences.userId, set: data }).returning();
  return row;
}
/**
 * Starts a new account's digest in the browser's time zone instead of UTC (09:00 UTC is 2:30 pm
 * in India). Only creates the row: a time zone already stored, guessed or chosen, always wins.
 * Returns whether it was used.
 */
export async function adoptBrowserTimezone(userId: string, timeZone: unknown) {
  const parsed = timezoneSchema.safeParse(timeZone);
  if (!parsed.success) return false;
  const created = await db.insert(emailPreferences).values({ userId, ...emailPreferenceDefaults, digestTimezone: parsed.data })
    .onConflictDoNothing({ target: emailPreferences.userId }).returning({ userId: emailPreferences.userId });
  return created.length > 0;
}
