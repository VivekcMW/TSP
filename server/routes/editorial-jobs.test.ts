import express from "express";
import request from "supertest";
import { createServer } from "node:http";
import { once } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enabled: true, configured: false, profile: vi.fn(), media: vi.fn(), generate: vi.fn(), fetch: vi.fn(),
  enqueue: vi.fn(), status: vi.fn(), result: vi.fn(), cancel: vi.fn(),
  limit: vi.fn((_req: unknown, _res: unknown, next: () => void) => next()),
}));
vi.mock("../lib/redis", () => ({ get redis() { return mocks.configured ? {} : undefined; } }));
vi.mock("../db", () => ({ db: {} }));
vi.mock("../services/generation-quota", async original => ({ ...await original<typeof import("../services/generation-quota")>(), readGenerationOperation: vi.fn(), runGeneration: vi.fn(async (_scope, _id, _kind, _input, _signal, work) => work()) }));
vi.mock("../jobs/editorial", () => ({
  getEditorialJobs: () => mocks.enabled ? { enqueue: mocks.enqueue, status: mocks.status, result: mocks.result, cancel: mocks.cancel } : undefined,
  EditorialQueueUnavailableError: class extends Error { constructor() { super("Editorial queue unavailable"); } },
}));
vi.mock("../middlewares/requireDbUser", () => ({
  requireDbUser: (req: any, res: any, next: () => void) => {
    if (!req.get("x-user")) return res.status(401).json({ message: "Unauthorized" });
    req.dbUser = { id: req.get("x-user") };
    req.tenant = { userId: req.get("x-user"), tenantId: req.get("x-tenant-id") || "tenant-a" };
    next();
  },
  authedOf: (req: any) => ({ dbUser: req.dbUser, tenant: req.tenant }),
}));
vi.mock("../middlewares/requirePermission", () => ({ requirePermission: (permission: string) => (req: any, res: any, next: () => void) => {
  if (permission !== "generation:create:own" || req.get("x-denied")) return res.status(403).json({ message: "Forbidden" });
  next();
} }));
vi.mock("../middlewares/rateLimit", () => ({ instantReviewRateLimit: mocks.limit }));
vi.mock("../storage", () => ({ storage: { getUserProfile: mocks.profile, getMediaAsset: mocks.media } }));
vi.mock("../services/punditBrain", () => ({ generatePlatformReviewsDetailed: mocks.generate }));
vi.mock("../services/urlFetcher", () => ({ fetchArticleFromUrl: mocks.fetch }));
import { registerEditorialJobsRoutes } from "./editorial-jobs";
import { CrawlError } from "../services/crawlerFetch";
import { GenerationQuotaError, readGenerationOperation, runGeneration } from "../services/generation-quota";

