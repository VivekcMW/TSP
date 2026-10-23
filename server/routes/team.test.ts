import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { guardNotificationsMediaNetwork } from "../../test/notifications-media-network";
import { installSupertestTransport } from "../../test/supertest-transport";

/**
 * The real route file + the real permission matrix (server/services/permissions.ts,
 * pure/no DB) run unmocked, so role-gating is exercised for real. Only the
 * database, the team-invitations service, email, and tenancy's listMemberships
 * are faked.
 */
const m = vi.hoisted(() => ({
  tenantRow: vi.fn(),
  listMemberships: vi.fn(),
  listTenantMembers: vi.fn(),
  listPendingInvitations: vi.fn(),
  inviteTenantMember: vi.fn(),
  revokeInvitation: vi.fn(),
  acceptTenantInvitation: vi.fn(),
  updateTenantMemberRole: vi.fn(),
  removeTenantMember: vi.fn(),
  getDraftsPendingTenantReview: vi.fn(),
  approveDraftForTenantReview: vi.fn(),
  sendAppEmail: vi.fn(),
  teamInvitation: vi.fn(),
  writeAuditLog: vi.fn(),
  ScheduleConflictError: class MockScheduleConflictError extends Error {},
}));

let dbUser: { id: string; name?: string | null; firstName?: string | null; email?: string | null };
let tenant: { tenantId: string; userId: string; role: string; platformRole: string | null; viaPlatformRole: boolean };

vi.mock("../middlewares/requireDbUser", () => ({
  requireDbUser: (req: any, _res: unknown, next: () => void) => { req.dbUser = dbUser; req.tenant = tenant; next(); },
  authedOf: (req: any) => ({ dbUser: req.dbUser, tenant: req.tenant }),
}));
vi.mock("../services/tenancy", () => ({ listMemberships: m.listMemberships, writeAuditLog: m.writeAuditLog }));
vi.mock("../services/teamInvitations", () => ({
  listTenantMembers: m.listTenantMembers,
  listPendingInvitations: m.listPendingInvitations,
  inviteTenantMember: m.inviteTenantMember,
  revokeInvitation: m.revokeInvitation,
  acceptTenantInvitation: m.acceptTenantInvitation,
  updateTenantMemberRole: m.updateTenantMemberRole,
  removeTenantMember: m.removeTenantMember,
}));
vi.mock("../storage", () => ({
  storage: { getDraftsPendingTenantReview: m.getDraftsPendingTenantReview, approveDraftForTenantReview: m.approveDraftForTenantReview },
  ScheduleConflictError: m.ScheduleConflictError,
}));
vi.mock("../services/email", () => ({ sendAppEmail: m.sendAppEmail }));
vi.mock("../services/email/templates", () => ({ emailTemplates: { teamInvitation: m.teamInvitation } }));
vi.mock("../db", () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => m.tenantRow() }) }) }) } }));
// Tripwires: this suite must never touch Postgres/Redis/providers directly.
vi.mock("pg", () => { throw new Error("Postgres forbidden in team route tests"); });
vi.mock("ioredis", () => { throw new Error("Redis forbidden in team route tests"); });
vi.mock("resend", () => { throw new Error("Provider forbidden in team route tests"); });
vi.mock("dotenv", () => { throw new Error("Environment file loads forbidden in team route tests"); });
vi.mock("dotenv/config", () => { throw new Error("Environment file loads forbidden in team route tests"); });

import { registerTeamRoutes } from "./team";
import { clearFeatureFlagCache } from "../services/featureFlags";

guardNotificationsMediaNetwork();
let restoreTransport: ReturnType<typeof installSupertestTransport>;
beforeAll(() => { restoreTransport = installSupertestTransport(); });
afterAll(async () => { await restoreTransport(); });

let app: express.Express;
beforeEach(() => {
  for (const mock of Object.values(m)) if (typeof mock === "function" && "mockReset" in mock) (mock as ReturnType<typeof vi.fn>).mockReset();
  clearFeatureFlagCache();
  m.tenantRow.mockResolvedValue([{ name: "Acme Co", kind: "team" }]);
  m.listMemberships.mockResolvedValue([{ tenantId: "tenant-1", name: "Acme Co", kind: "team", status: "active", role: "owner" }]);
  dbUser = { id: "user-1", name: "Jamie Author", email: "jamie@example.test" };
  tenant = { tenantId: "tenant-1", userId: "user-1", role: "owner", platformRole: null, viaPlatformRole: false };
  app = express();
  app.use(express.json());
  registerTeamRoutes(app);
});
afterEach(() => { vi.unstubAllEnvs(); });

function asRole(role: string) { tenant = { ...tenant, role }; }

it("returns the acting tenant's context and memberships", async () => {
  const response = await request(app).get("/api/team/context");
  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({ tenantId: "tenant-1", tenantName: "Acme Co", tenantKind: "team", role: "owner" });
  expect(response.body.memberships).toHaveLength(1);
});

it("denies listing members to a plain member role", async () => {
  asRole("member");
  const response = await request(app).get("/api/team/members");
  expect(response.status).toBe(403);
  expect(m.listTenantMembers).not.toHaveBeenCalled();
});

it("returns 503 instead of the handler when the team_workspaces flag is disabled", async () => {
  asRole("manager");
  m.tenantRow.mockResolvedValueOnce([{ enabled: false }]);
  const response = await request(app).get("/api/team/members");
  expect(response.status).toBe(503);
  expect(response.body.code).toBe("feature_disabled");
  expect(m.listTenantMembers).not.toHaveBeenCalled();
});

it("still serves team/context (identity, not a management action) regardless of the team_workspaces flag", async () => {
  const response = await request(app).get("/api/team/context");
  expect(response.status).toBe(200);
});

