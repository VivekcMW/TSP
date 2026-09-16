import type { NextFunction, Request, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { users, type User as UserRow } from "@shared/models/auth";
import { resolveTenantContext, type TenantContext } from "../services/tenancy";
import { auth } from "../authentication";

declare global {
  namespace Express {
    interface Request {
      /**
       * The local users row.
       *
       * Aliased as UserRow deliberately: @types/passport declares an empty
       * `Express.User`, so a bare `User` inside this augmentation resolves to
       * that instead of the imported row type — which silently typed dbUser as
       * `{}` and disabled checking on every field.
       */
      dbUser?: UserRow;
      /**
       * The tenant this request acts in. Present on every authenticated
       * request; repositories refuse to run without it.
       */
      tenant?: TenantContext;
    }
  }
}

/**
 * Header naming the tenant to act in. Absent means the user's personal tenant,
 * which is the only tenant most users ever have.
 */
const TENANT_HEADER = "x-tenant-id";

/**
 * Requires a valid Better Auth session and resolves the matching local user.
 * Better Auth owns the same `users` table, so the user is created before a
 * session can be established and no secondary identity provisioning occurs.
 */
export async function requireDbUser(req: Request, res: Response, next: NextFunction) {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    const userId = session?.user.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    if (!session.user.emailVerified) {
      return res.status(403).json({ message: "Verify your email address before continuing." });
    }

    let [dbUser] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

    if (!dbUser) {
      return res.status(401).json({ message: "Authenticated user was not found." });
    }

    if (!dbUser) {
      console.error("Could not resolve or provision user row for Clerk id:", userId);
      return res.status(500).json({ message: "Failed to resolve user" });
    }

    const tenant = await resolveTenantContext(dbUser.id, tenantHeader(req));
    if (!tenant) {
      // Unknown tenant and inaccessible tenant are reported identically, so a
      // response cannot be used to probe which tenant ids exist.
      return res.status(404).json({ message: "Tenant not found" });
    }

    req.dbUser = dbUser;
    req.tenant = tenant;
    next();
  } catch (error) {
    console.error("Error resolving authenticated user:", error);
    res.status(500).json({ message: "Failed to resolve user" });
  }
}

export interface AuthedContext {
  dbUser: UserRow;
  tenant: TenantContext;
}

/**
 * Narrows a request that has already passed requireDbUser.
 *
 * The Express augmentation must declare dbUser and tenant as optional, since
 * they are absent before this middleware runs — but every handler mounted
 * behind it needs them as definite. This is the one place that assertion is
 * made, so handlers can be typed instead of falling back to `req: any`, which
 * silently disabled checking on both fields.
 *
 * Throws rather than returning undefined: arriving here without them is a
 * middleware wiring error, not a runtime condition worth branching on.
 */
export function authedOf(req: Request): AuthedContext {
  const { dbUser, tenant } = req;
  if (!dbUser || !tenant) {
    throw new Error(
      "authedOf() called on a request that did not pass requireDbUser — check middleware order",
    );
  }
  return { dbUser, tenant };
}

function tenantHeader(req: Request): string | undefined {
  const raw = req.headers[TENANT_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value?.trim() || undefined;
}
