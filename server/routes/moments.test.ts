import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  audit: vi.fn(), profile: vi.fn(), between: vi.fn(), list: vi.fn(), create: vi.fn(), update: vi.fn(), archive: vi.fn(),
  getWatchlist: vi.fn(), saveWatchlist: vi.fn(), listAlerts: vi.fn(), seen: vi.fn(),
  NotFound: class MomentNotFoundError extends Error {},
  TermError: class WatchlistTermError extends Error {},
}));
vi.mock("../services/tenancy", () => ({ writeAuditLog: m.audit }));
vi.mock("../storage", () => ({ storage: { getUserProfile: m.profile } }));
vi.mock("../repositories/moments", () => ({ findMomentsBetween: m.between, listAdminMoments: m.list, createMoment: m.create,
  updateMoment: m.update, setMomentArchived: m.archive, MomentNotFoundError: m.NotFound }));
vi.mock("../repositories/watchAlerts", () => ({ getWatchlist: m.getWatchlist, saveWatchlist: m.saveWatchlist, listWatchAlerts: m.listAlerts,
  markWatchAlertsSeen: m.seen, WatchlistTermError: m.TermError }));
vi.mock("../db", () => { throw new Error("Database must not load in moments route tests"); });
vi.mock("../middlewares/requireDbUser", () => ({
  requireDbUser(req: Request, res: Response, next: NextFunction) {
    const role = req.get("x-test-role");
    if (!role) return res.status(401).json({ message: "Unauthorized" });
    req.dbUser = { id: "actor", email: role === "member" ? "member@example.test" : "hello@thesocialpundit.com", emailVerified: true } as Request["dbUser"];
    req.tenant = { tenantId: "tenant-1", userId: "actor", role: "owner", platformRole: role === "member" ? null : role, viaPlatformRole: false } as Request["tenant"];
    next();
  },
  authedOf: (req: Request) => ({ dbUser: req.dbUser, tenant: req.tenant }),
}));
import { registerMomentsRoutes } from "./moments";

const id = "7d7b8f0a-1f35-4c34-9f63-1c8f4b2f5d10";
function app() { const app = express(); app.use(express.json()); registerMomentsRoutes(app); return app; }
const valid = { title: "Union Budget", startsOn: "2027-02-01", endsOn: null, region: "IN", tags: ["Finance", "finance", "tax"], leadDays: 21,
  url: "https://example.test/budget", description: "" };
const record = { id: "m1", title: "Union Budget", startsOn: "2027-02-01", endsOn: null, region: "IN", tags: ["finance"], leadDays: 14, url: null, description: null };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  m.audit.mockResolvedValue(true);
  m.list.mockResolvedValue([]);
  m.create.mockImplementation(async input => ({ id, ...input, archived: false }));
  m.update.mockImplementation(async (momentId, input) => ({ id: momentId, ...input, archived: false }));
  m.archive.mockImplementation(async (momentId, archived) => ({ id: momentId, archived }));
  m.profile.mockResolvedValue({ keywords: [{ keyword: "Finance", weight: 0.9 }], companies: [], searchEdition: "en-IN", timezone: "UTC", recommendedIndustry: null });
  m.between.mockResolvedValue([record]);
});

