import express from "express";
import request from "supertest";
import { EventEmitter } from "node:events";
import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  scope: { tenantId: "tenant-a", userId: "user-a" },
  profile: vi.fn(), fetchArticle: vi.fn(), instant: vi.fn(), selected: vi.fn(), media: vi.fn(), publish: vi.fn(), save: vi.fn(),
  pass: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../db", () => ({ db: {} }));
vi.mock("../services/generation-quota", async original => ({ ...await original<typeof import("../services/generation-quota")>(), runGeneration: vi.fn(async (_scope, _id, _kind, _input, _signal, work) => work()) }));
vi.mock("../lib/redis", () => ({ redis: undefined }));
vi.mock("../storage", () => ({ storage: { getUserProfile: mocks.profile, getMediaAsset: mocks.media, createDraft: mocks.save }, ScheduleConflictError: class extends Error {} }));
vi.mock("../jobs/queue", () => ({ enqueuePublishDraft: mocks.publish, QueueUnavailableError: class extends Error {} }));
vi.mock("../jobs/handlers/publish-draft", () => ({ handlePublishDraft: mocks.publish }));
vi.mock("../middlewares/requireDbUser", () => ({ requireDbUser: mocks.pass, authedOf: () => ({ tenant: mocks.scope, dbUser: { id: "user-a" } }) }));
vi.mock("../middlewares/requirePermission", () => ({ requirePermission: () => mocks.pass }));
vi.mock("../middlewares/rateLimit", () => ({ instantReviewRateLimit: mocks.pass }));
vi.mock("../services/punditBrain", () => ({ generateInstantReviewDetailed: mocks.instant, generatePlatformReviewsDetailed: mocks.selected }));
vi.mock("../services/urlFetcher", () => ({ fetchArticleFromUrl: mocks.fetchArticle }));
import { registerDraftsRoutes } from "./drafts";
import { editorialCancellation } from "./editorial-context";
import { CrawlError } from "../services/crawlerFetch";
import { buildEvidenceBrief } from "../services/editorialEvidence";
import { GenerationQuotaError, runGeneration } from "../services/generation-quota";

const article = { title: "Pilot", content: "The publisher reports a pilot result. ".repeat(30), source: "Desk", url: "https://news.test/a", domain: "news.test" };
const metadata = { extractionMethod: "article" as const, originalLength: article.content.length, retainedLength: article.content.length, truncated: false };
const evidence = buildEvidenceBrief({ ...article, contentMetadata: metadata });
const post = { thoughtLeader: "Desk reports a pilot result.", industryInsider: "Desk reports a pilot result.", provocateur: "Desk reports a pilot result.", dataDriven: "Desk reports a pilot result." };
const result = { posts: { linkedin: post, twitter: post }, details: { linkedin: { thoughtLeader: { content: post.thoughtLeader, generation: { provider: "anthropic", model: "test", fallbackUsed: true }, validation: { factualVerification: "not-performed", requiresHumanReview: true } } } }, evidence, usage: { inputTokens: 10, outputTokens: 5 }, fallbackUsed: true };
const app = express(); app.use(express.json()); registerDraftsRoutes(app);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.profile.mockResolvedValue(undefined);
  mocks.fetchArticle.mockResolvedValue({ ...article, contentMetadata: metadata });
  mocks.instant.mockResolvedValue(result); mocks.selected.mockResolvedValue(result);
});

