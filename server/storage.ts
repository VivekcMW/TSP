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
import { eq, and, desc, gte } from "drizzle-orm";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserProfile(userId: string): Promise<UserProfile | undefined>;
  createUserProfile(profile: InsertUserProfile): Promise<UserProfile>;
  updateUserProfile(userId: string, data: Partial<InsertUserProfile>): Promise<UserProfile | undefined>;
  getInboxItems(userId: string): Promise<InboxItem[]>;
  getInboxItemByUrl(userId: string, articleUrl: string): Promise<InboxItem | undefined>;
  createInboxItem(item: InsertInboxItem): Promise<InboxItem>;
  updateInboxItem(id: string, userId: string, data: { status: string }): Promise<InboxItem | undefined>;
  clearUserInboxItems(userId: string): Promise<void>;
  getDrafts(userId: string): Promise<Draft[]>;
  createDraft(draft: InsertDraft): Promise<Draft>;
  updateDraft(id: string, userId: string, data: { content?: string; status?: string }): Promise<Draft | undefined>;
  deleteDraft(id: string, userId: string): Promise<void>;
  clearUserDrafts(userId: string): Promise<void>;
  getIndustrySources(industry: string): Promise<IndustrySource[]>;
  createIndustrySource(source: InsertIndustrySource): Promise<IndustrySource>;
  createEngineRunLog(log: InsertEngineRunLog): Promise<EngineRunLog>;
  updateEngineRunLog(id: string, data: Partial<InsertEngineRunLog>): Promise<EngineRunLog | undefined>;
  // Social accounts
  getSocialAccounts(userId: string): Promise<SocialAccount[]>;
  getSocialAccountByProvider(userId: string, provider: string): Promise<SocialAccount | undefined>;
  createSocialAccount(account: InsertSocialAccount): Promise<SocialAccount>;
  updateSocialAccount(id: string, data: Partial<InsertSocialAccount>): Promise<SocialAccount | undefined>;
  deleteSocialAccount(id: string, userId: string): Promise<void>;
  // Social analytics
  getSocialAnalytics(userId: string, provider?: string, daysBack?: number): Promise<SocialAnalyticsSnapshot[]>;
  getLatestSocialAnalytics(userId: string, provider: string): Promise<SocialAnalyticsSnapshot | undefined>;
  createSocialAnalytics(analytics: InsertSocialAnalytics): Promise<SocialAnalyticsSnapshot>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserProfile(userId: string): Promise<UserProfile | undefined> {
    const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, userId));
    return profile || undefined;
  }

  async createUserProfile(profile: InsertUserProfile): Promise<UserProfile> {
    const [newProfile] = await db.insert(userProfiles).values(profile).returning();
    return newProfile;
  }

  async updateUserProfile(userId: string, data: Partial<InsertUserProfile>): Promise<UserProfile | undefined> {
    const safeData: Record<string, any> = { updatedAt: new Date() };
    
    if (data.focusDescription !== undefined) safeData.focusDescription = data.focusDescription;
    if (data.onboardingStatus !== undefined) safeData.onboardingStatus = data.onboardingStatus;
    if (data.publications !== undefined) safeData.publications = data.publications;
    if (data.keywords !== undefined) safeData.keywords = data.keywords;
    if (data.influencers !== undefined) safeData.influencers = data.influencers;
    if (data.companies !== undefined) safeData.companies = data.companies;
    
    const [updated] = await db
      .update(userProfiles)
      .set(safeData)
      .where(eq(userProfiles.userId, userId))
      .returning();
    return updated || undefined;
  }

  async getInboxItems(userId: string): Promise<InboxItem[]> {
    return await db.select().from(inboxItems).where(eq(inboxItems.userId, userId)).orderBy(desc(inboxItems.createdAt));
  }

  async createInboxItem(item: InsertInboxItem): Promise<InboxItem> {
    const [newItem] = await db.insert(inboxItems).values(item).returning();
    return newItem;
  }

  async updateInboxItem(id: string, userId: string, data: { status: string }): Promise<InboxItem | undefined> {
    const [updated] = await db
      .update(inboxItems)
      .set({ status: data.status })
      .where(and(eq(inboxItems.id, id), eq(inboxItems.userId, userId)))
      .returning();
    return updated || undefined;
  }

  async getDrafts(userId: string): Promise<Draft[]> {
    return await db.select().from(drafts).where(eq(drafts.userId, userId));
  }

  async createDraft(draft: InsertDraft): Promise<Draft> {
    const [newDraft] = await db.insert(drafts).values(draft).returning();
    return newDraft;
  }

  async updateDraft(id: string, userId: string, data: { content?: string; status?: string }): Promise<Draft | undefined> {
    const updateData: any = { updatedAt: new Date() };
    if (data.content !== undefined) updateData.content = data.content;
    if (data.status !== undefined) updateData.status = data.status;
    
    const [updated] = await db
      .update(drafts)
      .set(updateData)
      .where(and(eq(drafts.id, id), eq(drafts.userId, userId)))
      .returning();
    return updated || undefined;
  }

  async deleteDraft(id: string, userId: string): Promise<void> {
    await db.delete(drafts).where(and(eq(drafts.id, id), eq(drafts.userId, userId)));
  }

  async clearUserInboxItems(userId: string): Promise<void> {
    await db.delete(inboxItems).where(eq(inboxItems.userId, userId));
  }

  async clearUserDrafts(userId: string): Promise<void> {
    await db.delete(drafts).where(eq(drafts.userId, userId));
  }

  async getInboxItemByUrl(userId: string, articleUrl: string): Promise<InboxItem | undefined> {
    const [item] = await db
      .select()
      .from(inboxItems)
      .where(and(eq(inboxItems.userId, userId), eq(inboxItems.articleUrl, articleUrl)));
    return item || undefined;
  }

  async getIndustrySources(industry: string): Promise<IndustrySource[]> {
    return await db
      .select()
      .from(industrySources)
      .where(and(eq(industrySources.industry, industry), eq(industrySources.isActive, true)))
      .orderBy(desc(industrySources.priority));
  }

  async createIndustrySource(source: InsertIndustrySource): Promise<IndustrySource> {
    const [newSource] = await db.insert(industrySources).values(source).returning();
    return newSource;
  }

  async createEngineRunLog(log: InsertEngineRunLog): Promise<EngineRunLog> {
    const [newLog] = await db.insert(engineRunLogs).values(log).returning();
    return newLog;
  }

  async updateEngineRunLog(id: string, data: Partial<InsertEngineRunLog>): Promise<EngineRunLog | undefined> {
    const [updated] = await db
      .update(engineRunLogs)
      .set(data)
      .where(eq(engineRunLogs.id, id))
      .returning();
    return updated || undefined;
  }

  // Social accounts methods
  async getSocialAccounts(userId: string): Promise<SocialAccount[]> {
    return await db
      .select()
      .from(socialAccounts)
      .where(eq(socialAccounts.userId, userId))
      .orderBy(desc(socialAccounts.createdAt));
  }

  async getSocialAccountByProvider(userId: string, provider: string): Promise<SocialAccount | undefined> {
    const [account] = await db
      .select()
      .from(socialAccounts)
      .where(and(eq(socialAccounts.userId, userId), eq(socialAccounts.provider, provider)));
    return account || undefined;
  }

  async createSocialAccount(account: InsertSocialAccount): Promise<SocialAccount> {
    const [newAccount] = await db.insert(socialAccounts).values(account).returning();
    return newAccount;
  }

  async updateSocialAccount(id: string, data: Partial<InsertSocialAccount>): Promise<SocialAccount | undefined> {
    const updateData: any = { updatedAt: new Date(), ...data };
    const [updated] = await db
      .update(socialAccounts)
      .set(updateData)
      .where(eq(socialAccounts.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteSocialAccount(id: string, userId: string): Promise<void> {
    await db.delete(socialAccounts).where(and(eq(socialAccounts.id, id), eq(socialAccounts.userId, userId)));
  }

  // Social analytics methods
  async getSocialAnalytics(userId: string, provider?: string, daysBack: number = 30): Promise<SocialAnalyticsSnapshot[]> {
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - daysBack);
    
    if (provider) {
      return await db
        .select()
        .from(socialAnalytics)
        .where(and(
          eq(socialAnalytics.userId, userId),
          eq(socialAnalytics.provider, provider),
          gte(socialAnalytics.snapshotDate, sinceDate)
        ))
        .orderBy(desc(socialAnalytics.snapshotDate));
    }
    
    return await db
      .select()
      .from(socialAnalytics)
      .where(and(
        eq(socialAnalytics.userId, userId),
        gte(socialAnalytics.snapshotDate, sinceDate)
      ))
      .orderBy(desc(socialAnalytics.snapshotDate));
  }

  async getLatestSocialAnalytics(userId: string, provider: string): Promise<SocialAnalyticsSnapshot | undefined> {
    const [latest] = await db
      .select()
      .from(socialAnalytics)
      .where(and(eq(socialAnalytics.userId, userId), eq(socialAnalytics.provider, provider)))
      .orderBy(desc(socialAnalytics.snapshotDate))
      .limit(1);
    return latest || undefined;
  }

  async createSocialAnalytics(analytics: InsertSocialAnalytics): Promise<SocialAnalyticsSnapshot> {
    const [newAnalytics] = await db.insert(socialAnalytics).values(analytics).returning();
    return newAnalytics;
  }
}

export const storage = new DatabaseStorage();