describe("admin moments", () => {
  it("blocks anonymous users and non-admin members before any read or write", async () => {
    await request(app()).get("/api/admin/moments").expect(401);
    await request(app()).get("/api/admin/moments").set("x-test-role", "member").expect(403);
    await request(app()).post("/api/admin/moments").set("x-test-role", "member").set("x-access-reason", "Add").send(valid).expect(403);
    await request(app()).patch(`/api/admin/moments/${id}`).set("x-test-role", "platform_support").set("x-access-reason", "Edit").send(valid).expect(403);
    await request(app()).post(`/api/admin/moments/${id}/archive`).set("x-test-role", "member").set("x-access-reason", "Archive").send({ archived: true }).expect(403);
    expect(m.list).not.toHaveBeenCalled(); expect(m.create).not.toHaveBeenCalled(); expect(m.update).not.toHaveBeenCalled(); expect(m.archive).not.toHaveBeenCalled();
  });

  it("lists with an audited, validated filter", async () => {
    const response = await request(app()).get("/api/admin/moments?filter=archived").set("x-test-role", "platform_admin").expect(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(m.list).toHaveBeenCalledWith("archived", expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "flag:write:all", actorUserId: "actor" }));
    await request(app()).get("/api/admin/moments?filter=soon").set("x-test-role", "platform_admin").expect(400);
    await request(app()).get("/api/admin/moments?filter=past&extra=1").set("x-test-role", "platform_admin").expect(400);
  });

  it("creates with a reason and normalized input, recording the actor", async () => {
    await request(app()).post("/api/admin/moments").set("x-test-role", "platform_admin").send(valid).expect(400);
    const response = await request(app()).post("/api/admin/moments").set("x-test-role", "platform_admin").set("x-access-reason", "Budget week").send(valid).expect(201);
    expect(response.body.id).toBe(id);
    expect(m.create).toHaveBeenCalledWith({ ...valid, tags: ["finance", "tax"], description: null },
      expect.objectContaining({ userId: "actor", platformRole: "platform_admin", reason: "Budget week" }));
  });

  it.each([
    ["an end before the start", { endsOn: "2027-01-31" }],
    ["a missing title", { title: "  " }],
    ["a long title", { title: "x".repeat(121) }],
    ["an impossible date", { startsOn: "2027-02-30" }],
    ["too many tags", { tags: Array.from({ length: 11 }, (_, i) => `tag${i}`) }],
    ["an unknown region", { region: "MARS" }],
    ["a lead time over 90 days", { leadDays: 91 }],
    ["a non-web link", { url: "javascript:alert(1)" }],
    ["a long description", { description: "x".repeat(501) }],
    ["unknown fields", { tenantId: "tenant-2" }],
  ])("rejects %s", async (_label, change) => {
    const response = await request(app()).post("/api/admin/moments").set("x-test-role", "platform_admin").set("x-access-reason", "Add").send({ ...valid, ...change }).expect(400);
    expect(response.body.message).toEqual(expect.any(String));
    expect(m.create).not.toHaveBeenCalled();
  });

  it("edits, archives and unarchives by id, and reports missing moments", async () => {
    const admin = (call: request.Test) => call.set("x-test-role", "platform_admin").set("x-access-reason", "Fix dates");
    await admin(request(app()).patch(`/api/admin/moments/${id}`)).send({ ...valid, endsOn: "2027-02-02" }).expect(200);
    expect(m.update).toHaveBeenCalledWith(id, expect.objectContaining({ endsOn: "2027-02-02" }), expect.objectContaining({ reason: "Fix dates" }));
    await admin(request(app()).post(`/api/admin/moments/${id}/archive`)).send({ archived: true }).expect(200);
    await admin(request(app()).post(`/api/admin/moments/${id}/archive`)).send({ archived: false }).expect(200);
    expect(m.archive.mock.calls.map(call => call[1])).toEqual([true, false]);
    await admin(request(app()).patch("/api/admin/moments/not-a-uuid")).send(valid).expect(400);
    await admin(request(app()).post(`/api/admin/moments/${id}/archive`)).send({ archived: "yes" }).expect(400);
    m.update.mockRejectedValueOnce(new m.NotFound());
    await admin(request(app()).patch(`/api/admin/moments/${id}`)).send(valid).expect(404);
    m.archive.mockRejectedValueOnce(new Error("DB down"));
    await admin(request(app()).post(`/api/admin/moments/${id}/archive`)).send({ archived: true }).expect(503);
  });

  it("fails closed when the audit log is unavailable", async () => {
    m.audit.mockResolvedValue(false);
    await request(app()).post("/api/admin/moments").set("x-test-role", "platform_admin").set("x-access-reason", "Add").send(valid).expect(503);
    expect(m.create).not.toHaveBeenCalled();
  });
});

