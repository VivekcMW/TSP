import type { PlatformRole, TenantRole } from "@shared/models/tenancy";

/**
 * Authorization: role-based, with the permission matrix as literal data.
 *
 * Keeping the matrix as a table rather than scattering `if (role === "admin")`
 * checks through handlers means the policy can be read in one place, diffed in
 * review, and — because the tests iterate the same table — a permission added
 * here without a decision for every role fails to compile.
 *
 * Permission names are `<resource>:<action>[:scope]`, where scope is:
 *   own    — the actor's own rows within the tenant
 *   tenant — anything in the tenant
 *   all    — across tenants (platform staff only)
 */

/** Tenant roles ordered least to most privileged, for readability below. */
const ALL_TENANT: readonly TenantRole[] = ["member", "manager", "admin", "owner"];
const FROM_MANAGER: readonly TenantRole[] = ["manager", "admin", "owner"];
const FROM_ADMIN: readonly TenantRole[] = ["admin", "owner"];
const OWNER_ONLY: readonly TenantRole[] = ["owner"];
const NO_TENANT_ROLE: readonly TenantRole[] = [];

const SUPPORT_AND_ADMIN: readonly PlatformRole[] = ["platform_support", "platform_admin"];
const ADMIN_ONLY: readonly PlatformRole[] = ["platform_admin"];
const NO_PLATFORM_ROLE: readonly PlatformRole[] = [];

interface Grant {
  /** Tenant roles that hold this permission through membership. */
  tenant: readonly TenantRole[];
  /** Platform staff roles that hold it across tenants. */
  platform: readonly PlatformRole[];
  /**
   * True if exercising this permission is a privileged or cross-tenant act and
   * must therefore be audited. Enforced by the middleware, not by callers.
   */
  audit?: true;
}

export const PERMISSIONS = {
  // --- subscriber surface: a member's own content ---------------------------
  "inbox:read:own": { tenant: ALL_TENANT, platform: SUPPORT_AND_ADMIN },
  "inbox:write:own": { tenant: ALL_TENANT, platform: NO_PLATFORM_ROLE },
  "draft:read:own": { tenant: ALL_TENANT, platform: SUPPORT_AND_ADMIN },
  "draft:write:own": { tenant: ALL_TENANT, platform: NO_PLATFORM_ROLE },
  "profile:read:own": { tenant: ALL_TENANT, platform: SUPPORT_AND_ADMIN },
  "profile:write:own": { tenant: ALL_TENANT, platform: NO_PLATFORM_ROLE },
  "generation:create:own": { tenant: ALL_TENANT, platform: NO_PLATFORM_ROLE },
  "social:read:own": { tenant: ALL_TENANT, platform: SUPPORT_AND_ADMIN },
  "social:connect:own": { tenant: ALL_TENANT, platform: NO_PLATFORM_ROLE },
  "analytics:read:own": { tenant: ALL_TENANT, platform: SUPPORT_AND_ADMIN },

  // --- corporate surface: tenant-wide -------------------------------------
  "draft:read:tenant": { tenant: FROM_MANAGER, platform: SUPPORT_AND_ADMIN },
  "draft:approve:tenant": { tenant: FROM_MANAGER, platform: NO_PLATFORM_ROLE },
  "analytics:read:tenant": { tenant: FROM_MANAGER, platform: SUPPORT_AND_ADMIN },
  "brand:write:tenant": { tenant: FROM_ADMIN, platform: NO_PLATFORM_ROLE },
  "member:read:tenant": { tenant: FROM_MANAGER, platform: SUPPORT_AND_ADMIN },
  "member:invite:tenant": { tenant: FROM_ADMIN, platform: NO_PLATFORM_ROLE },
  "member:remove:tenant": { tenant: FROM_ADMIN, platform: NO_PLATFORM_ROLE },
  "billing:manage:tenant": { tenant: FROM_ADMIN, platform: NO_PLATFORM_ROLE },
  "audit:read:tenant": { tenant: FROM_ADMIN, platform: SUPPORT_AND_ADMIN },
  "tenant:delete": { tenant: OWNER_ONLY, platform: ADMIN_ONLY, audit: true },

  // --- super admin surface: cross-tenant ----------------------------------
  "tenant:read:all": { tenant: NO_TENANT_ROLE, platform: SUPPORT_AND_ADMIN, audit: true },
  "user:read:all": { tenant: NO_TENANT_ROLE, platform: SUPPORT_AND_ADMIN, audit: true },
  "usage:read:all": { tenant: NO_TENANT_ROLE, platform: SUPPORT_AND_ADMIN, audit: true },
  "audit:read:all": { tenant: NO_TENANT_ROLE, platform: SUPPORT_AND_ADMIN, audit: true },
  "flag:write:all": { tenant: NO_TENANT_ROLE, platform: ADMIN_ONLY, audit: true },
  "quota:override:all": { tenant: NO_TENANT_ROLE, platform: ADMIN_ONLY, audit: true },
  "impersonate:all": { tenant: NO_TENANT_ROLE, platform: ADMIN_ONLY, audit: true },
  "pipeline:operate:all": { tenant: NO_TENANT_ROLE, platform: ADMIN_ONLY, audit: true },
} as const satisfies Record<string, Grant>;

export type Permission = keyof typeof PERMISSIONS;

export interface Actor {
  /** Role held through membership of the tenant being acted on, if any. */
  role: TenantRole | null;
  platformRole: PlatformRole | null;
  /**
   * True when the actor reached this tenant through platform privilege rather
   * than membership. Their tenant role is then disregarded entirely.
   */
  viaPlatformRole: boolean;
}

function grantFor(permission: Permission): Grant {
  return PERMISSIONS[permission];
}

/**
 * Whether the actor holds the permission.
 *
 * A platform actor acting on a tenant they are not a member of is evaluated
 * *only* against their platform role. That is what makes platform_support
 * read-only: it appears in the `platform` list of read permissions and in none
 * of the writes, so no synthesised tenant role can grant it write access.
 */
export function can(actor: Actor, permission: Permission): boolean {
  const grant = grantFor(permission);

  if (actor.platformRole && grant.platform.includes(actor.platformRole)) {
    return true;
  }

  if (actor.viaPlatformRole) return false;

  return actor.role !== null && grant.tenant.includes(actor.role);
}

/** Whether exercising this permission must produce an audit entry. */
export function requiresAudit(actor: Actor, permission: Permission): boolean {
  return grantFor(permission).audit === true || actor.viaPlatformRole;
}

/** Every permission the actor holds — for returning capabilities to a client. */
export function grantedPermissions(actor: Actor): Permission[] {
  return (Object.keys(PERMISSIONS) as Permission[]).filter((p) => can(actor, p));
}
