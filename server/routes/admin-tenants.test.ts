import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ directory: vi.fn(), overview: vi.fn(), audit: vi.fn() }));
vi.mock("../services/admin-tenants", () => ({ getTenantDirectory: m.directory, getTenantOverview: m.overview }));
vi.mock("../services/tenancy", () => ({ writeAuditLog: m.audit }));
vi.mock("../middlewares/requireDbUser", () => ({
  requireDbUser(req: Request, res: Response, next: NextFunction) {
    const role = req.get("x-test-role");
    if (!role) return res.status(401).json({ message: "Unauthorized" });
    req.dbUser = { id: "actor", email: "hello@thesocialpundit.com", emailVerified: true } as Request["dbUser"];
    req.tenant = { tenantId: req.get("x-tenant-id") ?? "personal-tenant", userId: "actor", role: "owner",
      platformRole: role === "owner" ? null : role, viaPlatformRole: !!req.get("x-tenant-id") } as Request["tenant"];
    next();
  },
}));
import { registerAdminTenantRoutes } from "./admin-tenants";
const id = "90cc5331-e6e7-4e29-bddb-8c906ed4310e";
function app() { const app = express(); registerAdminTenantRoutes(app); return app; }
beforeEach(() => {
  vi.clearAllMocks(); m.audit.mockResolvedValue(true);
  m.directory.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 });
  m.overview.mockResolvedValue({ tenant: { id } });
});
it("blocks anonymous and tenant-owner access before any platform reads", async () => {
  await request(app()).get("/api/admin/tenant-directory").expect(401);
  await request(app()).get("/api/admin/tenant-directory").set("x-test-role", "owner").expect(403);
  await request(app()).get(`/api/admin/tenants/${id}/overview`).set("x-test-role", "owner").set("x-tenant-id", id).expect(403);
  expect(m.directory).not.toHaveBeenCalled(); expect(m.overview).not.toHaveBeenCalled();
});
it.each(["platform_support", "platform_admin"])("allows %s to search with bounded parsed pagination", async role => {
  const result = await request(app()).get("/api/admin/tenant-directory?q=%20Acme%20&kind=corporate&status=active&page=2").set("x-test-role", role).expect(200);
  expect(result.headers["cache-control"]).toBe("no-store");
  expect(m.directory).toHaveBeenCalledWith({ q: "Acme", kind: "corporate", status: "active", page: 2 });
  expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "tenant:read:all" }));
});
it.each(["page=0", "page=-1", "page=1.5", "page=10001", "page=NaN", "q=a&q=b", "status=unknown", "kind=unknown", "extra=value"])("rejects malformed directory query %s", async query => {
  await request(app()).get(`/api/admin/tenant-directory?${query}`).set("x-test-role", "platform_admin").expect(400);
  expect(m.directory).not.toHaveBeenCalled();
});
it("requires a scoped target and an explicit investigation reason", async () => {
  const path = `/api/admin/tenants/${id}/overview`;
  await request(app()).get(path).set("x-test-role", "platform_admin").set("x-access-reason", "Investigate failure").expect(403);
  await request(app()).get(path).set("x-test-role", "platform_admin").set("x-tenant-id", id).expect(400);
  expect(m.overview).not.toHaveBeenCalled();
});
it.each(["platform_support", "platform_admin"])("audits scoped %s investigation before returning data", async role => {
  const result = await request(app()).get(`/api/admin/tenants/${id}/overview`).set("x-test-role", role)
    .set("x-tenant-id", id).set("x-access-reason", "Investigate publishing ticket").expect(200);
  expect(result.headers["cache-control"]).toBe("no-store");
  expect(m.overview).toHaveBeenCalledWith(id, 1);
  expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ tenantId: id, justification: "Investigate publishing ticket", action: "tenant:read:all" }));
});
it("fails closed on audit outage, returns not found explicitly and surfaces service failures", async () => {
  const call = () => request(app()).get(`/api/admin/tenants/${id}/overview`).set("x-test-role", "platform_admin").set("x-tenant-id", id).set("x-access-reason", "Investigate publishing");
  m.audit.mockResolvedValue(false); await call().expect(503);
  expect(m.overview).not.toHaveBeenCalled();
  m.audit.mockResolvedValue(true); m.overview.mockResolvedValue(null); await call().expect(404);
  m.overview.mockRejectedValue(new Error("DB down")); await call().expect(503);
  m.directory.mockRejectedValue(new Error("DB down"));
  await request(app()).get("/api/admin/tenant-directory").set("x-test-role", "platform_admin").expect(503);
});
it("rejects malformed target IDs without reading tenant data", async () => {
  await request(app()).get("/api/admin/tenants/not-a-uuid/overview").set("x-test-role", "platform_admin").set("x-access-reason", "Investigate").expect(400);
  expect(m.overview).not.toHaveBeenCalled();
});
it("accepts a bounded member page and rejects malformed pagination before reading tenant data", async () => {
  const call = (query: string) => request(app()).get(`/api/admin/tenants/${id}/overview?${query}`).set("x-test-role", "platform_admin")
    .set("x-tenant-id", id).set("x-access-reason", "Investigate workspace membership");
  for (const query of ["memberPage=0", "memberPage=1.5", "memberPage=10001", "memberPage=2&memberPage=3", "unexpected=1"]) await call(query).expect(400);
  expect(m.overview).not.toHaveBeenCalled();
  await call("memberPage=2").expect(200);
  expect(m.overview).toHaveBeenCalledWith(id, 2);
});
