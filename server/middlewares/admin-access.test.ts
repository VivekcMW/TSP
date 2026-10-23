import express, { type Request } from "express";
import request from "supertest";
import { beforeEach, expect, it, vi } from "vitest";
const audit = vi.hoisted(() => vi.fn());
vi.mock("../services/tenancy", () => ({ writeAuditLog: audit }));
import { requirePermission } from "./requirePermission";
function app(email: string, verified = true, role: string | null = "platform_admin") {
  const app = express();
  app.use((req, _res, next) => {
    req.dbUser = { id: "actor", email, emailVerified: verified } as Request["dbUser"];
    req.tenant = { tenantId: "personal", userId: "actor", role: "owner", platformRole: role, viaPlatformRole: false } as Request["tenant"];
    next();
  });
  app.get("/probe", requirePermission("usage:read:all"), (_req, res) => res.json({ ok: true }));
  return app;
}
beforeEach(() => { audit.mockReset(); audit.mockResolvedValue(true); });
it.each(["dev@example.com", "other@thesocialpundit.com", "hello@thesocialpundit.com.evil.test"])("denies %s despite a provisioned platform role", async email => {
  await request(app(email)).get("/probe").expect(403);
  expect(audit).not.toHaveBeenCalled();
});
it("denies unverified allowed addresses and unprovisioned accounts", async () => {
  await request(app("hello@thesocialpundit.com", false)).get("/probe").expect(403);
  await request(app("hello@thesocialpundit.com", true, null)).get("/probe").expect(403);
});
it.each(["hello@thesocialpundit.com", "marketing@thesocialpundit.com"])("allows and audits the verified provisioned account %s", async email => {
  await request(app(email)).get("/probe").expect(200);
  expect(audit).toHaveBeenCalledOnce();
});
