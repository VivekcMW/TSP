import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { storage, scope, security } = vi.hoisted(() => ({
  storage: { getDrafts: vi.fn() },
  scope: { tenantId: "tenant", userId: "owner" },
  security: { authenticated: true, allowed: true },
}));
vi.mock("../db", () => ({ db: {} }));
vi.mock("../storage", () => ({ storage, ScheduleConflictError: class extends Error {} }));
vi.mock("../middlewares/requireDbUser", () => ({ requireDbUser: (_req: unknown, res: any, next: () => void) => security.authenticated ? next() : res.sendStatus(401), authedOf: () => ({ tenant: scope, dbUser: { id: scope.userId } }) }));
vi.mock("../middlewares/requirePermission", () => ({ requirePermission: () => (_req: unknown, res: any, next: () => void) => security.allowed ? next() : res.sendStatus(403) }));
vi.mock("../middlewares/rateLimit", () => ({ instantReviewRateLimit: (_req: unknown, _res: unknown, next: () => void) => next() }));
vi.mock("../services/punditBrain", () => ({ generateInstantReviewDetailed: vi.fn() }));
vi.mock("../services/editorial-request", () => ({ prepareEditorialRequest: vi.fn(), executeEditorialRequest: vi.fn() }));
vi.mock("../services/urlFetcher", () => ({ fetchArticleFromUrl: vi.fn() }));
vi.mock("./editorial-context", () => ({ editorialPreferences: {} }));
vi.mock("../services/openRouter", () => ({ getAIErrorResponse: vi.fn() }));
vi.mock("../jobs/queue", () => ({ enqueuePublishDraft: vi.fn(), QueueUnavailableError: class extends Error {} }));
vi.mock("../jobs/handlers/publish-draft", () => ({ handlePublishDraft: vi.fn() }));

import { registerDraftsRoutes } from "./drafts";

const app = express();
app.use(express.json());
registerDraftsRoutes(app);

const pastPost = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", content: "Shipping fast matters more than shipping perfect. Teams that ship weekly learn faster than teams that plan quarterly.", platform: "linkedin", publishedAt: new Date("2026-08-01"), updatedAt: new Date("2026-08-01") };

beforeEach(() => {
  vi.resetAllMocks();
  security.authenticated = true;
  security.allowed = true;
  storage.getDrafts.mockResolvedValue([pastPost]);
});

describe("POST /api/drafts/repetition-check", () => {
  it("requires authentication and read permission", async () => {
    security.authenticated = false;
    expect((await request(app).post("/api/drafts/repetition-check").send({ content: "hello" })).status).toBe(401);
    security.authenticated = true;
    security.allowed = false;
    expect((await request(app).post("/api/drafts/repetition-check").send({ content: "hello" })).status).toBe(403);
    expect(storage.getDrafts).not.toHaveBeenCalled();
  });

  it("rejects an empty or missing content body", async () => {
    expect((await request(app).post("/api/drafts/repetition-check").send({})).status).toBe(400);
    expect((await request(app).post("/api/drafts/repetition-check").send({ content: "" })).status).toBe(400);
    expect(storage.getDrafts).not.toHaveBeenCalled();
  });

  it("flags a near-verbatim repost of the caller's own past draft", async () => {
    const response = await request(app).post("/api/drafts/repetition-check")
      .send({ content: "Honestly, shipping fast matters more than shipping perfect. Teams that ship weekly learn faster than teams that plan quarterly." });
    expect(response.status).toBe(200);
    expect(response.body.matches).toHaveLength(1);
    expect(response.body.matches[0].id).toBe(pastPost.id);
    expect(storage.getDrafts).toHaveBeenCalledExactlyOnceWith(scope, { limit: 200 });
  });

  it("returns no matches for genuinely new content", async () => {
    const response = await request(app).post("/api/drafts/repetition-check").send({ content: "A completely unrelated announcement about office relocation plans." });
    expect(response.status).toBe(200);
    expect(response.body.matches).toEqual([]);
  });

  it("excludes the draft's own id so editing it never flags itself", async () => {
    const response = await request(app).post("/api/drafts/repetition-check").send({ content: pastPost.content, excludeId: pastPost.id });
    expect(response.status).toBe(200);
    expect(response.body.matches).toEqual([]);
  });

  it("fails closed with a 500 on a storage error, without leaking internals", async () => {
    storage.getDrafts.mockRejectedValueOnce(new Error("private SQL detail"));
    const response = await request(app).post("/api/drafts/repetition-check").send({ content: "hello world this is a draft" });
    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain("private SQL");
  });
});
