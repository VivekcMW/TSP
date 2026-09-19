import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { storage, scope, security, Conflict, PolicyError, enqueue } = vi.hoisted(() => ({
  storage: { approveDraftForPublishing: vi.fn(), reconcilePublishTarget: vi.fn(), getDraft: vi.fn(), getDraftSchedule: vi.fn(), scheduleDraftPublish: vi.fn(), getDraftScheduleTargets: vi.fn() },
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
const app = express(); app.use(express.json()); registerDraftsRoutes(app);
const endpoint = "/api/drafts/d/schedule/targets/target/reconcile";
const evidence = { expectedRevision: 2, decision: "not_delivered", note: "Provider checked and old worker stopped", workerStopped: true };
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
    const response = await request(app).post("/api/drafts/d/schedule").send({ publishAt: new Date().toISOString(), platforms: ["slack"] });
    expect(response.status).toBe(403); expect(response.body.code).toBe("publishing_policy"); expect(enqueue).not.toHaveBeenCalled();
  });
});