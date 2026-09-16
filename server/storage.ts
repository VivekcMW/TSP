import {
  users, userProfiles, profileSocialLinks, inboxItems, drafts, industrySources, userSources, engineRunLogs,
  socialAccounts, socialAnalytics, draftSchedules, draftScheduleTargets, publishJobLogs, mediaAssets, publishingRules,
  type User, type UserProfile, type InboxItem, type Draft,
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
import { eq, and, desc, gte, sql, count, inArray, not } from "drizzle-orm";

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

/** Fields the repository supplies; callers must not pass them. */
type Scoped<T> = Omit<T, "tenantId" | "userId">;

/** Bounded pagination — every list endpoint must cap rows read, not just paginate the response. */
export interface Pagination {
  limit?: number;
  offset?: number;
}

// Callers that don't ask for a specific page (existing internal dedupe/count
// checks in server/routes/inbox.ts) still get every row up to this safety
// cap — it exists to stop a single tenant's table from growing unbounded,
// not to change those callers' behavior at realistic row counts.
const SAFETY_CAP = 500;

function clampLimit(limit?: number): number {
  if (!limit || limit <= 0) return SAFETY_CAP;
  return Math.min(limit, SAFETY_CAP);
}

export interface IStorage {
  /** Identity lookup — not tenant-scoped by nature. */
  getUser(id: string): Promise<User | undefined>;

  getUserProfile(scope: TenantScope): Promise<UserProfile | undefined>;
  createUserProfile(scope: TenantScope, profile: Scoped<InsertUserProfile>): Promise<UserProfile>;
  updateUserProfile(scope: TenantScope, data: Partial<Scoped<InsertUserProfile>>): Promise<UserProfile | undefined>;
  getProfileSocialLinks(scope: TenantScope): Promise<ProfileSocialLink[]>;
  createProfileSocialLink(scope: TenantScope, data: Scoped<InsertProfileSocialLink>): Promise<ProfileSocialLink>;
  updateProfileSocialLink(scope: TenantScope, id: string, data: Partial<Scoped<InsertProfileSocialLink>>): Promise<ProfileSocialLink | undefined>;
  deleteProfileSocialLink(scope: TenantScope, id: string): Promise<void>;
  reorderProfileSocialLinks(scope: TenantScope, ids: string[]): Promise<ProfileSocialLink[]>;

  getInboxItems(scope: TenantScope, page?: Pagination): Promise<InboxItem[]>;
  getInboxItemByUrl(scope: TenantScope, articleUrl: string): Promise<InboxItem | undefined>;
  createInboxItem(scope: TenantScope, item: Scoped<InsertInboxItem>): Promise<InboxItem>;
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
  getDraftScheduleTargetsForPublishing(scheduleId: string): Promise<DraftScheduleTarget[]>;
  updateDraftScheduleTargetStatus(scope: TenantScope, targetId: string, status: string, lastError?: string): Promise<DraftScheduleTarget | undefined>;
  getScheduledDrafts(scope: TenantScope, pagination?: Pagination, platform?: string): Promise<DraftSchedule[]>;
  getScheduledDraftsByStatus(scope: TenantScope, status: string, pagination?: Pagination, platform?: string): Promise<DraftSchedule[]>;
  countScheduledDrafts(scope: TenantScope, status?: string, platform?: string): Promise<number>;
  getDraftSchedule(scope: TenantScope, draftId: string): Promise<DraftSchedule | undefined>;
  getScheduledDraftsForPublishing(limit?: number): Promise<DraftSchedule[]>; // Not tenant-scoped, for scheduler
  updateDraftScheduleStatus(scope: TenantScope, scheduleId: string, status: string, lastError?: string): Promise<DraftSchedule | undefined>;
  cancelDraftSchedule(scope: TenantScope, draftId: string): Promise<void>;
  markDraftAsPublished(scope: TenantScope, draftId: string): Promise<DraftSchedule | undefined>;

  // Publish logs
  createPublishLog(scope: TenantScope, log: Scoped<InsertPublishJobLog>): Promise<PublishJobLog>;
  getPublishLogs(scope: TenantScope, draftId: string): Promise<PublishJobLog[]>;
  updatePublishLog(scope: TenantScope, logId: string, data: Partial<Scoped<InsertPublishJobLog>>): Promise<PublishJobLog | undefined>;

  createMediaAsset(scope: TenantScope, asset: Omit<MediaAsset, "tenantId" | "userId" | "createdAt">): Promise<MediaAsset>;
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
      const [newProfile] = await tx
        .insert(userProfiles)
        .values({ ...profile, tenantId: scope.tenantId, userId: scope.userId })
        .returning();
      return newProfile;
    });
  }

  async updateUserProfile(
    scope: TenantScope,
    data: Partial<Scoped<InsertUserProfile>>,
  ): Promise<UserProfile | undefined> {
    return scoped(scope, async (tx) => {
      // Allowlisted rather than spread, so an unexpected key cannot reach the
      // update — including tenantId or userId.
      const safeData: Record<string, unknown> = { updatedAt: new Date() };
      if (data.focusDescription !== undefined) safeData.focusDescription = data.focusDescription;
      if (data.onboardingStatus !== undefined) safeData.onboardingStatus = data.onboardingStatus;
      if (data.publications !== undefined) safeData.publications = data.publications;
      if (data.keywords !== undefined) safeData.keywords = data.keywords;
      if (data.influencers !== undefined) safeData.influencers = data.influencers;
      if (data.companies !== undefined) safeData.companies = data.companies;
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

  async getInboxItems(scope: TenantScope, page: Pagination = {}): Promise<InboxItem[]> {
    return scoped(scope, async (tx) => {
      return tx
        .select()
        .from(inboxItems)
        .where(and(eq(inboxItems.tenantId, scope.tenantId), eq(inboxItems.userId, scope.userId)))
        .orderBy(desc(inboxItems.createdAt))
        .limit(clampLimit(page.limit))
        .offset(page.offset && page.offset > 0 ? page.offset : 0);
    });
  }

  async getInboxItemByUrl(scope: TenantScope, articleUrl: string): Promise<InboxItem | undefined> {
    return scoped(scope, async (tx) => {
      const [item] = await tx
        .select()
        .from(inboxItems)
        .where(
          and(
            eq(inboxItems.tenantId, scope.tenantId),
            eq(inboxItems.userId, scope.userId),
            eq(inboxItems.articleUrl, articleUrl),
          ),
        );
      return item || undefined;
    });
  }

  async createInboxItem(scope: TenantScope, item: Scoped<InsertInboxItem>): Promise<InboxItem> {
    return scoped(scope, async (tx) => {
      const [newItem] = await tx
        .insert(inboxItems)
        .values({ ...item, tenantId: scope.tenantId, userId: scope.userId })
        .returning();
      return newItem;
    });
  }

  async updateInboxItem(
    scope: TenantScope,
    id: string,
    data: { status: string },
  ): Promise<InboxItem | undefined> {
    return scoped(scope, async (tx) => {
      const [updated] = await tx
        .update(inboxItems)
        .set({ status: data.status })
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
      await tx
        .delete(inboxItems)
        .where(and(eq(inboxItems.tenantId, scope.tenantId), eq(inboxItems.userId, scope.userId)));
    });
  }

  // ------------------------------------------------------------------ drafts

  async getDrafts(scope: TenantScope, page: Pagination = {}): Promise<Draft[]> {
    return scoped(scope, async (tx) => {
      return tx
        .select()
        .from(drafts)
        .where(and(eq(drafts.tenantId, scope.tenantId), eq(drafts.userId, scope.userId)))
        .orderBy(desc(drafts.updatedAt))
        .limit(clampLimit(page.limit))
        .offset(page.offset && page.offset > 0 ? page.offset : 0);
    });
  }

  async createDraft(scope: TenantScope, draft: Scoped<InsertDraft>): Promise<Draft> {
    return scoped(scope, async (tx) => {
      const [newDraft] = await tx
        .insert(drafts)
        .values({ ...draft, tenantId: scope.tenantId, userId: scope.userId })
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
      const safeData: Record<string, unknown> = { updatedAt: new Date() };
      if (data.content !== undefined) safeData.content = data.content;
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
      await tx
        .delete(drafts)
        .where(and(eq(drafts.tenantId, scope.tenantId), eq(drafts.userId, scope.userId)));
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
      const [created] = await tx
        .insert(userSources)
        .values({ ...source, tenantId: scope.tenantId, userId: scope.userId })
        .returning();
      return created;
    });
  }

  async updateUserSource(
    scope: TenantScope,
    id: string,
    data: Partial<Scoped<InsertUserSource>> & { lastFetchedAt?: Date; lastFetchStatus?: string | null; lastFetchError?: string | null },
  ): Promise<UserSource | undefined> {
    return scoped(scope, async (tx) => {
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
      await tx
        .delete(userSources)
        .where(and(eq(userSources.id, id), eq(userSources.tenantId, scope.tenantId), eq(userSources.userId, scope.userId)));
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
    return scoped(scope, async (tx) => {
      const [newAccount] = await tx
        .insert(socialAccounts)
        .values({ ...account, tenantId: scope.tenantId, userId: scope.userId })
        .returning();
      return newAccount;
    });
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
  ): Promise<SocialAccount | undefined> {
    return scoped(scope, async (tx) => {
      const [updated] = await tx
        .update(socialAccounts)
        .set({ ...data, updatedAt: new Date() })
        .where(
          and(
            eq(socialAccounts.id, id),
            eq(socialAccounts.tenantId, scope.tenantId),
            eq(socialAccounts.userId, scope.userId),
          ),
        )
        .returning();
      return updated || undefined;
    });
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
  async scheduleDraftPublish(scope: TenantScope, draftId: string, publishAt: Date, platforms?: string[]): Promise<DraftSchedule> {
    return scoped(scope, async (tx) => {
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
            updatedAt: new Date(),
          },
        })
        .returning();

      // Update draft status
      await tx
        .update(drafts)
        .set({ publishStatus: "scheduled", scheduledAt: publishAt, updatedAt: new Date() })
        .where(and(eq(drafts.id, draftId), eq(drafts.tenantId, scope.tenantId), eq(drafts.userId, scope.userId)));

      const targetPlatforms = platforms?.length ? [...new Set(platforms)] : [
        (await tx.select({ platform: drafts.platform }).from(drafts).where(and(eq(drafts.id, draftId), eq(drafts.tenantId, scope.tenantId))).limit(1))[0]?.platform,
      ].filter((platform): platform is string => Boolean(platform));
      if (platforms?.length) {
        await tx.delete(draftScheduleTargets).where(and(
          eq(draftScheduleTargets.draftScheduleId, schedule.id),
          not(inArray(draftScheduleTargets.platform, targetPlatforms)),
        ));
      }
      for (const platform of targetPlatforms) {
        await tx.insert(draftScheduleTargets).values({ tenantId: scope.tenantId, draftScheduleId: schedule.id, platform, status: "scheduled" }).onConflictDoUpdate({
          target: [draftScheduleTargets.draftScheduleId, draftScheduleTargets.platform],
          set: { status: "scheduled", lastError: null, updatedAt: new Date() },
        });
      }

      return schedule;
    });
  }

  async getDraftScheduleTargets(scope: TenantScope, scheduleId: string): Promise<DraftScheduleTarget[]> {
    return scoped(scope, (tx) => tx.select().from(draftScheduleTargets).where(and(eq(draftScheduleTargets.tenantId, scope.tenantId), eq(draftScheduleTargets.draftScheduleId, scheduleId))));
  }

  async getDraftScheduleTargetsForPublishing(scheduleId: string): Promise<DraftScheduleTarget[]> {
    return db.select().from(draftScheduleTargets).where(and(eq(draftScheduleTargets.draftScheduleId, scheduleId), eq(draftScheduleTargets.status, "scheduled")));
  }

  async updateDraftScheduleTargetStatus(scope: TenantScope, targetId: string, status: string, lastError?: string): Promise<DraftScheduleTarget | undefined> {
    return scoped(scope, async (tx) => {
      const [target] = await tx.update(draftScheduleTargets).set({ status, lastError: lastError ?? null, publishedAt: status === "published" ? new Date() : undefined, updatedAt: new Date() }).where(and(eq(draftScheduleTargets.id, targetId), eq(draftScheduleTargets.tenantId, scope.tenantId))).returning();
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
          ),
        );
      return schedule || undefined;
    });
  }

  async getScheduledDraftsForPublishing(limit?: number): Promise<DraftSchedule[]> {
    // Not tenant-scoped: used by scheduler to find all due drafts
    return db
      .select()
      .from(draftSchedules)
      .where(
        and(
          eq(draftSchedules.status, "scheduled"),
          gte(sql`NOW()`, draftSchedules.scheduledPublishAt),
        ),
      )
      .orderBy(draftSchedules.scheduledPublishAt)
      .limit(limit || 50);
  }

  async updateDraftScheduleStatus(scope: TenantScope, scheduleId: string, status: string, lastError?: string): Promise<DraftSchedule | undefined> {
    return scoped(scope, async (tx) => {
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
    return scoped(scope, async (tx) => {
      const now = new Date();

      // Update schedule
      const [schedule] = await tx
        .update(draftSchedules)
        .set({ status: "published", publishedAt: now, updatedAt: now })
        .where(
          and(
            eq(draftSchedules.tenantId, scope.tenantId),
            eq(draftSchedules.draftId, draftId),
          ),
        )
        .returning();

      // Update draft
      await tx
        .update(drafts)
        .set({ publishStatus: "published", publishedAt: now, updatedAt: now })
        .where(and(eq(drafts.id, draftId), eq(drafts.tenantId, scope.tenantId), eq(drafts.userId, scope.userId)));

      return schedule || undefined;
    });
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

  async createMediaAsset(scope: TenantScope, asset: Omit<MediaAsset, "tenantId" | "userId" | "createdAt">): Promise<MediaAsset> {
    return scoped(scope, async (tx) => {
      const [created] = await tx.insert(mediaAssets).values({ ...asset, tenantId: scope.tenantId, userId: scope.userId }).returning();
      return created;
    });
  }

  async getMediaAsset(scope: TenantScope, id: string): Promise<MediaAsset | undefined> {
    return scoped(scope, async (tx) => {
      const [asset] = await tx.select().from(mediaAssets).where(and(eq(mediaAssets.id, id), eq(mediaAssets.tenantId, scope.tenantId), eq(mediaAssets.userId, scope.userId)));
      return asset || undefined;
    });
  }

  async deleteMediaAsset(scope: TenantScope, id: string): Promise<void> {
    await scoped(scope, async (tx) => {
      await tx.delete(mediaAssets).where(and(eq(mediaAssets.id, id), eq(mediaAssets.tenantId, scope.tenantId), eq(mediaAssets.userId, scope.userId)));
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

export const storage = new DatabaseStorage();
