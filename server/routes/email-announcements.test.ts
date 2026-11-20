import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ prepare: vi.fn(), confirm: vi.fn(), list: vi.fn(), audit: vi.fn(), pause: vi.fn(), test: vi.fn() }));
vi.mock("../services/email/announcements", () => ({ prepareAnnouncement: m.prepare, confirmAnnouncement: m.confirm, listAnnouncementCampaigns: m.list, setAnnouncementPaused: m.pause, sendAnnouncementTest: m.test }));
vi.mock("../services/tenancy", () => ({ writeAuditLog: m.audit }));
vi.mock("../middlewares/requireDbUser", () => ({
  requireDbUser(req: Request, res: Response, next: NextFunction) {
    const role = req.headers["x-test-role"];
    if (!role) return res.status(401).json({ message: "Unauthorized" });
    req.dbUser = { id: "actor", email: "hello@thesocialpundit.com", emailVerified: true } as Request["dbUser"];
    req.tenant = { tenantId: "tenant", userId: "actor", role: "owner", platformRole: role === "owner" ? null : role, viaPlatformRole: role !== "owner" } as Request["tenant"];
    next();
  },
  authedOf: (req: Request) => ({ dbUser: req.dbUser, tenant: req.tenant }),
}));
import { registerEmailAnnouncementRoutes } from "./email-announcements";
const id = "90cc5331-e6e7-4e29-bddb-8c906ed4310e";
const content = { type: "product_update", title: "A useful update", body: "The new content planning tools are available.", actionLabel: "Explore", actionUrl: "https://example.invalid/update" };
function app() { const app = express(); app.use(express.json()); registerEmailAnnouncementRoutes(app); return app; }
beforeEach(() => {
  vi.clearAllMocks(); m.audit.mockResolvedValue(true); m.list.mockResolvedValue([]);
  m.prepare.mockResolvedValue({ campaign: { id, audienceCount: 2 }, html: "<p>Preview</p>" }); m.confirm.mockResolvedValue(true);
  vi.stubEnv("EMAIL_ANNOUNCEMENTS_ENABLED", "true");
});
afterEach(() => vi.unstubAllEnvs());
it.each(["owner", "platform_support"])("denies %s despite tenant ownership, without touching campaign data", async role => {
  await request(app()).post("/api/admin/email-announcements/preview").set("x-test-role", role).set("x-access-reason", "Prepare an announcement").send(content).expect(403);
  expect(m.prepare).not.toHaveBeenCalled();
});
it("requires authentication, justification and a successful audit write before preparing a broadcast", async () => {
  await request(app()).post("/api/admin/email-announcements/preview").send(content).expect(401);
  await request(app()).post("/api/admin/email-announcements/preview").set("x-test-role", "platform_admin").send(content).expect(400);
  m.audit.mockResolvedValue(false);
  await request(app()).post("/api/admin/email-announcements/preview").set("x-test-role", "platform_admin").set("x-access-reason", "Explain new features").send(content).expect(503);
  expect(m.prepare).not.toHaveBeenCalled();
});
it.each(["product_update", "maintenance", "incident"])("binds %s to an audited preview without sending", async type => {
  const result = await request(app()).post("/api/admin/email-announcements/preview").set("x-test-role", "platform_admin").set("x-access-reason", "Notify users of an update").send({ ...content, type }).expect(201);
  expect(m.prepare).toHaveBeenCalledWith("actor", { ...content, type });
  expect(m.confirm).not.toHaveBeenCalled();
  expect(result.body.html).toBe("<p>Preview</p>");
  expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "email:send:all", actorUserId: "actor", justification: "Notify users of an update" }));
});
it.each(["javascript:alert(1)", "http://example.invalid", "https://name:password@example.invalid"])("rejects unsafe announcement URLs: %s", async actionUrl => {
  await request(app()).post("/api/admin/email-announcements/preview").set("x-test-role", "platform_admin").set("x-access-reason", "Preview").send({ ...content, actionUrl }).expect(400);
  expect(m.prepare).not.toHaveBeenCalled();
});
it("rejects unsupported fields and missing explicit confirmation", async () => {
  await request(app()).post("/api/admin/email-announcements/preview").set("x-test-role", "platform_admin").set("x-access-reason", "Preview").send({ ...content, recipient: "other@example.invalid" }).expect(400);
  await request(app()).post(`/api/admin/email-announcements/${id}/confirm`).set("x-test-role", "platform_admin").set("x-access-reason", "Send").send({}).expect(400);
  expect(m.confirm).not.toHaveBeenCalled();
});
it("confirms an existing immutable campaign using only its ID and accepts safe retry", async () => {
  for (let i = 0; i < 2; i++) await request(app()).post(`/api/admin/email-announcements/${id}/confirm`).set("x-test-role", "platform_admin").set("x-access-reason", "Send approved product news").send({ confirm: true }).expect(202);
  expect(m.confirm).toHaveBeenNthCalledWith(1, id); expect(m.confirm).toHaveBeenNthCalledWith(2, id);
  expect(m.prepare).not.toHaveBeenCalled();
});
it("keeps preview available when dispatch is disabled but blocks confirmation", async () => {
  vi.stubEnv("EMAIL_ANNOUNCEMENTS_ENABLED", "false");
  await request(app()).post("/api/admin/email-announcements/preview").set("x-test-role", "platform_admin").set("x-access-reason", "Prepare").send(content).expect(201);
  await request(app()).post(`/api/admin/email-announcements/${id}/confirm`).set("x-test-role", "platform_admin").set("x-access-reason", "Send").send({ confirm: true }).expect(503);
  expect(m.confirm).not.toHaveBeenCalled();
});
it("gates test sends independently, rejects recipient overrides and uses only the signed-in admin", async () => {
  const call = (body: object) => request(app()).post(`/api/admin/email-announcements/${id}/test`).set("x-test-role", "platform_admin")
    .set("x-access-reason", "Verify announcement in my own inbox").send(body);
  await call({ confirm: true }).expect(503);
  expect(m.test).not.toHaveBeenCalled();
  vi.stubEnv("EMAIL_ANNOUNCEMENT_TEST_ENABLED", "true");
  await call({ confirm: true, recipient: "other@example.invalid" }).expect(400);
  m.test.mockResolvedValue("unknown");
  const result = await call({ confirm: true }).expect(200);
  expect(result.body.outcome).toBe("unknown");
  expect(m.test).toHaveBeenCalledWith(id, expect.objectContaining({ id: "actor", email: "hello@thesocialpundit.com" }));
});
it("allows pausing with dispatch disabled but blocks resuming until enabled", async () => {
  const call = (paused: boolean) => request(app()).post(`/api/admin/email-announcements/${id}/pause`).set("x-test-role", "platform_admin")
    .set("x-access-reason", "Stop admitting campaign recipients").send({ paused });
  vi.stubEnv("EMAIL_ANNOUNCEMENTS_ENABLED", "false"); m.pause.mockResolvedValue(true);
  await call(true).expect(200); expect(m.pause).toHaveBeenCalledWith(id, true);
  await call(false).expect(503);
  vi.stubEnv("EMAIL_ANNOUNCEMENTS_ENABLED", "true"); m.pause.mockResolvedValue(false);
  await call(false).expect(409);
});
