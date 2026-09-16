import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { storage, enqueue, handle, instant, selected, pass, scope } = vi.hoisted(() => ({
  storage: { updateDraft: vi.fn(), getDraft: vi.fn(), getDraftSchedule: vi.fn(), getDraftScheduleTargetsForPublishing: vi.fn(), retryDraftScheduleTargets: vi.fn(), cancelDraftScheduleTarget: vi.fn(), scheduleDraftPublish: vi.fn(), getUserProfile: vi.fn() },
  enqueue: vi.fn(), handle: vi.fn(), instant: vi.fn(), selected: vi.fn(),
  pass: (_req: unknown, _res: unknown, next: () => void) => next(), scope: { tenantId: "t", userId: "u" },
}));
vi.mock("../db", () => ({ db: {} }));
vi.mock("../storage", () => ({ storage, ScheduleConflictError: class extends Error {} }));
vi.mock("../jobs/queue", () => ({ enqueuePublishDraft: enqueue, QueueUnavailableError: class extends Error {} }));
vi.mock("../jobs/handlers/publish-draft", () => ({ handlePublishDraft: handle }));
vi.mock("../middlewares/requireDbUser", () => ({ requireDbUser: pass, authedOf: () => ({ tenant: scope, dbUser: { id: "u" } }) }));
vi.mock("../middlewares/requirePermission", () => ({ requirePermission: () => pass }));
vi.mock("../middlewares/rateLimit", () => ({ instantReviewRateLimit: pass }));
vi.mock("../services/punditBrain", () => ({ generateInstantReviewDetailed: instant, generatePlatformReviewsDetailed: selected }));
vi.mock("../lib/redis", () => ({ redis: undefined }));
vi.mock("../services/urlFetcher", () => ({ fetchArticleFromUrl: async () => ({ title: "Article", source: "News", domain: "news.test", url: "https://news.test/a", content: "Article text" }) }));
import { QueueUnavailableError } from "../jobs/queue";
import { ScheduleConflictError } from "../storage";
import { AIGenerationError } from "../services/openRouter";
import { registerDraftsRoutes } from "./drafts";
const app = express(); app.use(express.json()); registerDraftsRoutes(app);

beforeEach(() => {
  vi.resetAllMocks();
  storage.getDraft.mockResolvedValue({ id: "d", platform: "linkedin", publishStatus: "scheduled" });
  storage.getDraftSchedule.mockResolvedValue({ id: "s", draftId: "d", status: "scheduled", scheduledPublishAt: new Date(0) });
  storage.getDraftScheduleTargetsForPublishing.mockResolvedValue([{ id: "li", platform: "linkedin" }, { id: "tw", platform: "twitter" }]);
  storage.retryDraftScheduleTargets.mockResolvedValue([{ id: "tw", platform: "twitter" }]);
  storage.cancelDraftScheduleTarget.mockResolvedValue({ id: "tw", status: "cancelled" });
  enqueue.mockResolvedValue("job");
});

