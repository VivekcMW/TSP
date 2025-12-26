import { users, type User, type UpsertUser } from "@shared/models/auth";
import { db } from "../../db";
import { eq, and, gt } from "drizzle-orm";
import { randomUUID, randomBytes, createHash } from "crypto";

export interface IAuthStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  createUser(userData: { email: string; passwordHash: string; firstName?: string | null; lastName?: string | null }): Promise<User>;
  setResetToken(email: string): Promise<{ token: string; user: User } | null>;
  getUserByResetToken(token: string): Promise<User | undefined>;
  resetPassword(token: string, newPasswordHash: string): Promise<User | null>;
  clearResetToken(userId: string): Promise<void>;
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

  async createUser(userData: { email: string; passwordHash: string; firstName?: string | null; lastName?: string | null }): Promise<User> {
    const [user] = await db
      .insert(users)
      .values({
        id: randomUUID(),
        email: userData.email,
        passwordHash: userData.passwordHash,
        firstName: userData.firstName || null,
        lastName: userData.lastName || null,
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
    const [user] = await db
      .select()
      .from(users)
      .where(
        and(
          eq(users.resetToken, hashedToken),
          gt(users.resetTokenExpiry, new Date())
        )
      );
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
}

export const authStorage = new AuthStorage();
