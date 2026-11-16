import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { inboxItems, userProfiles } from "@shared/schema";
import { topPicks } from "@shared/inbox-view";
import { storage, type TenantScope } from "../storage";
import { getEmailPreferences } from "../services/email/preferences";
import { digestSlot, preferenceEnabled } from "../services/email/policy";
import { deliverAppEmail } from "../services/email";
import { mondayPlanEmail, topPicksEmail, type PlanPost, type TopPick } from "../services/email/planning-templates";
import { findMomentsBetween } from "../repositories/moments";
import { addDays, entersLeadWindowDuring, momentMatchesProfile, suggestedAngle, type MomentProfile } from "../services/moments";
import { relevanceSummary } from "../../client/src/lib/relevance-summary";
import { sendWatchAlertsForScope } from "./email-watch-alerts";
import { loadRecipient } from "./email-recipient";

/**
 * Monday plan and weekly top picks. Separate from the daily digest (recent stories, every day) and the weekly
 * summary (last week's counts): these look ahead. They reuse the same preference row, digest time and zone,
 * delivery idempotency (one dedupe key per local Monday) and unsubscribe handling.
 */
const MOMENT_LOOKAHEAD_DAYS = 90;
const TOP_PICK_WINDOW_DAYS = 7;

/** Monday in the person's digest zone, from their digest time onwards. */
export function planWeek(now: Date, timezone: string, time: string) {
  const slot = digestSlot(now, timezone, time);
  if (!slot || new Date(`${slot}T00:00:00Z`).getUTCDay() !== 1) return undefined;
  return { slot, weekStart: slot, weekEnd: addDays(slot, 6), nextMonday: addDays(slot, 7) };
}
export type PlanWeek = NonNullable<ReturnType<typeof planWeek>>;

export interface PlanData { profile: MomentProfile | null; posts: PlanPost[]; draftsWaiting: number }

export async function loadPlanData(scope: TenantScope, week: PlanWeek, timezone: string): Promise<PlanData> {
  return db.transaction(async tx => {
    await tx.execute(sql`select set_config('app.tenant_id', ${scope.tenantId}, true)`);
    const [profile] = await tx.select({ keywords: userProfiles.keywords, companies: userProfiles.companies,
      recommendedIndustry: userProfiles.recommendedIndustry, searchEdition: userProfiles.searchEdition })
      .from(userProfiles).where(and(eq(userProfiles.tenantId, scope.tenantId), eq(userProfiles.userId, scope.userId))).limit(1);
    // Local calendar midnights; schedule times are stored as UTC wall time.
    const start = sql`(${week.weekStart}::date::timestamp at time zone ${timezone})`;
    const end = sql`(${week.nextMonday}::date::timestamp at time zone ${timezone})`;
    const posts = (await tx.execute<{ content: string; at: string }>(sql`select left(d.content, 400) as content,
        extract(epoch from s.scheduled_publish_at at time zone 'UTC') * 1000 as at
      from drafts d
      inner join draft_schedules s on s.draft_id = d.id and s.tenant_id = d.tenant_id
      where d.tenant_id = ${scope.tenantId} and d.user_id = ${scope.userId}
        and d.publish_status in ('scheduled', 'queued') and s.status in ('scheduled', 'queued')
        and exists (select 1 from draft_schedule_targets t where t.draft_schedule_id = s.id and t.tenant_id = d.tenant_id
          and t.platform = 'linkedin' and t.status in ('scheduled', 'queued'))
        and s.scheduled_publish_at at time zone 'UTC' >= ${start} and s.scheduled_publish_at at time zone 'UTC' < ${end}
      order by s.scheduled_publish_at, d.id limit 10`)).rows;
    const [drafts] = (await tx.execute<{ count: number }>(sql`select count(*)::int as count from drafts
      where tenant_id = ${scope.tenantId} and user_id = ${scope.userId} and platform = 'linkedin' and publish_status = 'draft'`)).rows;
    return { profile: profile ?? null, posts: posts.map(post => ({ content: post.content, at: new Date(Number(post.at)) })), draftsWaiting: drafts?.count ?? 0 };
  });
}

