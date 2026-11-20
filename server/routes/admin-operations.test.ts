import express, { type Request } from "express";
import request from "supertest";
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ audit: vi.fn(), grant: vi.fn(), grants: vi.fn(), revoke: vi.fn(), job: vi.fn(), jobs: vi.fn(), recover: vi.fn(),
  health: vi.fn(), evaluate: vi.fn(), incidents: vi.fn(), transition: vi.fn(), insights: vi.fn() }));
vi.mock("../services/tenancy", () => ({ writeAuditLog: m.audit }));
vi.mock("../services/admin-quotas", () => ({ grantQuota: m.grant, listQuotaGrants: m.grants, revokeQuota: m.revoke, AdminControlConflict: class extends Error {} }));
vi.mock("../services/admin-jobs", () => ({ getAdminJob: m.job, listAdminJobs: m.jobs, recoverDiscoveryJob: m.recover }));
vi.mock("../services/admin-incidents", () => ({ operationalSnapshot: m.health, synchronizeIncidents: m.evaluate, listIncidents: m.incidents, transitionIncident: m.transition }));
vi.mock("../services/admin-insights", () => ({ getTenantInsights: m.insights }));
vi.mock("../jobs/queue", () => ({ InboxRefreshAdmissionError: class extends Error {} }));
vi.mock("../middlewares/requireDbUser", () => ({
  requireDbUser(req: Request, res: express.Response, next: express.NextFunction) {
    const role = req.get("x-test-role");
    if (!role) return res.status(401).json({ message: "Unauthorized" });
    req.dbUser = { id: "actor", email: req.get("x-test-email") ?? "hello@thesocialpundit.com", emailVerified: true } as Request["dbUser"];
    req.tenant = { tenantId: req.get("x-tenant-id") ?? "personal", userId: "actor", role: "owner", viaPlatformRole: false,
      platformRole: role === "owner" ? null : role } as Request["tenant"]; next();
  },
}));
import { registerAdminOperationRoutes } from "./admin-operations";
const tenant = "90cc5331-e6e7-4e29-bddb-8c906ed4310e";
const intent = "31e43402-9b9c-4592-8c46-7f1d6ef7a7d0";
function app() { const app = express(); app.use(express.json()); registerAdminOperationRoutes(app); return app; }
beforeEach(() => { vi.clearAllMocks(); m.audit.mockResolvedValue(true); m.grant.mockResolvedValue({ id: intent }); m.grants.mockResolvedValue([]); m.incidents.mockResolvedValue([]); m.health.mockResolvedValue({ expected: false }); m.recover.mockResolvedValue({ outcome: "waiting" }); });
it.each(["health", "jobs?queue=inbox", "incidents", `quotas/${tenant}`, `insights/${tenant}`])("rejects unauthenticated, member and unapproved staff access to %s", async path => {
  await request(app()).get(`/api/admin/operations/${path}`).expect(401);
  await request(app()).get(`/api/admin/operations/${path}`).set("x-test-role", "owner").expect(403);
  await request(app()).get(`/api/admin/operations/${path}`).set("x-test-role", "platform_admin").set("x-test-email", "dev@example.com").expect(403);
});
it("requires a reason, exact scope, bounded body and successful audit before granting quota", async () => {
  const call = (body: object) => request(app()).post(`/api/admin/operations/quotas/${tenant}`).set("x-test-role", "platform_admin").send(body);
  const body = { operationId: intent, additional: 10, expiresAt: "2026-10-24T00:00:00Z" };
  await call(body).set("x-tenant-id", tenant).expect(400);
  await call(body).set("x-access-reason", "Support allowance").expect(403);
  await call({ ...body, additional: 0 }).set("x-access-reason", "Support allowance").set("x-tenant-id", tenant).expect(400);
  await call({ ...body, planId: "pro" }).set("x-access-reason", "Support allowance").set("x-tenant-id", tenant).expect(400);
  m.audit.mockResolvedValue(false);
  await call(body).set("x-access-reason", "Support allowance").set("x-tenant-id", tenant).expect(503);
  expect(m.grant).not.toHaveBeenCalled();
  m.audit.mockResolvedValue(true);
  const result = await call(body).set("x-access-reason", "Support allowance").set("x-tenant-id", tenant).expect(200);
  expect(result.headers["cache-control"]).toBe("no-store");
  expect(m.grant).toHaveBeenCalledWith(tenant, "actor", "Support allowance", body);
});
it("does not expose publication recovery or allow support to recover discovery", async () => {
  await request(app()).post("/api/admin/operations/jobs/publishing/job/recover").set("x-test-role", "platform_admin").expect(404);
  await request(app()).post("/api/admin/operations/jobs/inbox/job/recover").set("x-test-role", "platform_support").expect(403);
  expect(m.recover).not.toHaveBeenCalled();
});
it("requires original tenant/operation/confirmation and propagates recovery outcomes without claiming completion", async () => {
  const call = (body: object) => request(app()).post("/api/admin/operations/jobs/inbox/job/recover").set("x-test-role", "platform_admin")
    .set("x-access-reason", "Recover failed discovery").set("x-tenant-id", tenant).send(body);
  await call({ tenantId: tenant, operationId: "original" }).expect(400);
  await call({ tenantId: tenant, operationId: "original", confirm: true }).expect(200, { outcome: "waiting" });
  expect(m.recover).toHaveBeenCalledWith("job", "original", tenant);
  m.recover.mockResolvedValue(null); await call({ tenantId: tenant, operationId: "original", confirm: true }).expect(404);
});
it("rejects bad job filters and versionless incident transitions", async () => {
  await request(app()).get("/api/admin/operations/jobs?queue=emails").set("x-test-role", "platform_admin").expect(400);
  await request(app()).patch(`/api/admin/operations/incidents/${intent}`).set("x-test-role", "platform_admin").set("x-access-reason", "Review incident").send({ state: "resolved" }).expect(400);
  expect(m.jobs).not.toHaveBeenCalled(); expect(m.transition).not.toHaveBeenCalled();
});
