import type { NextFunction, Request, Response } from "express";
import { clerkClient, getAuth } from "@clerk/express";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { users, type User } from "@shared/models/auth";
import { devAuthEnabled, resolveDevUser } from "./devAuth";

declare global {
  namespace Express {
    interface Request {
      dbUser?: User;
    }
  }
}

/**
 * Requires a valid Clerk session and resolves — or just-in-time provisions —
 * the matching local `users` row.
 *
 * Identity comes from `auth.userId`, i.e. Clerk's native `sub` claim, so no
 * session-token customisation is required. An earlier version read a custom
 * `sessionClaims.userId` claim, which returned 401 for every request unless a
 * matching claim template happened to be configured in the Clerk dashboard.
 *
 * Email is read from the Clerk Backend API, and only when the local row is
 * missing — one API call per user lifetime, not one per request.
 */
export async function requireDbUser(req: Request, res: Response, next: NextFunction) {
  // TEMPORARY local-development bypass — see devAuth.ts. Cannot activate in a
  // production build; that combination refuses to boot.
  if (devAuthEnabled) {
    try {
      req.dbUser = await resolveDevUser();
      return next();
    } catch (error) {
      console.error("DEV_AUTH_BYPASS: failed to resolve the seeded user:", error);
      return res.status(500).json({ message: "Failed to resolve dev user" });
    }
  }

  const { userId } = getAuth(req);

  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    let [dbUser] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

    if (!dbUser) {
      const clerkUser = await clerkClient.users.getUser(userId);
      const email = clerkUser.primaryEmailAddress?.emailAddress;

      if (!email) {
        // A valid session on an unprovisionable account is a data problem, not
        // an auth problem. Returning 401 here would send the client into a
        // pointless sign-out / sign-in loop against a state it cannot fix.
        return res
          .status(422)
          .json({ message: "Your account has no primary email address." });
      }

      const [inserted] = await db
        .insert(users)
        .values({
          id: userId,
          email,
          firstName: clerkUser.firstName ?? undefined,
          lastName: clerkUser.lastName ?? undefined,
          profileImageUrl: clerkUser.imageUrl ?? undefined,
        })
        .onConflictDoNothing()
        .returning();

      // A concurrent first request may have won the insert; re-read rather
      // than treating the no-op as a failure.
      dbUser =
        inserted ??
        (await db.select().from(users).where(eq(users.id, userId)).limit(1))[0];
    }

    if (!dbUser) {
      console.error("Could not resolve or provision user row for Clerk id:", userId);
      return res.status(500).json({ message: "Failed to resolve user" });
    }

    req.dbUser = dbUser;
    next();
  } catch (error) {
    console.error("Error resolving authenticated user:", error);
    res.status(500).json({ message: "Failed to resolve user" });
  }
}
