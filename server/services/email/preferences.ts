import { eq } from "drizzle-orm";
import { db } from "../../db";
import { emailPreferences } from "@shared/schema";
import { emailCategoryKeys, emailPreferenceDefaults, emailPreferencePatch, type EmailPreferencePatch } from "@shared/email-preferences";

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