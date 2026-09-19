import {
  users, userProfiles, publicationResolutions, userSourceDeletions, profileSocialLinks, inboxItems, inboxRefreshReceipts, drafts, industrySources, userSources, engineRunLogs,
  socialAccounts, socialOAuthStates, socialAnalytics, draftSchedules, draftScheduleTargets, publishJobLogs, mediaAssets, publishingRules,
  type User, type UserProfile, type PublicationResolution, type InboxItem, type Draft,
  type InsertUserProfile, type ProfileSocialLink, type InsertProfileSocialLink, type InsertInboxItem, type InsertDraft,
  type IndustrySource, type InsertIndustrySource,
  type UserSource, type InsertUserSource,
  type EngineRunLog, type InsertEngineRunLog,
  type SocialAccount, type InsertSocialAccount,
  type SocialAnalyticsSnapshot, type InsertSocialAnalytics,
  type DraftSchedule, type DraftScheduleTarget,
  type PublishJobLog, type InsertPublishJobLog,
  type MediaAsset, type PublishingRule,
} from "@shared/schema";
import { db } from "./db";
import { eq, and, desc, gte, sql, count, inArray, notInArray, gt, or } from "drizzle-orm";
import { tenantMembers, tenants } from "@shared/models/tenancy";
import { randomUUID } from "node:crypto";
import { aggregateScheduleStatus } from "./jobs/schedule-state";
import { assertPublishingPolicy, configuredPublishingMode, reviewFingerprint } from "./services/publishing-policy";
import type { PublishingIntent, PublishingMode } from "@shared/publishing-capabilities";
import { reconciliationSchema, type ReconciliationDecision } from "@shared/publishing-reconciliation";
import { publicationCandidatesSchema, reconcilePublicationCandidates, selectedPublicationCandidates, type PublicationCandidate } from "@shared/publication-preferences";
import { planSearchQueries } from "@shared/search-query-plan";
import { searchEditionSchema, type SearchEditionId } from "@shared/search-editions";
import { canonicalHttpUrl } from "@shared/canonical-url";
import { INBOX_CAPACITY, INBOX_CANDIDATE_LIMIT, InboxOperationConflictError, inboxRefreshMessage, type InboxRefreshResult, type InboxRefreshSnapshot } from "@shared/inbox-refresh";
export { InboxOperationConflictError } from "@shared/inbox-refresh";
import { selectDiverse } from "./services/inboxDiversity";
import { TREND_ROW_LIMIT, TREND_WINDOW_MS, type TrendRow } from "./services/personalTrends";

/** A transaction handle, as drizzle hands it to the transaction callback. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Tenant-scoped data access.
 *
 * Every method that touches per-tenant data takes a TenantScope as its first
 * argument and injects `tenant_id` (and `user_id`) itself. Callers therefore
 * cannot forget to scope a query, and cannot pass a tenant of their choosing:
 * the insert types below have `tenantId` and `userId` removed, so supplying one
 * is a compile error.
 *
 * This is the first of the three isolation layers in the architecture spec.
 * Row-Level Security is the second, and the cross-tenant contract tests are
 * the third — the one that keeps the other two honest.
 */
export interface TenantScope {
  tenantId: string;
  userId: string;
}

/**
 * Internal engine integration contract: use queries IN THIS ORDER and score with
 * this SAME profile, never the caller's earlier snapshot or a second profile read.
 * profile is a detached clone of the full row read under the reservation lock
 * (including keywords, companies, influencers, publications and candidates).
 * Its searchQueryState is the pre-reservation state; the next state is committed
 * before this promise resolves. Do not expose this internal envelope over HTTP.
 */
export interface SearchQueryReservation {
  queries: string[];
  searchEdition: SearchEditionId;
  profile: UserProfile;
}

export type PublicationResolutionOutcome = { status: "failed" | "resolved"; error?: string; sourceId?: string };
export type PublicationResolutionSource = { name: string; feedUrl: string; sourceType: "feed" | "webpage" };

function linkedPublicationCandidates(names: readonly string[], candidates: PublicationCandidate[]): PublicationCandidate[] {
  return publicationCandidatesSchema.refine(items => reconcilePublicationCandidates(names, items).length === items.length,
    "Publication candidates must match selected publication names").parse(candidates);
}

async function lockPublicationProfile(tx: Tx, scope: TenantScope) {
  const [profile] = await tx.select().from(userProfiles).where(and(
    eq(userProfiles.tenantId, scope.tenantId), eq(userProfiles.userId, scope.userId),
  )).for("update");
  return profile;
}

function publicationKey(scope: TenantScope, url: string) {
  return and(eq(publicationResolutions.tenantId, scope.tenantId), eq(publicationResolutions.userId, scope.userId), eq(publicationResolutions.url, url));
}

function selectedPublication(profile: UserProfile | undefined, url: string): boolean {
  return !!profile && selectedPublicationCandidates(profile.publications ?? [], profile.publicationCandidates).some(candidate => candidate.url === url);
}

function activePublicationClaim(scope: TenantScope, url: string, token: string) {
  return and(publicationKey(scope, url), eq(publicationResolutions.status, "checking"),
    eq(publicationResolutions.claimToken, token), sql`${publicationResolutions.leaseUntil} > clock_timestamp()`);
}

/** Caller holds the profile lock; only publication-created sources belong to this selection. */
async function pauseUnselectedPublicationSources(tx: Tx, scope: TenantScope, urls: string[]) {
  // Aliases can reference a source ID, its canonical feed, or the feed URL itself.
  // Never delete or reactivate here; manual/suggestion sources are independent.
  await tx.update(userSources).set({ isActive: false }).where(and(
    eq(userSources.tenantId, scope.tenantId), eq(userSources.userId, scope.userId),
    eq(userSources.addedVia, "publication"), eq(userSources.isActive, true),
    urls.length ? notInArray(userSources.feedUrl, urls) : undefined,
    sql`exists (select 1 from ${publicationResolutions} r
      where r.tenant_id = ${scope.tenantId} and r.user_id = ${scope.userId}
        and r.status = 'resolved' and (r.source_id = ${userSources.id} or r.resolved_feed_url = ${userSources.feedUrl}))`,
    urls.length ? sql`not exists (select 1 from ${publicationResolutions} r
      where r.tenant_id = ${scope.tenantId} and r.user_id = ${scope.userId}
        and r.status = 'resolved' and ${inArray(sql`r.url`, urls)}
        and (r.source_id = ${userSources.id} or r.resolved_feed_url = ${userSources.feedUrl}))` : undefined,
  ));
}

// Raw crawler errors may contain URLs, credentials, markup or internal addresses.
// Persist only fixed public text, never the supplied diagnostic string.
function publicationError(error?: string): string {
  return error === "Publication is no longer selected."
    ? error : "Could not connect this publication. Check its URL and try again.";
}

class PublicationLeaseExpired extends Error {}

/** Fields the repository supplies; callers must not pass them. */
type Scoped<T> = Omit<T, "tenantId" | "userId">;

/** Bounded pagination — every list endpoint must cap rows read, not just paginate the response. */
export interface Pagination {
  limit?: number;
  offset?: number;
  /** Inbox only: opt in for Discover; history/trends remain chronological. */
  order?: "relevance";
  /** Inbox only: exact status filter BEFORE ordering/limit/offset; omitted = all statuses.
   * Includes every matching legacy row (null metadata, duplicates, overcapacity).
   * Read-only: no quality/provenance hiding, backfill, rescoring or reconciliation.
   */
  status?: "active" | "saved" | "dismissed";
}

// Bounds each list read, not the stored history. Dedupe and capacity queries
// deliberately do not use this paginated API.
const SAFETY_CAP = 500;

function clampLimit(limit?: number): number {
  if (!limit || limit <= 0) return SAFETY_CAP;
  return Math.min(limit, SAFETY_CAP);
}

export interface IStorage {
  /** Identity lookup — not tenant-scoped by nature. */
  getUser(id: string): Promise<User | undefined>;

  getUserProfile(scope: TenantScope): Promise<UserProfile | undefined>;
  reserveSearchQueryPlan(scope: TenantScope): Promise<SearchQueryReservation>;
  createUserProfile(scope: TenantScope, profile: Scoped<InsertUserProfile>): Promise<UserProfile>;
  updateUserProfile(scope: TenantScope, data: Partial<Scoped<InsertUserProfile>>): Promise<UserProfile | undefined>;
  getPublicationResolutions(scope: TenantScope, urls: string[]): Promise<PublicationResolution[]>;
  claimPublicationResolution(scope: TenantScope, url: string): Promise<string | undefined>;
  finishPublicationResolution(scope: TenantScope, url: string, token: string, outcome: PublicationResolutionOutcome): Promise<boolean>;
  completePublicationResolution(scope: TenantScope, url: string, token: string, source: PublicationResolutionSource): Promise<boolean>;
  getProfileSocialLinks(scope: TenantScope): Promise<ProfileSocialLink[]>;
  createProfileSocialLink(scope: TenantScope, data: Scoped<InsertProfileSocialLink>): Promise<ProfileSocialLink>;
  updateProfileSocialLink(scope: TenantScope, id: string, data: Partial<Scoped<InsertProfileSocialLink>>): Promise<ProfileSocialLink | undefined>;
  deleteProfileSocialLink(scope: TenantScope, id: string): Promise<void>;
  reorderProfileSocialLinks(scope: TenantScope, ids: string[]): Promise<ProfileSocialLink[]>;

  getInboxItems(scope: TenantScope, page?: Pagination): Promise<InboxItem[]>;
  getInboxDiscoveryWindow(scope: TenantScope, now: Date): Promise<TrendRow[]>;
  getInboxRefreshReceipt(scope: TenantScope, operationId: string, autoRefresh: boolean): Promise<InboxRefreshResult | undefined>;
  beginInboxRefresh(scope: TenantScope, operationId: string, autoRefresh: boolean): Promise<{ receipt?: InboxRefreshResult; snapshot: InboxRefreshSnapshot; activeCount: number }>;
  commitInboxRefresh(scope: TenantScope, operationId: string, autoRefresh: boolean, snapshot: InboxRefreshSnapshot, candidates: Scoped<InsertInboxItem>[], metrics: RefreshMetrics): Promise<InboxRefreshResult>;
  getInboxItemByUrl(scope: TenantScope, articleUrl: string): Promise<InboxItem | undefined>;
  createInboxItem(scope: TenantScope, item: Scoped<InsertInboxItem>): Promise<InboxItem>;
  addInboxItem(scope: TenantScope, item: Scoped<InsertInboxItem>): Promise<{ item: InboxItem; alreadyExists: boolean }>;
  updateInboxItem(scope: TenantScope, id: string, data: { status: string }): Promise<InboxItem | undefined>;
  clearUserInboxItems(scope: TenantScope): Promise<void>;

  getDrafts(scope: TenantScope, page?: Pagination): Promise<Draft[]>;
  createDraft(scope: TenantScope, draft: Scoped<InsertDraft>): Promise<Draft>;
  updateDraft(scope: TenantScope, id: string, data: { content?: string; status?: string }): Promise<Draft | undefined>;
  deleteDraft(scope: TenantScope, id: string): Promise<void>;
  clearUserDrafts(scope: TenantScope): Promise<void>;

  /** Industry sources are global reference data, shared across tenants. */
  getIndustrySources(industry: string): Promise<IndustrySource[]>;
  createIndustrySource(source: InsertIndustrySource): Promise<IndustrySource>;

  /** A user's own explicitly-added Discover sources. */
  getUserSources(scope: TenantScope): Promise<UserSource[]>;
  createUserSource(scope: TenantScope, source: Scoped<InsertUserSource>): Promise<UserSource>;
  updateUserSource(scope: TenantScope, id: string, data: Partial<Scoped<InsertUserSource>> & { lastFetchedAt?: Date; lastFetchStatus?: string | null; lastFetchError?: string | null }): Promise<UserSource | undefined>;
  deleteUserSource(scope: TenantScope, id: string): Promise<void>;

  createEngineRunLog(scope: TenantScope, log: Scoped<InsertEngineRunLog>): Promise<EngineRunLog>;
  updateEngineRunLog(scope: TenantScope, id: string, data: Partial<Scoped<InsertEngineRunLog>>): Promise<EngineRunLog | undefined>;

  getSocialAccounts(scope: TenantScope): Promise<SocialAccount[]>;
  getSocialAccountByProvider(scope: TenantScope, provider: string): Promise<SocialAccount | undefined>;
  createSocialAccount(scope: TenantScope, account: Scoped<InsertSocialAccount>): Promise<SocialAccount>;
  updateSocialAccount(scope: TenantScope, id: string, data: Partial<Scoped<InsertSocialAccount>>): Promise<SocialAccount | undefined>;
  deleteSocialAccount(scope: TenantScope, id: string): Promise<void>;

  getSocialAnalytics(scope: TenantScope, provider?: string, daysBack?: number): Promise<SocialAnalyticsSnapshot[]>;
  getLatestSocialAnalytics(scope: TenantScope, provider: string): Promise<SocialAnalyticsSnapshot | undefined>;
  createSocialAnalytics(scope: TenantScope, analytics: Scoped<InsertSocialAnalytics>): Promise<SocialAnalyticsSnapshot>;