it("allows a manager to list members", async () => {
  asRole("manager");
  m.listTenantMembers.mockResolvedValue([{ userId: "user-2", name: "Sam", email: "sam@example.test", role: "member", joinedAt: new Date() }]);
  const response = await request(app).get("/api/team/members");
  expect(response.status).toBe(200);
  expect(response.body).toHaveLength(1);
});

it("denies inviting a member to a manager role (admin+owner only)", async () => {
  asRole("manager");
  const response = await request(app).post("/api/team/invitations").send({ email: "new@example.test", role: "member" });
  expect(response.status).toBe(403);
  expect(m.inviteTenantMember).not.toHaveBeenCalled();
});

it("rejects an invalid invite payload before calling the service", async () => {
  const response = await request(app).post("/api/team/invitations").send({ email: "not-an-email", role: "member" });
  expect(response.status).toBe(400);
  expect(m.inviteTenantMember).not.toHaveBeenCalled();
});

it("sends a team invitation email on success", async () => {
  m.inviteTenantMember.mockResolvedValue({ kind: "invited", id: "invite-1", token: "a".repeat(64) });
  m.teamInvitation.mockReturnValue({ subject: "You're invited", html: "<p>hi</p>" });
  const response = await request(app).post("/api/team/invitations").send({ email: "new@example.test", role: "member" });
  expect(response.status).toBe(201);
  expect(m.inviteTenantMember).toHaveBeenCalledWith({ tenantId: "tenant-1", email: "new@example.test", role: "member", invitedByUserId: "user-1" });
  expect(m.sendAppEmail).toHaveBeenCalledWith(expect.objectContaining({ type: "team_invitation", recipient: "new@example.test", subject: "You're invited" }));
});

it("reports an already-pending invitation as a conflict", async () => {
  m.inviteTenantMember.mockResolvedValue({ kind: "already_invited" });
  const response = await request(app).post("/api/team/invitations").send({ email: "new@example.test", role: "member" });
  expect(response.status).toBe(409);
  expect(m.sendAppEmail).not.toHaveBeenCalled();
});

it("404s revoking a missing invitation", async () => {
  m.revokeInvitation.mockResolvedValue(false);
  const response = await request(app).delete("/api/team/invitations/invite-x");
  expect(response.status).toBe(404);
});

it("blocks changing the owner's role", async () => {
  m.updateTenantMemberRole.mockResolvedValue({ kind: "owner_immutable" });
  const response = await request(app).patch("/api/team/members/user-2").send({ role: "admin" });
  expect(response.status).toBe(409);
});

it("404s removing a member that is not found", async () => {
  m.removeTenantMember.mockResolvedValue({ kind: "not_found" });
  const response = await request(app).delete("/api/team/members/user-2");
  expect(response.status).toBe(404);
});

it("accepts a valid invitation token", async () => {
  m.acceptTenantInvitation.mockResolvedValue({ kind: "accepted", tenantId: "tenant-2", role: "member" });
  const response = await request(app).post("/api/team-invitations/accept").send({ token: "a".repeat(64) });
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ status: "accepted", tenantId: "tenant-2", role: "member" });
});

it("reports already-member acceptance without a bogus tenantId field", async () => {
  m.acceptTenantInvitation.mockResolvedValue({ kind: "already_member" });
  const response = await request(app).post("/api/team-invitations/accept").send({ token: "a".repeat(64) });
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ status: "already_member" });
});

it("rejects a malformed invitation token before calling the service", async () => {
  const response = await request(app).post("/api/team-invitations/accept").send({ token: "not-a-real-token" });
  expect(response.status).toBe(400);
  expect(m.acceptTenantInvitation).not.toHaveBeenCalled();
});

it("404s an invalid or expired invitation", async () => {
  m.acceptTenantInvitation.mockResolvedValue({ kind: "invalid" });
  const response = await request(app).post("/api/team-invitations/accept").send({ token: "a".repeat(64) });
  expect(response.status).toBe(404);
});

it("denies the review queue to a plain member", async () => {
  asRole("member");
  const response = await request(app).get("/api/team/review-queue");
  expect(response.status).toBe(403);
});

it("allows a manager to read the review queue", async () => {
  asRole("manager");
  m.getDraftsPendingTenantReview.mockResolvedValue([{ id: "draft-1", content: "hello", userId: "user-2" }]);
  const response = await request(app).get("/api/team/review-queue");
  expect(response.status).toBe(200);
  expect(response.body).toHaveLength(1);
});

it("maps a schedule conflict on approval to 409 via instanceof, not error.name", async () => {
  m.approveDraftForTenantReview.mockRejectedValue(new m.ScheduleConflictError("Draft changed. Reload and review the current content."));
  const response = await request(app).post("/api/team/drafts/draft-1/approve").send({ content: "hello", updatedAt: new Date().toISOString() });
  expect(response.status).toBe(409);
  expect(response.body.message).toBe("Draft changed. Reload and review the current content.");
});

it("404s approving a draft that is not found", async () => {
  m.approveDraftForTenantReview.mockResolvedValue(undefined);
  const response = await request(app).post("/api/team/drafts/draft-1/approve").send({ content: "hello", updatedAt: new Date().toISOString() });
  expect(response.status).toBe(404);
});

it("approves a teammate's draft", async () => {
  m.approveDraftForTenantReview.mockResolvedValue({ id: "draft-1", publishApprovedBy: "user-1" });
  const response = await request(app).post("/api/team/drafts/draft-1/approve").send({ content: "hello", updatedAt: new Date().toISOString() });
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ id: "draft-1", publishApprovedBy: "user-1" });
});