describe("GET /api/moments", () => {
  it("returns matching moments in the contract shape, never stored in the HTTP cache", async () => {
    const response = await request(app()).get("/api/moments?from=2027-01-15&to=2027-02-15").set("x-test-role", "member").expect(200);
    // Personalised per member and workspace with no Vary: a shared browser cache could serve it to the next account.
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(m.between).toHaveBeenCalledWith("2027-01-15", "2027-02-15");
    expect(response.body).toEqual([{ id: "m1", title: "Union Budget", date: "2027-02-01", endDate: null, leadDays: 14, category: "finance",
      url: null, description: null, suggestedAngle: "What Union Budget means for your clients", inLeadWindow: expect.any(Boolean) }]);
  });

  it("filters out other regions and unmatched tags", async () => {
    m.between.mockResolvedValue([{ ...record, region: "US" }, { ...record, id: "m2", tags: ["healthcare"] }]);
    const response = await request(app()).get("/api/moments").set("x-test-role", "member").expect(200);
    expect(response.body).toEqual([]);
    expect(m.between).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
  });

  it.each(["from=2027-01-01&to=2027-06-01", "from=2027-02-01&to=2027-01-01", "from=tomorrow", "from=2027-02-30"])("rejects %s", async query => {
    const response = await request(app()).get(`/api/moments?${query}`).set("x-test-role", "member").expect(400);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(m.between).not.toHaveBeenCalled();
  });

  it("reports unavailability without details", async () => {
    m.between.mockRejectedValue(new Error("relation does not exist"));
    const response = await request(app()).get("/api/moments").set("x-test-role", "member").expect(503);
    expect(JSON.stringify(response.body)).not.toContain("relation");
  });
});

describe("watchlist and alerts", () => {
  it("reads and saves the watchlist for the session's scope only", async () => {
    m.getWatchlist.mockResolvedValue({ terms: [], options: [] });
    await request(app()).get("/api/watchlist").set("x-test-role", "member").expect(200);
    expect(m.getWatchlist).toHaveBeenCalledWith({ tenantId: "tenant-1", userId: "actor" });
    m.saveWatchlist.mockResolvedValue({ terms: [{ kind: "company", term: "Zeta" }], options: [] });
    await request(app()).put("/api/watchlist").set("x-test-role", "member").send({ terms: [{ kind: "company", term: "Zeta" }] }).expect(200);
    expect(m.saveWatchlist).toHaveBeenCalledWith({ tenantId: "tenant-1", userId: "actor" }, [{ kind: "company", term: "Zeta" }]);
    await request(app()).put("/api/watchlist").set("x-test-role", "member").send({ terms: [{ kind: "brand", term: "Zeta" }] }).expect(400);
    await request(app()).put("/api/watchlist").set("x-test-role", "member").send({ terms: [], tenantId: "other" }).expect(400);
    m.saveWatchlist.mockRejectedValueOnce(new m.TermError("Choose companies, people and topics from your profile."));
    await request(app()).put("/api/watchlist").set("x-test-role", "member").send({ terms: [{ kind: "company", term: "Unknown" }] }).expect(400);
  });

  it("lists alerts and marks chosen or all alerts seen", async () => {
    m.listAlerts.mockResolvedValue([]);
    await request(app()).get("/api/watch-alerts").set("x-test-role", "member").expect(200);
    m.seen.mockResolvedValue(1);
    expect((await request(app()).post("/api/watch-alerts/seen").set("x-test-role", "member").send({ ids: [id] }).expect(200)).body).toEqual({ updated: 1 });
    expect(m.seen).toHaveBeenLastCalledWith({ tenantId: "tenant-1", userId: "actor" }, [id]);
    await request(app()).post("/api/watch-alerts/seen").set("x-test-role", "member").send({ all: true }).expect(200);
    expect(m.seen).toHaveBeenLastCalledWith({ tenantId: "tenant-1", userId: "actor" }, undefined);
    await request(app()).post("/api/watch-alerts/seen").set("x-test-role", "member").send({ ids: ["x"] }).expect(400);
    await request(app()).post("/api/watch-alerts/seen").set("x-test-role", "member").send({}).expect(400);
  });
});
