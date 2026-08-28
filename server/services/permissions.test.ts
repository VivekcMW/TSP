import { describe, expect, it } from "vitest";
import { PLATFORM_ROLES, TENANT_ROLES } from "@shared/models/tenancy";
import type { PlatformRole, TenantRole } from "@shared/models/tenancy";
import {
  PERMISSIONS,
  can,
  grantedPermissions,
  requiresAudit,
  type Actor,
  type Permission,
} from "./permissions";

const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

function member(role: TenantRole): Actor {
  return { role, platformRole: null, viaPlatformRole: false };
}
function staff(platformRole: PlatformRole): Actor {
  return { role: null, platformRole, viaPlatformRole: true };
}

describe("the permission matrix as a whole", () => {
  it("grants nothing to an actor with no role at all", () => {
    const nobody: Actor = { role: null, platformRole: null, viaPlatformRole: false };
    expect(grantedPermissions(nobody)).toEqual([]);
  });

  it("gives every permission to at least one role, so none is unreachable", () => {
    const reachable = new Set<Permission>();
    for (const role of TENANT_ROLES) grantedPermissions(member(role)).forEach((p) => reachable.add(p));
    for (const role of PLATFORM_ROLES) grantedPermissions(staff(role)).forEach((p) => reachable.add(p));

    const orphaned = ALL_PERMISSIONS.filter((p) => !reachable.has(p));
    expect(orphaned).toEqual([]);
  });

  it("keeps tenant roles monotonic: owner holds everything admin does, and so on", () => {
    // A privilege ladder that is not monotonic is almost always a mistake, and
    // it is the kind that review misses.
    const ladder: TenantRole[] = ["member", "manager", "admin", "owner"];
    for (let i = 0; i < ladder.length - 1; i++) {
      const lower = new Set(grantedPermissions(member(ladder[i])));
      const higher = new Set(grantedPermissions(member(ladder[i + 1])));
      const lost = [...lower].filter((p) => !higher.has(p));
      expect(lost, `${ladder[i + 1]} should hold everything ${ladder[i]} does`).toEqual([]);
    }
  });

  it("keeps platform_admin a superset of platform_support", () => {
    const support = new Set(grantedPermissions(staff("platform_support")));
    const admin = new Set(grantedPermissions(staff("platform_admin")));
    expect([...support].filter((p) => !admin.has(p))).toEqual([]);
  });
});

describe("platform staff are read-only across tenants", () => {
  // The property that matters most: support can look, but cannot act.
  const WRITE_SHAPED = ALL_PERMISSIONS.filter((p) =>
    /:(write|approve|invite|remove|create|connect|manage|delete|operate|override)\b/.test(p) ||
    p === "tenant:delete",
  );

  it.each(WRITE_SHAPED)("platform_support cannot %s", (permission) => {
    expect(can(staff("platform_support"), permission)).toBe(false);
  });

  it("platform_support cannot write into a tenant even where a member could", () => {
    expect(can(member("member"), "draft:write:own")).toBe(true);
    expect(can(staff("platform_support"), "draft:write:own")).toBe(false);
  });

  it("a synthesised tenant role cannot grant a platform actor write access", () => {
    // resolveTenantContext previously handed platform actors a "member" role.
    // viaPlatformRole must make that role irrelevant.
    const sneaky: Actor = {
      role: "owner",
      platformRole: "platform_support",
      viaPlatformRole: true,
    };
    expect(can(sneaky, "draft:write:own")).toBe(false);
    expect(can(sneaky, "billing:manage:tenant")).toBe(false);
    expect(can(sneaky, "tenant:delete")).toBe(false);
  });
});

describe("tenant role boundaries", () => {
  it("a member cannot read other members' drafts", () => {
    expect(can(member("member"), "draft:read:own")).toBe(true);
    expect(can(member("member"), "draft:read:tenant")).toBe(false);
  });

  it("a manager can review tenant drafts but not change billing or branding", () => {
    expect(can(member("manager"), "draft:read:tenant")).toBe(true);
    expect(can(member("manager"), "draft:approve:tenant")).toBe(true);
    expect(can(member("manager"), "brand:write:tenant")).toBe(false);
    expect(can(member("manager"), "billing:manage:tenant")).toBe(false);
    expect(can(member("manager"), "member:invite:tenant")).toBe(false);
  });

  it("an admin manages the tenant but cannot delete it", () => {
    expect(can(member("admin"), "member:invite:tenant")).toBe(true);
    expect(can(member("admin"), "billing:manage:tenant")).toBe(true);
    expect(can(member("admin"), "brand:write:tenant")).toBe(true);
    expect(can(member("admin"), "tenant:delete")).toBe(false);
  });

  it("only the owner can delete the tenant", () => {
    expect(can(member("owner"), "tenant:delete")).toBe(true);
  });

  it("no tenant role reaches a cross-tenant permission", () => {
    const crossTenant = ALL_PERMISSIONS.filter((p) => p.endsWith(":all"));
    for (const role of TENANT_ROLES) {
      for (const permission of crossTenant) {
        expect(can(member(role), permission), `${role} must not hold ${permission}`).toBe(false);
      }
    }
  });
});

describe("the most dangerous capabilities", () => {
  const BREAK_GLASS: Permission[] = [
    "impersonate:all",
    "flag:write:all",
    "quota:override:all",
    "pipeline:operate:all",
  ];

  it.each(BREAK_GLASS)("%s is restricted to platform_admin", (permission) => {
    expect(can(staff("platform_admin"), permission)).toBe(true);
    expect(can(staff("platform_support"), permission)).toBe(false);
    for (const role of TENANT_ROLES) {
      expect(can(member(role), permission)).toBe(false);
    }
  });
});

describe("auditing", () => {
  it("audits every cross-tenant permission", () => {
    for (const permission of ALL_PERMISSIONS.filter((p) => p.endsWith(":all"))) {
      expect(
        requiresAudit(staff("platform_admin"), permission),
        `${permission} must be audited`,
      ).toBe(true);
    }
  });

  it("audits ordinary permissions when reached through platform privilege", () => {
    // Support reading a tenant's drafts is routine for them and invisible to
    // the tenant unless it is recorded.
    expect(requiresAudit(staff("platform_support"), "draft:read:tenant")).toBe(true);
    expect(requiresAudit(member("manager"), "draft:read:tenant")).toBe(false);
  });

  it("does not audit a member acting on their own content", () => {
    expect(requiresAudit(member("member"), "draft:write:own")).toBe(false);
  });
});