type PlanDeps = {
  getEmailPreferences: typeof getEmailPreferences;
  loadRecipient: typeof loadRecipient;
  loadPlanData: typeof loadPlanData;
  findMomentsBetween: typeof findMomentsBetween;
  deliverAppEmail: typeof deliverAppEmail;
};
const planDeps: PlanDeps = { getEmailPreferences, loadRecipient, loadPlanData, findMomentsBetween, deliverAppEmail };

/** Skipped when there is nothing scheduled, no moment to plan for and no draft waiting. */
export async function sendMondayPlanForScope(scope: TenantScope, now = new Date(), deps: PlanDeps = planDeps) {
  const preferences = await deps.getEmailPreferences(scope.userId);
  if (!preferenceEnabled("monday_plan", preferences)) return;
  const week = planWeek(now, preferences.digestTimezone, preferences.digestTime);
  if (!week) return;
  const data = await deps.loadPlanData(scope, week, preferences.digestTimezone);
  const moments = (await deps.findMomentsBetween(week.weekStart, addDays(week.weekEnd, MOMENT_LOOKAHEAD_DAYS)))
    .filter(moment => entersLeadWindowDuring(moment, week.weekStart, week.weekEnd) && momentMatchesProfile(moment, data.profile))
    .map(moment => ({ title: moment.title, date: moment.startsOn, endDate: moment.endsOn, url: moment.url, suggestedAngle: suggestedAngle(moment.title, data.profile) }));
  if (!data.posts.length && !moments.length && !data.draftsWaiting) return;
  const recipient = await deps.loadRecipient(scope);
  if (!recipient) return;
  await deps.deliverAppEmail({
    type: "monday_plan", userId: scope.userId, recipient: recipient.email, recipientName: recipient.name ?? undefined,
    dedupeKey: JSON.stringify(["monday-plan-v1", scope.tenantId, scope.userId, week.slot]),
    ...mondayPlanEmail({ weekStart: week.weekStart, weekEnd: week.weekEnd, timezone: preferences.digestTimezone, posts: data.posts, moments, draftsWaiting: data.draftsWaiting }),
  });
}

export interface TopPickCandidate {
  id: string; source: string; headline: string; url: string;
  matchedKeywords: string[] | null; relevanceScore: string | null; rankingScore: string | null; relevanceReason: string | null;
  evidence: Array<{ type: "keyword" | "company" | "influencer" | "focus"; label: string }> | null;
  publishedAt: Date | null; discoveredAt: Date | null;
}

/** Active, unsnoozed stories added in the last week, best ranked first (bounded). */
export async function loadTopPickCandidates(scope: TenantScope, now = new Date()): Promise<TopPickCandidate[]> {
  return db.transaction(async tx => {
    await tx.execute(sql`select set_config('app.tenant_id', ${scope.tenantId}, true)`);
    const added = sql`coalesce(${inboxItems.discoveredAt}, ${inboxItems.createdAt})`;
    return tx.select({ id: inboxItems.id, source: sql<string>`left(${inboxItems.source}, 120)`, headline: sql<string>`left(${inboxItems.headline}, 300)`,
      url: sql<string>`left(${inboxItems.articleUrl}, 2048)`, matchedKeywords: inboxItems.matchedKeywords, relevanceScore: inboxItems.relevanceScore,
      rankingScore: inboxItems.rankingScore, relevanceReason: sql<string | null>`left(${inboxItems.relevanceReason}, 1000)`,
      evidence: sql<TopPickCandidate["evidence"]>`${inboxItems.qualityMetadata}->'relevance'->'evidence'`,
      publishedAt: inboxItems.publishedAt, discoveredAt: inboxItems.discoveredAt })
      .from(inboxItems).where(and(eq(inboxItems.tenantId, scope.tenantId), eq(inboxItems.userId, scope.userId), eq(inboxItems.status, "active"),
        sql`(${inboxItems.snoozedUntil} is null or ${inboxItems.snoozedUntil} <= ${now.toISOString()}::timestamptz)`,
        sql`${added} >= ${new Date(now.getTime() - TOP_PICK_WINDOW_DAYS * 86_400_000).toISOString()}::timestamptz`))
      .orderBy(sql`coalesce(${inboxItems.rankingScore}, ${inboxItems.relevanceScore}) desc nulls last`, inboxItems.id).limit(100);
  });
}

