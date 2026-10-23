import express, { type Request } from "express";
import request from "supertest";
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ users: vi.fn(), audit: vi.fn(), overview: vi.fn(), log: vi.fn(), emails: vi.fn() }));
vi.mock("../services/admin-records", () => ({ getUserDirectory: m.users, getAuditDirectory: m.audit, getUserOverview: m.overview, getEmailDirectory: m.emails }));
vi.mock("../services/tenancy", () => ({ writeAuditLog: m.log }));
vi.mock("../middlewares/requireDbUser", () => ({
  requireDbUser(req: Request, res: express.Response, next: express.NextFunction) {
    if (!req.get("x-test-role")) return res.status(401).json({ message: "Unauthorized" });
    req.dbUser = { id: "actor", email: req.get("x-test-email") ?? "hello@thesocialpundit.com", emailVerified: true } as Request["dbUser"];
    req.tenant = { tenantId: "personal", userId: "actor", role: "owner", platformRole: req.get("x-test-role") === "owner" ? null : req.get("x-test-role"), viaPlatformRole: false } as Request["tenant"];
    next();
  },
}));
import { registerAdminRecordRoutes } from "./admin-records";
function app() { const app = express(); registerAdminRecordRoutes(app); return app; }
beforeEach(() => { vi.clearAllMocks(); m.log.mockResolvedValue(true); m.users.mockResolvedValue({ items: [], total: 0 }); m.audit.mockResolvedValue({ items: [], total: 0 }); m.overview.mockResolvedValue({ user: { id: "u" } }); });
it.each(["/api/admin/users-directory", "/api/admin/audit-directory", "/api/admin/users/u/overview", "/api/admin/email-directory"])("enforces approved staff identity on %s", async path => {
  await request(app()).get(path).expect(401);
  await request(app()).get(path).set("x-test-role", "owner").expect(403);
  await request(app()).get(path).set("x-test-role", "platform_admin").set("x-test-email", "dev@example.com").expect(403);
  expect(m.users).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled(); expect(m.overview).not.toHaveBeenCalled();
});
it("validates pagination and exact audit filters and fails closed on audit outage", async () => {
  await request(app()).get("/api/admin/users-directory?page=0").set("x-test-role", "platform_admin").expect(400);
  await request(app()).get("/api/admin/audit-directory?tenant=invalid").set("x-test-role", "platform_admin").expect(400);
  await request(app()).get("/api/admin/audit-directory?actor=u&action=tenant%3Aread%3Aall&page=2").set("x-test-role", "platform_admin").expect(200);
  expect(m.audit).toHaveBeenCalledWith({ q: "", actor: "u", action: "tenant:read:all", tenant: "", page: 2 });
  m.log.mockResolvedValue(false);
  await request(app()).get("/api/admin/users-directory").set("x-test-role", "platform_admin").expect(503);
  expect(m.users).not.toHaveBeenCalled();
});
it("requires an explicit account-investigation reason and reports unknown/error states", async () => {
  const call = () => request(app()).get("/api/admin/users/u/overview").set("x-test-role", "platform_admin");
  await call().expect(400);
  await call().set("x-access-reason", "Investigate support request").expect(200);
  expect(m.overview).toHaveBeenCalledWith("u", 1);
  m.overview.mockResolvedValue(null); await call().set("x-access-reason", "Investigate support").expect(404);
  m.overview.mockRejectedValue(new Error("DB unavailable")); await call().set("x-access-reason", "Investigate support").expect(503);
});
it("bounds global delivery filters, reports outages explicitly, and does not accept provider metadata selectors", async () => {
  m.emails.mockResolvedValue({ items: [], total: 0, page: 2, pageSize: 25 });
  await request(app()).get("/api/admin/email-directory?user=u&status=unknown&type=daily_digest&page=2").set("x-test-role", "platform_support").expect(200);
  expect(m.emails).toHaveBeenCalledWith({ q: "", user: "u", status: "unknown", type: "daily_digest", page: 2 });
  for (const query of ["status=delivered", "page=0", "page=10001", "metadata=true", "q=a&q=b"]) {
    await request(app()).get(`/api/admin/email-directory?${query}`).set("x-test-role", "platform_admin").expect(400);
  }
  m.emails.mockRejectedValue(new Error("DB unavailable"));
  await request(app()).get("/api/admin/email-directory").set("x-test-role", "platform_admin").expect(503);
});
it("validates and forwards account membership pagination", async () => {
  await request(app()).get("/api/admin/users/u/overview?membershipPage=2").set("x-test-role", "platform_admin").set("x-access-reason", "Inspect all memberships").expect(200);
  expect(m.overview).toHaveBeenCalledWith("u", 2);
  await request(app()).get("/api/admin/users/u/overview?membershipPage=0").set("x-test-role", "platform_admin").set("x-access-reason", "Inspect all memberships").expect(400);
});
