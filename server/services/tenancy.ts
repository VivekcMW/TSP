import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { users } from "@shared/models/auth";
import {
  auditLog,
  tenantMembers,
  tenants,
  type InsertAuditLogEntry,
  type PlatformRole,
  type TenantRole,
} from "@shared/models/tenancy";

/**
 * Tenant resolution and provisioning.
 *
 * Every request that touches domain data carries a TenantContext, and every
 * repository query is scoped by its tenantId. Nothing reads or writes domain
 * tables without one.
 */

export interface TenantContext {
  tenantId: string;
  userId: string;
  /** The actor's role within this tenant. */
  role: TenantRole;
  /** Set only for platform staff acting across tenants. */
  platformRole: PlatformRole | null;
  /**
   * True when the actor reached this tenant through platform privilege rather
   * than membership. Forces an audit entry and restricts writes.
   */
  viaPlatformRole: boolean;
}

/**
 * Creates a user's personal tenant, or returns the existing one.
 *
 * Idempotent, and safe under concurrent first requests: the membership insert
 * is the serialisation point, so a duplicate call re-reads rather than
 * creating a second tenant.
 */
export async function ensurePersonalTenant(
  userId: string,
  displayName?: string | null,
): Promise<string> {
  const existing = await findPersonalTenant(userId);
  if (existing) return existing;

  const name = displayName?.trim() || "Personal workspace";

  const [tenant] = await db
    .insert(tenants)
    .values({ kind: "personal", name, status: "active" })
    .returning();

  const [membership] = await db
    .insert(tenantMembers)
    .values({ tenantId: tenant.id, userId, role: "owner" })
    .onConflictDoNothing()
    .returning();

  if (membership) return tenant.id;

  // A concurrent call won. Drop the tenant we just created rather than leaving
  // an orphan, and use theirs.
  await db.delete(tenants).where(eq(tenants.id, tenant.id));
  const winner = await findPersonalTenant(userId);
  if (!winner) {
    throw new Error(`Could not resolve a personal tenant for user ${userId}`);
  }
  return winner;
}

async function findPersonalTenant(userId: string): Promise<string | undefined> {
  const [row] = await db
    .select({ tenantId: tenants.id })
    .from(tenantMembers)
    .innerJoin(tenants, eq(tenants.id, tenantMembers.tenantId))
    .where(and(eq(tenantMembers.userId, userId), eq(tenants.kind, "personal")))
    .limit(1);
  return row?.tenantId;
}

/** Every tenant the user belongs to, for a tenant switcher. */
export async function listMemberships(userId: string) {
  return db
    .select({
      tenantId: tenants.id,
      name: tenants.name,
      kind: tenants.kind,
      status: tenants.status,
      role: tenantMembers.role,
    })
    .from(tenantMembers)
    .innerJoin(tenants, eq(tenants.id, tenantMembers.tenantId))
    .where(eq(tenantMembers.userId, userId));
}

/**
 * Resolves the tenant a request should act in.
 *
 * With no requested tenant, falls back to the user's personal tenant. A
 * requested tenant requires membership — or platform privilege, which is
 * flagged so the caller audits it and write access can be withheld.
 */
export async function resolveTenantContext(
  userId: string,
  requestedTenantId?: string,
): Promise<TenantContext | null> {
  const [user] = await db
    .select({ platformRole: users.platformRole })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const platformRole = (user?.platformRole as PlatformRole | null) ?? null;

  if (!requestedTenantId) {
    const personal = await ensurePersonalTenant(userId);
    return { tenantId: personal, userId, role: "owner", platformRole, viaPlatformRole: false };
  }

  const [membership] = await db
    .select({ role: tenantMembers.role })
    .from(tenantMembers)
    .where(
      and(eq(tenantMembers.tenantId, requestedTenantId), eq(tenantMembers.userId, userId)),
    )
    .limit(1);

  if (membership) {
    return {
      tenantId: requestedTenantId,
      userId,
      role: membership.role as TenantRole,
      platformRole,
      viaPlatformRole: false,
    };
  }

  if (platformRole) {
    const [tenant] = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.id, requestedTenantId))
      .limit(1);
    // Report a non-existent tenant and an inaccessible one identically: a 403
    // would confirm existence and leak the tenant namespace.
    if (!tenant) return null;
    return {
      tenantId: requestedTenantId,
      userId,
      role: "member",
      platformRole,
      viaPlatformRole: true,
    };
  }

  return null;
}

/**
 * Appends an audit entry.
 *
 * Returns false when the audit write fails so privileged requests can fail
 * closed instead of completing without a durable record.
 */
export async function writeAuditLog(entry: InsertAuditLogEntry): Promise<boolean> {
  try {
    await db.insert(auditLog).values(entry);
    return true;
  } catch (error) {
    console.error("[audit] FAILED to write audit entry", { entry, error });
    return false;
  }
}
