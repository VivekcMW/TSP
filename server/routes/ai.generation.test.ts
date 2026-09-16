import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { generatePostContent, where, select, pass, getUserProfile, fetchArticle } = vi.hoisted(() => ({
  generatePostContent: vi.fn(), where: vi.fn(), select: vi.fn(), getUserProfile: vi.fn(), fetchArticle: vi.fn(),
  pass: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../db", () => ({ db: { select } }));
vi.mock("../middlewares/requireDbUser", () => ({ requireDbUser: pass, authedOf: () => ({ tenant: { tenantId: "tenant-a", userId: "user-a" } }) }));
vi.mock("../storage", () => ({ storage: { getUserProfile } }));
vi.mock("../lib/redis", () => ({ redis: undefined }));
vi.mock("../services/urlFetcher", () => ({ fetchArticleFromUrl: fetchArticle }));
vi.mock("../middlewares/requirePermission", () => ({ requirePermission: () => pass }));
vi.mock("../middlewares/rateLimit", () => ({ aiGenerationRateLimit: pass }));
vi.mock("../services/metaEngine", () => ({ getAvailableVerticals: vi.fn(), normalizeIndustryToSlug: vi.fn(), selectIndustryEngine: vi.fn() }));
vi.mock("../services/punditBrain", async importOriginal => ({ ...await importOriginal<typeof import("../services/punditBrain")>(), generatePostContentDetailed: generatePostContent }));
import { AIGenerationError } from "../services/openRouter";
import { registerAiRoutes } from "./ai";

const body = { headline: "Pilot result", summary: "The pilot reduced latency by 12%.", source: "Research Desk", articleUrl: "https://news.test/pilot", platform: "twitter", tone: "professional" };
const app = express();
app.use(express.json());
registerAiRoutes(app);

beforeEach(() => {
  select.mockReset().mockReturnValue({ from: () => ({ where }) });
  where.mockReset().mockResolvedValue([]);
  generatePostContent.mockReset().mockResolvedValue({ content: "A real generated post", evidence: { excerpts: [] }, generation: { provider: "anthropic", model: "test", fallbackUsed: false }, validation: { factualVerification: "not-performed", requiresHumanReview: true } });
  getUserProfile.mockReset().mockResolvedValue({ defaultTone: "authoritative", focusDescription: "Developer education" });
  fetchArticle.mockReset().mockResolvedValue({ title: "Fetched title", content: "Fetched body, not the inbox summary", source: "Publisher", url: body.articleUrl, contentMetadata: { extractionMethod: "article", originalLength: 35, retainedLength: 35, truncated: false } });
});

describe("POST /api/ai/generate-post", () => {
  it.each([
    {}, { ...body, headline: 12 }, { ...body, headline: " " },
    { ...body, summary: "" }, { ...body, summary: {} }, { ...body, summary: "x".repeat(50_001) },
    { ...body, source: [] }, { ...body, source: " " },
    { ...body, platform: "__proto__" }, { ...body, platform: "unsupported" },
    { ...body, tone: false }, { ...body, tone: "x".repeat(1001) },
    { ...body, articleUrl: "javascript:alert(1)" }, { ...body, articleUrl: "https://user:pass@news.test" },
    { ...body, userContext: "x".repeat(4001) }, { ...body, format: "unknown" }, { ...body, format: "article" },
  ])("rejects invalid input before querying integrations or invoking AI (%#)", async invalid => {
    const result = await request(app).post("/api/ai/generate-post").send(invalid);
    expect(result.status).toBe(400);
    expect(result.body.code).toBe("ai_invalid_input");
    expect(select).not.toHaveBeenCalled();
    expect(generatePostContent).not.toHaveBeenCalled();
  });

  it("passes validated content and preferences to generation", async () => {
    const result = await request(app).post("/api/ai/generate-post").send({ ...body, userContext: "Concise" });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ content: "A real generated post", generation: { provider: "anthropic" }, validation: { factualVerification: "not-performed" } });
    expect(generatePostContent).toHaveBeenCalledWith({ headline: body.headline, summary: body.summary, source: body.source, articleUrl: body.articleUrl }, "twitter", "professional", expect.objectContaining({ userContext: "Concise", scope: { tenantId: "tenant-a" }, signal: expect.any(AbortSignal) }));
  });

  it("ignores body scope and voice and uses only the authenticated saved profile", async () => {
    await request(app).post("/api/ai/generate-post").send({ ...body, tenantId: "evil", scope: { tenantId: "evil" }, voice: "invented" });
    expect(getUserProfile).toHaveBeenCalledWith({ tenantId: "tenant-a", userId: "user-a" });
    const options = generatePostContent.mock.calls[0][3];
    expect(options.scope).toEqual({ tenantId: "tenant-a" });
    expect(JSON.parse(options.voice)).toEqual({ defaultTone: "authoritative", professionalFocus: "Developer education" });
  });

  it("fetches full content with provenance and signal only when requested", async () => {
    const result = await request(app).post("/api/ai/generate-post").send({ ...body, summary: "", fetchSource: true, platform: "medium", format: "article" });
    expect(result.status).toBe(200);
    expect(fetchArticle).toHaveBeenCalledWith(body.articleUrl, expect.any(AbortSignal));
    expect(generatePostContent.mock.calls[0][0]).toMatchObject({ headline: "Fetched title", summary: "Fetched body, not the inbox summary", contentMetadata: { extractionMethod: "article" } });
    expect(generatePostContent.mock.calls[0][3].format).toBe("article");
  });

  it("continues to reject disabled platforms before generation", async () => {
    where.mockResolvedValue([{ enabled: false }]);
    expect((await request(app).post("/api/ai/generate-post").send(body)).status).toBe(403);
    expect(generatePostContent).not.toHaveBeenCalled();
  });

  it.each([
    ["ai_quota", 503], ["ai_configuration", 503], ["ai_timeout", 504], ["ai_invalid_output", 502], ["ai_busy", 503],
  ] as const)("maps %s safely without successful content", async (code, status) => {
    generatePostContent.mockRejectedValue(new AIGenerationError(code, 60));
    const result = await request(app).post("/api/ai/generate-post").send(body);
    expect(result.status).toBe(status);
    expect(result.body.code).toBe(code);
    expect(result.body).not.toHaveProperty("content");
    expect(result.headers["retry-after"]).toBe("60");
  });

  it("does not trust arbitrary exception status or expose internal messages", async () => {
    generatePostContent.mockRejectedValue({ status: 200, message: "secret provider body" });
    const result = await request(app).post("/api/ai/generate-post").send(body);
    expect(result.status).toBe(500);
    expect(JSON.stringify(result.body)).not.toContain("secret");
  });
});