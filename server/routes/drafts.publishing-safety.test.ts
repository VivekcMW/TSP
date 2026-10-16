import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { storage, scope, security, Conflict, PolicyError, enqueue } = vi.hoisted(() => ({
  storage: { approveDraftForPublishing: vi.fn(), reconcilePublishTarget: vi.fn(), getDrafts: vi.fn(), getDraft: vi.fn(), getDraftSchedule: vi.fn(), scheduleDraftPublish: vi.fn(), getDraftScheduleTargets: vi.fn(), getDraftScheduleTargetsForPublishing: vi.fn(), checkDraftPublishingPolicy: vi.fn() },
  scope: { tenantId: "tenant", userId: "owner" }, security: { authenticated: true, allowed: true },
  Conflict: class extends Error {}, PolicyError: class extends Error { statusCode = 403; code = "publishing_policy"; }, enqueue: vi.fn(),
}));
vi.mock("../db", () => ({ db: {} }));
vi.mock("../storage", () => ({ storage, ScheduleConflictError: Conflict }));
vi.mock("../services/publishing-policy", () => ({ PublishingPolicyError: PolicyError }));
vi.mock("../jobs/queue", () => ({ enqueuePublishDraft: enqueue, QueueUnavailableError: class extends Error {} }));
vi.mock("../jobs/handlers/publish-draft", () => ({ handlePublishDraft: vi.fn() }));
vi.mock("../middlewares/requireDbUser", () => ({ requireDbUser: (_req: unknown, res: any, next: () => void) => security.authenticated ? next() : res.sendStatus(401), authedOf: () => ({ tenant: scope, dbUser: { id: scope.userId } }) }));
vi.mock("../middlewares/requirePermission", () => ({ requirePermission: () => (_req: unknown, res: any, next: () => void) => security.allowed ? next() : res.sendStatus(403) }));
vi.mock("../middlewares/rateLimit", () => ({ instantReviewRateLimit: (_req: unknown, _res: unknown, next: () => void) => next() }));
vi.mock("../services/punditBrain", () => ({ generateInstantReviewDetailed: vi.fn() }));
vi.mock("../services/editorial-request", () => ({ prepareEditorialRequest: vi.fn(), executeEditorialRequest: vi.fn() }));
vi.mock("../services/urlFetcher", () => ({ fetchArticleFromUrl: vi.fn() }));
vi.mock("./editorial-context", () => ({ editorialPreferences: {} }));
vi.mock("../services/openRouter", () => ({ getAIErrorResponse: vi.fn() }));
import { registerDraftsRoutes } from "./drafts";
import { assertPublishingConsent, capturePublishingConsent, PublishingConsentError } from "@shared/publishing-consent";
const app = express(); app.use(express.json()); registerDraftsRoutes(app);
const endpoint = "/api/drafts/d/schedule/targets/target/reconcile";
const evidence = { expectedRevision: 2, decision: "not_delivered", note: "Provider checked and old worker stopped", workerStopped: true };
const reviewed = { content: "Reviewed", updatedAt: "2030-01-01T00:00:00.000Z" };
const consent = capturePublishingConsent(reviewed, null)!;
beforeEach(() => { vi.resetAllMocks(); security.authenticated = true; security.allowed = true; storage.reconcilePublishTarget.mockResolvedValue({ id: "target", status: "failed" }); });
describe("publishing safety route wiring", () => {
  it("requires authentication and own-write permission before reconciliation", async () => {
    security.authenticated = false; expect((await request(app).post(endpoint).send(evidence)).status).toBe(401);
    security.authenticated = true; security.allowed = false; expect((await request(app).post(endpoint).send(evidence)).status).toBe(403);
    expect(storage.reconcilePublishTarget).not.toHaveBeenCalled();
  });
  it("passes only authenticated scope and never enqueues reconciliation", async () => {
    expect((await request(app).post(`${endpoint}?tenantId=attacker`).send(evidence)).status).toBe(200);
    expect(storage.reconcilePublishTarget).toHaveBeenCalledWith(scope, "d", "target", evidence); expect(enqueue).not.toHaveBeenCalled();
  });
  it.each([{ providerVerified: true }, { tenantId: "attacker" }, { workerStopped: false }, { expectedRevision: -1 }, { decision: "delivered" }])("rejects invalid or forged reconciliation %j", async change => {
    expect((await request(app).post(endpoint).send({ ...evidence, ...change })).status).toBe(400);
    expect(storage.reconcilePublishTarget).not.toHaveBeenCalled();
  });
  it("returns scoped not-found and stale-revision conflict", async () => {
    storage.reconcilePublishTarget.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Conflict("Target changed"));
    expect((await request(app).post(endpoint).send(evidence)).status).toBe(404);
    expect((await request(app).post(endpoint).send(evidence)).status).toBe(409);
  });
  it("records only explicit exact-version approval", async () => {
    const payload = { content: "Reviewed", updatedAt: new Date(0).toISOString() };
    storage.approveDraftForPublishing.mockResolvedValue({ id: "d" });
    expect((await request(app).post("/api/drafts/d/approve-publishing").send(payload)).status).toBe(200);
    expect(storage.approveDraftForPublishing).toHaveBeenCalledWith(scope, "d", payload.content, payload.updatedAt);
    expect((await request(app).post("/api/drafts/d/approve-publishing").send({ ...payload, approved: true })).status).toBe(400);
    expect(enqueue).not.toHaveBeenCalled();
  });
  it("enforces storage policy admission and returns safe denial", async () => {
    storage.getDraft.mockResolvedValue({ id: "d" }); storage.scheduleDraftPublish.mockRejectedValue(new PolicyError("Review required"));
    const response = await request(app).post("/api/drafts/d/schedule").send({ publishAt: new Date().toISOString(), platforms: ["slack"], consent });
    expect(response.status).toBe(403); expect(response.body.code).toBe("publishing_policy"); expect(enqueue).not.toHaveBeenCalled();
  });
});

