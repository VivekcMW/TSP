import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { storage, enqueue, handle, instant, selected, generation, pass, scope } = vi.hoisted(() => ({
  storage: { checkDraftPublishingPolicy: vi.fn(), getDraftPublishStatus: vi.fn(), updateDraft: vi.fn(), getDraft: vi.fn(), getDraftSchedule: vi.fn(), getDraftScheduleTargetsForPublishing: vi.fn(), retryDraftScheduleTargets: vi.fn(), cancelDraftScheduleTarget: vi.fn(), scheduleDraftPublish: vi.fn(), getUserProfile: vi.fn() },
  enqueue: vi.fn(), handle: vi.fn(), instant: vi.fn(), selected: vi.fn(), generation: vi.fn(),
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
// Exercise real request preparation/execution, but never access the usage ledger.
vi.mock("../services/generation-quota", () => ({
  generationOperationId: () => "00000000-0000-4000-8000-000000000001",
  generationAccessFailure: () => undefined,
  runGeneration: generation,
}));
vi.mock("../services/publishing-policy", () => ({ PublishingPolicyError: class extends Error {} }));
vi.mock("../lib/redis", () => ({ redis: undefined }));
vi.mock("../services/urlFetcher", () => ({ fetchArticleFromUrl: async () => ({ title: "Article", source: "News", domain: "news.test", url: "https://news.test/a", content: "Article text" }) }));
import { QueueUnavailableError } from "../jobs/queue";
import { ScheduleConflictError } from "../storage";
import { AIGenerationError } from "../services/openRouter";
import { registerDraftsRoutes } from "./drafts";
import { DraftConflictError } from "@shared/draft-revision";
const baseline = { expectedContent: "Original", expectedUpdatedAt: "2030-01-01T00:00:00.000Z" };
const consent = { ...baseline, expectedSchedule: null };
const app = express(); app.use(express.json()); registerDraftsRoutes(app);

beforeEach(() => {
  vi.resetAllMocks();
  generation.mockImplementation((_scope, _id, _kind, _input, signal: AbortSignal, work: () => Promise<unknown>) => {
    signal.throwIfAborted();
    return work();
  });
  storage.getDraft.mockResolvedValue({ id: "d", platform: "linkedin", publishStatus: "scheduled" });
  storage.getDraftSchedule.mockResolvedValue({ id: "s", draftId: "d", status: "scheduled", scheduledPublishAt: new Date(0) });
  storage.getDraftScheduleTargetsForPublishing.mockResolvedValue([{ id: "li", platform: "linkedin", executionMode: "sandbox", intent: "publish" }, { id: "tw", platform: "twitter", executionMode: "sandbox", intent: "publish" }]);
  storage.scheduleDraftPublish.mockResolvedValue({ id: "s", draftId: "d", status: "scheduled", scheduledPublishAt: new Date(0), targets: [{ id: "li" }, { id: "tw" }] });
  storage.retryDraftScheduleTargets.mockResolvedValue([{ id: "tw", platform: "twitter" }]);
  storage.cancelDraftScheduleTarget.mockResolvedValue({ id: "tw", status: "cancelled" });
  enqueue.mockResolvedValue("job");
});

describe("draft scheduling routes", () => {
  it("reads an uncached scoped publication snapshot without separate parent/target reads", async () => {
    const snapshot = { schedule: { id: "s", draftId: "d", status: "published", targets: [{ id: "li", status: "published" }] } };
    storage.getDraftPublishStatus.mockResolvedValue(snapshot);
    const response = await request(app).get("/api/drafts/d/publish-status?tenantId=attacker");
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toEqual(snapshot);
    expect(storage.getDraftPublishStatus).toHaveBeenCalledWith(scope, "d");
    expect(storage.getDraft).not.toHaveBeenCalled();
    expect(storage.getDraftSchedule).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });
  it("distinguishes absent schedules, inaccessible drafts and unavailable status", async () => {
    storage.getDraftPublishStatus.mockResolvedValueOnce({ schedule: null }).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("database unavailable"));
    const absent = await request(app).get("/api/drafts/d/publish-status");
    expect(absent.status).toBe(200); expect(absent.body).toEqual({ schedule: null });
    expect((await request(app).get("/api/drafts/missing/publish-status")).status).toBe(404);
    const unavailable = await request(app).get("/api/drafts/d/publish-status");
    expect(unavailable.status).toBe(503);
    expect(unavailable.body.message).toContain("could not be verified");
    expect(unavailable.body).not.toHaveProperty("schedule");
  });
  it("returns an actionable 409 for immutable PATCH without dispatching", async () => {
    storage.updateDraft.mockRejectedValue(new ScheduleConflictError("Published drafts are immutable. Copy to a new draft."));
    const response = await request(app).patch("/api/drafts/d").send({ content: "Changed", status: "draft", tenantId: "attacker", ...baseline });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: "draft_immutable", message: expect.stringContaining("Copy") });
    expect(storage.updateDraft).toHaveBeenCalledWith(scope, "d", { content: "Changed", status: "draft" }, baseline);
    expect(enqueue).not.toHaveBeenCalled();
  });
  it("retains successful unscheduled PATCH and missing-draft behavior", async () => {
    storage.updateDraft.mockResolvedValueOnce({ id: "d", content: "Changed", publishStatus: "draft" }).mockResolvedValueOnce(undefined);
    expect((await request(app).patch("/api/drafts/d").send({ content: "Changed", ...baseline })).status).toBe(200);
    expect((await request(app).patch("/api/drafts/missing").send({ content: "Changed", ...baseline })).status).toBe(404);
  });
  it("publish-now dispatches only the generation admitted with the reviewed consent", async () => {
    const result = await request(app).post("/api/drafts/d/publish-now").send({ consent });
    expect(result.status).toBe(200); expect(result.body.jobIds).toHaveLength(2);
    expect(enqueue.mock.calls.map(([data]) => data.draftScheduleTargetId)).toEqual(["li", "tw"]);
    expect(storage.scheduleDraftPublish).toHaveBeenCalledExactlyOnceWith(scope, "d", expect.any(Date), undefined, "publish", consent); expect(handle).not.toHaveBeenCalled();
  });
  it("returns 503 and Retry-After on partial enqueue failure without sync fallback", async () => {
    enqueue.mockResolvedValueOnce("li-job").mockRejectedValueOnce(new QueueUnavailableError());
    const result = await request(app).post("/api/drafts/d/publish-now").send({ consent });
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

describe("draft editing revisions", () => {
  it.each([
    {}, { expectedContent: "A" }, { expectedUpdatedAt: null },
    { expectedContent: null, expectedUpdatedAt: null }, { expectedContent: "A", expectedUpdatedAt: "invalid" },
    { expectedContent: "A", expectedUpdatedAt: 123 },
  ])("rejects missing/malformed content preconditions %j before storage", async fields => {
    expect((await request(app).patch("/api/drafts/d").send({ content: "B", ...fields })).status).toBe(400);
    expect(storage.updateDraft).not.toHaveBeenCalled(); expect(enqueue).not.toHaveBeenCalled();
  });
  it("keeps exact baseline whitespace/null while returning canonical normalized content", async () => {
    const canonical = { id: "d", content: "B", updatedAt: baseline.expectedUpdatedAt, platform: "linkedin", tone: "professional" };
    storage.updateDraft.mockResolvedValue(canonical);
    const response = await request(app).patch("/api/drafts/d").send({ content: " B ", expectedContent: " A ", expectedUpdatedAt: null, userId: "attacker" });
    expect(response.status).toBe(200); expect(response.body).toEqual(canonical);
    expect(storage.updateDraft).toHaveBeenCalledExactlyOnceWith(scope, "d", { content: "B" }, { expectedContent: " A ", expectedUpdatedAt: null });
  });
  it("returns distinct revision conflict without preflight reads or any retry", async () => {
    storage.updateDraft.mockRejectedValue(new DraftConflictError());
    const result = await request(app).patch("/api/drafts/d").send({ content: "C", ...baseline });
    expect(result.status).toBe(409); expect(result.body.code).toBe("draft_conflict");
    expect(storage.updateDraft).toHaveBeenCalledTimes(1); expect(storage.getDraft).not.toHaveBeenCalled(); expect(enqueue).not.toHaveBeenCalled();
  });
  it("returns an owner-scoped no-store editing snapshot with nullable revision and no private fields", async () => {
    const snapshot = { id: "d", content: "A", updatedAt: null, platform: "linkedin", tone: "professional" };
    storage.getDraft.mockResolvedValue({ ...snapshot, tenantId: "t", userId: "u", publishApprovalHash: "private" });
    const result = await request(app).get("/api/drafts/d/editing-snapshot?tenantId=attacker&userId=attacker");
    expect(result.status).toBe(200); expect(result.headers["cache-control"]).toBe("no-store"); expect(result.body).toEqual(snapshot);
    expect(storage.getDraft).toHaveBeenCalledExactlyOnceWith(scope, "d"); expect(storage.updateDraft).not.toHaveBeenCalled();
  });
  it("distinguishes inaccessible snapshot from unavailable refresh without exposing row data", async () => {
    storage.getDraft.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("private database details"));
    const absent = await request(app).get("/api/drafts/foreign/editing-snapshot");
    const failed = await request(app).get("/api/drafts/d/editing-snapshot");
    expect(absent.status).toBe(404); expect(failed.status).toBe(503);
    for (const response of [absent, failed]) {
      expect(response.headers["cache-control"]).toBe("no-store"); expect(response.body).not.toHaveProperty("content");
      expect(JSON.stringify(response.body)).not.toContain("private");
    }
  });
});

describe("instant review safe AI failures", () => {
  const endpoints = [
    ["/api/instant-review", { url: "https://news.test/a" }],
    ["/api/instant-review/selected", { url: "https://news.test/a", selectedPlatforms: ["twitter"] }],
    ["/api/instant-review/manual", { title: "Article", content: "A sufficiently long article for generation.", selectedPlatforms: ["twitter"] }],
  ] as const;
  function expectProviderAttempt(endpoint: string, body: Record<string, unknown>) {
    const kind = endpoint === "/api/instant-review" ? "instant-review" : endpoint.split("/").at(-1);
    expect(generation).toHaveBeenCalledExactlyOnceWith(scope, "00000000-0000-4000-8000-000000000001", kind,
      expect.objectContaining({ ...body, format: "short-post" }), expect.any(AbortSignal), expect.any(Function));
    const options = expect.objectContaining({ scope: { tenantId: "t" }, voiceScope: scope, format: "short-post", signal: expect.any(AbortSignal) });
    if (kind === "instant-review") {
      expect(instant).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ url: body.url }), options);
      expect(selected).not.toHaveBeenCalled();
    } else {
      expect(selected).toHaveBeenCalledExactlyOnceWith(expect.objectContaining(kind === "manual"
        ? { title: body.title, content: body.content, source: "Your draft" } : { url: body.url }), ["twitter"], options);
      expect(instant).not.toHaveBeenCalled();
    }
  }
  it.each(endpoints)("maps quota and Retry-After safely for %s", async (endpoint, body) => {
    instant.mockRejectedValue(new AIGenerationError("ai_quota", 60)); selected.mockRejectedValue(new AIGenerationError("ai_quota", 60));
    const result = await request(app).post(endpoint).send(body);
    expectProviderAttempt(endpoint, body);
    expect(result.status).toBe(503); expect(result.body.code).toBe("ai_quota"); expect(result.headers["retry-after"]).toBe("60");
    expect(result.body).not.toHaveProperty("posts");
  });
  it.each(endpoints)("does not leak arbitrary provider errors for %s", async (endpoint, body) => {
    instant.mockRejectedValue(new Error("secret provider response")); selected.mockRejectedValue(new Error("secret provider response"));
    const result = await request(app).post(endpoint).send(body);
    expectProviderAttempt(endpoint, body);
    expect(result.status).toBe(500);
    expect(result.body).toEqual({ code: "ai_generation_failed", message: "AI generation failed. Please try again later." });
    expect(result.headers["retry-after"]).toBeUndefined();
    expect(JSON.stringify(result.body)).not.toContain("secret");
  });
});