import express, { type Express } from "express";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

vi.mock("@clerk/express", () => ({
  getAuth: vi.fn(),
  clerkClient: { users: { getUser: vi.fn() } },
}));

import { pool } from "../db";
import { ownerDb, ownerPool } from "../../test/db-owner";
import { users } from "@shared/models/auth";
import { auditLog, tenantMembers, tenants } from "@shared/models/tenancy";
import { userProfiles, inboxItems, drafts, socialAccounts, socialAnalytics } from "@shared/schema";
import type { TenantContext } from "../services/tenancy";
import { requirePermission } from "./requirePermission";
import type { Permission } from "../services/permissions";

/**
 * The permission gate end to end: denial, the justification requirement for
 * cross-tenant access, and the audit entries the middleware writes on the
 * caller's behalf.
 */

/** Mounts a probe behind the gate, with a pre-set tenant context. */
function appWith(ctx: TenantContext, permission: Permission): Express {
  const app = express();
  app.use((req, _res, next) => {
    req.dbUser = { id: ctx.userId } as NonNullable<typeof req.dbUser>;
    req.tenant = ctx;
    next();
  });
  app.get("/probe", requirePermission(permission), (_req, res) => res.json({ ok: true }));
  return app;
}

let tenantId: string;

beforeEach(async () => {
  await ownerDb.delete(auditLog);
  await ownerDb.delete(socialAnalytics);
  await ownerDb.delete(socialAccounts);
  await ownerDb.delete(drafts);
  await ownerDb.delete(inboxItems);
  await ownerDb.delete(userProfiles);
  await ownerDb.delete(tenantMembers);
  await ownerDb.delete(tenants);
  await ownerDb.delete(users);

  await ownerDb.insert(users).values({ id: "actor", email: "actor@perm.test" });
  const [tenant] = await ownerDb
    .insert(tenants)
    .values({ kind: "corporate", name: "Acme" })
    .returning();
  tenantId = tenant.id;
  await ownerDb.insert(tenantMembers).values({ tenantId, userId: "actor", role: "member" });
});

afterAll(async () => {
  await pool.end();
  await ownerPool.end();
});

function memberCtx(role: TenantContext["role"] = "member"): TenantContext {
  return { tenantId, userId: "actor", role, platformRole: null, viaPlatformRole: false };
}
function platformCtx(platformRole: TenantContext["platformRole"]): TenantContext {
  return { tenantId, userId: "actor", role: "member", platformRole, viaPlatformRole: true };
}

describe("requirePermission", () => {
  it("allows a member to act on their own content", async () => {
    const res = await request(appWith(memberCtx(), "draft:write:own")).get("/probe");
    expect(res.status).toBe(200);
  });

  it("denies a member a tenant-wide permission", async () => {
    const res = await request(appWith(memberCtx(), "draft:read:tenant")).get("/probe");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("permission_denied");
  });

  it("allows a manager the same tenant-wide permission", async () => {
    const res = await request(appWith(memberCtx("manager"), "draft:read:tenant")).get("/probe");
    expect(res.status).toBe(200);
  });

  it("returns 500 rather than allowing through if requireDbUser did not run", async () => {
    const app = express();
    app.get("/probe", requirePermission("draft:write:own"), (_req, res) => res.json({ ok: true }));

    const res = await request(app).get("/probe");

    // Failing closed matters: a misordered middleware chain must not become an
    // open door.
    expect(res.status).toBe(500);
  });
});

describe("cross-tenant access by platform staff", () => {
  it("denies a write even to platform_admin", async () => {
    const res = await request(appWith(platformCtx("platform_admin"), "draft:write:own"))
      .get("/probe")
      .set("x-access-reason", "investigating a report");

    expect(res.status).toBe(403);
  });

  it("requires a stated reason before allowing a read", async () => {
    const res = await request(appWith(platformCtx("platform_support"), "draft:read:tenant")).get("/probe");

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("justification_required");
    expect(await ownerDb.select().from(auditLog)).toHaveLength(0);
  });

  it("allows the read once a reason is given, and records it", async () => {
    const res = await request(appWith(platformCtx("platform_support"), "draft:read:tenant"))
      .get("/probe")
      .set("x-access-reason", "ticket 4172: user reports missing drafts")
      .set("x-correlation-id", "corr-123");

    expect(res.status).toBe(200);

    const entries = await ownerDb.select().from(auditLog);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actorUserId: "actor",
      actorPlatformRole: "platform_support",
      tenantId,
      action: "draft:read:tenant",
      justification: "ticket 4172: user reports missing drafts",
      correlationId: "corr-123",
    });
  });

  it("denies platform_support a platform_admin-only capability", async () => {
    const res = await request(appWith(platformCtx("platform_support"), "impersonate:all"))
      .get("/probe")
      .set("x-access-reason", "why not");

    expect(res.status).toBe(403);
  });
});

describe("auditing", () => {
  it("audits a privileged action even for a legitimate tenant owner", async () => {
    await ownerDb
      .update(tenantMembers)
      .set({ role: "owner" })
      .where(eq(tenantMembers.userId, "actor"));

    const res = await request(appWith(memberCtx("owner"), "tenant:delete")).get("/probe");

    expect(res.status).toBe(200);
    const entries = await ownerDb.select().from(auditLog);
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe("tenant:delete");
  });

  it("does not audit a member acting on their own content", async () => {
    await request(appWith(memberCtx(), "draft:write:own")).get("/probe").expect(200);
    expect(await ownerDb.select().from(auditLog)).toHaveLength(0);
  });
});
