import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { emailDeliveries, inboxItems, userProfiles, userWatchlists, watchAlerts, type WatchTerm } from "@shared/schema";
import type { WatchAlertView, WatchlistView } from "@shared/moments";
import { withTenantTransaction, type TenantScope, type TenantTx } from "../storage";
import { alertsFor, effectiveWatchTerms, validateWatchSelection, watchOptions, type WatchStory } from "../services/watch-alerts";

const LIST_LIMIT = 50;
const SEEN_LIMIT = 100;
const ALERTS_PER_REFRESH = 200;
const RETENTION_DAYS = 90;
/** Alerts older than this are left for the in-app list only. */
const EMAIL_WINDOW_HOURS = 24;
export const EMAIL_BATCH_SIZE = 10;

export class WatchlistTermError extends Error {
  constructor() { super("Choose companies, people and topics from your profile."); }
}

const mine = (scope: TenantScope) => and(eq(watchAlerts.tenantId, scope.tenantId), eq(watchAlerts.userId, scope.userId));
const hoursAgo = (hours: number, now = new Date()) => new Date(now.getTime() - hours * 3_600_000);

async function readProfile(tx: TenantTx, scope: TenantScope) {
  const [profile] = await tx.select({ keywords: userProfiles.keywords, companies: userProfiles.companies, influencers: userProfiles.influencers })
    .from(userProfiles).where(and(eq(userProfiles.tenantId, scope.tenantId), eq(userProfiles.userId, scope.userId))).limit(1);
  return profile;
}

async function readStoredTerms(tx: TenantTx, scope: TenantScope): Promise<WatchTerm[]> {
  const [row] = await tx.select({ terms: userWatchlists.terms }).from(userWatchlists)
    .where(and(eq(userWatchlists.tenantId, scope.tenantId), eq(userWatchlists.userId, scope.userId))).limit(1);
  return row?.terms ?? [];
}

export async function getWatchlist(scope: TenantScope): Promise<WatchlistView> {
  return withTenantTransaction(scope, async tx => {
    const profile = await readProfile(tx, scope);
    return { terms: effectiveWatchTerms(await readStoredTerms(tx, scope), profile), options: watchOptions(profile) };
  });
}

export async function saveWatchlist(scope: TenantScope, selection: WatchTerm[]): Promise<WatchlistView> {
  return withTenantTransaction(scope, async tx => {
    const profile = await readProfile(tx, scope);
    const terms = validateWatchSelection(selection, profile);
    if (!terms) throw new WatchlistTermError();
    await tx.insert(userWatchlists).values({ ...scope, terms, updatedAt: new Date() })
      .onConflictDoUpdate({ target: [userWatchlists.tenantId, userWatchlists.userId], set: { terms, updatedAt: new Date() } });
    return { terms, options: watchOptions(profile) };
  });
}

/** Called after an inbox refresh admits stories. Deduped per story and term. Returns the number of new alerts. */
export async function recordWatchAlerts(scope: TenantScope, stories: readonly WatchStory[]): Promise<number> {
  if (!stories.length) return 0;
  return withTenantTransaction(scope, async tx => {
    const stored = await readStoredTerms(tx, scope);
    if (!stored.length) return 0;
    const alerts = alertsFor(stories, effectiveWatchTerms(stored, await readProfile(tx, scope))).slice(0, ALERTS_PER_REFRESH);
    if (!alerts.length) return 0;
    const owned = new Set((await tx.select({ id: inboxItems.id }).from(inboxItems).where(and(eq(inboxItems.tenantId, scope.tenantId),
      eq(inboxItems.userId, scope.userId), inArray(inboxItems.id, [...new Set(alerts.map(alert => alert.inboxItemId))])))).map(row => row.id));
    const rows = alerts.filter(alert => owned.has(alert.inboxItemId)).map(alert => ({ ...scope, inboxItemId: alert.inboxItemId, term: alert.term, kind: alert.kind }));
    if (!rows.length) return 0;
    const inserted = await tx.insert(watchAlerts).values(rows)
      .onConflictDoNothing({ target: [watchAlerts.tenantId, watchAlerts.userId, watchAlerts.inboxItemId, watchAlerts.term] })
      .returning({ id: watchAlerts.id });
    await tx.delete(watchAlerts).where(and(mine(scope), lt(watchAlerts.createdAt, hoursAgo(RETENTION_DAYS * 24))));
    return inserted.length;
  });
}

const alertFields = {
  id: watchAlerts.id, inboxItemId: watchAlerts.inboxItemId, term: watchAlerts.term, kind: watchAlerts.kind,
  headline: sql<string>`left(${inboxItems.headline}, 300)`, source: sql<string>`left(${inboxItems.source}, 120)`,
  articleUrl: sql<string>`left(${inboxItems.articleUrl}, 2048)`, createdAt: watchAlerts.createdAt, seenAt: watchAlerts.seenAt,
};
const joinOwnStory = (scope: TenantScope) => and(eq(inboxItems.id, watchAlerts.inboxItemId), eq(inboxItems.tenantId, scope.tenantId), eq(inboxItems.userId, scope.userId));