describe("detailed review routes", () => {
  it.each(["/api/instant-review", "/api/instant-review/selected", "/api/instant-review/manual"])("fails closed on usage outage at %s before provider work", async endpoint => {
    vi.mocked(runGeneration).mockRejectedValueOnce(new GenerationQuotaError(503, "generation_usage_unavailable", "Usage unavailable"));
    const response = await request(app).post(endpoint).send({ title: "Pilot", content: article.content, url: article.url, selectedPlatforms: ["linkedin"], tenantId: "evil" });
    expect(response.status).toBe(503); expect(response.body.code).toBe("generation_usage_unavailable");
    expect(runGeneration).toHaveBeenCalledWith(mocks.scope, expect.any(String), expect.any(String), expect.any(Object), expect.any(AbortSignal), expect.any(Function));
    expect(mocks.fetchArticle).not.toHaveBeenCalled(); expect(mocks.instant).not.toHaveBeenCalled(); expect(mocks.selected).not.toHaveBeenCalled();
  });
  it("rejects invalid retry intent without provider work", async () => {
    const response = await request(app).post("/api/instant-review").send({ url: article.url, requestIntent: "invalid" });
    expect(response.status).toBe(400); expect(mocks.instant).not.toHaveBeenCalled();
  });
  it.each(["/api/instant-review", "/api/instant-review/selected"])("preserves string posts and returns full source metadata at %s", async endpoint => {
    const response = await request(app).post(endpoint).send({ url: article.url, selectedPlatforms: ["linkedin"], tenantId: "evil", scope: { tenantId: "evil" }, voice: "evil" });
    expect(response.status).toBe(200);
    expect(response.body.posts.linkedin.thoughtLeader).toBe(post.thoughtLeader);
    expect(response.body.article.content).toBe(article.content);
    expect(response.body.article.contentMetadata).toEqual(metadata);
    expect(response.body.evidence).toEqual(evidence);
    expect(response.body.details).toEqual(result.details);
    expect(response.body.fallbackUsed).toBe(true);
    expect(mocks.profile).toHaveBeenCalledWith(mocks.scope);
    const options = endpoint.endsWith("selected") ? mocks.selected.mock.calls[0][2] : mocks.instant.mock.calls[0][1];
    expect(options).toMatchObject({ scope: { tenantId: "tenant-a" }, format: "short-post", signal: expect.any(AbortSignal) });
    expect(options.voice).toBeUndefined();
    expect(mocks.fetchArticle).toHaveBeenCalledWith(article.url, options.signal);
    expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.publish).not.toHaveBeenCalled();
  });

  it("regenerates exactly one selected platform with saved voice and preferences", async () => {
    mocks.profile.mockResolvedValue({ defaultTone: "contrarian", focusDescription: "Supply chains" });
    const response = await request(app).post("/api/instant-review/selected").send({ url: article.url, selectedPlatforms: ["medium"], format: "article", userContext: "Concise" });
    expect(response.status).toBe(200);
    expect(mocks.selected).toHaveBeenCalledWith(expect.objectContaining({ contentMetadata: metadata }), ["medium"], expect.objectContaining({ format: "article", userContext: "Concise", voice: JSON.stringify({ defaultTone: "contrarian", professionalFocus: "Supply chains" }) }));
    expect(mocks.instant).not.toHaveBeenCalled();
  });

  it("manual input is marked manual and media names are not evidence", async () => {
    const response = await request(app).post("/api/instant-review/manual").send({ title: "Manual", content: article.content, media: [{ type: "image", name: "Unverified million dollar result", url: "/test.jpg" }], selectedPlatforms: ["linkedin"], scope: { tenantId: "evil" } });
    expect(response.status).toBe(200);
    expect(mocks.selected.mock.calls[0][0]).toMatchObject({ content: article.content.trim(), contentMetadata: { extractionMethod: "manual", truncated: false } });
    expect(JSON.stringify(mocks.selected.mock.calls[0][0])).not.toContain("Unverified");
    expect(mocks.selected.mock.calls[0][2].scope).toEqual({ tenantId: "tenant-a" });
    expect(response.body.article.media).toHaveLength(1);
  });

  it.each([
    { selectedPlatforms: ["twitter"], format: "article" },
    { selectedPlatforms: ["medium", "twitter"], format: "article" },
    { selectedPlatforms: ["linkedin"], format: "invalid" },
    { selectedPlatforms: [] }, { selectedPlatforms: ["__proto__"] },
    { selectedPlatforms: ["linkedin"], url: "file:///private" },
    { selectedPlatforms: ["linkedin"], userContext: "x".repeat(4001) },
  ])("rejects incompatible formats and bad input before work (%#)", async invalid => {
    const response = await request(app).post("/api/instant-review/selected").send({ url: article.url, ...invalid });
    expect(response.status).toBe(400);
    expect(mocks.profile).not.toHaveBeenCalled(); expect(mocks.fetchArticle).not.toHaveBeenCalled(); expect(mocks.selected).not.toHaveBeenCalled();
  });

  it("rejects article format on the legacy two-platform endpoint", async () => {
    expect((await request(app).post("/api/instant-review").send({ url: article.url, format: "article" })).status).toBe(400);
    expect(mocks.instant).not.toHaveBeenCalled();
  });

  it("returns actionable crawl failures without successful posts", async () => {
    mocks.fetchArticle.mockRejectedValue(new CrawlError("content", "No readable article content was found."));
    const response = await request(app).post("/api/instant-review/selected").send({ url: article.url, selectedPlatforms: ["linkedin"] });
    expect(response.status).toBe(422); expect(response.body.message).toContain("Write article");
    expect(response.body).not.toHaveProperty("posts"); expect(mocks.selected).not.toHaveBeenCalled();
  });

  it("rejects whitespace-only draft saves", async () => {
    const response = await request(app).post("/api/drafts").send({ platform: "linkedin", tone: "professional", content: "   " });
    expect(response.status).toBe(400); expect(mocks.save).not.toHaveBeenCalled();
  });
});

describe("generation connection cancellation", () => {
  it("does not cancel on completed POST body, but does cancel on disconnected response", () => {
    const req = new EventEmitter() as Request;
    const res = Object.assign(new EventEmitter(), { writableEnded: false }) as Response;
    const cancellation = editorialCancellation(req, res);
    req.emit("close"); expect(cancellation.signal.aborted).toBe(false);
    res.emit("close"); expect(cancellation.signal.aborted).toBe(true);
    expect(cancellation.signal.reason.code).toBe("ai_cancelled");
    cancellation.dispose();
    expect(req.listenerCount("aborted")).toBe(0); expect(res.listenerCount("close")).toBe(0);
  });
  it("cleans up without cancelling normally completed responses", () => {
    const req = new EventEmitter() as Request;
    const res = Object.assign(new EventEmitter(), { writableEnded: true }) as Response;
    const cancellation = editorialCancellation(req, res);
    res.emit("close"); expect(cancellation.signal.aborted).toBe(false);
    cancellation.dispose();
  });
});