// Never put credentials or non-web URLs from legacy inbox rows into an email.
const safeWebUrl = (value: string) => {
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password; }
  catch { return false; }
};

/** Top five, one per source first (like the Inbox's Top picks), each with a plain "why". */
export function pickTopStories(candidates: readonly TopPickCandidate[]): TopPick[] {
  return topPicks(candidates.filter(candidate => safeWebUrl(candidate.url))).map(story => ({
    source: story.source, headline: story.headline, url: story.url,
    why: relevanceSummary({ relevanceReason: story.relevanceReason, matchedKeywords: story.matchedKeywords,
      qualityMetadata: Array.isArray(story.evidence) ? { relevance: { evidence: story.evidence } } : null }),
  }));
}

type TopPickDeps = {
  getEmailPreferences: typeof getEmailPreferences;
  loadRecipient: typeof loadRecipient;
  loadTopPickCandidates: typeof loadTopPickCandidates;
  deliverAppEmail: typeof deliverAppEmail;
};
const topPickDeps: TopPickDeps = { getEmailPreferences, loadRecipient, loadTopPickCandidates, deliverAppEmail };

/** The weekly variant of the daily digest: Monday at the digest time. Skipped when there are no stories. */
export async function sendTopPicksForScope(scope: TenantScope, now = new Date(), deps: TopPickDeps = topPickDeps) {
  const preferences = await deps.getEmailPreferences(scope.userId);
  if (!preferenceEnabled("top_picks_weekly", preferences)) return;
  const week = planWeek(now, preferences.digestTimezone, preferences.digestTime);
  if (!week) return;
  const stories = pickTopStories(await deps.loadTopPickCandidates(scope, now));
  if (!stories.length) return;
  const recipient = await deps.loadRecipient(scope);
  if (!recipient) return;
  await deps.deliverAppEmail({
    type: "top_picks_weekly", userId: scope.userId, recipient: recipient.email, recipientName: recipient.name ?? undefined,
    dedupeKey: JSON.stringify(["top-picks-weekly-v1", scope.tenantId, scope.userId, week.slot]),
    ...topPicksEmail(stories),
  });
}

export interface PlanningCycleOptions { plan: boolean; watch: boolean }
const fromEnv = (): PlanningCycleOptions => ({
  plan: process.env.EMAIL_PLANNING_ENABLED === "true",
  watch: process.env.EMAIL_WATCH_ALERTS_ENABLED === "true",
});

let cursor: TenantScope | undefined;
/** One keyset page of members per cycle, rotated for fairness (like the daily digest). */
export async function runPlanningEmailCycle(assertConnected: () => Promise<void> = async () => undefined, options: PlanningCycleOptions = fromEnv()) {
  if (!options.plan && !options.watch) return;
  const deadline = Date.now() + 45_000;
  const page = await storage.getSchedulerScopes(cursor);
  if (!page.length) { cursor = undefined; return; }
  for (const scope of page) {
    if (Date.now() >= deadline) break;
    await assertConnected();
    // One preference read per member per cycle, shared by every email below.
    const preferences = getEmailPreferences(scope.userId);
    const cached = () => preferences;
    const sends: Array<[string, () => Promise<void>]> = [];
    if (options.plan) {
      sends.push(["monday-plan", () => sendMondayPlanForScope(scope, new Date(), { ...planDeps, getEmailPreferences: cached })]);
      sends.push(["top-picks", () => sendTopPicksForScope(scope, new Date(), { ...topPickDeps, getEmailPreferences: cached })]);
    }
    if (options.watch) sends.push(["watch-alerts", () => sendWatchAlertsForScope(scope, new Date(), { getEmailPreferences: cached })]);
    for (const [name, send] of sends) {
      try { await send(); }
      catch { console.error(`[email:${name}] Scoped delivery failed; retry or reconciliation pending`); }
    }
    cursor = scope;
  }
}