describe("reviewed admission route contract (all storage/queues mocked)", () => {
  beforeEach(() => {
    storage.getDraft.mockResolvedValue({ id: "d", ...reviewed, platform: "linkedin" });
    storage.getDraftSchedule.mockResolvedValue({ id: "s" });
    storage.getDraftScheduleTargets.mockResolvedValue([]);
    storage.getDraftScheduleTargetsForPublishing.mockResolvedValue([]);
    storage.scheduleDraftPublish.mockResolvedValue({ id: "s", draftId: "d", scheduledPublishAt: new Date(), status: "scheduled", targets: [] });
  });
  it.each(["schedule", "reschedule", "publish-now"])("requires well-formed exact consent for external %s before storage or enqueue", async action => {
    for (const invalid of [undefined, {}, { ...consent, expectedContent: undefined }, { ...consent, expectedUpdatedAt: undefined }, { ...consent, expectedUpdatedAt: "not a date" }, { ...consent, expectedSchedule: undefined }]) {
      const req = action === "reschedule" ? request(app).put("/api/drafts/d/schedule") : request(app).post(`/api/drafts/d/${action}`);
      const response = await req.send({ publishAt: new Date().toISOString(), consent: invalid });
      expect(response.status).toBe(409); expect(response.body.code).toBe("publishing_reconfirm_required");
    }
    expect(storage.scheduleDraftPublish).not.toHaveBeenCalled(); expect(enqueue).not.toHaveBeenCalled();
  });
  it.each(["schedule", "reschedule", "publish-now"])("returns distinct stale %s conflict with no enqueue, retry or newer-baseline adoption", async action => {
    storage.scheduleDraftPublish.mockRejectedValue(new PublishingConsentError());
    const req = action === "reschedule" ? request(app).put("/api/drafts/d/schedule") : request(app).post(`/api/drafts/d/${action}`);
    const response = await req.send({ publishAt: new Date().toISOString(), consent });
    expect(response.status).toBe(409); expect(response.body.code).toBe("publishing_reconfirm_required");
    expect(storage.scheduleDraftPublish).toHaveBeenCalledExactlyOnceWith(scope, "d", expect.any(Date), undefined, action === "publish-now" ? "publish" : "schedule", consent);
    expect(enqueue).not.toHaveBeenCalled(); expect(storage.getDraftScheduleTargetsForPublishing).not.toHaveBeenCalled();
  });
  it.each([false, true])("never enqueues B after confirmation of A, even if B approved = %s", async approved => {
    storage.getDraft.mockResolvedValue({ id: "d", content: "B", updatedAt: reviewed.updatedAt, publishApprovedAt: approved ? reviewed.updatedAt : null });
    storage.scheduleDraftPublish.mockImplementation(async (_scope, _id, _at, _platforms, _intent, expected) => {
      assertPublishingConsent(expected, { content: "B", updatedAt: reviewed.updatedAt }, null);
    });
    const response = await request(app).post("/api/drafts/d/publish-now").send({ consent });
    expect(response.status).toBe(409); expect(response.body.code).toBe("publishing_reconfirm_required"); expect(enqueue).not.toHaveBeenCalled();
  });
  it("preserves per-draft partial errors; missing consent never reaches admission", async () => {
    storage.scheduleDraftPublish.mockImplementation(async (_scope, id) => { if (id === "stale") throw new PublishingConsentError(); return { id: "s" }; });
    const response = await request(app).post("/api/drafts/bulk-schedule").send({ draftIds: ["ok", "stale", "unreviewed"], publishAt: reviewed.updatedAt, consents: { ok: consent, stale: consent } });
    expect(response.status).toBe(200); expect(response.body.scheduled).toEqual(["ok"]); expect(response.body.failed).toEqual(["stale", "unreviewed"]);
    for (const id of response.body.failed) expect(response.body.errors[id]).toMatchObject({ code: "publishing_reconfirm_required", status: 409 });
    expect(storage.scheduleDraftPublish.mock.calls.map(call => [call[0], call[1], call[5]])).toEqual([[scope, "ok", consent], [scope, "stale", consent]]);
    expect(enqueue).not.toHaveBeenCalled();
  });
  it("fails a bulk request without consent closed", async () => {
    const response = await request(app).post("/api/drafts/bulk-schedule").send({ draftIds: ["d"], publishAt: reviewed.updatedAt });
    expect(response.status).toBe(409); expect(response.body.code).toBe("publishing_reconfirm_required"); expect(storage.scheduleDraftPublish).not.toHaveBeenCalled();
  });
  it("cannot enqueue a newer target generation that appears after admission", async () => {
    storage.scheduleDraftPublish.mockResolvedValue({ id: "s", draftId: "d", scheduledPublishAt: new Date(), targets: [{ id: "reviewed-generation" }] });
    storage.getDraftScheduleTargetsForPublishing.mockResolvedValue([{ id: "replacement", platform: "twitter", executionMode: "sandbox" }]);
    expect((await request(app).post("/api/drafts/d/publish-now").send({ consent })).status).toBe(200);
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe("independent safe draft details", () => {
  it("queries an older exact ID before pagination with authenticated scope and receipt-aware projected status", async () => {
    const older = { id: "old/é", ...reviewed, platform: "linkedin", tone: "professional", media: [], platformPublishRules: {}, publishStatus: "legacy_unverified", publishedAt: null, publishApprovedAt: null, publishApprovalHash: "private", publishApprovedBy: "actor" };
    storage.getDrafts.mockResolvedValue([older]);
    const response = await request(app).get("/api/drafts/old%2F%C3%A9/details?tenantId=attacker&userId=attacker");
    expect(response.status).toBe(200); expect(response.headers["cache-control"]).toBe("no-store");
    expect(storage.getDrafts).toHaveBeenCalledExactlyOnceWith(scope, { id: older.id, limit: 1 });
    expect(response.body).toMatchObject({ id: older.id, content: older.content, media: [], platformPublishRules: {}, publishStatus: "legacy_unverified", publishedAt: null });
    expect(response.body).not.toHaveProperty("publishApprovalHash"); expect(response.body).not.toHaveProperty("publishApprovedBy");
    expect(storage.getDraft).not.toHaveBeenCalled(); expect(enqueue).not.toHaveBeenCalled();
  });
  it("distinguishes missing/inaccessible IDs from failed reads without leaking details", async () => {
    storage.getDrafts.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("private SQL"));
    expect((await request(app).get("/api/drafts/missing/details")).status).toBe(404);
    expect((await request(app).get("/api/drafts/foreign/details")).status).toBe(404);
    const failure = await request(app).get("/api/drafts/d/details");
    expect(failure.status).toBe(503); expect(failure.body).not.toHaveProperty("content"); expect(JSON.stringify(failure.body)).not.toContain("private SQL");
  });
  it("requires authentication and own-read permission", async () => {
    security.authenticated = false; expect((await request(app).get("/api/drafts/d/details")).status).toBe(401);
    security.authenticated = true; security.allowed = false; expect((await request(app).get("/api/drafts/d/details")).status).toBe(403);
    expect(storage.getDrafts).not.toHaveBeenCalled();
  });
});