const id = "00000000-0000-4000-8000-000000000001";
const body = { requestIntent: id, url: "https://news.test/a", selectedPlatforms: ["medium"], format: "article" };
const scoped = { tenantId: "tenant-a", userId: "user-a" };
const app = express(); app.use(express.json()); registerEditorialJobsRoutes(app);
app.post("/api/instant-review/selected", (_req, res) => res.json({ direct: true }));
const post = () => request(app).post("/api/editorial/jobs/selected").set("x-user", "user-a");
beforeEach(() => {
  vi.clearAllMocks(); mocks.enabled = true; mocks.configured = false;
  mocks.profile.mockResolvedValue({ defaultTone: "professional", focusDescription: "Saved focus" });
  mocks.media.mockResolvedValue(undefined); mocks.enqueue.mockResolvedValue(id);
  mocks.status.mockImplementation(async (scope: typeof scoped) => scope.userId === scoped.userId && scope.tenantId === scoped.tenantId ? { jobId: id, status: "completed", progress: { platformsCompleted: 1, platformsTotal: 1 } } : null);
  mocks.result.mockResolvedValue({ posts: { medium: "result" } });
  mocks.cancel.mockImplementation(async (scope: typeof scoped) => scope.userId === scoped.userId && scope.tenantId === scoped.tenantId);
  mocks.fetch.mockResolvedValue({ title: "Pilot", content: "Desk reports a trial in thirty stores.", source: "Desk", url: body.url });
  mocks.generate.mockResolvedValue({ posts: { medium: "result" }, details: {}, evidence: {} });
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("editorial queue HTTP boundary", () => {
  it("returns truthful quota errors from queue admission and local fallback", async () => {
    const denied = new GenerationQuotaError(429, "generation_quota_exceeded", "Limit reached", 120);
    mocks.enqueue.mockRejectedValueOnce(denied);
    const queued = await post().send(body);
    expect(queued.status).toBe(429); expect(queued.headers["retry-after"]).toBe("120");
    mocks.enabled = false; vi.mocked(runGeneration).mockRejectedValueOnce(denied);
    expect((await post().send(body)).status).toBe(429); expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("scopes operation status and never calls an uncertain started operation successful", async () => {
    vi.mocked(readGenerationOperation).mockResolvedValueOnce({ operationId: id, kind: "manual", status: "started", periodStart: new Date(), periodEnd: new Date(), createdAt: new Date(), completedAt: null });
    const response = await request(app).get(`/api/generation/operations/${id}`).set("x-user", "user-a");
    expect(response.status).toBe(200); expect(response.body).toMatchObject({ consumed: true, outcome: "in_progress_or_unknown", resultRetained: false });
    expect(readGenerationOperation).toHaveBeenCalledWith(scoped, id);
    vi.mocked(readGenerationOperation).mockResolvedValueOnce(null);
    expect((await request(app).get(`/api/generation/operations/${id}`).set("x-user", "other")).status).toBe(404);
  });
  it("requires authentication and generation permission before admission or status", async () => {
    expect((await request(app).post("/api/editorial/jobs/selected").send(body)).status).toBe(401);
    expect((await post().set("x-denied", "1").send(body)).status).toBe(403);
    for (const verb of ["get", "delete"] as const) {
      expect((await request(app)[verb](`/api/editorial/jobs/${id}`)).status).toBe(401);
      expect((await request(app)[verb](`/api/editorial/jobs/${id}`).set("x-user", "user-a").set("x-denied", "1")).status).toBe(403);
    }
    expect(mocks.enqueue).not.toHaveBeenCalled(); expect(mocks.limit).not.toHaveBeenCalled();
  });

  it("validates and captures only trusted scope/profile before queuing, without fetching or generating", async () => {
    const response = await post().send({ ...body, tenantId: "evil", userId: "evil", voice: "evil", voiceScope: { tenantId: "evil", userId: "evil" }, approvedVoiceSamples: ["evil"], options: { secret: "evil" } });
    expect(response.status).toBe(202); expect(response.body.jobId).toBe(id);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(mocks.enqueue.mock.calls[0][1].input.requestIntent).toBe(id);
    expect(mocks.enqueue).toHaveBeenCalledWith(scoped, expect.objectContaining({ options: expect.objectContaining({ scope: { tenantId: scoped.tenantId }, voice: JSON.stringify({ defaultTone: "professional", professionalFocus: "Saved focus" }) }) }));
    expect(mocks.enqueue.mock.calls[0][1].options.voiceScope).toEqual(scoped);
    expect(mocks.enqueue.mock.calls[0][1].options).not.toHaveProperty("approvedVoiceSamples");
    expect(JSON.stringify(mocks.enqueue.mock.calls)).not.toContain("evil");
    expect(mocks.limit).toHaveBeenCalledTimes(1);
    expect(mocks.fetch).not.toHaveBeenCalled(); expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("rejects invalid platforms, source URLs and incompatible formats before queueing", async () => {
    for (const invalid of [{ selectedPlatforms: [] }, { selectedPlatforms: ["twitter"], format: "article" }, { url: "file:///private" }, { userContext: "x".repeat(4001) }]) {
      expect((await post().send({ ...body, ...invalid })).status).toBe(400);
    }
    expect(mocks.enqueue).not.toHaveBeenCalled(); expect(mocks.profile).not.toHaveBeenCalled();
  });

  it("rejects missing or invalid request intents before admission for both input kinds", async () => {
    for (const requestIntent of [undefined, null, "not-a-uuid", "-".repeat(36), 123]) {
      for (const kind of ["selected", "manual"]) {
        expect((await request(app).post(`/api/editorial/jobs/${kind}`).set("x-user", "user-a").send({ ...body, requestIntent })).status).toBe(400);
      }
    }
    expect(mocks.enqueue).not.toHaveBeenCalled(); expect(mocks.profile).not.toHaveBeenCalled();
  });

  it("rejects attachments owned by another user before admission", async () => {
    const response = await request(app).post("/api/editorial/jobs/manual").set("x-user", "user-a").send({ requestIntent: id, title: "Pilot", content: "Desk reports a trial in thirty stores.", selectedPlatforms: ["linkedin"], media: [{ id, name: "image", type: "image", url: "/uploads/image" }] });
    expect(response.status).toBe(403); expect(mocks.media).toHaveBeenCalledWith(scoped, id);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("keeps direct URLs backward compatible and intercepts only explicit async preference", async () => {
    expect((await request(app).post("/api/instant-review/selected").send(body)).body).toEqual({ direct: true });
    const response = await request(app).post("/api/instant-review/selected").set("x-user", "user-a").set("Prefer", "respond-async").send(body);
    expect(response.status).toBe(202); expect(response.headers["preference-applied"]).toBe("respond-async");
  });

  it("surfaces the specific crawl failure reason instead of a generic message", async () => {
    mocks.enabled = false;
    mocks.fetch.mockRejectedValue(new CrawlError("size", "The source response exceeds the crawl size limit."));
    const response = await post().send(body);
    expect(response.status).toBe(422);
    expect(response.body.code).toBe("source_unreadable");
    expect(response.body.message).toContain("exceeds the crawl size limit");
  });

  it("uses synchronous fallback only when local Redis is deliberately absent", async () => {
    mocks.enabled = false;
    expect((await post().send(body)).status).toBe(200);
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    mocks.configured = true;
    expect((await post().send(body)).status).toBe(503);
    mocks.configured = false; vi.stubEnv("NODE_ENV", "production");
    expect((await post().send(body)).status).toBe(503);
    expect(mocks.generate).toHaveBeenCalledTimes(1);
  });

  it("passes exact tenant/user ownership to status/result/cancel and hides others with 404", async () => {
    for (const headers of [{ "x-user": "other" }, { "x-user": "user-a", "x-tenant-id": "other" }]) {
      expect((await request(app).get(`/api/editorial/jobs/${id}`).set(headers)).status).toBe(404);
      expect((await request(app).get(`/api/editorial/jobs/${id}/result`).set(headers)).status).toBe(404);
      expect((await request(app).delete(`/api/editorial/jobs/${id}`).set(headers)).status).toBe(404);
    }
    expect(mocks.result).not.toHaveBeenCalled();
    const result = await request(app).get(`/api/editorial/jobs/${id}/result`).set("x-user", "user-a");
    expect(result.status).toBe(200); expect(result.headers["cache-control"]).toBe("no-store");
    expect(mocks.result).toHaveBeenCalledWith(scoped, id);
    expect((await request(app).delete(`/api/editorial/jobs/${id}`).set("x-user", "user-a")).status).toBe(200);
    expect(mocks.cancel).toHaveBeenLastCalledWith(scoped, id);
  });

  it("does not expose results until completed and fails closed on Redis outages", async () => {
    mocks.status.mockResolvedValueOnce({ status: "active", progress: { platformsCompleted: 0, platformsTotal: 1 } });
    expect((await request(app).get(`/api/editorial/jobs/${id}/result`).set("x-user", "user-a")).status).toBe(409);
    expect(mocks.result).not.toHaveBeenCalled();
    mocks.status.mockRejectedValueOnce(new Error("REDIS_PRIVATE_DETAILS"));
    const failed = await request(app).get(`/api/editorial/jobs/${id}`).set("x-user", "user-a");
    expect(failed.status).toBe(503); expect(failed.text).not.toContain("REDIS_PRIVATE_DETAILS");
  });

  it("rate limits status polling separately from paid generation", async () => {
    const server = createServer(app);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      let last;
      for (let index = 0; index < 181; index++) last = await request(server).get(`/api/editorial/jobs/${id}`).set("x-user", "rate-test").set("Connection", "close");
      expect(last!.status).toBe(429);
      expect(last!.headers["retry-after"]).toBeDefined();
      mocks.cancel.mockResolvedValueOnce(true);
      expect((await request(server).delete(`/api/editorial/jobs/${id}`).set("x-user", "rate-test")).status).toBe(200);
      expect(mocks.cancel).toHaveBeenLastCalledWith({ tenantId: "tenant-a", userId: "rate-test" }, id);
      expect((await request(server).get(`/api/editorial/jobs/${id}`).set("x-user", "rate-test").set("x-tenant-id", "another-tenant")).status).not.toBe(429);
      expect(mocks.limit).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
});