  // Draft scheduling
  scheduleDraftPublish(scope: TenantScope, draftId: string, publishAt: Date, platforms?: string[]): Promise<DraftSchedule>;
  getDraftScheduleTargets(scope: TenantScope, scheduleId: string): Promise<DraftScheduleTarget[]>;
  getDraftScheduleTargetsForPublishing(scope: TenantScope, scheduleId: string): Promise<DraftScheduleTarget[]>;
  updateDraftScheduleTargetStatus(scope: TenantScope, targetId: string, status: string, lastError?: string): Promise<DraftScheduleTarget | undefined>;
  getScheduledDrafts(scope: TenantScope, pagination?: Pagination, platform?: string): Promise<DraftSchedule[]>;
  getScheduledDraftsByStatus(scope: TenantScope, status: string, pagination?: Pagination, platform?: string): Promise<DraftSchedule[]>;
  countScheduledDrafts(scope: TenantScope, status?: string, platform?: string): Promise<number>;
  getDraftSchedule(scope: TenantScope, draftId: string): Promise<DraftSchedule | undefined>;
  getDraftPublishStatus(scope: TenantScope, draftId: string): Promise<{ schedule: (DraftSchedule & { targets: DraftScheduleTarget[] }) | null } | undefined>;
  getScheduledDraftsForPublishing(scope: TenantScope, limit?: number): Promise<DraftSchedule[]>;
  updateDraftScheduleStatus(scope: TenantScope, scheduleId: string, status: string, lastError?: string): Promise<DraftSchedule | undefined>;
  cancelDraftSchedule(scope: TenantScope, draftId: string): Promise<void>;
  markDraftAsPublished(scope: TenantScope, draftId: string): Promise<DraftSchedule | undefined>;

  // Publish logs
  createPublishLog(scope: TenantScope, log: Scoped<InsertPublishJobLog>): Promise<PublishJobLog>;
  getPublishLogs(scope: TenantScope, draftId: string): Promise<PublishJobLog[]>;
  updatePublishLog(scope: TenantScope, logId: string, data: Partial<Scoped<InsertPublishJobLog>>): Promise<PublishJobLog | undefined>;

  createMediaAsset(scope: TenantScope, asset: Omit<typeof mediaAssets.$inferInsert, "tenantId" | "userId" | "createdAt">): Promise<MediaAsset>;
  getMediaAsset(scope: TenantScope, id: string): Promise<MediaAsset | undefined>;
  deleteMediaAsset(scope: TenantScope, id: string): Promise<void>;

  getPublishingRules(scope: TenantScope): Promise<PublishingRule[]>;
  getPublishingRule(scope: TenantScope, platform: string): Promise<PublishingRule | undefined>;
  upsertPublishingRule(scope: TenantScope, platform: string, rule: Partial<Omit<PublishingRule, "tenantId" | "userId" | "platform" | "createdAt" | "updatedAt">>): Promise<PublishingRule>;
}

/**
 * Runs a query inside a transaction with app.tenant_id set transaction-locally,
 * which is what activates the Row-Level Security policies (migration 0002).
 *
 * Transaction-local (`set_config(..., true)`) is essential: a session-level
 * setting would leak to the next request that borrowed the same pooled
 * connection, which is worse than having no policy at all.
 *
 * This costs a BEGIN/SET/COMMIT per repository call. Acceptable at current
 * scale; the architecture spec's request-scoped transaction is the fix when it
 * stops being.
 */
async function scoped<T>(scope: TenantScope, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${scope.tenantId}, true)`);
    return fn(tx);
  });
}

export class ScheduleConflictError extends Error {}

export class InboxCapacityError extends Error {
  constructor() { super(inboxRefreshMessage("capacity")); }
}
export class InboxCanonicalConflictError extends Error {
  constructor() { super("This article already has an active inbox item."); }
}
type RefreshMetrics = Pick<InboxRefreshResult, "articlesProcessed" | "articlesMatched" | "durationMs" | "needsSetup" | "discoveryWarnings">;
function inboxScope(scope: TenantScope) {
  return and(eq(inboxItems.tenantId, scope.tenantId), eq(inboxItems.userId, scope.userId));
}
function inboxCanonicalMatches(keys: string[]) {
  // Match the bounded expression index, but NEVER treat a digest as identity.
  // Exact comparison makes even deliberate MD5 collisions harmless.
  return and(
    inArray(sql`md5(${inboxItems.canonicalUrl})`, keys.map(key => sql`md5(${key})`)),
    inArray(inboxItems.canonicalUrl, keys),
  );
}
async function lockInbox(tx: Tx, scope: TenantScope) {
  // One transaction-scoped lock for EVERY writer, including empty inboxes and
  // users without profiles. JSON encoding avoids delimiter collisions.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["inbox", scope.tenantId, scope.userId])}, 0))`);
}
async function inboxCount(tx: Tx, scope: TenantScope): Promise<number> {
  const [row] = await tx.select({ total: count() }).from(inboxItems).where(and(inboxScope(scope), eq(inboxItems.status, "active")));
  return Number(row.total);
}
async function backfillInboxCanonical(tx: Tx, scope: TenantScope): Promise<void> {
  // No safety-cap blind spot: drain ALL unprocessed history in bounded batches.
  // Invalid old URLs get a sentinel, never match a valid candidate. No deletions.
  for (;;) {
    const rows = await tx.select({ id: inboxItems.id, url: inboxItems.articleUrl }).from(inboxItems)
      .where(and(inboxScope(scope), sql`${inboxItems.canonicalUrl} is null`)).orderBy(inboxItems.id).limit(200);
    if (!rows.length) return;
    const values = rows.map(row => sql`(${row.id}::varchar, ${canonicalHttpUrl(row.url) ?? ""}::text)`);
    await tx.execute(sql`update inbox_items as i set canonical_url = v.url from (values ${sql.join(values, sql`, `)}) as v(id, url)
      where i.id = v.id and i.tenant_id = ${scope.tenantId} and i.user_id = ${scope.userId}`);
  }
}
async function readInboxReceipt(tx: Tx, scope: TenantScope, operationId: string, autoRefresh: boolean): Promise<InboxRefreshResult | undefined> {
  if (!operationId || operationId.length > 200) throw new InboxOperationConflictError();
  const [receipt] = await tx.select().from(inboxRefreshReceipts).where(and(
    eq(inboxRefreshReceipts.tenantId, scope.tenantId), eq(inboxRefreshReceipts.userId, scope.userId),
    eq(inboxRefreshReceipts.operationId, operationId),
  ));
  if (!receipt) return undefined;
  if (receipt.autoRefresh !== autoRefresh) throw new InboxOperationConflictError();
  return { ...receipt.result, items: receipt.result.items.map(item => ({ ...item,
    createdAt: item.createdAt ? new Date(item.createdAt) : null,
    ...(item.publishedAt !== undefined ? { publishedAt: item.publishedAt ? new Date(item.publishedAt) : null } : {}),
    ...(item.discoveredAt !== undefined ? { discoveredAt: item.discoveredAt ? new Date(item.discoveredAt) : null } : {}),
  })) };
}

function ownedSchedule(scope: TenantScope) {
  return sql`exists (select 1 from ${drafts} where ${drafts.id} = ${draftSchedules.draftId}
    and ${drafts.tenantId} = ${scope.tenantId} and ${drafts.userId} = ${scope.userId})`;
}

async function lockScheduledDraft(tx: Tx, scope: TenantScope, scheduleId: string) {
  const [draft] = await tx.select().from(drafts).where(and(
    eq(drafts.tenantId, scope.tenantId), eq(drafts.userId, scope.userId),
    sql`${drafts.id} in (select ${draftSchedules.draftId} from ${draftSchedules}
      where ${draftSchedules.id} = ${scheduleId} and ${draftSchedules.tenantId} = ${scope.tenantId})`,
  )).for("update");
  return draft;
}