describe("draft scheduling routes", () => {
  it("returns an actionable 409 for immutable PATCH without dispatching", async () => {
    storage.updateDraft.mockRejectedValue(new ScheduleConflictError("Published drafts are immutable. Copy to a new draft."));
    const response = await request(app).patch("/api/drafts/d").send({ content: "Changed", status: "draft", tenantId: "attacker" });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: "draft_immutable", message: expect.stringContaining("Copy") });
    expect(storage.updateDraft).toHaveBeenCalledWith(scope, "d", { content: "Changed", status: "draft" });
    expect(enqueue).not.toHaveBeenCalled();
  });
  it("retains successful unscheduled PATCH and missing-draft behavior", async () => {
    storage.updateDraft.mockResolvedValueOnce({ id: "d", content: "Changed", publishStatus: "draft" }).mockResolvedValueOnce(undefined);
    expect((await request(app).patch("/api/drafts/d").send({ content: "Changed" })).status).toBe(200);
    expect((await request(app).patch("/api/drafts/missing").send({ content: "Changed" })).status).toBe(404);
  });
  it("publish-now enqueues each platform without replacing an existing due generation", async () => {
    const result = await request(app).post("/api/drafts/d/publish-now");
    expect(result.status).toBe(200); expect(result.body.jobIds).toHaveLength(2);
    expect(enqueue.mock.calls.map(([data]) => data.draftScheduleTargetId)).toEqual(["li", "tw"]);
    expect(storage.scheduleDraftPublish).not.toHaveBeenCalled(); expect(handle).not.toHaveBeenCalled();
  });
  it("returns 503 and Retry-After on partial enqueue failure without sync fallback", async () => {
    enqueue.mockResolvedValueOnce("li-job").mockRejectedValueOnce(new QueueUnavailableError());
    const result = await request(app).post("/api/drafts/d/publish-now");
    expect(result.status).toBe(503); expect(result.headers["retry-after"]).toBe("5"); expect(handle).not.toHaveBeenCalled();
  });
  it("target retry dispatches only the replacement target using authenticated scope", async () => {
    const result = await request(app).post("/api/drafts/d/schedule/targets/old/retry").send({ tenantId: "attacker" });
    expect(result.status).toBe(200);
    expect(storage.retryDraftScheduleTargets).toHaveBeenCalledWith(scope, "d", "old");
    expect(enqueue).toHaveBeenCalledTimes(1); expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ ...scope, draftScheduleTargetId: "tw" }));
  });
  it("parent retry dispatches only failed replacements, not successful siblings", async () => {
    expect((await request(app).post("/api/drafts/d/retry-publish")).status).toBe(200);
    expect(storage.retryDraftScheduleTargets).toHaveBeenCalledWith(scope, "d");
    expect(enqueue).toHaveBeenCalledTimes(1);
  });
  it("scopes cancellation and leaves other targets alone", async () => {
    expect((await request(app).delete("/api/drafts/d/schedule/targets/tw")).status).toBe(200);
    expect(storage.cancelDraftScheduleTarget).toHaveBeenCalledWith(scope, "d", "tw");
    expect(enqueue).not.toHaveBeenCalled();
  });
  it("returns 404 for a target outside the caller's draft/scope", async () => {
    storage.cancelDraftScheduleTarget.mockResolvedValue(undefined); storage.retryDraftScheduleTargets.mockResolvedValue(undefined);
    expect((await request(app).delete("/api/drafts/d/schedule/targets/missing")).status).toBe(404);
    expect((await request(app).post("/api/drafts/d/schedule/targets/missing/retry")).status).toBe(404);
  });
  it("returns conflict for already publishing/unknown targets", async () => {
    storage.cancelDraftScheduleTarget.mockRejectedValue(new ScheduleConflictError("Already in flight"));
    expect((await request(app).delete("/api/drafts/d/schedule/targets/tw")).status).toBe(409);
  });
});

describe("instant review safe AI failures", () => {
  const endpoints = [
    ["/api/instant-review", { url: "https://news.test/a" }],
    ["/api/instant-review/selected", { url: "https://news.test/a", selectedPlatforms: ["twitter"] }],
    ["/api/instant-review/manual", { title: "Article", content: "A sufficiently long article for generation.", selectedPlatforms: ["twitter"] }],
  ] as const;
  it.each(endpoints)("maps quota and Retry-After safely for %s", async (endpoint, body) => {
    instant.mockRejectedValue(new AIGenerationError("ai_quota", 60)); selected.mockRejectedValue(new AIGenerationError("ai_quota", 60));
    const result = await request(app).post(endpoint).send(body);
    expect(result.status).toBe(503); expect(result.body.code).toBe("ai_quota"); expect(result.headers["retry-after"]).toBe("60");
    expect(result.body).not.toHaveProperty("posts");
  });
  it.each(endpoints)("does not leak arbitrary provider errors for %s", async (endpoint, body) => {
    instant.mockRejectedValue(new Error("secret provider response")); selected.mockRejectedValue(new Error("secret provider response"));
    const result = await request(app).post(endpoint).send(body);
    expect(result.status).toBe(500); expect(JSON.stringify(result.body)).not.toContain("secret");
  });
});