/** Unseen first, newest first within each group. */
export async function listWatchAlerts(scope: TenantScope, limit = LIST_LIMIT): Promise<WatchAlertView[]> {
  const rows = await withTenantTransaction(scope, tx => tx.select(alertFields).from(watchAlerts)
    .innerJoin(inboxItems, joinOwnStory(scope)).where(mine(scope))
    .orderBy(sql`${watchAlerts.seenAt} is null desc`, desc(watchAlerts.createdAt), asc(watchAlerts.id)).limit(Math.min(limit, LIST_LIMIT)));
  return rows.map(row => ({ ...row, createdAt: row.createdAt.toISOString(), seenAt: row.seenAt?.toISOString() ?? null }));
}

/** Marks the given alerts (or all unseen ones) as seen. Returns how many changed. */
export async function markWatchAlertsSeen(scope: TenantScope, ids?: readonly string[]): Promise<number> {
  return withTenantTransaction(scope, async tx => {
    const rows = await tx.update(watchAlerts).set({ seenAt: new Date() })
      .where(and(mine(scope), isNull(watchAlerts.seenAt), ids ? inArray(watchAlerts.id, ids.slice(0, SEEN_LIMIT)) : undefined))
      .returning({ id: watchAlerts.id });
    return rows.length;
  });
}

export interface AlertEmailState { pendingSlot: string | null; claimable: boolean }
export interface AlertEmailItem { id: string; term: string; kind: string; headline: string; source: string; articleUrl: string }

/** A slot claimed by an earlier cycle but never closed (dispatch failed or crashed) is retried before anything new. */
export async function watchAlertEmailState(scope: TenantScope, now = new Date()): Promise<AlertEmailState> {
  return withTenantTransaction(scope, async tx => {
    const recent = gt(watchAlerts.createdAt, hoursAgo(EMAIL_WINDOW_HOURS, now));
    const [pending] = await tx.select({ slot: watchAlerts.emailSlot }).from(watchAlerts)
      .where(and(mine(scope), recent, isNotNull(watchAlerts.emailSlot), isNull(watchAlerts.emailedAt)))
      .orderBy(asc(watchAlerts.emailSlot)).limit(1);
    if (pending?.slot) return { pendingSlot: pending.slot, claimable: false };
    const [claimable] = await tx.select({ id: watchAlerts.id }).from(watchAlerts)
      .where(and(mine(scope), recent, isNull(watchAlerts.seenAt), isNull(watchAlerts.emailSlot))).limit(1);
    return { pendingSlot: null, claimable: Boolean(claimable) };
  });
}

/** Claims up to EMAIL_BATCH_SIZE unclaimed unseen alerts for `slot` (unless `retry`), then returns the slot's unseen alerts. */
export async function takeWatchAlertBatch(scope: TenantScope, slot: string, retry: boolean, now = new Date()): Promise<AlertEmailItem[]> {
  return withTenantTransaction(scope, async tx => {
    if (!retry) {
      await tx.execute(sql`update watch_alerts set email_slot = ${slot}
        where id in (select id from watch_alerts
          where tenant_id = ${scope.tenantId} and user_id = ${scope.userId} and seen_at is null and email_slot is null
            and created_at > ${hoursAgo(EMAIL_WINDOW_HOURS, now).toISOString()}::timestamptz
          order by created_at, id limit ${EMAIL_BATCH_SIZE} for update skip locked)`);
    }
    return tx.select({ id: watchAlerts.id, term: watchAlerts.term, kind: watchAlerts.kind, headline: alertFields.headline,
      source: alertFields.source, articleUrl: alertFields.articleUrl }).from(watchAlerts)
      .innerJoin(inboxItems, joinOwnStory(scope))
      .where(and(mine(scope), eq(watchAlerts.emailSlot, slot), isNull(watchAlerts.emailedAt), isNull(watchAlerts.seenAt)))
      .orderBy(asc(watchAlerts.createdAt), asc(watchAlerts.id)).limit(EMAIL_BATCH_SIZE);
  });
}

/** Closes a slot once its email was sent, skipped or proven a duplicate. */
export async function closeWatchAlertSlot(scope: TenantScope, slot: string): Promise<void> {
  await withTenantTransaction(scope, tx => tx.update(watchAlerts).set({ emailedAt: new Date() })
    .where(and(mine(scope), eq(watchAlerts.emailSlot, slot), isNull(watchAlerts.emailedAt))));
}

/** At most one watchlist email an hour, counting any attempt that may have reached the provider. */
export async function watchAlertEmailedWithinHour(userId: string): Promise<boolean> {
  const [row] = await db.select({ id: emailDeliveries.id }).from(emailDeliveries)
    .where(and(eq(emailDeliveries.userId, userId), eq(emailDeliveries.type, "watch_alert"),
      inArray(emailDeliveries.status, ["pending", "sending", "sent", "unknown"]), sql`${emailDeliveries.createdAt} > now() - interval '1 hour'`))
    .limit(1);
  return Boolean(row);
}
