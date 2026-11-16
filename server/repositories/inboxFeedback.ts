import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { feedPreferences, inboxFeedback, inboxItems, type FeedPreferencesView } from "@shared/schema";
import { withTenantTransaction, type TenantScope, type TenantTx } from "../storage";
import { EMPTY_FEED_PREFERENCES, sanitizePreferences, type FeedbackItem, type FeedPreferences, type NewFeedback } from "../services/feedbackWeights";

/** Newest feedback rows kept per person; older ones are pruned on write. */
export const FEEDBACK_HISTORY_LIMIT = 500;

export interface FeedbackPlan<T> { next: FeedPreferences; feedback: NewFeedback[]; deleteFeedbackIds?: readonly string[]; result: T }
export interface FeedbackOutcome<T> { result: T; feedbackIds: string[]; preferences: FeedPreferencesView }

const ownPreferences = (scope: TenantScope) => and(eq(feedPreferences.tenantId, scope.tenantId), eq(feedPreferences.userId, scope.userId));
const ownFeedback = (scope: TenantScope) => and(eq(inboxFeedback.tenantId, scope.tenantId), eq(inboxFeedback.userId, scope.userId));

type PreferenceRow = typeof feedPreferences.$inferSelect;
function view(row: PreferenceRow | undefined): FeedPreferencesView {
  const clean = sanitizePreferences(row);
  return { ...clean, revision: row?.revision ?? 0, updatedAt: row ? row.updatedAt.toISOString() : null };
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

async function readRow(tx: TenantTx, scope: TenantScope, lock = false): Promise<PreferenceRow | undefined> {
  const query = tx.select().from(feedPreferences).where(ownPreferences(scope));
  const [row] = lock ? await query.for("update") : await query;
  return row;
}

async function storyFacts(tx: TenantTx, scope: TenantScope, ids: readonly string[]): Promise<FeedbackItem[]> {
  if (!ids.length) return [];
  const rows = await tx.select({ id: inboxItems.id, source: inboxItems.source, matchedKeywords: inboxItems.matchedKeywords }).from(inboxItems)
    .where(and(eq(inboxItems.tenantId, scope.tenantId), eq(inboxItems.userId, scope.userId), inArray(inboxItems.id, [...new Set(ids)])));
  return rows.map(row => ({ id: row.id, source: row.source, matchedKeywords: Array.isArray(row.matchedKeywords) ? row.matchedKeywords : [] }));
}

export const inboxFeedbackRepository = {
  async preferences(scope: TenantScope): Promise<FeedPreferencesView> {
    return withTenantTransaction(scope, async tx => view(await readRow(tx, scope)));
  },

  /** For refreshes: the learned preferences, or none. */
  async load(scope: TenantScope): Promise<FeedPreferences> {
    return withTenantTransaction(scope, async tx => {
      const row = await readRow(tx, scope);
      return row ? sanitizePreferences(row) : { ...EMPTY_FEED_PREFERENCES };
    });
  },

  /**
   * One transaction: lock this person's preferences, read the named stories (their own only),
   * let `plan` decide, then save preferences and feedback. `plan` may throw to reject the request.
   */
  async update<T>(scope: TenantScope, itemIds: readonly string[], plan: (items: FeedbackItem[], current: FeedPreferences) => FeedbackPlan<T>): Promise<FeedbackOutcome<T>> {
    return withTenantTransaction(scope, async tx => {
      await tx.insert(feedPreferences).values({ tenantId: scope.tenantId, userId: scope.userId }).onConflictDoNothing();
      const row = await readRow(tx, scope, true);
      const current = sanitizePreferences(row);
      const decided = plan(await storyFacts(tx, scope, itemIds), current);
      const next = sanitizePreferences(decided.next);
      let saved = row;
      if (!sameJson(next, current)) {
        [saved] = await tx.update(feedPreferences)
          .set({ mutedSources: next.mutedSources, keywordAdjustments: next.keywordAdjustments, revision: sql`${feedPreferences.revision} + 1`, updatedAt: sql`now()` })
          .where(ownPreferences(scope)).returning();
      }
      if (decided.deleteFeedbackIds?.length) await tx.delete(inboxFeedback).where(and(ownFeedback(scope), inArray(inboxFeedback.id, [...decided.deleteFeedbackIds])));
      let feedbackIds: string[] = [];
      if (decided.feedback.length) {
        feedbackIds = (await tx.insert(inboxFeedback).values(decided.feedback.map(entry => ({ ...entry, tenantId: scope.tenantId, userId: scope.userId })))
          .returning({ id: inboxFeedback.id })).map(entry => entry.id);
        const stale = tx.select({ id: inboxFeedback.id }).from(inboxFeedback).where(ownFeedback(scope))
          .orderBy(desc(inboxFeedback.createdAt), desc(inboxFeedback.id)).offset(FEEDBACK_HISTORY_LIMIT);
        await tx.delete(inboxFeedback).where(and(ownFeedback(scope), inArray(inboxFeedback.id, stale)));
      }
      return { result: decided.result, feedbackIds, preferences: view(saved) };
    });
  },

  /** Forget everything learned, including the feedback history; returns exactly what was cleared, read under the row lock. */
  async reset(scope: TenantScope): Promise<{ preferences: FeedPreferencesView; previous: FeedPreferences }> {
    return withTenantTransaction(scope, async tx => {
      const locked = await readRow(tx, scope, true);
      const previous = locked ? sanitizePreferences(locked) : { mutedSources: [], keywordAdjustments: {} };
      await tx.delete(inboxFeedback).where(ownFeedback(scope));
      if (!locked) return { preferences: view(undefined), previous };
      const [row] = await tx.update(feedPreferences).set({ mutedSources: [], keywordAdjustments: {}, revision: sql`${feedPreferences.revision} + 1`, updatedAt: sql`now()` })
        .where(ownPreferences(scope)).returning();
      return { preferences: view(row), previous };
    });
  },
};
