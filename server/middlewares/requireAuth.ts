import type { NextFunction, Request, Response } from "express";
import { getAuth } from "@clerk/express";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { users, type User } from "@shared/models/auth";

declare global {
  namespace Express {
    interface Request {
      dbUser?: User;
    }
  }
}

/**
 * Requires a valid Clerk session and resolves (or just-in-time provisions)
 * the corresponding local `users` row, matching the bridge column the app
 * used under Replit Auth: `users.id`.
 *
 * For users migrated from Replit Auth, `sessionClaims.userId` returns their
 * original Replit Auth subject ID (stored as `externalId` in Clerk), so
 * their existing row is found immediately. New users get Clerk's native ID.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const auth = getAuth(req);
  const userId = auth?.sessionClaims?.userId as string | undefined;

  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    let [dbUser] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

    if (!dbUser) {
      const email = (auth.sessionClaims as any)?.email as string | undefined;
      if (!email) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const [inserted] = await db
        .insert(users)
        .values({ id: userId, email })
        .onConflictDoNothing()
        .returning();

      if (inserted) {
        dbUser = inserted;
      } else {
        [dbUser] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      }
    }

    if (!dbUser) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    req.dbUser = dbUser;
    next();
  } catch (error) {
    console.error("Error resolving authenticated user:", error);
    res.status(500).json({ message: "Failed to resolve user" });
  }
}
