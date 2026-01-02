import { 
  users, userProfiles, inboxItems, drafts,
  type User, type UserProfile, type InboxItem, type Draft,
  type InsertUserProfile, type InsertInboxItem, type InsertDraft
} from "@shared/schema";
import { db } from "./db";
import { eq, and, desc } from "drizzle-orm";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserProfile(userId: string): Promise<UserProfile | undefined>;
  createUserProfile(profile: InsertUserProfile): Promise<UserProfile>;
  updateUserProfile(userId: string, data: Partial<InsertUserProfile>): Promise<UserProfile | undefined>;
  getInboxItems(userId: string): Promise<InboxItem[]>;
  createInboxItem(item: InsertInboxItem): Promise<InboxItem>;
  updateInboxItem(id: string, userId: string, data: { status: string }): Promise<InboxItem | undefined>;
  clearUserInboxItems(userId: string): Promise<void>;
  getDrafts(userId: string): Promise<Draft[]>;
  createDraft(draft: InsertDraft): Promise<Draft>;
  updateDraft(id: string, userId: string, data: { content?: string; status?: string }): Promise<Draft | undefined>;
  deleteDraft(id: string, userId: string): Promise<void>;
  clearUserDrafts(userId: string): Promise<void>;
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
}

export const storage = new DatabaseStorage();
