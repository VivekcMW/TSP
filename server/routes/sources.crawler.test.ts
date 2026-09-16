import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { storage, discovery, pass, scope } = vi.hoisted(() => ({
  storage: { createUserSource: vi.fn(), getUserSources: vi.fn() }, discovery: vi.fn(),
  pass: (_req: unknown, _res: unknown, next: () => void) => next(), scope: { tenantId: "tenant", userId: "user" },
}));
vi.mock("../storage", () => ({ storage }));
vi.mock("../lib/redis", () => ({ redis: undefined }));
vi.mock("../services/metaEngine", () => ({ normalizeIndustryToSlug: () => "other" }));
vi.mock("../services/feedDiscovery", () => ({ discoverFeed: discovery }));
vi.mock("../middlewares/requireDbUser", () => ({ requireDbUser: pass, authedOf: () => ({ tenant: scope, dbUser: { id: scope.userId } }) }));
vi.mock("../middlewares/requirePermission", () => ({ requirePermission: () => pass }));
import { registerSourcesRoutes } from "./sources";
const makeApp = () => { const app = express(); app.use(express.json()); registerSourcesRoutes(app); return app; };
beforeEach(() => {
  vi.resetAllMocks(); scope.userId = "user";
  discovery.mockResolvedValue({ name: "Actual page", feedUrl: "https://news.test/canonical", sourceType: "webpage" });
  storage.createUserSource.mockImplementation(async (_scope, source) => source);
});

describe("source creation", () => {
  it("validates both explicit input and suggested feed URL paths before persisting", async () => {
    const app = makeApp();
    const result = await request(app).post("/api/sources").send({ name: "Confirmed name", feedUrl: "https://news.test/feed" });
    expect(result.status).toBe(200); expect(discovery).toHaveBeenCalledWith("https://news.test/feed");
    expect(storage.createUserSource).toHaveBeenCalledWith(scope, expect.objectContaining({ name: "Confirmed name", feedUrl: "https://news.test/canonical", sourceType: "webpage" }));
  });
  it("does not create inaccessible or unresolved sources", async () => {
    discovery.mockResolvedValue({ error: "Paste an explicit URL." });
    const app = makeApp();
    expect((await request(app).post("/api/sources").send({ input: "Campaign" })).status).toBe(400);
    expect((await request(app).post("/api/sources").send({ name: "Bad source", feedUrl: "https://news.test/bad" })).status).toBe(400);
    expect(storage.createUserSource).not.toHaveBeenCalled();
  });
  it("limits attempts before discovery, including invalid inputs, and isolates users", async () => {
    const app = makeApp();
    for (let i = 0; i < 10; i++) expect((await request(app).post("/api/sources").send({})).status).toBe(400);
    const limited = await request(app).post("/api/sources").send({ input: "https://news.test/" });
    expect(limited.status).toBe(429); expect(limited.headers["retry-after"]).toBeDefined();
    expect(discovery).not.toHaveBeenCalled();
    scope.userId = "another-user";
    expect((await request(app).post("/api/sources").send({ input: "https://news.test/" })).status).toBe(200);
    expect(discovery).toHaveBeenCalledTimes(1);
  });
});