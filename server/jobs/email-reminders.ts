import { and, desc, eq, max, sql } from "drizzle-orm";
import { db } from "../db";
import { drafts, inboxItems, userProfiles, users } from "@shared/schema";
import type { TenantScope } from "../storage";
import { getEmailPreferences } from "../services/email/preferences";
import { digestSlot, preferenceEnabled } from "../services/email/policy";
import { deliverAppEmail, emailTemplates } from "../services/email";
import { reminderStep, reminderSubjectVariant } from "../services/email/reengagement";
import type { ReminderStory } from "../services/email/templates";

export interface ReminderContext {
  email: string;
  firstName: string | null;
  onboarded: boolean;
  /** Latest of sign-up, sign-in (session refresh), new draft or published post. */
  lastActivity: Date;
  /** When earlier reminders went out, including ones still in flight. */
  sent: Date[];
  stories: ReminderStory[];
  topics: string[];
  platform: string;
}

type Deps = {
  getEmailPreferences: typeof getEmailPreferences;
  loadReminderContext: (scope: TenantScope) => Promise<ReminderContext | null>;
  deliverAppEmail: typeof deliverAppEmail;
};

/** Sends this person's weekly reminder if one is due. Runs alongside the digest, at their digest time. */
export async function sendReminderForScope(scope: TenantScope, now = new Date(), deps: Deps = { getEmailPreferences, loadReminderContext, deliverAppEmail }) {
  const preference = await deps.getEmailPreferences(scope.userId);
  if (!preferenceEnabled("re_engagement", preference)) return;
  if (preference.remindersPausedUntil && preference.remindersPausedUntil > now) return;
  const slot = digestSlot(now, preference.digestTimezone, preference.digestTime);
  if (!slot) return;
  const context = await deps.loadReminderContext(scope);
  if (!context?.onboarded) return;
  const step = reminderStep({ now, lastActivity: context.lastActivity, sent: context.sent });
  if (!step) return;
  const content = step === 2 ? emailTemplates.reminderSingle({ story: context.stories[0] ?? null, platform: context.platform })
    : step === 3 ? emailTemplates.reminderCheckIn({ firstName: context.firstName })
    : emailTemplates.reminderWeekly({ firstName: context.firstName, topics: context.topics, stories: context.stories, variant: reminderSubjectVariant(scope.userId, now) });
  await deps.deliverAppEmail({ type: "re_engagement", userId: scope.userId, recipient: context.email, recipientName: context.firstName ?? undefined,
    dedupeKey: JSON.stringify(["reminder-v1", scope.userId, slot]), ...content });
}

// Never put credentials or non-web URLs from legacy inbox rows into an email.
function safeWebUrl(value: string) {
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password; }
  catch { return false; }
}

// `name` falls back to the email address for accounts created without one (migration 0008).
function firstNameOf(firstName: string | null, name: string) {
  const candidate = firstName?.trim() || name.trim().split(/\s+/)[0] || "";
  return candidate && !candidate.includes("@") ? candidate.slice(0, 60) : null;
}

export async function loadReminderContext(scope: TenantScope): Promise<ReminderContext | null> {
  const [user] = await db.select({ email: users.email, firstName: users.firstName, name: users.name, createdAt: users.createdAt })
    .from(users).where(eq(users.id, scope.userId)).limit(1);
  if (!user?.email) return null;
  // sessions and email_deliveries are not tenant tables; Better Auth refreshes a session's updated_at daily while it's used.
  // Epoch milliseconds: raw rows skip Drizzle's UTC mapping of timestamp columns.
  const [signIn] = (await db.execute<{ at: string | null }>(sql`select extract(epoch from max(greatest(created_at, updated_at))) * 1000 as at
    from sessions where user_id = ${scope.userId}`)).rows;
  const sent = (await db.execute<{ at: string }>(sql`select extract(epoch from coalesce(sent_at, created_at)) * 1000 as at from email_deliveries
    where user_id = ${scope.userId} and type = 're_engagement' and status not in ('failed', 'suppressed')`)).rows;
  const tenant = await db.transaction(async tx => {
    await tx.execute(sql`select set_config('app.tenant_id', ${scope.tenantId}, true)`);
    const [profile] = await tx.select({ onboardingStatus: userProfiles.onboardingStatus, keywords: userProfiles.keywords, defaultPlatform: userProfiles.defaultPlatform })
      .from(userProfiles).where(and(eq(userProfiles.tenantId, scope.tenantId), eq(userProfiles.userId, scope.userId))).limit(1);
    const [drafting] = await tx.select({ created: max(drafts.createdAt), published: max(drafts.publishedAt) })
      .from(drafts).where(and(eq(drafts.tenantId, scope.tenantId), eq(drafts.userId, scope.userId)));
    const [usual] = await tx.select({ platform: drafts.platform }).from(drafts)
      .where(and(eq(drafts.tenantId, scope.tenantId), eq(drafts.userId, scope.userId)))
      .groupBy(drafts.platform).orderBy(desc(sql`count(*)`), drafts.platform).limit(1);
    const stories = await tx.select({ source: sql<string>`left(${inboxItems.source}, 120)`, headline: sql<string>`left(${inboxItems.headline}, 300)`,
      url: sql<string>`left(${inboxItems.articleUrl}, 2048)` })
      .from(inboxItems).where(and(eq(inboxItems.tenantId, scope.tenantId), eq(inboxItems.userId, scope.userId), eq(inboxItems.status, "active"),
        // The emails say "this week".
        sql`coalesce(${inboxItems.publishedAt}, ${inboxItems.discoveredAt}, ${inboxItems.createdAt}) > now() - interval '7 days'`))
      .orderBy(sql`coalesce(${inboxItems.rankingScore}, ${inboxItems.relevanceScore}) desc nulls last`, inboxItems.id).limit(10);
    return { profile, drafting, usual, stories };
  });
  const activity = [user.createdAt, tenant.drafting?.created, tenant.drafting?.published]
    .filter((date): date is Date => date != null).map(date => date.getTime());
  if (signIn?.at != null) activity.push(Number(signIn.at));
  const topics = [...(tenant.profile?.keywords ?? [])].sort((a, b) => b.weight - a.weight).map(item => item.keyword.trim()).filter(Boolean).slice(0, 2);
  return {
    email: user.email,
    firstName: firstNameOf(user.firstName, user.name),
    onboarded: tenant.profile?.onboardingStatus === "completed",
    lastActivity: new Date(activity.length ? Math.max(...activity) : Date.now()),
    sent: sent.map(row => new Date(Number(row.at))),
    stories: tenant.stories.filter(story => safeWebUrl(story.url)).slice(0, 3),
    topics,
    platform: tenant.usual?.platform ?? tenant.profile?.defaultPlatform ?? "linkedin",
  };
}
