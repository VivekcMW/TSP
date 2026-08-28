import {
  users, userProfiles, inboxItems, drafts, industrySources, engineRunLogs,
  socialAccounts, socialAnalytics,
  type User, type UserProfile, type InboxItem, type Draft,
  type InsertUserProfile, type InsertInboxItem, type InsertDraft,
  type IndustrySource, type InsertIndustrySource,
  type EngineRunLog, type InsertEngineRunLog,
  type SocialAccount, type InsertSocialAccount,
  type SocialAnalyticsSnapshot, type InsertSocialAnalytics
} from "@shared/schema";
import { db } from "./db";
import { eq, and, desc, gte, sql } from "drizzle-orm";

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

export interface IStorage {
  /** Identity lookup — not tenant-scoped by nature. */
  getUser(id: string): Promise<User | undefined>;

  getUserProfile(scope: TenantScope): Promise<UserProfile | undefined>;
  createUserProfile(scope: TenantScope, profile: Scoped<InsertUserProfile>): Promise<UserProfile>;
  updateUserProfile(scope: TenantScope, data: Partial<Scoped<InsertUserProfile>>): Promise<UserProfile | undefined>;

  getInboxItems(scope: TenantScope): Promise<InboxItem[]>;
  getInboxItemByUrl(scope: TenantScope, articleUrl: string): Promise<InboxItem | undefined>;
  createInboxItem(scope: TenantScope, item: Scoped<InsertInboxItem>): Promise<InboxItem>;
  updateInboxItem(scope: TenantScope, id: string, data: { status: string }): Promise<InboxItem | undefined>;
  clearUserInboxItems(scope: TenantScope): Promise<void>;

  getDrafts(scope: TenantScope): Promise<Draft[]>;
  createDraft(scope: TenantScope, draft: Scoped<InsertDraft>): Promise<Draft>;
  updateDraft(scope: TenantScope, id: string, data: { content?: string; status?: string }): Promise<Draft | undefined>;
  deleteDraft(scope: TenantScope, id: string): Promise<void>;
  clearUserDrafts(scope: TenantScope): Promise<void>;

  /** Industry sources are global reference data, shared across tenants. */
  getIndustrySources(industry: string): Promise<IndustrySource[]>;
  createIndustrySource(source: InsertIndustrySource): Promise<IndustrySource>;

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

      const [updated] = await tx
        .update(userProfiles)
        .set(safeData)
        .where(and(eq(userProfiles.tenantId, scope.tenantId), eq(userProfiles.userId, scope.userId)))
        .returning();
      return updated || undefined;
    });
  }

  // ------------------------------------------------------------------- inbox

  async getInboxItems(scope: TenantScope): Promise<InboxItem[]> {
    return scoped(scope, async (tx) => {
      return tx
        .select()
        .from(inboxItems)
        .where(and(eq(inboxItems.tenantId, scope.tenantId), eq(inboxItems.userId, scope.userId)))
        .orderBy(desc(inboxItems.createdAt));
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

  async getDrafts(scope: TenantScope): Promise<Draft[]> {
    return scoped(scope, async (tx) => {
      return tx
        .select()
        .from(drafts)
        .where(and(eq(drafts.tenantId, scope.tenantId), eq(drafts.userId, scope.userId)))
        .orderBy(desc(drafts.updatedAt));
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
}

export const storage = new DatabaseStorage();
