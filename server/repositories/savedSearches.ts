import { and, count, eq, inArray, sql } from "drizzle-orm";
import { inboxItems, savedSearches, type SavedSearch } from "@shared/schema";
import { withTenantTransaction, type TenantScope } from "../storage";

/** Phase 3A data access: followed news searches, and which search results are already in the caller's Inbox. */
export const SAVED_SEARCH_LIMIT = 25;
export const SAVED_SEARCH_NAME_MAX = 60;
const INBOX_LOOKUP_LIMIT = 200;

export class SavedSearchLimitError extends Error {
  readonly status = 409;
  constructor() { super(`You can follow up to ${SAVED_SEARCH_LIMIT} searches. Remove one first.`); }
}

const owned = (scope: TenantScope) => and(eq(savedSearches.tenantId, scope.tenantId), eq(savedSearches.userId, scope.userId));
const byId = (scope: TenantScope, id: string) => and(owned(scope), eq(savedSearches.id, id));

export async function listSavedSearches(scope: TenantScope): Promise<SavedSearch[]> {
  return withTenantTransaction(scope, tx => tx.select().from(savedSearches).where(owned(scope))
    .orderBy(sql`lower(${savedSearches.name})`, savedSearches.createdAt, savedSearches.id).limit(SAVED_SEARCH_LIMIT * 2));
}

/** Returns the existing row when the member already follows this query (any case). */
export async function createSavedSearch(scope: TenantScope, input: { query: string; name: string }): Promise<{ search: SavedSearch; created: boolean }> {
  return withTenantTransaction(scope, async tx => {
    // Serializes this member's writers so the cap and the duplicate check cannot race.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["saved-searches", scope.tenantId, scope.userId])}, 0))`);
    const [existing] = await tx.select().from(savedSearches).where(and(owned(scope), sql`lower(${savedSearches.query}) = lower(${input.query})`)).limit(1);
    if (existing) return { search: existing, created: false };
    const [{ total }] = await tx.select({ total: count() }).from(savedSearches).where(owned(scope));
    if (Number(total) >= SAVED_SEARCH_LIMIT) throw new SavedSearchLimitError();
    const [search] = await tx.insert(savedSearches).values({ tenantId: scope.tenantId, userId: scope.userId, query: input.query, name: input.name }).returning();
    return { search, created: true };
  });
}

export async function renameSavedSearch(scope: TenantScope, id: string, name: string): Promise<SavedSearch | undefined> {
  return withTenantTransaction(scope, async tx => (await tx.update(savedSearches).set({ name }).where(byId(scope, id)).returning())[0]);
}

export async function deleteSavedSearch(scope: TenantScope, id: string): Promise<boolean> {
  return withTenantTransaction(scope, async tx => (await tx.delete(savedSearches).where(byId(scope, id)).returning({ id: savedSearches.id })).length > 0);
}

export async function markSavedSearchViewed(scope: TenantScope, id: string): Promise<SavedSearch | undefined> {
  return withTenantTransaction(scope, async tx => (await tx.update(savedSearches).set({ lastViewedAt: sql`now()` }).where(byId(scope, id)).returning())[0]);
}

export interface InboxMatch { id: string; status: string; canonicalUrl: string }

/** The caller's own inbox rows for these canonical URLs (exact match; md5 only uses the index). */
export async function findInboxItemsByCanonicalUrls(scope: TenantScope, canonicalUrls: readonly string[]): Promise<InboxMatch[]> {
  const keys = [...new Set(canonicalUrls)].slice(0, INBOX_LOOKUP_LIMIT);
  if (!keys.length) return [];
  return withTenantTransaction(scope, async tx => {
    const rows = await tx.select({ id: inboxItems.id, status: inboxItems.status, canonicalUrl: inboxItems.canonicalUrl }).from(inboxItems)
      .where(and(eq(inboxItems.tenantId, scope.tenantId), eq(inboxItems.userId, scope.userId),
        inArray(sql`md5(${inboxItems.canonicalUrl})`, keys.map(key => sql`md5(${key})`)), inArray(inboxItems.canonicalUrl, keys)));
    return rows.flatMap(row => row.canonicalUrl ? [{ id: row.id, status: row.status, canonicalUrl: row.canonicalUrl }] : []);
  });
}
