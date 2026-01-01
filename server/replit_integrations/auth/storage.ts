import { users, authAccounts, type User, type UpsertUser, type AuthAccount } from "@shared/models/auth";
import { db } from "../../db";
import { eq, and, gt } from "drizzle-orm";
import { randomUUID, randomBytes, createHash } from "crypto";

export interface IAuthStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  createUser(userData: { email: string; passwordHash?: string | null; firstName?: string | null; lastName?: string | null; profileImageUrl?: string | null }): Promise<User>;
  setResetToken(email: string): Promise<{ token: string; user: User } | null>;
  getUserByResetToken(token: string): Promise<User | undefined>;
  resetPassword(token: string, newPasswordHash: string): Promise<User | null>;
  clearResetToken(userId: string): Promise<void>;
  // OAuth account methods
  findUserByOAuthProvider(provider: string, providerUserId: string): Promise<User | undefined>;
  linkOAuthAccount(userId: string, provider: string, providerUserId: string, accessToken?: string, refreshToken?: string): Promise<AuthAccount>;
  getLinkedAccounts(userId: string): Promise<AuthAccount[]>;
  unlinkOAuthAccount(userId: string, provider: string): Promise<void>;
}

class AuthStorage implements IAuthStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  async createUser(userData: { email: string; passwordHash?: string | null; firstName?: string | null; lastName?: string | null; profileImageUrl?: string | null }): Promise<User> {
    const [user] = await db
      .insert(users)
      .values({
        id: randomUUID(),
        email: userData.email,
        passwordHash: userData.passwordHash || null,
        firstName: userData.firstName || null,
        lastName: userData.lastName || null,
        profileImageUrl: userData.profileImageUrl || null,
      })
      .returning();
    return user;
  }

  async setResetToken(email: string): Promise<{ token: string; user: User } | null> {
    const user = await this.getUserByEmail(email);
    if (!user) return null;

    const rawToken = randomBytes(32).toString("hex");
    const hashedToken = createHash("sha256").update(rawToken).digest("hex");
    const expiry = new Date(Date.now() + 60 * 60 * 1000);

    console.log("Password reset token generated for:", email);
    console.log("Raw token (first 8 chars):", rawToken.substring(0, 8) + "...");
    console.log("Token expires at:", expiry.toISOString());

    const [updatedUser] = await db
      .update(users)
      .set({
        resetToken: hashedToken,
        resetTokenExpiry: expiry,
        updatedAt: new Date(),
      })
      .where(eq(users.email, email))
      .returning();

    return { token: rawToken, user: updatedUser };
  }

  async getUserByResetToken(token: string): Promise<User | undefined> {
    const hashedToken = createHash("sha256").update(token).digest("hex");
    console.log("Verifying reset token - received token (first 8 chars):", token.substring(0, 8) + "...");
    console.log("Hashed for lookup (first 16 chars):", hashedToken.substring(0, 16) + "...");
    
    const [user] = await db
      .select()
      .from(users)
      .where(
        and(
          eq(users.resetToken, hashedToken),
          gt(users.resetTokenExpiry, new Date())
        )
      );
    
    console.log("Token verification result:", user ? "User found - " + user.email : "No user found or token expired");
    return user;
  }

  async resetPassword(token: string, newPasswordHash: string): Promise<User | null> {
    const hashedToken = createHash("sha256").update(token).digest("hex");
    const [user] = await db
      .update(users)
      .set({
        passwordHash: newPasswordHash,
        resetToken: null,
        resetTokenExpiry: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(users.resetToken, hashedToken),
          gt(users.resetTokenExpiry, new Date())
        )
      )
      .returning();
    return user || null;
  }

  async clearResetToken(userId: string): Promise<void> {
    await db
      .update(users)
      .set({
        resetToken: null,
        resetTokenExpiry: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  }

  async findUserByOAuthProvider(provider: string, providerUserId: string): Promise<User | undefined> {
    const [result] = await db
      .select({ user: users })
      .from(authAccounts)
      .innerJoin(users, eq(authAccounts.userId, users.id))
      .where(
        and(
          eq(authAccounts.provider, provider),
          eq(authAccounts.providerUserId, providerUserId)
        )
      );
    return result?.user;
  }

  async linkOAuthAccount(
    userId: string,
    provider: string,
    providerUserId: string,
    accessToken?: string,
    refreshToken?: string
  ): Promise<AuthAccount> {
    const [existingAccount] = await db
      .select()
      .from(authAccounts)
      .where(
        and(
          eq(authAccounts.userId, userId),
          eq(authAccounts.provider, provider)
        )
      );

    if (existingAccount) {
      const [updated] = await db
        .update(authAccounts)
        .set({
          providerUserId,
          accessToken: accessToken || null,
          refreshToken: refreshToken || null,
          updatedAt: new Date(),
        })
        .where(eq(authAccounts.id, existingAccount.id))
        .returning();
      return updated;
    }

    const [account] = await db
      .insert(authAccounts)
      .values({
        userId,
        provider,
        providerUserId,
        accessToken: accessToken || null,
        refreshToken: refreshToken || null,
      })
      .returning();
    return account;
  }

  async getLinkedAccounts(userId: string): Promise<AuthAccount[]> {
    return db
      .select()
      .from(authAccounts)
      .where(eq(authAccounts.userId, userId));
  }

  async unlinkOAuthAccount(userId: string, provider: string): Promise<void> {
    await db
      .delete(authAccounts)
      .where(
        and(
          eq(authAccounts.userId, userId),
          eq(authAccounts.provider, provider)
        )
      );
  }
}

export const authStorage = new AuthStorage();
