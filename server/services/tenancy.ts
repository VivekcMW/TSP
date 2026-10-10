import { and, asc, eq, sql } from "drizzle-orm";
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
 * A user's first requests arrive in parallel (e.g. /api/me and /api/profile), and
 * nothing in the schema makes "one personal tenant per user" unique. Creation
 * therefore holds a per-user transaction-scoped advisory lock and re-checks under
 * it, so concurrent first calls create exactly one tenant.
 */
export async function ensurePersonalTenant(
  userId: string,
  displayName?: string | null,
): Promise<string> {
  const existing = await findPersonalTenant(userId);
  if (existing) return existing;

  const name = displayName?.trim() || "Personal workspace";
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`personal-tenant:${userId}`}, 0))`);
    const created = await findPersonalTenant(userId, tx);
    if (created) return created;
    const [tenant] = await tx
      .insert(tenants)
      .values({ kind: "personal", name, status: "active" })
      .returning();
    await tx.insert(tenantMembers).values({ tenantId: tenant.id, userId, role: "owner" });
    return tenant.id;
  });
}

type Executor = Pick<typeof db, "select">;

/** Deterministic: the earliest membership wins if duplicates ever exist (0041 removed them). */
async function findPersonalTenant(userId: string, executor: Executor = db): Promise<string | undefined> {
  const [row] = await executor
    .select({ tenantId: tenants.id })
    .from(tenantMembers)
    .innerJoin(tenants, eq(tenants.id, tenantMembers.tenantId))
    .where(and(eq(tenantMembers.userId, userId), eq(tenants.kind, "personal")))
    .orderBy(asc(tenantMembers.createdAt), asc(tenants.id))
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