/** Caller holds the draft row lock. Child mutation and aggregate commit together. */
async function aggregateSchedule(tx: Tx, scope: TenantScope, scheduleId: string) {
  const targets = await tx.select().from(draftScheduleTargets).where(and(
    eq(draftScheduleTargets.tenantId, scope.tenantId), eq(draftScheduleTargets.draftScheduleId, scheduleId),
  ));
  const status = aggregateScheduleStatus(targets.map((target) => target.status));
  const now = new Date();
  const [schedule] = await tx.update(draftSchedules).set({
    status, updatedAt: now,
    publishedAt: status === "published" ? now : null,
    lastError: targets.find((target) => target.lastError)?.lastError ?? null,
  }).where(and(eq(draftSchedules.id, scheduleId), eq(draftSchedules.tenantId, scope.tenantId), ownedSchedule(scope))).returning();
  if (schedule) await tx.update(drafts).set({
    publishStatus: ["scheduled", "queued", "publishing"].includes(status) ? "scheduled" : status === "cancelled" ? "draft" : status,
    scheduledAt: status === "cancelled" ? null : schedule.scheduledPublishAt,
    publishedAt: status === "published" ? now : null, updatedAt: now,
  }).where(and(eq(drafts.id, schedule.draftId), eq(drafts.tenantId, scope.tenantId), eq(drafts.userId, scope.userId)));
  return schedule;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  // ---------------------------------------------------------------- profiles

  async getUserProfile(scope: TenantScope): Promise<UserProfile | undefined> {
    return scoped(scope, async (tx) => {
      const [profile] = await tx
        .select()
        .from(userProfiles)
        .where(and(eq(userProfiles.tenantId, scope.tenantId), eq(userProfiles.userId, scope.userId)));
      return profile || undefined;
    });
  }

  async createUserProfile(scope: TenantScope, profile: Scoped<InsertUserProfile>): Promise<UserProfile> {
    return scoped(scope, async (tx) => {
      const { searchQueryState: _serverOwnedState, ...safeProfile } = profile;
      if (safeProfile.searchEdition !== undefined) safeProfile.searchEdition = searchEditionSchema.parse(safeProfile.searchEdition);
      const publicationCandidates = linkedPublicationCandidates(profile.publications ?? [], profile.publicationCandidates ?? []);
      const [newProfile] = await tx
        .insert(userProfiles)
        .values({ ...safeProfile, publicationCandidates, tenantId: scope.tenantId, userId: scope.userId })
        .returning();
      return newProfile;
    });
  }

  async reserveSearchQueryPlan(scope: TenantScope): Promise<SearchQueryReservation> {
    return scoped(scope, async tx => {
      // Shared with profile edits/publication lifecycle: read only AFTER acquiring
      // the lock, then persist the next cursor and edition snapshot atomically.
      const profile = await lockPublicationProfile(tx, scope);
      if (!profile) throw new Error("Profile not found");
      const searchEdition = searchEditionSchema.parse(profile.searchEdition);
      const plan = planSearchQueries(profile, profile.searchQueryState);
      await tx.update(userProfiles).set({ searchQueryState: plan.state }).where(and(
        eq(userProfiles.tenantId, scope.tenantId), eq(userProfiles.userId, scope.userId),
      ));
      return { queries: plan.queries, searchEdition, profile: structuredClone(profile) };
    });
  }

  async updateUserProfile(
    scope: TenantScope,
    data: Partial<Scoped<InsertUserProfile>>,
  ): Promise<UserProfile | undefined> {
    return scoped(scope, async (tx) => {
      const existing = await lockPublicationProfile(tx, scope);
      if (!existing) return undefined;
      // Allowlisted rather than spread, so an unexpected key cannot reach the
      // update — including tenantId or userId.
      const safeData: Record<string, unknown> = { updatedAt: new Date() };
      if (data.focusDescription !== undefined) safeData.focusDescription = data.focusDescription;
      if (data.onboardingStatus !== undefined) safeData.onboardingStatus = data.onboardingStatus;
      if (data.recommendedIndustry !== undefined) safeData.recommendedIndustry = data.recommendedIndustry;
      if (data.publications !== undefined) safeData.publications = data.publications;
      if (data.publications !== undefined || data.publicationCandidates !== undefined) {
        const names = data.publications !== undefined ? data.publications ?? [] : existing.publications ?? [];
        const candidates = data.publicationCandidates !== undefined
          ? linkedPublicationCandidates(names, data.publicationCandidates)
          : reconcilePublicationCandidates(names, existing.publicationCandidates);
        safeData.publicationCandidates = candidates;
        const urls = selectedPublicationCandidates(names, candidates).map(candidate => candidate.url);
        await pauseUnselectedPublicationSources(tx, scope, urls);
        // Fence an in-flight attempt even if the URL is subsequently reselected.
        // Keep failed timestamps for retry rotation and resolved rows as tombstones.
        await tx.update(publicationResolutions).set({ status: "failed", claimToken: null, leaseUntil: null,
          error: publicationError("Publication is no longer selected.") }).where(and(
          eq(publicationResolutions.tenantId, scope.tenantId), eq(publicationResolutions.userId, scope.userId),
          eq(publicationResolutions.status, "checking"),
          urls.length ? notInArray(publicationResolutions.url, urls) : undefined,
        ));
      }
      if (data.keywords !== undefined) safeData.keywords = data.keywords;
      if (data.influencers !== undefined) safeData.influencers = data.influencers;
      if (data.companies !== undefined) safeData.companies = data.companies;
      if (data.searchEdition !== undefined) safeData.searchEdition = searchEditionSchema.parse(data.searchEdition);
      if (data.enabledPlatforms !== undefined) safeData.enabledPlatforms = data.enabledPlatforms;
      if (data.defaultPlatform !== undefined) safeData.defaultPlatform = data.defaultPlatform;
      if (data.defaultTone !== undefined) safeData.defaultTone = data.defaultTone;
      if (data.preferredPublishTime !== undefined) safeData.preferredPublishTime = data.preferredPublishTime;
      if (data.timezone !== undefined) safeData.timezone = data.timezone;
      if (data.requirePublishReview !== undefined) safeData.requirePublishReview = data.requirePublishReview;
      if (data.autoPublish !== undefined) safeData.autoPublish = data.autoPublish;
      if (data.dailyDigest !== undefined) safeData.dailyDigest = data.dailyDigest;
      if (data.contentAlerts !== undefined) safeData.contentAlerts = data.contentAlerts;
      if (data.productUpdates !== undefined) safeData.productUpdates = data.productUpdates;

      const [updated] = await tx
        .update(userProfiles)
        .set(safeData)
        .where(and(eq(userProfiles.tenantId, scope.tenantId), eq(userProfiles.userId, scope.userId)))
        .returning();
      return updated || undefined;
    });
  }

  async getPublicationResolutions(scope: TenantScope, urls: string[]): Promise<PublicationResolution[]> {
    const bounded = [...new Set(urls.slice(0, 20))];
    if (!bounded.length) return [];
    return scoped(scope, tx => tx.select().from(publicationResolutions).where(and(
      eq(publicationResolutions.tenantId, scope.tenantId), eq(publicationResolutions.userId, scope.userId),
      inArray(publicationResolutions.url, bounded),
    )).orderBy(publicationResolutions.lastAttemptAt, publicationResolutions.url).limit(20));
  }

  async claimPublicationResolution(scope: TenantScope, url: string): Promise<string | undefined> {
    return scoped(scope, async tx => {
      if (!selectedPublication(await lockPublicationProfile(tx, scope), url)) return undefined;
      const token = randomUUID();
      const attempt = { status: "checking" as const, claimToken: token, error: null, sourceId: null,
        lastAttemptAt: sql`clock_timestamp()`, leaseUntil: sql`clock_timestamp() + interval '30 seconds'` };
      const [claimed] = await tx.insert(publicationResolutions).values({ ...scope, url, ...attempt })
        .onConflictDoUpdate({ target: [publicationResolutions.tenantId, publicationResolutions.userId, publicationResolutions.url],
          set: attempt, setWhere: and(sql`${publicationResolutions.status} != 'resolved'`,
            or(eq(publicationResolutions.status, "failed"), sql`${publicationResolutions.leaseUntil} <= clock_timestamp()`)) })
        .returning({ token: publicationResolutions.claimToken });
      return claimed?.token ?? undefined;
    });
  }

  async finishPublicationResolution(scope: TenantScope, url: string, token: string, outcome: PublicationResolutionOutcome): Promise<boolean> {
    return scoped(scope, async tx => {
      if (!selectedPublication(await lockPublicationProfile(tx, scope), url)) return false;
      let resolvedFeedUrl: string | null = null;
      if (outcome.status === "resolved") {
        if (!outcome.sourceId) return false;
        const [source] = await tx.select().from(userSources).where(and(eq(userSources.id, outcome.sourceId),
          eq(userSources.tenantId, scope.tenantId), eq(userSources.userId, scope.userId))).for("update");
        if (!source) return false;
        resolvedFeedUrl = source.feedUrl;
      }
      const [finished] = await tx.update(publicationResolutions).set({ status: outcome.status,
        error: outcome.status === "failed" ? publicationError(outcome.error) : null,
        resolvedFeedUrl,
        sourceId: outcome.status === "resolved" ? outcome.sourceId ?? null : null, claimToken: null, leaseUntil: null,
      }).where(activePublicationClaim(scope, url, token)).returning({ url: publicationResolutions.url });
      return !!finished;
    });
  }

  async completePublicationResolution(scope: TenantScope, url: string, token: string, source: PublicationResolutionSource): Promise<boolean> {
    try {
      return await scoped(scope, async tx => {
        if (!selectedPublication(await lockPublicationProfile(tx, scope), url)) return false;
        const [claim] = await tx.select().from(publicationResolutions).where(activePublicationClaim(scope, url, token)).for("update");
        if (!claim) return false;
        // Deletion can precede the first discovery. Match the canonical identity,
        // not the candidate URL, and retain the old resolved-row guard for legacy data.
        // Only explicit source creation can clear/repair either durable tombstone.
        const [deletion] = await tx.select().from(userSourceDeletions).where(and(
          eq(userSourceDeletions.tenantId, scope.tenantId), eq(userSourceDeletions.userId, scope.userId),
          eq(userSourceDeletions.feedUrl, source.feedUrl),
        )).limit(1);
        const removed = deletion ?? (await tx.select().from(publicationResolutions).where(and(
          eq(publicationResolutions.tenantId, scope.tenantId), eq(publicationResolutions.userId, scope.userId),
          eq(publicationResolutions.status, "resolved"), eq(publicationResolutions.resolvedFeedUrl, source.feedUrl),
          sql`not exists (select 1 from ${userSources} s where s.tenant_id = ${scope.tenantId}
            and s.user_id = ${scope.userId} and s.id = ${publicationResolutions.sourceId})`,
        )).limit(1))[0];
        if (removed) {
          const [finished] = await tx.update(publicationResolutions).set({ status: "resolved",
            sourceId: removed.sourceId, resolvedFeedUrl: source.feedUrl, error: null, claimToken: null, leaseUntil: null,
          }).where(activePublicationClaim(scope, url, token)).returning({ url: publicationResolutions.url });
          return !!finished;
        }
        // Only the expected scoped feed uniqueness conflict is recoverable.
        const [created] = await tx.insert(userSources).values({ name: source.name, feedUrl: source.feedUrl,
          sourceType: source.sourceType, addedVia: "publication", tenantId: scope.tenantId, userId: scope.userId })
          .onConflictDoNothing({ target: [userSources.tenantId, userSources.userId, userSources.feedUrl] }).returning();
        const linked = created ?? (await tx.select().from(userSources).where(and(eq(userSources.tenantId, scope.tenantId),
          eq(userSources.userId, scope.userId), eq(userSources.feedUrl, source.feedUrl))).for("update"))[0];
        // Concurrent deletion or a lease that expired while waiting must roll back the insert.
        if (!linked) throw new PublicationLeaseExpired();
        const [finished] = await tx.update(publicationResolutions).set({ status: "resolved", sourceId: linked.id,
          resolvedFeedUrl: linked.feedUrl, error: null, claimToken: null, leaseUntil: null }).where(activePublicationClaim(scope, url, token))
          .returning({ url: publicationResolutions.url });
        if (!finished) throw new PublicationLeaseExpired();
        return true;
      });
    } catch (error) {
      if (error instanceof PublicationLeaseExpired) return false;
      throw error;
    }
  }

  async getProfileSocialLinks(scope: TenantScope): Promise<ProfileSocialLink[]> {
    return scoped(scope, (tx) => tx.select().from(profileSocialLinks).where(and(eq(profileSocialLinks.tenantId, scope.tenantId), eq(profileSocialLinks.userId, scope.userId))).orderBy(profileSocialLinks.sortOrder, profileSocialLinks.createdAt));
  }

  async createProfileSocialLink(scope: TenantScope, data: Scoped<InsertProfileSocialLink>): Promise<ProfileSocialLink> {
    return scoped(scope, async (tx) => {
      const [link] = await tx.insert(profileSocialLinks).values({ ...data, tenantId: scope.tenantId, userId: scope.userId }).returning();
      return link;
    });
  }

  async updateProfileSocialLink(scope: TenantScope, id: string, data: Partial<Scoped<InsertProfileSocialLink>>): Promise<ProfileSocialLink | undefined> {
    return scoped(scope, async (tx) => {
      const [link] = await tx.update(profileSocialLinks).set({ ...data, updatedAt: new Date() }).where(and(eq(profileSocialLinks.id, id), eq(profileSocialLinks.tenantId, scope.tenantId), eq(profileSocialLinks.userId, scope.userId))).returning();
      return link || undefined;
    });
  }

  async deleteProfileSocialLink(scope: TenantScope, id: string): Promise<void> {
    await scoped(scope, (tx) => tx.delete(profileSocialLinks).where(and(eq(profileSocialLinks.id, id), eq(profileSocialLinks.tenantId, scope.tenantId), eq(profileSocialLinks.userId, scope.userId))).then(() => undefined));
  }

  async reorderProfileSocialLinks(scope: TenantScope, ids: string[]): Promise<ProfileSocialLink[]> {
    return scoped(scope, async (tx) => {
      for (const [sortOrder, id] of ids.entries()) {
        await tx.update(profileSocialLinks).set({ sortOrder, updatedAt: new Date() }).where(and(eq(profileSocialLinks.id, id), eq(profileSocialLinks.tenantId, scope.tenantId), eq(profileSocialLinks.userId, scope.userId)));
      }
      return tx.select().from(profileSocialLinks).where(and(eq(profileSocialLinks.tenantId, scope.tenantId), eq(profileSocialLinks.userId, scope.userId))).orderBy(profileSocialLinks.sortOrder, profileSocialLinks.createdAt);
    });
  }

  // ------------------------------------------------------------------- inbox

  async getInboxRefreshReceipt(scope: TenantScope, operationId: string, autoRefresh: boolean) {
    return scoped(scope, tx => readInboxReceipt(tx, scope, operationId, autoRefresh));
  }

  async beginInboxRefresh(scope: TenantScope, operationId: string, autoRefresh: boolean) {
    return scoped(scope, async tx => {
      await lockInbox(tx, scope);
      const receipt = await readInboxReceipt(tx, scope, operationId, autoRefresh);
      const activeCount = await inboxCount(tx, scope);
      const snapshot = autoRefresh && !receipt ? await tx.select({ id: inboxItems.id, version: inboxItems.version })
        .from(inboxItems).where(and(inboxScope(scope), eq(inboxItems.status, "active")))
        .orderBy(inboxItems.createdAt, inboxItems.id).limit(INBOX_CAPACITY) : [];
      return { receipt, snapshot, activeCount };
    });
  }

  async commitInboxRefresh(scope: TenantScope, operationId: string, autoRefresh: boolean,
    snapshot: InboxRefreshSnapshot, candidates: Scoped<InsertInboxItem>[], metrics: RefreshMetrics): Promise<InboxRefreshResult> {
    return scoped(scope, async tx => {
      await lockInbox(tx, scope);
      const receipt = await readInboxReceipt(tx, scope, operationId, autoRefresh);
      if (receipt) return receipt;
      await backfillInboxCanonical(tx, scope);
      const unique = new Map<string, Scoped<InsertInboxItem>>();
      for (const item of candidates.slice(0, INBOX_CANDIDATE_LIMIT)) {
        const key = canonicalHttpUrl(item.articleUrl);
        if (key && !unique.has(key)) unique.set(key, item);
      }
      const history = unique.size ? await tx.select({ key: inboxItems.canonicalUrl }).from(inboxItems)
        .where(and(inboxScope(scope), inboxCanonicalMatches([...unique.keys()]))) : [];
      for (const row of history) if (row.key) unique.delete(row.key);
      const activeCount = await inboxCount(tx, scope);
      const eligible = autoRefresh && activeCount <= INBOX_CAPACITY && snapshot.length
        ? await tx.select({ id: inboxItems.id, version: inboxItems.version }).from(inboxItems)
          .where(and(inboxScope(scope), eq(inboxItems.status, "active"), inArray(inboxItems.id, snapshot.map(row => row.id)))) : [];
      const versions = new Map(eligible.map(row => [row.id, row.version]));
      const unchanged = snapshot.filter(row => versions.get(row.id) === row.version);
      const free = Math.max(0, INBOX_CAPACITY - activeCount);
      // Legacy overcapacity: neither grow nor reconcile/destructively replace.
      const selected = selectDiverse([...unique.values()], activeCount > INBOX_CAPACITY ? 0 : Math.min(INBOX_CAPACITY, free + unchanged.length))
        .map(item => [canonicalHttpUrl(item.articleUrl)!, item] as const);
      const replacedCount = Math.max(0, selected.length - free);
      for (const row of unchanged.slice(0, replacedCount)) {
        await tx.update(inboxItems).set({ status: "dismissed", version: sql`${inboxItems.version} + 1` })
          .where(and(inboxScope(scope), eq(inboxItems.id, row.id), eq(inboxItems.status, "active"), eq(inboxItems.version, row.version)));
      }
      const items: InboxItem[] = [];
      for (const [canonicalUrl, item] of selected) {
        const [created] = await tx.insert(inboxItems).values({ ...item, ...scope, canonicalUrl, version: 0, status: "active", discoveredAt: sql`clock_timestamp()` }).returning();
        items.push(created);
      }
      const outcome = items.length ? "updated" : metrics.needsSetup ? "needs_setup"
        : activeCount >= INBOX_CAPACITY && (!autoRefresh || unique.size > 0 || activeCount > INBOX_CAPACITY) ? "capacity" : "no_new";
      const result: InboxRefreshResult = { ...metrics, success: true, outcome, count: items.length,
        newInboxItems: items.length, articlesCreated: items.length, items, activeCount: await inboxCount(tx, scope),
        replacedCount, message: inboxRefreshMessage(outcome, items.length) };
      await tx.insert(inboxRefreshReceipts).values({ ...scope, operationId, autoRefresh, result });
      return result;
    });
  }

  async getInboxItems(scope: TenantScope, page: Pagination = {}): Promise<InboxItem[]> {
    return scoped(scope, async (tx) => {
      return tx
        .select()
        .from(inboxItems)
        .where(and(inboxScope(scope), page.status === undefined ? undefined : eq(inboxItems.status, page.status)))
        .orderBy(...(page.order === "relevance"
          ? [sql`coalesce(${inboxItems.rankingScore}, ${inboxItems.relevanceScore}) desc nulls last`, desc(inboxItems.createdAt), inboxItems.id]
          : [desc(inboxItems.createdAt)]))
        .limit(clampLimit(page.limit))
        .offset(page.offset && page.offset > 0 ? page.offset : 0);
    });
  }

  async getInboxItemByUrl(scope: TenantScope, articleUrl: string): Promise<InboxItem | undefined> {
    return scoped(scope, async (tx) => {
      await lockInbox(tx, scope);
      await backfillInboxCanonical(tx, scope);
      const key = canonicalHttpUrl(articleUrl);
      if (!key) return undefined;
      const [item] = await tx
        .select()
        .from(inboxItems)
        .where(
          and(
            eq(inboxItems.tenantId, scope.tenantId),
            eq(inboxItems.userId, scope.userId),
            inboxCanonicalMatches([key]),
          ),
        );
      return item || undefined;
    });
  }

  async getInboxDiscoveryWindow(scope: TenantScope, now: Date): Promise<TrendRow[]> {
    if (!Number.isFinite(now.getTime())) throw new Error("Invalid discovery window");
    return scoped(scope, tx => tx.select({ articleUrl: inboxItems.articleUrl, headline: inboxItems.headline,
      source: inboxItems.source, discoveredAt: inboxItems.discoveredAt, matchedKeywords: inboxItems.matchedKeywords,
      relevanceScore: inboxItems.relevanceScore, qualityMetadata: inboxItems.qualityMetadata }).from(inboxItems)
      .where(and(inboxScope(scope), gte(inboxItems.discoveredAt, new Date(now.getTime() - 2 * TREND_WINDOW_MS)),
        sql`${inboxItems.discoveredAt} < ${now}`, sql`${inboxItems.relevanceScore} > 0`,
        sql`case when jsonb_typeof(${inboxItems.qualityMetadata}->'relevance'->'evidence') = 'array'
          then jsonb_array_length(${inboxItems.qualityMetadata}->'relevance'->'evidence') > 0 else false end`))
      .orderBy(inboxItems.discoveredAt, inboxItems.id).limit(TREND_ROW_LIMIT + 1));
  }

  async createInboxItem(scope: TenantScope, item: Scoped<InsertInboxItem>): Promise<InboxItem> {
    return (await this.addInboxItem(scope, item)).item;
  }

  async addInboxItem(scope: TenantScope, item: Scoped<InsertInboxItem>): Promise<{ item: InboxItem; alreadyExists: boolean }> {
    return scoped(scope, async (tx) => {
      await lockInbox(tx, scope);
      await backfillInboxCanonical(tx, scope);
      const canonicalUrl = canonicalHttpUrl(item.articleUrl);
      if (!canonicalUrl) throw new Error("Invalid HTTP(S) article URL");
      const [existing] = await tx.select().from(inboxItems).where(and(inboxScope(scope), inboxCanonicalMatches([canonicalUrl]))).limit(1);
      if (existing) return { item: existing, alreadyExists: true }; // Never reactivate historical saved/dismissed rows.
      if ((item.status ?? "active") === "active" && await inboxCount(tx, scope) >= INBOX_CAPACITY) throw new InboxCapacityError();
      const [newItem] = await tx
        .insert(inboxItems)
        .values({ ...item, tenantId: scope.tenantId, userId: scope.userId, canonicalUrl, version: 0, discoveredAt: sql`clock_timestamp()` })
        .returning();
      return { item: newItem, alreadyExists: false };
    });
  }

  async updateInboxItem(
    scope: TenantScope,
    id: string,
    data: Partial<{ status: string; relevanceScore?: number; relevanceReason?: string }>,
  ): Promise<InboxItem | undefined> {
    return scoped(scope, async (tx) => {
      await lockInbox(tx, scope);
      const [existing] = await tx.select().from(inboxItems).where(and(inboxScope(scope), eq(inboxItems.id, id)));
      if (!existing) return undefined;
      if (data.status === "active" && existing.status !== "active") {
        await backfillInboxCanonical(tx, scope);
        const key = canonicalHttpUrl(existing.articleUrl);
        if (key) {
          const [duplicate] = await tx.select({ id: inboxItems.id }).from(inboxItems).where(and(
            inboxScope(scope), eq(inboxItems.status, "active"), inboxCanonicalMatches([key]),
          )).limit(1);
          if (duplicate) throw new InboxCanonicalConflictError();
        }
        if (await inboxCount(tx, scope) >= INBOX_CAPACITY) throw new InboxCapacityError();
      }
      const updateData: Record<string, unknown> = { version: sql`${inboxItems.version} + 1` };
      if (data.status !== undefined) updateData.status = data.status;
      if (data.relevanceScore !== undefined) {
        updateData.relevanceScore = String(data.relevanceScore);
        // An independent rescore invalidates the old policy/evidence snapshot.
        updateData.rankingScore = null;
        updateData.qualityMetadata = null;
      }
      if (data.relevanceReason !== undefined) updateData.relevanceReason = data.relevanceReason;

      const [updated] = await tx
        .update(inboxItems)
        .set(updateData)
        .where(
          and(
            eq(inboxItems.id, id),
            eq(inboxItems.tenantId, scope.tenantId),
            eq(inboxItems.userId, scope.userId),
          ),
        )
        .returning();
      return updated || undefined;
    });
  }

  async clearUserInboxItems(scope: TenantScope): Promise<void> {
    return scoped(scope, async (tx) => {
      await lockInbox(tx, scope);
      await tx
        .delete(inboxItems)
        .where(and(eq(inboxItems.tenantId, scope.tenantId), eq(inboxItems.userId, scope.userId)));
    });
  }

  // ------------------------------------------------------------------ drafts

  async getDrafts(scope: TenantScope, page: Pagination = {}): Promise<Draft[]> {
    return scoped(scope, async (tx) => {
      // Drizzle removes Column qualifiers in single-table SELECT projections,
      // including nested SQL. Keep this correlation explicitly in the outer
      // drafts scope; neither joined receipt table's unqualified id is valid.
      const draftId = sql`${drafts}.${sql.identifier(drafts.id.name)}`;
      const rows = await tx
        .select({ draft: drafts, liveReceipt: sql<boolean>`exists (
          select 1 from draft_schedules s join draft_schedule_targets t on t.draft_schedule_id = s.id
          where s.draft_id = ${draftId} and s.tenant_id = ${scope.tenantId} and t.tenant_id = ${scope.tenantId}
        ) and not exists (
          select 1 from draft_schedules s join draft_schedule_targets t on t.draft_schedule_id = s.id
          where s.draft_id = ${draftId} and s.tenant_id = ${scope.tenantId} and t.tenant_id = ${scope.tenantId}
          and (t.status <> 'published' or t.execution_mode is distinct from 'live' or t.receipt_kind is distinct from 'provider_id'
            or nullif(trim(t.provider_post_id), '') is null or t.provider_post_id ~* '^(sandbox|mock|dryrun|dry-run)[_-]')
        )` })
        .from(drafts)
        .where(and(eq(drafts.tenantId, scope.tenantId), eq(drafts.userId, scope.userId)))
        .orderBy(desc(drafts.updatedAt))
        .limit(clampLimit(page.limit))
        .offset(page.offset && page.offset > 0 ? page.offset : 0);
      // Legacy success flags are not proof of live delivery. Keep stored history
      // intact, but never let old synthetic receipts inflate live UI counts.
      return rows.map(({ draft, liveReceipt }) => draft.publishStatus === "published" && !liveReceipt
        ? { ...draft, publishStatus: "legacy_unverified", publishedAt: null } : draft);
    });
  }

  async createDraft(scope: TenantScope, draft: Scoped<InsertDraft>): Promise<Draft> {
    return scoped(scope, async (tx) => {
      const [newDraft] = await tx
        .insert(drafts)
        .values({ ...draft, tenantId: scope.tenantId, userId: scope.userId, status: "draft", publishStatus: "draft", publishedAt: null, scheduledAt: null, publishApprovalHash: null, publishApprovedAt: null, publishApprovedBy: null })
        .returning();
      return newDraft;
    });
  }

  async updateDraft(
    scope: TenantScope,
    id: string,
    data: { content?: string; status?: string },
  ): Promise<Draft | undefined> {
    return scoped(scope, async (tx) => {
      // Serialize edits with scheduling/worker claims. A route-only preflight
      // would race a claim and rewrite the content behind a delivery receipt.
      const [draft] = await tx.select().from(drafts).where(and(
        eq(drafts.id, id), eq(drafts.tenantId, scope.tenantId), eq(drafts.userId, scope.userId),
      )).for("update");
      if (!draft) return undefined;
      const schedules = await tx.select().from(draftSchedules).where(and(
        eq(draftSchedules.draftId, id), eq(draftSchedules.tenantId, scope.tenantId),
      ));
      const targets = schedules.length ? await tx.select().from(draftScheduleTargets).where(and(
        inArray(draftScheduleTargets.draftScheduleId, schedules.map((schedule) => schedule.id)),
        eq(draftScheduleTargets.tenantId, scope.tenantId),
      )) : [];
      const [receipt] = await tx.select({ id: publishJobLogs.id }).from(publishJobLogs).where(and(
        eq(publishJobLogs.draftId, id), eq(publishJobLogs.tenantId, scope.tenantId),
        or(inArray(publishJobLogs.status, ["published", "success", "unknown"]), sql`${publishJobLogs.publishedPostId} is not null`),
      )).limit(1);
      const editableStates = ["draft", "scheduled", "queued", "failed", "cancelled"];
      if (draft.status === "published" || draft.publishedAt || !["draft", "scheduled", "failed"].includes(draft.publishStatus)
        || schedules.some((schedule) => schedule.publishedAt || !editableStates.includes(schedule.status))
        || targets.some((target) => target.publishedAt || !editableStates.includes(target.status)) || receipt) {
        throw new ScheduleConflictError("Published, partially delivered, in-flight or uncertain drafts are immutable. Copy to a new draft to make changes.");
      }
      const safeData: Record<string, unknown> = { updatedAt: new Date() };
      if (data.status !== undefined && data.status !== "draft") throw new ScheduleConflictError("Delivery status is server-owned");
      if (data.content !== undefined) {
        safeData.content = data.content;
        safeData.publishApprovalHash = null;
        safeData.publishApprovedAt = null;
        safeData.publishApprovedBy = null;
      }
      if (data.status !== undefined) safeData.status = data.status;

      const [updated] = await tx
        .update(drafts)
        .set(safeData)
        .where(
          and(
            eq(drafts.id, id),
            eq(drafts.tenantId, scope.tenantId),
            eq(drafts.userId, scope.userId),
          ),
        )
        .returning();
      return updated || undefined;
    });
  }

  async deleteDraft(scope: TenantScope, id: string): Promise<void> {
    return scoped(scope, async (tx) => {
      const [draft] = await tx.select().from(drafts).where(and(eq(drafts.id, id), eq(drafts.tenantId, scope.tenantId), eq(drafts.userId, scope.userId))).for("update");
      if (!draft) return;
      const [schedule] = await tx.select({ id: draftSchedules.id }).from(draftSchedules).where(and(eq(draftSchedules.draftId, id), eq(draftSchedules.tenantId, scope.tenantId)));
      const [history] = await tx.select({ id: publishJobLogs.id }).from(publishJobLogs).where(and(eq(publishJobLogs.draftId, id), eq(publishJobLogs.tenantId, scope.tenantId))).limit(1);
      if (schedule || history || draft.publishStatus !== "draft" || draft.publishedAt) throw new ScheduleConflictError("Publishing records must be retained with their audit history. Only untouched drafts can be deleted.");
      await tx
        .delete(drafts)
        .where(
          and(
            eq(drafts.id, id),
            eq(drafts.tenantId, scope.tenantId),
            eq(drafts.userId, scope.userId),
          ),
        );
    });
  }

  async clearUserDrafts(scope: TenantScope): Promise<void> {
    return scoped(scope, async (tx) => {
      await tx.select({ id: drafts.id }).from(drafts).where(and(eq(drafts.tenantId, scope.tenantId), eq(drafts.userId, scope.userId))).for("update");
      await tx
        .delete(drafts)
        .where(and(eq(drafts.tenantId, scope.tenantId), eq(drafts.userId, scope.userId), eq(drafts.publishStatus, "draft"), sql`${drafts.publishedAt} is null`,
          sql`not exists (select 1 from ${draftSchedules} where ${draftSchedules.draftId} = ${drafts.id} and ${draftSchedules.tenantId} = ${scope.tenantId})`,
          sql`not exists (select 1 from ${publishJobLogs} where ${publishJobLogs.draftId} = ${drafts.id} and ${publishJobLogs.tenantId} = ${scope.tenantId})`));
    });
  }

  // --------------------------------------------------- global reference data

  async getIndustrySources(industry: string): Promise<IndustrySource[]> {
    return db
      .select()
      .from(industrySources)
      .where(and(eq(industrySources.industry, industry), eq(industrySources.isActive, true)))
      .orderBy(desc(industrySources.priority));
  }

  async createIndustrySource(source: InsertIndustrySource): Promise<IndustrySource> {
    const [created] = await db.insert(industrySources).values(source).returning();
    return created;
  }

  // ------------------------------------------------------------- user sources

  async getUserSources(scope: TenantScope): Promise<UserSource[]> {
    return scoped(scope, async (tx) => {
      return tx
        .select()
        .from(userSources)
        .where(and(eq(userSources.tenantId, scope.tenantId), eq(userSources.userId, scope.userId)))
        .orderBy(desc(userSources.createdAt));
    });
  }

  async createUserSource(scope: TenantScope, source: Scoped<InsertUserSource>): Promise<UserSource> {
    return scoped(scope, async (tx) => {
      await lockPublicationProfile(tx, scope);
      const [created] = await tx
        .insert(userSources)
        .values({ ...source, tenantId: scope.tenantId, userId: scope.userId })
        .returning();
      if (["manual", "suggestion"].includes(created.addedVia)) {
        await tx.delete(userSourceDeletions).where(and(
          eq(userSourceDeletions.tenantId, scope.tenantId), eq(userSourceDeletions.userId, scope.userId),
          eq(userSourceDeletions.feedUrl, created.feedUrl),
        ));
        // Exact canonical identity only, scoped to both tenant and user. Preserve
        // status, attempt time and leases; a GET must never perform this repair.
        await tx.update(publicationResolutions).set({ sourceId: created.id }).where(and(
          eq(publicationResolutions.tenantId, scope.tenantId), eq(publicationResolutions.userId, scope.userId),
          eq(publicationResolutions.status, "resolved"), eq(publicationResolutions.resolvedFeedUrl, created.feedUrl),
          sql`not exists (select 1 from ${userSources} s where s.tenant_id = ${scope.tenantId}
            and s.user_id = ${scope.userId} and s.id = ${publicationResolutions.sourceId})`,
        ));
      }
      return created;
    });
  }

  async updateUserSource(
    scope: TenantScope,
    id: string,
    data: Partial<Scoped<InsertUserSource>> & { lastFetchedAt?: Date; lastFetchStatus?: string | null; lastFetchError?: string | null },
  ): Promise<UserSource | undefined> {
    return scoped(scope, async (tx) => {
      await lockPublicationProfile(tx, scope);
      const [updated] = await tx
        .update(userSources)
        .set(data)
        .where(and(eq(userSources.id, id), eq(userSources.tenantId, scope.tenantId), eq(userSources.userId, scope.userId)))
        .returning();
      return updated || undefined;
    });
  }

  async deleteUserSource(scope: TenantScope, id: string): Promise<void> {
    return scoped(scope, async (tx) => {
      await lockPublicationProfile(tx, scope);
      const [deleted] = await tx
        .delete(userSources)
        .where(and(eq(userSources.id, id), eq(userSources.tenantId, scope.tenantId), eq(userSources.userId, scope.userId)))
        .returning({ id: userSources.id, feedUrl: userSources.feedUrl });
      if (!deleted) return;
      // Separate from input-URL resolution rows: this canonical URL may itself
      // already be an input resolved to a different feed. Never overwrite that row.
      await tx.insert(userSourceDeletions).values({ ...scope, feedUrl: deleted.feedUrl, sourceId: deleted.id })
        .onConflictDoUpdate({ target: [userSourceDeletions.tenantId, userSourceDeletions.userId, userSourceDeletions.feedUrl],
          set: { sourceId: deleted.id, deletedAt: sql`clock_timestamp()` } });
      // Discovery has not supplied canonical identities yet, so conservatively
      // fence all outstanding claims in this profile. Other profiles are untouched.
      // Resolved tombstones (including canonical identity and attempt time) survive.
      await tx.update(publicationResolutions).set({ status: "failed", claimToken: null,
        leaseUntil: null, error: publicationError() }).where(and(
        eq(publicationResolutions.tenantId, scope.tenantId), eq(publicationResolutions.userId, scope.userId),
        eq(publicationResolutions.status, "checking"),
      ));
    });
  }

  // ------------------------------------------------------------ engine runs

  async createEngineRunLog(scope: TenantScope, log: Scoped<InsertEngineRunLog>): Promise<EngineRunLog> {
    return scoped(scope, async (tx) => {
      const [created] = await tx
        .insert(engineRunLogs)
        .values({ ...log, tenantId: scope.tenantId, userId: scope.userId })
        .returning();
      return created;
    });
  }

  async updateEngineRunLog(
    scope: TenantScope,
    id: string,
    data: Partial<Scoped<InsertEngineRunLog>>,
  ): Promise<EngineRunLog | undefined> {
    return scoped(scope, async (tx) => {
      const [updated] = await tx
        .update(engineRunLogs)
        .set(data)
        .where(and(eq(engineRunLogs.id, id), eq(engineRunLogs.tenantId, scope.tenantId)))
        .returning();
      return updated || undefined;
    });
  }

  // --------------------------------------------------------- social accounts

  async createSocialOAuthState(scope: TenantScope, data: { stateDigest: string; provider: string; sessionBinding: string; expiresAt: Date }): Promise<void> {
    await scoped(scope, async tx => {
      await tx.delete(socialOAuthStates).where(and(eq(socialOAuthStates.tenantId, scope.tenantId),
        eq(socialOAuthStates.userId, scope.userId), sql`${socialOAuthStates.expiresAt} <= clock_timestamp()`));
      await tx.insert(socialOAuthStates).values({ ...data, ...scope });
    }).catch(() => { throw new Error("Could not start connection; retry from Connections"); });
  }

  /** Atomic delete/returning: only the authorized session can spend this nonce. */
  async consumeSocialOAuthState(scope: TenantScope, data: { stateDigest: string; provider: string; sessionBinding: string }): Promise<boolean> {
    return scoped(scope, async tx => {
      const [consumed] = await tx.delete(socialOAuthStates).where(and(
        eq(socialOAuthStates.tenantId, scope.tenantId), eq(socialOAuthStates.userId, scope.userId),
        eq(socialOAuthStates.stateDigest, data.stateDigest), eq(socialOAuthStates.provider, data.provider),
        eq(socialOAuthStates.sessionBinding, data.sessionBinding), sql`${socialOAuthStates.expiresAt} > clock_timestamp()`,
      )).returning({ digest: socialOAuthStates.stateDigest });
      return !!consumed;
    }).catch(() => { throw new Error("Could not verify connection; restart from Connections"); });
  }

  async getSocialAccounts(scope: TenantScope): Promise<SocialAccount[]> {
    return scoped(scope, async (tx) => {
      return tx
        .select()
        .from(socialAccounts)
        .where(and(eq(socialAccounts.tenantId, scope.tenantId), eq(socialAccounts.userId, scope.userId)))
        .orderBy(desc(socialAccounts.createdAt));
    });
  }

  async getSocialAccountByProvider(
    scope: TenantScope,
    provider: string,
  ): Promise<SocialAccount | undefined> {
    return scoped(scope, async (tx) => {
      const [account] = await tx
        .select()
        .from(socialAccounts)
        .where(
          and(
            eq(socialAccounts.tenantId, scope.tenantId),
            eq(socialAccounts.userId, scope.userId),
            eq(socialAccounts.provider, provider),
          ),
        );
      return account || undefined;
    });
  }

  async createSocialAccount(
    scope: TenantScope,
    account: Scoped<InsertSocialAccount>,
  ): Promise<SocialAccount> {
    const { encryptSocialAccountCredentials } = await import("./services/webhookSecrets");
    const encrypted = encryptSocialAccountCredentials(account);
    return scoped(scope, async (tx) => {
      const [newAccount] = await tx
        .insert(socialAccounts)
        .values({ ...encrypted, tenantId: scope.tenantId, userId: scope.userId, credentialVersion: 0 })
        .returning();
      return newAccount;
    }).catch(() => { throw new Error("Could not store social account credentials"); });
  }

  /**
   * Previously filtered on `id` alone — no user or tenant predicate — while
   * deleteSocialAccount below did filter. Any caller passing a client-supplied
   * id would have had a cross-tenant write.
   */
  async updateSocialAccount(
    scope: TenantScope,
    id: string,
    data: Partial<Scoped<InsertSocialAccount>>,
    expectedCredentialVersion?: number,
  ): Promise<SocialAccount | undefined> {
    const { encryptSocialAccountCredentials } = await import("./services/webhookSecrets");
    const encrypted = encryptSocialAccountCredentials(data);
    return scoped(scope, async (tx) => {
      const [updated] = await tx
        .update(socialAccounts)
        .set({ ...encrypted, id, tenantId: scope.tenantId, userId: scope.userId,
          credentialVersion: sql`${socialAccounts.credentialVersion} + 1`, updatedAt: new Date() })
        .where(
          and(
            eq(socialAccounts.id, id),
            eq(socialAccounts.tenantId, scope.tenantId),
            eq(socialAccounts.userId, scope.userId),
            expectedCredentialVersion === undefined ? undefined : eq(socialAccounts.credentialVersion, expectedCredentialVersion),
          ),
        )
        .returning();
      return updated || undefined;
    }).catch(() => { throw new Error("Could not update social account credentials"); });
  }

  async compareAndSwapSocialCredentials(scope: TenantScope, id: string, version: number,
    credentials: { accessToken: string; refreshToken?: string; tokenExpiresAt: Date | null }): Promise<SocialAccount | undefined> {
    if (!Number.isSafeInteger(version) || version < 0) throw new Error("Connection version unavailable; reconnect before refreshing");
    // Allowlist: refresh must never change the provider identity or active state.
    return this.updateSocialAccount(scope, id, { accessToken: credentials.accessToken,
      ...(credentials.refreshToken === undefined ? {} : { refreshToken: credentials.refreshToken }),
      tokenExpiresAt: credentials.tokenExpiresAt }, version);
  }

  async deleteSocialAccount(scope: TenantScope, id: string): Promise<void> {
    return scoped(scope, async (tx) => {
      await tx
        .delete(socialAccounts)
        .where(
          and(
            eq(socialAccounts.id, id),
            eq(socialAccounts.tenantId, scope.tenantId),
            eq(socialAccounts.userId, scope.userId),
          ),
        );
    });
  }

  /** Explicit operator maintenance only. No request/startup/read path calls this. */
  async migrateSocialAccountCredentials(scope: TenantScope, options: { dryRun?: boolean; afterId?: string; limit?: number; rotate?: boolean } = {}) {
    const limit = options.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("Invalid credential migration batch size");
    const dryRun = options.dryRun !== false;
    const { socialCredentialMigrationPatch } = await import("./services/webhookSecrets");
    try {
      return await scoped(scope, async tx => {
        const rows = await tx.select().from(socialAccounts).where(and(
          eq(socialAccounts.tenantId, scope.tenantId), eq(socialAccounts.userId, scope.userId),
          options.afterId === undefined ? undefined : gt(socialAccounts.id, options.afterId),
        )).orderBy(socialAccounts.id).limit(limit).for("update");
        let candidates = 0;
        for (const row of rows) {
          const data = socialCredentialMigrationPatch(row, options.rotate);
          if (!Object.keys(data).length) continue;
          candidates++;
          if (!dryRun) await tx.update(socialAccounts).set({ ...data, credentialVersion: sql`${socialAccounts.credentialVersion} + 1` }).where(and(
            eq(socialAccounts.id, row.id), eq(socialAccounts.tenantId, scope.tenantId), eq(socialAccounts.userId, scope.userId),
          ));
        }
        return { dryRun, scanned: rows.length, candidates, updated: dryRun ? 0 : candidates,
          nextAfterId: rows.at(-1)?.id ?? options.afterId ?? null, done: rows.length < limit };
      });
    } catch {
      // DB drivers can embed SQL parameters (including tokens) in their errors.
      throw new Error("Credential migration batch failed; no batch changes committed");
    }
  }

  // -------------------------------------------------------- social analytics

  async getSocialAnalytics(
    scope: TenantScope,
    provider?: string,
    daysBack: number = 30,
  ): Promise<SocialAnalyticsSnapshot[]> {
    return scoped(scope, async (tx) => {
      const sinceDate = new Date();
      sinceDate.setDate(sinceDate.getDate() - daysBack);

      const predicates = [
        eq(socialAnalytics.tenantId, scope.tenantId),
        eq(socialAnalytics.userId, scope.userId),
        gte(socialAnalytics.snapshotDate, sinceDate),
      ];
      if (provider) predicates.push(eq(socialAnalytics.provider, provider));

      return tx
        .select()
        .from(socialAnalytics)
        .where(and(...predicates))
        .orderBy(desc(socialAnalytics.snapshotDate));
    });
  }

  async getLatestSocialAnalytics(
    scope: TenantScope,
    provider: string,
  ): Promise<SocialAnalyticsSnapshot | undefined> {
    return scoped(scope, async (tx) => {
      const [latest] = await tx
        .select()
        .from(socialAnalytics)
        .where(
          and(
            eq(socialAnalytics.tenantId, scope.tenantId),
            eq(socialAnalytics.userId, scope.userId),
            eq(socialAnalytics.provider, provider),
          ),
        )
        .orderBy(desc(socialAnalytics.snapshotDate))
        .limit(1);
      return latest || undefined;
    });
  }

  async createSocialAnalytics(
    scope: TenantScope,
    analytics: Scoped<InsertSocialAnalytics>,
  ): Promise<SocialAnalyticsSnapshot> {
    return scoped(scope, async (tx) => {
      const [created] = await tx
        .insert(socialAnalytics)
        .values({ ...analytics, tenantId: scope.tenantId, userId: scope.userId })
        .returning();
      return created;
    });
  }

  // Draft scheduling methods
  async approveDraftForPublishing(scope: TenantScope, draftId: string, expectedContent: string, expectedUpdatedAt: string): Promise<Draft | undefined> {
    return scoped(scope, async tx => {
      const [draft] = await tx.select().from(drafts).where(and(eq(drafts.id, draftId), eq(drafts.tenantId, scope.tenantId), eq(drafts.userId, scope.userId))).for("update");
      if (!draft) return undefined;
      if (draft.content !== expectedContent || draft.updatedAt?.getTime() !== new Date(expectedUpdatedAt).getTime()) throw new ScheduleConflictError("Draft changed. Reload and review the current content.");
      if (!["draft", "scheduled", "failed"].includes(draft.publishStatus)) throw new ScheduleConflictError("This draft cannot be approved in its current delivery state.");
      return (await tx.update(drafts).set({ publishApprovalHash: reviewFingerprint(draft), publishApprovedBy: scope.userId, publishApprovedAt: new Date() }).where(eq(drafts.id, draft.id)).returning())[0];
    });
  }

  async checkDraftPublishingPolicy(scope: TenantScope, draftId: string, platforms: string[], intent: PublishingIntent, mode = configuredPublishingMode()): Promise<void> {
    await scoped(scope, async tx => {
      const [draft] = await tx.select().from(drafts).where(and(eq(drafts.id, draftId), eq(drafts.tenantId, scope.tenantId), eq(drafts.userId, scope.userId))).for("update");
      if (!draft) throw new ScheduleConflictError("Draft not found");
      await assertPublishingPolicy(tx, scope, draft, platforms, intent, mode);
    });
  }

  /** Final pre-effect gate also verifies this worker still owns the claim. */
  async authorizePublishClaim(scope: TenantScope, draftId: string, targetId: string, token: string): Promise<void> {
    await scoped(scope, async tx => {
      const [draft] = await tx.select().from(drafts).where(and(eq(drafts.id, draftId), eq(drafts.tenantId, scope.tenantId), eq(drafts.userId, scope.userId))).for("update");
      if (!draft) throw new ScheduleConflictError("Draft not found");
      const [target] = await tx.select().from(draftScheduleTargets).innerJoin(draftSchedules, eq(draftSchedules.id, draftScheduleTargets.draftScheduleId)).where(and(eq(draftScheduleTargets.id, targetId), eq(draftScheduleTargets.tenantId, scope.tenantId), eq(draftSchedules.draftId, draftId), eq(draftScheduleTargets.claimToken, token), eq(draftScheduleTargets.status, "publishing")));
      const current = target?.draft_schedule_targets;
      if (!current || !["sandbox", "dry-run", "live"].includes(current.executionMode ?? "")) throw new ScheduleConflictError("Claim is stale or has no admitted execution mode");
      await assertPublishingPolicy(tx, scope, draft, [current.platform], current.intent as PublishingIntent, current.executionMode as PublishingMode);
    });
  }

  async reconcilePublishTarget(scope: TenantScope, draftId: string, targetId: string, input: ReconciliationDecision): Promise<DraftScheduleTarget | undefined> {
    const decision = reconciliationSchema.parse(input);
    return scoped(scope, async tx => {
      const [draft] = await tx.select().from(drafts).where(and(eq(drafts.id, draftId), eq(drafts.tenantId, scope.tenantId), eq(drafts.userId, scope.userId))).for("update");
      if (!draft) return undefined;
      const [schedule] = await tx.select().from(draftSchedules).where(and(eq(draftSchedules.draftId, draftId), eq(draftSchedules.tenantId, scope.tenantId)));
      if (!schedule) return undefined;
      const [target] = await tx.select().from(draftScheduleTargets).where(and(eq(draftScheduleTargets.id, targetId), eq(draftScheduleTargets.tenantId, scope.tenantId), eq(draftScheduleTargets.draftScheduleId, schedule.id)));
      if (!target) return undefined;
      if (target.revision !== decision.expectedRevision || !["unknown", "publishing", "accepted_unverified"].includes(target.status)) throw new ScheduleConflictError("Target changed or does not require reconciliation. Reload its current state.");
      if (target.status === "publishing" && (!target.updatedAt || target.updatedAt.getTime() > Date.now() - 5 * 60_000)) throw new ScheduleConflictError("Worker may still be active. Reconciliation is blocked for five minutes after claim.");
      if (decision.decision === "delivered" && target.executionMode !== "live") throw new ScheduleConflictError("A non-live attempt cannot be claimed as delivered.");
      const status = decision.decision === "delivered" ? "manual_published" : decision.decision === "not_delivered" ? "failed" : "unknown";
      const [updated] = await tx.update(draftScheduleTargets).set({ status, claimToken: null, revision: target.revision + 1, receiptKind: "manual", publishedAt: null,
        lastError: decision.decision === "not_delivered" ? "Operator recorded not delivered. Explicit retry requires current policy." : decision.decision === "delivered" ? "Manual delivery claim; not provider-verified." : "Outcome unresolved; replay blocked.", updatedAt: new Date() })
        .where(and(eq(draftScheduleTargets.id, targetId), eq(draftScheduleTargets.tenantId, scope.tenantId), eq(draftScheduleTargets.revision, decision.expectedRevision))).returning();
      if (!updated) throw new ScheduleConflictError("Target changed during reconciliation");
      await tx.insert(publishJobLogs).values({ tenantId: scope.tenantId, draftId, draftScheduleId: schedule.id, targetId, claimToken: target.claimToken, executionMode: target.executionMode,
        platform: target.platform, status, receiptKind: "manual", actorUserId: scope.userId, evidence: { decision: decision.decision, note: decision.note, receipt: decision.receipt, workerStopped: decision.workerStopped, previousStatus: target.status, previousRevision: target.revision }, completedAt: new Date() });
      await aggregateSchedule(tx, scope, schedule.id);
      return updated;
    });
  }

  async getDraft(scope: TenantScope, draftId: string): Promise<Draft | undefined> {
    return scoped(scope, async (tx) => (await tx.select().from(drafts).where(and(
      eq(drafts.id, draftId), eq(drafts.tenantId, scope.tenantId), eq(drafts.userId, scope.userId),
    )).limit(1))[0]);
  }

  /** Identity tables are global; all subsequent domain queries are RLS scoped. */
  async getSchedulerScopes(after?: TenantScope): Promise<TenantScope[]> {
    return db.select({ tenantId: tenantMembers.tenantId, userId: tenantMembers.userId })
      .from(tenantMembers).innerJoin(tenants, eq(tenants.id, tenantMembers.tenantId))
      .where(and(eq(tenants.status, "active"), after ? or(
        gt(tenantMembers.tenantId, after.tenantId),
        and(eq(tenantMembers.tenantId, after.tenantId), gt(tenantMembers.userId, after.userId)),
      ) : undefined)).orderBy(tenantMembers.tenantId, tenantMembers.userId).limit(100);
  }

  async getSchedulerActivity(scope: TenantScope): Promise<{ active: boolean; engagement: number }> {
    return scoped(scope, async (tx) => {
      const result = await tx.execute(sql`select
        (exists(select 1 from inbox_items where tenant_id = ${scope.tenantId} and user_id = ${scope.userId} and created_at > now() - interval '30 days')
        or exists(select 1 from drafts where tenant_id = ${scope.tenantId} and user_id = ${scope.userId} and updated_at > now() - interval '30 days')) as active,
        ((select count(*) from inbox_items where tenant_id = ${scope.tenantId} and user_id = ${scope.userId} and status = 'saved')
        + (select count(*) from drafts where tenant_id = ${scope.tenantId} and user_id = ${scope.userId} and status != 'draft')) as engagement`);
      return { active: Boolean(result.rows[0]?.active), engagement: Number(result.rows[0]?.engagement ?? 0) };
    });
  }

  async scheduleDraftPublish(scope: TenantScope, draftId: string, publishAt: Date, platforms?: string[], intent: PublishingIntent = "schedule"): Promise<DraftSchedule> {
    return scoped(scope, async (tx) => {
      if (!Number.isFinite(publishAt.getTime())) throw new ScheduleConflictError("Invalid publication time");
      const [draft] = await tx.select().from(drafts).where(and(eq(drafts.id, draftId), eq(drafts.tenantId, scope.tenantId), eq(drafts.userId, scope.userId))).for("update");
      if (!draft) throw new ScheduleConflictError("Draft not found");
      const [existing] = await tx.select().from(draftSchedules).where(and(eq(draftSchedules.draftId, draftId), eq(draftSchedules.tenantId, scope.tenantId)));
      const previous = existing ? await tx.select().from(draftScheduleTargets).where(and(eq(draftScheduleTargets.draftScheduleId, existing.id), eq(draftScheduleTargets.tenantId, scope.tenantId))) : [];
      if (previous.some((target) => ["publishing", "unknown"].includes(target.status)) || (existing && ["publishing", "unknown"].includes(existing.status))) {
        throw new ScheduleConflictError("Publication is in flight or its outcome is unknown; reconcile with the provider before rescheduling");
      }
      if (draft.publishStatus === "published") throw new ScheduleConflictError("Draft is already published");
      if (previous.some(target => ["simulated", "manual_published", "accepted_unverified"].includes(target.status))) throw new ScheduleConflictError("Copy this completed draft to make a new explicit publication.");
      const retained = previous.filter((target) => target.status !== "cancelled");
      const defaults = (retained.length ? retained : previous).map((target) => target.platform);
      const targetPlatforms = platforms?.length ? [...new Set(platforms)] : defaults;
      if (!targetPlatforms.length) targetPlatforms.push(draft.platform);
      const mode = configuredPublishingMode();
      await assertPublishingPolicy(tx, scope, draft, targetPlatforms, intent, mode);
      // Create or update schedule, update draft status
      const [schedule] = await tx
        .insert(draftSchedules)
        .values({
          tenantId: scope.tenantId,
          draftId,
          scheduledPublishAt: publishAt,
          status: "scheduled",
        })
        .onConflictDoUpdate({
          target: draftSchedules.draftId,
          set: {
            scheduledPublishAt: publishAt,
            status: "scheduled",
            lastError: null,
            publishedAt: null,
            updatedAt: new Date(),
          },
        })
        .returning();

      // Update draft status
      await tx
        .update(drafts)
        .set({ publishStatus: "scheduled", scheduledAt: publishAt, updatedAt: new Date() })
        .where(and(eq(drafts.id, draftId), eq(drafts.tenantId, scope.tenantId), eq(drafts.userId, scope.userId)));

      // Fresh IDs fence every previously queued delivery, even at the same publish time.
      // Keep successful targets as durable dedupe records; never reschedule them.
      for (const target of previous.filter(target => target.status !== "published")) {
        await tx.insert(publishJobLogs).values({ tenantId: scope.tenantId, draftId, draftScheduleId: schedule.id, targetId: target.id,
          platform: target.platform, executionMode: target.executionMode, status: "superseded", actorUserId: scope.userId,
          evidence: { decision: "reschedule", note: "Explicit schedule replaced this target generation", workerStopped: false, previousStatus: target.status, previousRevision: target.revision }, completedAt: new Date() });
      }
      await tx.delete(draftScheduleTargets).where(and(eq(draftScheduleTargets.tenantId, scope.tenantId), eq(draftScheduleTargets.draftScheduleId, schedule.id), sql`${draftScheduleTargets.status} != 'published'`));
      for (const platform of targetPlatforms) {
        await tx.insert(draftScheduleTargets).values({ tenantId: scope.tenantId, draftScheduleId: schedule.id, platform, status: "scheduled", executionMode: mode, intent }).onConflictDoNothing();
      }

      return (await aggregateSchedule(tx, scope, schedule.id))!;
    });
  }

  async getDraftScheduleTargets(scope: TenantScope, scheduleId: string): Promise<DraftScheduleTarget[]> {
    return scoped(scope, async (tx) => {
      const [schedule] = await tx.select().from(draftSchedules).where(and(eq(draftSchedules.id, scheduleId), eq(draftSchedules.tenantId, scope.tenantId), ownedSchedule(scope)));
      if (!schedule) return [];
      return tx.select().from(draftScheduleTargets).where(and(eq(draftScheduleTargets.tenantId, scope.tenantId), eq(draftScheduleTargets.draftScheduleId, scheduleId)));
    });
  }

  async getDraftScheduleTargetsForPublishing(scope: TenantScope, scheduleId: string): Promise<DraftScheduleTarget[]> {
    return scoped(scope, async (tx) => {
      const draft = await lockScheduledDraft(tx, scope, scheduleId);
      if (!draft) return [];
      const [schedule] = await tx.select().from(draftSchedules).where(eq(draftSchedules.id, scheduleId));
      if (!schedule || !["scheduled", "queued", "publishing"].includes(schedule.status)) return [];
      let targets = await tx.select().from(draftScheduleTargets).where(and(eq(draftScheduleTargets.draftScheduleId, scheduleId), eq(draftScheduleTargets.tenantId, scope.tenantId)));
      // Upgrade only untouched legacy schedules. Never guess the outcome of an old in-flight job.
      if (!targets.length && schedule.status === "scheduled") targets = await tx.insert(draftScheduleTargets).values({ tenantId: scope.tenantId, draftScheduleId: scheduleId, platform: draft.platform }).returning();
      return targets.filter((target) => ["scheduled", "queued"].includes(target.status));
    });
  }

  async updateDraftScheduleTargetStatus(scope: TenantScope, targetId: string, status: string, lastError?: string): Promise<DraftScheduleTarget | undefined> {
    return scoped(scope, async (tx) => {
      const [existing] = await tx.select().from(draftScheduleTargets).where(and(eq(draftScheduleTargets.id, targetId), eq(draftScheduleTargets.tenantId, scope.tenantId)));
      if (!existing || !await lockScheduledDraft(tx, scope, existing.draftScheduleId)) return undefined;
      // Delivery transitions require claimPublishTarget/finishPublishTarget.
      if (!["queued", "failed", "cancelled"].includes(status)) throw new ScheduleConflictError("Use the target lifecycle API for this transition");
      const [target] = await tx.update(draftScheduleTargets).set({ status, lastError: lastError ?? null, updatedAt: new Date() }).where(and(eq(draftScheduleTargets.id, targetId), eq(draftScheduleTargets.tenantId, scope.tenantId), inArray(draftScheduleTargets.status, ["scheduled", "queued"]))).returning();
      if (target) await aggregateSchedule(tx, scope, target.draftScheduleId);
      return target;
    });
  }

  async getScheduledDrafts(scope: TenantScope, pagination?: Pagination, platform?: string): Promise<DraftSchedule[]> {
    return scoped(scope, async (tx) => {
      const limit = clampLimit(pagination?.limit);
      const offset = pagination?.offset || 0;

      const rows = await tx
        .select({ schedule: draftSchedules })
        .from(draftSchedules)
        .innerJoin(drafts, eq(drafts.id, draftSchedules.draftId))
        .where(and(eq(draftSchedules.tenantId, scope.tenantId), eq(drafts.userId, scope.userId), platform ? eq(drafts.platform, platform) : undefined))
        .orderBy(desc(draftSchedules.scheduledPublishAt))
        .limit(limit)
        .offset(offset);
      return rows.map(({ schedule }) => schedule);
    });
  }

  async getScheduledDraftsByStatus(
    scope: TenantScope,
    status: string,
    pagination?: Pagination,
    platform?: string,
  ): Promise<DraftSchedule[]> {
    return scoped(scope, async (tx) => {
      const limit = clampLimit(pagination?.limit);
      const offset = pagination?.offset || 0;

      const rows = await tx
        .select({ schedule: draftSchedules })
        .from(draftSchedules)
        .innerJoin(drafts, eq(drafts.id, draftSchedules.draftId))
        .where(
          and(
            eq(draftSchedules.tenantId, scope.tenantId),
            eq(drafts.userId, scope.userId),
            eq(draftSchedules.status, status),
            status === "published" ? liveScheduleEvidence(scope) : undefined,
            platform ? eq(drafts.platform, platform) : undefined,
          ),
        )
        .orderBy(draftSchedules.scheduledPublishAt)
        .limit(limit)
        .offset(offset);
      return rows.map(({ schedule }) => schedule);
    });
  }

  async countScheduledDrafts(scope: TenantScope, status?: string, platform?: string): Promise<number> {
    return scoped(scope, async (tx) => {
      const [result] = await tx
        .select({ total: count() })
        .from(draftSchedules)
        .innerJoin(drafts, eq(drafts.id, draftSchedules.draftId))
        .where(and(
          eq(draftSchedules.tenantId, scope.tenantId),
          eq(drafts.userId, scope.userId),
          status ? eq(draftSchedules.status, status) : undefined,
          status === "published" ? liveScheduleEvidence(scope) : undefined,
          platform ? eq(drafts.platform, platform) : undefined,
        ));
      return Number(result?.total ?? 0);
    });
  }

  async getDraftSchedule(scope: TenantScope, draftId: string): Promise<DraftSchedule | undefined> {
    return scoped(scope, async (tx) => {
      const [schedule] = await tx
        .select()
        .from(draftSchedules)
        .where(
          and(
            eq(draftSchedules.tenantId, scope.tenantId),
            eq(draftSchedules.draftId, draftId),
            ownedSchedule(scope),
          ),
        );
      return schedule || undefined;
    });
  }

  async getDraftPublishStatus(scope: TenantScope, draftId: string): Promise<{ schedule: (DraftSchedule & { targets: DraftScheduleTarget[] }) | null } | undefined> {
    return scoped(scope, async (tx) => {
      // One SELECT uses one MVCC snapshot even at READ COMMITTED. Separate
      // repository calls (or SELECTs in a default transaction) can mix times.
      const rows = await tx.select({ draftId: drafts.id, schedule: draftSchedules, target: draftScheduleTargets })
        .from(drafts)
        .leftJoin(draftSchedules, and(eq(draftSchedules.draftId, drafts.id), eq(draftSchedules.tenantId, scope.tenantId)))
        .leftJoin(draftScheduleTargets, and(eq(draftScheduleTargets.draftScheduleId, draftSchedules.id), eq(draftScheduleTargets.tenantId, scope.tenantId)))
        .where(and(eq(drafts.id, draftId), eq(drafts.tenantId, scope.tenantId), eq(drafts.userId, scope.userId)));
      if (!rows.length) return undefined;
      const schedule = rows[0].schedule;
      const targets = rows.flatMap(({ target }) => target ? [target] : []).map(target => target.status === "published"
        && (target.executionMode !== "live" || target.receiptKind !== "provider_id" || !target.providerPostId?.trim() || /^(sandbox|mock|dryrun|dry-run)[_-]/i.test(target.providerPostId))
        ? { ...target, status: "legacy_unverified", publishedAt: null } : target);
      const legacy = targets.some(target => target.status === "legacy_unverified") || (!targets.length && schedule?.status === "published");
      return { schedule: schedule ? { ...schedule, ...(legacy ? { status: "legacy_unverified", publishedAt: null } : {}), targets } : null };
    });
  }

  async getScheduledDraftsForPublishing(scope: TenantScope, limit = 50): Promise<DraftSchedule[]> {
    return scoped(scope, (tx) => tx
      .select()
      .from(draftSchedules)
      .where(
        and(
          eq(draftSchedules.tenantId, scope.tenantId),
          ownedSchedule(scope),
          inArray(draftSchedules.status, ["scheduled", "queued", "publishing"]),
          gte(sql`NOW()`, draftSchedules.scheduledPublishAt),
          sql`(exists (select 1 from ${draftScheduleTargets} where ${draftScheduleTargets.draftScheduleId} = ${draftSchedules.id}
            and ${draftScheduleTargets.tenantId} = ${scope.tenantId} and ${draftScheduleTargets.status} in ('scheduled', 'queued'))
            or (${draftSchedules.status} = 'scheduled' and not exists (select 1 from ${draftScheduleTargets} where ${draftScheduleTargets.draftScheduleId} = ${draftSchedules.id})))`,
        ),
      )
      .orderBy(draftSchedules.scheduledPublishAt)
      .limit(clampLimit(limit)));
  }

  async claimPublishTarget(scope: TenantScope, data: { draftId: string; draftScheduleId: string; draftScheduleTargetId?: string; platform: string; publishAt: Date | string }): Promise<(Draft & { publishClaim: { token: string; mode: string | null; intent: string } }) | undefined> {
    // Old jobs without a concrete target generation must never publish.
    const targetId = data.draftScheduleTargetId;
    if (!targetId) return undefined;
    return scoped(scope, async (tx) => {
      const draft = await lockScheduledDraft(tx, scope, data.draftScheduleId);
      if (!draft || draft.id !== data.draftId) return undefined;
      const [schedule] = await tx.select().from(draftSchedules).where(eq(draftSchedules.id, data.draftScheduleId));
      if (!schedule || !["scheduled", "queued", "publishing"].includes(schedule.status)
        || schedule.scheduledPublishAt.getTime() !== new Date(data.publishAt).getTime()
        || schedule.scheduledPublishAt.getTime() > Date.now()) return undefined;
      const token = randomUUID();
      const [target] = await tx.update(draftScheduleTargets).set({ status: "publishing", claimToken: token, revision: sql`${draftScheduleTargets.revision} + 1`, retryCount: sql`coalesce(${draftScheduleTargets.retryCount}, 0) + 1`, updatedAt: new Date() })
        .where(and(eq(draftScheduleTargets.id, targetId), eq(draftScheduleTargets.draftScheduleId, schedule.id),
          eq(draftScheduleTargets.tenantId, scope.tenantId), eq(draftScheduleTargets.platform, data.platform),
          inArray(draftScheduleTargets.status, ["scheduled", "queued"])) ).returning();
      if (!target) return undefined;
      await aggregateSchedule(tx, scope, schedule.id);
      return { ...draft, publishClaim: { token, mode: target.executionMode, intent: target.intent } };
    });
  }

  async finishPublishTarget(scope: TenantScope, targetId: string, status: "published" | "simulated" | "accepted_unverified" | "failed" | "scheduled" | "unknown", log: Scoped<InsertPublishJobLog>): Promise<boolean> {
    if (!log.claimToken) return false;
    if (status === "published" && (log.executionMode !== "live" || log.receiptKind !== "provider_id" || !log.publishedPostId?.trim() || /^(sandbox|mock|dryrun|dry-run)[_-]/i.test(log.publishedPostId))) throw new ScheduleConflictError("Live publication requires a provider receipt");
    if (status === "simulated" && (!log.executionMode || log.executionMode === "live" || log.publishedPostId)) throw new ScheduleConflictError("Simulation cannot contain a provider receipt");
    if (status === "accepted_unverified" && (log.executionMode !== "live" || log.receiptKind !== "unavailable" || log.publishedPostId)) throw new ScheduleConflictError("Acceptance is not a delivery receipt");
    return scoped(scope, async (tx) => {
      const [target] = await tx.select().from(draftScheduleTargets).where(and(eq(draftScheduleTargets.id, targetId), eq(draftScheduleTargets.tenantId, scope.tenantId)));
      if (!target) return false;
      const draft = await lockScheduledDraft(tx, scope, target.draftScheduleId);
      if (!draft || draft.id !== log.draftId || target.platform !== log.platform || target.executionMode !== log.executionMode) return false;
      const [updated] = await tx.update(draftScheduleTargets).set({ status, claimToken: null, revision: sql`${draftScheduleTargets.revision} + 1`, receiptKind: log.receiptKind ?? null, providerPostId: log.publishedPostId ?? null, lastError: log.errorMessage ?? null, publishedAt: status === "published" ? new Date() : null, updatedAt: new Date() })
        .where(and(eq(draftScheduleTargets.id, targetId), eq(draftScheduleTargets.tenantId, scope.tenantId), eq(draftScheduleTargets.claimToken, log.claimToken!), eq(draftScheduleTargets.status, "publishing"))).returning();
      if (!updated) return false;
      await tx.insert(publishJobLogs).values({ ...log, targetId, tenantId: scope.tenantId, draftScheduleId: target.draftScheduleId, completedAt: new Date() });
      await aggregateSchedule(tx, scope, target.draftScheduleId);
      return true;
    });
  }

  async retryDraftScheduleTargets(scope: TenantScope, draftId: string, targetId?: string): Promise<DraftScheduleTarget[] | undefined> {
    return scoped(scope, async (tx) => {
      const [draft] = await tx.select().from(drafts).where(and(eq(drafts.id, draftId), eq(drafts.tenantId, scope.tenantId), eq(drafts.userId, scope.userId))).for("update");
      if (!draft) return undefined;
      const [schedule] = await tx.select().from(draftSchedules).where(and(eq(draftSchedules.draftId, draftId), eq(draftSchedules.tenantId, scope.tenantId)));
      if (!schedule) return undefined;
      const targets = await tx.select().from(draftScheduleTargets).where(and(eq(draftScheduleTargets.draftScheduleId, schedule.id), eq(draftScheduleTargets.tenantId, scope.tenantId)));
      if (targetId && !targets.some((target) => target.id === targetId)) return undefined;
      const failed = targets.filter((target) => target.status === "failed" && (!targetId || target.id === targetId));
      if (!failed.length) throw new ScheduleConflictError("Only failed targets can be retried; unknown outcomes require provider reconciliation");
      for (const target of failed) await assertPublishingPolicy(tx, scope, draft, [target.platform], target.intent as PublishingIntent, configuredPublishingMode());
      const retried: DraftScheduleTarget[] = [];
      for (const target of failed) {
        await tx.insert(publishJobLogs).values({ tenantId: scope.tenantId, draftId, draftScheduleId: schedule.id, targetId: target.id, platform: target.platform, executionMode: target.executionMode, status: "explicit_retry", actorUserId: scope.userId, completedAt: new Date() });
        const [replacement] = await tx.update(draftScheduleTargets).set({ id: randomUUID(), executionMode: configuredPublishingMode(), claimToken: null, revision: 0, receiptKind: null, providerPostId: null, status: "scheduled", retryCount: 0, lastError: null, publishedAt: null, updatedAt: new Date() })
          .where(and(eq(draftScheduleTargets.id, target.id), eq(draftScheduleTargets.tenantId, scope.tenantId))).returning();
        retried.push(replacement);
      }
      // Keep the original timestamp: sibling jobs carry it as an additional stale-job fence.
      await aggregateSchedule(tx, scope, schedule.id);
      return retried;
    });
  }

  async cancelDraftScheduleTarget(scope: TenantScope, draftId: string, targetId: string): Promise<DraftScheduleTarget | undefined> {
    return scoped(scope, async (tx) => {
      const [draft] = await tx.select().from(drafts).where(and(eq(drafts.id, draftId), eq(drafts.tenantId, scope.tenantId), eq(drafts.userId, scope.userId))).for("update");
      if (!draft) return undefined;
      const [schedule] = await tx.select().from(draftSchedules).where(and(eq(draftSchedules.draftId, draftId), eq(draftSchedules.tenantId, scope.tenantId)));
      if (!schedule) return undefined;
      const [target] = await tx.select().from(draftScheduleTargets).where(and(eq(draftScheduleTargets.id, targetId), eq(draftScheduleTargets.draftScheduleId, schedule.id), eq(draftScheduleTargets.tenantId, scope.tenantId)));
      if (!target) return undefined;
      if (!["scheduled", "queued", "failed", "cancelled"].includes(target.status)) throw new ScheduleConflictError("This target is completed, publishing, or needs provider reconciliation");
      const [updated] = await tx.update(draftScheduleTargets).set({ status: "cancelled", updatedAt: new Date() }).where(eq(draftScheduleTargets.id, targetId)).returning();
      await aggregateSchedule(tx, scope, schedule.id);
      return updated;
    });
  }

  async updateDraftScheduleStatus(scope: TenantScope, scheduleId: string, status: string, lastError?: string): Promise<DraftSchedule | undefined> {
    return scoped(scope, async (tx) => {
      if (!await lockScheduledDraft(tx, scope, scheduleId)) return undefined;
      const targets = await tx.select().from(draftScheduleTargets).where(and(eq(draftScheduleTargets.tenantId, scope.tenantId), eq(draftScheduleTargets.draftScheduleId, scheduleId)));
      if (targets.length) {
        if (["failed", "cancelled"].includes(status)) {
          if (targets.some((target) => ["publishing", "unknown"].includes(target.status))) throw new ScheduleConflictError("Publication requires provider reconciliation");
          await tx.update(draftScheduleTargets).set({ status, lastError: lastError ?? null, updatedAt: new Date() }).where(and(
            eq(draftScheduleTargets.tenantId, scope.tenantId), eq(draftScheduleTargets.draftScheduleId, scheduleId), inArray(draftScheduleTargets.status, ["scheduled", "queued", "failed"]),
          ));
        } else if (status !== aggregateScheduleStatus(targets.map((target) => target.status))) {
          throw new ScheduleConflictError("Parent status is derived from its targets");
        }
        return aggregateSchedule(tx, scope, scheduleId);
      }
      if (!["scheduled", "queued", "failed", "cancelled"].includes(status)) throw new ScheduleConflictError("Delivery requires a claimed target and provider receipt");
      const [legacy] = await tx.select().from(draftSchedules).where(eq(draftSchedules.id, scheduleId));
      if (!legacy || !["scheduled", "queued", "failed", "cancelled"].includes(legacy.status)) throw new ScheduleConflictError("Legacy outcome requires reconciliation");
      const now = new Date();
      const draftPublishStatusMap: Record<string, string> = {
        scheduled: "scheduled",
        queued: "scheduled",
        publishing: "scheduled",
        published: "published",
        failed: "failed",
        cancelled: "draft",
      };

      const [updated] = await tx
        .update(draftSchedules)
        .set({
          status,
          lastError: lastError ?? null,
          updatedAt: now,
          publishedAt: status === "published" ? now : undefined,
        })
        .where(
          and(
            eq(draftSchedules.tenantId, scope.tenantId),
            eq(draftSchedules.id, scheduleId),
            ownedSchedule(scope),
          ),
        )
        .returning();

      if (!updated) return undefined;

      const mappedStatus = draftPublishStatusMap[status] ?? "draft";
      await tx
        .update(drafts)
        .set({
          publishStatus: mappedStatus,
          publishedAt: status === "published" ? now : drafts.publishedAt,
          scheduledAt: status === "cancelled" ? null : drafts.scheduledAt,
          updatedAt: now,
        })
        .where(and(eq(drafts.id, updated.draftId), eq(drafts.tenantId, scope.tenantId), eq(drafts.userId, scope.userId)));

      return updated;
    });
  }

  async cancelDraftSchedule(scope: TenantScope, draftId: string): Promise<void> {
    return scoped(scope, async (tx) => {
      const [draft] = await tx.select().from(drafts).where(and(eq(drafts.id, draftId), eq(drafts.tenantId, scope.tenantId), eq(drafts.userId, scope.userId))).for("update");
      if (!draft) return;
      const schedule = await tx
        .select()
        .from(draftSchedules)
        .where(
          and(
            eq(draftSchedules.tenantId, scope.tenantId),
            eq(draftSchedules.draftId, draftId),
          ),
        )
        .then((rows) => rows[0]);

      if (schedule) {
        const targets = await tx.select().from(draftScheduleTargets).where(and(eq(draftScheduleTargets.draftScheduleId, schedule.id), eq(draftScheduleTargets.tenantId, scope.tenantId)));
        if (targets.some((target) => ["publishing", "unknown", "accepted_unverified"].includes(target.status)) || ["publishing", "unknown", "accepted_unverified"].includes(schedule.status)) {
          throw new ScheduleConflictError("Publication is in flight or its outcome is unknown; it cannot be safely cancelled");
        }
        await tx.update(draftScheduleTargets).set({ status: "cancelled", updatedAt: new Date() }).where(and(eq(draftScheduleTargets.draftScheduleId, schedule.id), eq(draftScheduleTargets.tenantId, scope.tenantId), inArray(draftScheduleTargets.status, ["scheduled", "queued", "failed"])));
        if (targets.length) {
          await aggregateSchedule(tx, scope, schedule.id);
          return;
        }
        if (!["scheduled", "queued", "failed", "cancelled"].includes(schedule.status)) throw new ScheduleConflictError("Legacy outcome cannot be cancelled");
        await tx
          .update(draftSchedules)
          .set({ status: "cancelled", updatedAt: new Date() })
          .where(eq(draftSchedules.id, schedule.id));
      }

      // Update draft status back to draft
      await tx
        .update(drafts)
        .set({ publishStatus: "draft", scheduledAt: null, updatedAt: new Date() })
        .where(and(eq(drafts.id, draftId), eq(drafts.tenantId, scope.tenantId), eq(drafts.userId, scope.userId)));
    });
  }

  async markDraftAsPublished(scope: TenantScope, draftId: string): Promise<DraftSchedule | undefined> {
    const schedule = await this.getDraftSchedule(scope, draftId);
    if (!schedule) return undefined;
    return this.updateDraftScheduleStatus(scope, schedule.id, "published");
  }

  // Publish log methods
  async createPublishLog(scope: TenantScope, log: Scoped<InsertPublishJobLog>): Promise<PublishJobLog> {
    return scoped(scope, async (tx) => {
      const [created] = await tx
        .insert(publishJobLogs)
        .values({ ...log, tenantId: scope.tenantId })
        .returning();
      return created;
    });
  }

  async getPublishLogs(scope: TenantScope, draftId: string): Promise<PublishJobLog[]> {
    return scoped(scope, async (tx) => {
      const [owned] = await tx.select({ id: drafts.id }).from(drafts).where(and(eq(drafts.id, draftId), eq(drafts.tenantId, scope.tenantId), eq(drafts.userId, scope.userId)));
      if (!owned) return [];
      return tx
        .select()
        .from(publishJobLogs)
        .where(
          and(
            eq(publishJobLogs.tenantId, scope.tenantId),
            eq(publishJobLogs.draftId, draftId),
          ),
        )
        .orderBy(desc(publishJobLogs.startedAt));
    });
  }

  async updatePublishLog(scope: TenantScope, logId: string, data: Partial<Scoped<InsertPublishJobLog>>): Promise<PublishJobLog | undefined> {
    return scoped(scope, async (tx) => {
      const [updated] = await tx
        .update(publishJobLogs)
        .set({ ...data, completedAt: data.status === "success" ? new Date() : undefined })
        .where(
          and(
            eq(publishJobLogs.tenantId, scope.tenantId),
            eq(publishJobLogs.id, logId),
          ),
        )
        .returning();
      return updated || undefined;
    });
  }

  // -------------------------------------------------------------- media assets

  async withMediaLock<T>(scope: TenantScope, work: (repository: {
    create: (asset: Omit<typeof mediaAssets.$inferInsert, "tenantId" | "userId" | "createdAt">) => Promise<MediaAsset>;
    get: (id: string) => Promise<MediaAsset | undefined>;
    remove: (id: string) => Promise<void>;
    list: (after?: string) => Promise<MediaAsset[]>;
    referenced: (key: string) => Promise<boolean>;
    relocate: (id: string, locator: Pick<MediaAsset, "storageKey" | "storageBackend" | "storageLocation">) => Promise<void>;
  }) => Promise<T>): Promise<T> {
    return scoped(scope, async (tx) => {
      const owned = and(eq(mediaAssets.tenantId, scope.tenantId), eq(mediaAssets.userId, scope.userId));
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["media", scope.tenantId, scope.userId])}, 0))`);
      return work({
        create: async asset => {
          const [total] = await tx.select({ total: count() }).from(mediaAssets).where(owned);
          if (Number(total.total) >= 200) throw new Error("Media asset limit reached");
          const [created] = await tx.insert(mediaAssets).values({ ...asset, ...scope }).returning();
          return created;
        },
        get: async id => (await tx.select().from(mediaAssets).where(and(owned, eq(mediaAssets.id, id))).limit(1))[0],
        remove: async id => { await tx.delete(mediaAssets).where(and(owned, eq(mediaAssets.id, id))); },
        list: after => tx.select().from(mediaAssets).where(and(owned, after ? gt(mediaAssets.id, after) : undefined)).orderBy(mediaAssets.id).limit(100),
        referenced: async key => !!(await tx.select({ id: mediaAssets.id }).from(mediaAssets).where(and(owned, eq(mediaAssets.storageKey, key))).limit(1))[0],
        relocate: async (id, locator) => { await tx.update(mediaAssets).set(locator).where(and(owned, eq(mediaAssets.id, id))); },
      });
    });
  }

  async createMediaAsset(scope: TenantScope, asset: Omit<typeof mediaAssets.$inferInsert, "tenantId" | "userId" | "createdAt">): Promise<MediaAsset> {
    return this.withMediaLock(scope, repository => repository.create(asset));
  }

  async getMediaAsset(scope: TenantScope, id: string): Promise<MediaAsset | undefined> {
    return scoped(scope, async (tx) => {
      const [asset] = await tx.select().from(mediaAssets).where(and(eq(mediaAssets.id, id), eq(mediaAssets.tenantId, scope.tenantId), eq(mediaAssets.userId, scope.userId)));
      return asset || undefined;
    });
  }

  async deleteMediaAsset(scope: TenantScope, id: string): Promise<void> {
    await this.withMediaLock(scope, repository => repository.remove(id));
  }

  async requestMediaDeletion(scope: TenantScope, id: string): Promise<void> {
    await scoped(scope, async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["media", scope.tenantId, scope.userId])}, 0))`);
      await tx.update(mediaAssets).set({ deletionRequestedAt: new Date() })
        .where(and(eq(mediaAssets.id, id), eq(mediaAssets.tenantId, scope.tenantId), eq(mediaAssets.userId, scope.userId)));
    });
  }

  // ----------------------------------------------------------- publishing rules

  async getPublishingRules(scope: TenantScope): Promise<PublishingRule[]> {
    return scoped(scope, (tx) => tx.select().from(publishingRules).where(and(eq(publishingRules.tenantId, scope.tenantId), eq(publishingRules.userId, scope.userId))));
  }

  async getPublishingRule(scope: TenantScope, platform: string): Promise<PublishingRule | undefined> {
    return scoped(scope, async (tx) => {
      const [rule] = await tx.select().from(publishingRules).where(and(eq(publishingRules.tenantId, scope.tenantId), eq(publishingRules.userId, scope.userId), eq(publishingRules.platform, platform)));
      return rule || undefined;
    });
  }

  async upsertPublishingRule(scope: TenantScope, platform: string, rule: Partial<Omit<PublishingRule, "tenantId" | "userId" | "platform" | "createdAt" | "updatedAt">>): Promise<PublishingRule> {
    return scoped(scope, async (tx) => {
      const [saved] = await tx.insert(publishingRules).values({ tenantId: scope.tenantId, userId: scope.userId, platform, ...rule, updatedAt: new Date() })
        .onConflictDoUpdate({ target: [publishingRules.tenantId, publishingRules.userId, publishingRules.platform], set: { ...rule, updatedAt: new Date() } }).returning();
      return saved;
    });
  }
}

function liveScheduleEvidence(scope: TenantScope) {
  return sql`exists (select 1 from draft_schedule_targets t where t.draft_schedule_id = ${draftSchedules.id} and t.tenant_id = ${scope.tenantId})
    and not exists (select 1 from draft_schedule_targets t where t.draft_schedule_id = ${draftSchedules.id} and t.tenant_id = ${scope.tenantId}
      and (t.status <> 'published' or t.execution_mode is distinct from 'live' or t.receipt_kind is distinct from 'provider_id'
        or nullif(trim(t.provider_post_id), '') is null or t.provider_post_id ~* '^(sandbox|mock|dryrun|dry-run)[_-]'))`;
}

export const storage = new DatabaseStorage();
