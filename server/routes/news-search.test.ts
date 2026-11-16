import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  scope: { tenantId: "search-tenant", userId: "search-user" },
  permissions: new Map<string, string>(),
  storage: { getUserProfile: vi.fn(), addInboxItem: vi.fn(), updateInboxItem: vi.fn() },
  searchNews: vi.fn(),
  repo: {
    listSavedSearches: vi.fn(), createSavedSearch: vi.fn(), renameSavedSearch: vi.fn(), deleteSavedSearch: vi.fn(),
    markSavedSearchViewed: vi.fn(), findInboxItemsByCanonicalUrls: vi.fn(),
  },
  LimitError: class SavedSearchLimitError extends Error { constructor() { super("You can follow up to 25 searches. Remove one first."); } },
}));

vi.mock("../db", () => { throw new Error("Database must not load in news search route tests"); });
vi.mock("../lib/redis", () => ({ redis: undefined }));
vi.mock("../storage", () => ({ storage: m.storage }));
vi.mock("../services/newsSearch", () => ({ searchNews: m.searchNews, NEWS_SEARCH_MAX_RESULTS: 50 }));
vi.mock("../repositories/savedSearches", () => ({ ...m.repo, SavedSearchLimitError: m.LimitError, SAVED_SEARCH_NAME_MAX: 60 }));
vi.mock("../middlewares/requireDbUser", () => ({
  // A request may act as another member through a test header, to prove limits are per user.
  requireDbUser: (req: express.Request, _res: unknown, next: () => void) => {
    const userId = req.header("x-test-user") ?? m.scope.userId;
    Object.assign(req, { dbUser: { id: userId }, tenant: { ...m.scope, userId } });
    next();
  },
  authedOf: (req: express.Request & { tenant?: unknown; dbUser?: unknown }) => ({ tenant: req.tenant, dbUser: req.dbUser }),
}));
vi.mock("../middlewares/requirePermission", () => ({
  requirePermission: (permission: string) => Object.assign((_req: unknown, _res: unknown, next: () => void) => next(), { permission }),
}));

import { registerNewsSearchRoutes, safeArticleUrl } from "./news-search";
import { newsSearchRateLimit, newsSearchWriteRateLimit } from "../middlewares/rateLimit";

const app = express();
app.use(express.json());
const original = { get: app.get.bind(app), post: app.post.bind(app), patch: app.patch.bind(app), delete: app.delete.bind(app) };
for (const method of ["get", "post", "patch", "delete"] as const) {
  (app as unknown as Record<string, unknown>)[method] = (path: string, ...handlers: Array<{ permission?: string }>) => {
    const permission = handlers.find(handler => handler.permission)?.permission;
    if (permission) m.permissions.set(`${method} ${path}`, permission);
    return (original[method] as (...args: unknown[]) => unknown)(path, ...handlers);
  };
}
registerNewsSearchRoutes(app);

const hit = (id: string, url: string, alsoCoveredBy: Array<{ source: string; url: string }> = []) => ({
  id, title: `Story ${id}`, url, source: "Wire", publishedAt: "2026-11-15T00:00:00.000Z", snippet: "", matchedTerms: ["ai"], alsoCoveredBy,
});
const outcome = (results = [hit("a", "https://wire.test/a"), hit("b", "https://wire.test/b", [{ source: "Other", url: "https://other.test/b" }]), hit("c", "https://wire.test/c")]) => ({
  query: { normalized: "ai", warnings: [] }, providers: { pool: "ok", google: "failed", bing: "ok" }, results,
});
const saved = { id: "s1", tenantId: m.scope.tenantId, userId: m.scope.userId, name: "ai", query: "ai", createdAt: "2026-11-16T00:00:00.000Z", lastViewedAt: null };
const item = (extra: Record<string, unknown> = {}) => ({ id: "i1", headline: "Story", source: "Wire", articleUrl: "https://wire.test/a", status: "saved", ...extra });
const resetLimits = (...users: string[]) => Promise.all(users.flatMap(user => [newsSearchRateLimit.resetKey(user), newsSearchWriteRateLimit.resetKey(user)]));

beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  await resetLimits(m.scope.userId, "other-user");
  m.storage.getUserProfile.mockResolvedValue({ searchEdition: "en-IN" });
  m.searchNews.mockResolvedValue(outcome());
  m.repo.findInboxItemsByCanonicalUrls.mockResolvedValue([]);
});

describe("permissions", () => {
  it("reads with inbox:read:own and writes with inbox:write:own", () => {
    expect(Object.fromEntries(m.permissions)).toEqual({
      "get /api/search/news": "inbox:read:own", "post /api/search/news/save": "inbox:write:own",
      "get /api/searches": "inbox:read:own", "post /api/searches": "inbox:write:own", "patch /api/searches/:id": "inbox:write:own",
      "delete /api/searches/:id": "inbox:write:own", "post /api/searches/:id/viewed": "inbox:write:own",
    });
  });
});

describe("GET /api/search/news", () => {
  it.each([
    ["missing q", ""], ["blank q", "?q=%20%20"], ["q over 300 characters", `?q=${"x".repeat(301)}`], ["repeated q", "?q=a&q=b"],
    ["limit 0", "?q=ai&limit=0"], ["limit 51", "?q=ai&limit=51"], ["a non-numeric limit", "?q=ai&limit=lots"],
  ])("rejects %s with 400 before searching", async (_label, query) => {
    await request(app).get(`/api/search/news${query}`).expect(400);
    expect(m.searchNews).not.toHaveBeenCalled();
  });

  it("searches the member's edition and marks results already in their Inbox, never cacheable", async () => {
    m.repo.findInboxItemsByCanonicalUrls.mockResolvedValue([
      { id: "i1", status: "saved", canonicalUrl: "https://wire.test/a" },
      { id: "i2", status: "active", canonicalUrl: "https://other.test/b" },
    ]);
    const response = await request(app).get("/api/search/news?q=%20ai%20&limit=10").expect(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(m.searchNews).toHaveBeenCalledWith({ query: "ai", edition: "en-IN", limit: 10 });
    expect(m.repo.findInboxItemsByCanonicalUrls).toHaveBeenCalledWith(m.scope, ["https://wire.test/a", "https://wire.test/b", "https://other.test/b", "https://wire.test/c"]);
    expect(response.body.providers).toEqual({ pool: "ok", google: "failed", bing: "ok" });
    expect(response.body.results.map((result: { inInbox: unknown }) => result.inInbox)).toEqual([
      { id: "i1", status: "saved", url: "https://wire.test/a" }, { id: "i2", status: "active", url: "https://other.test/b" }, null,
    ]);
  });

  it("defaults to 30 results in en-US without a profile", async () => {
    m.storage.getUserProfile.mockResolvedValue(undefined);
    await request(app).get("/api/search/news?q=ai").expect(200);
    expect(m.searchNews).toHaveBeenCalledWith({ query: "ai", edition: "en-US", limit: 30 });
  });

  it("still answers when the Inbox lookup fails, and returns 500 when the search fails", async () => {
    m.repo.findInboxItemsByCanonicalUrls.mockRejectedValue(new Error("db down"));
    const response = await request(app).get("/api/search/news?q=ai").expect(200);
    expect(response.body.results.every((result: { inInbox: unknown }) => result.inInbox === null)).toBe(true);
    m.searchNews.mockRejectedValue(new Error("boom"));
    expect((await request(app).get("/api/search/news?q=ai").expect(500)).body).toEqual({ message: "Search failed. Please try again." });
  });

  it("limits each member to 20 searches a minute", async () => {
    for (let i = 0; i < 20; i++) await request(app).get("/api/search/news?q=ai").expect(200);
    expect((await request(app).get("/api/search/news?q=ai").expect(429)).body).toEqual({ message: "Too many searches. Please wait a minute and try again." });
    expect(m.searchNews).toHaveBeenCalledTimes(20);
    await request(app).get("/api/search/news?q=ai").set("x-test-user", "other-user").expect(200);
  });
});

describe("POST /api/search/news/save", () => {
  const body = { url: "https://wire.test/a?utm_source=x", title: " Story ", source: "Wire", publishedAt: "2026-11-15T08:00:00Z", snippet: "Short", tenantId: "forged", status: "active" };

  it("adds the story to the Shortlist in the session scope with only the allowed fields", async () => {
    m.storage.addInboxItem.mockResolvedValue({ item: item(), alreadyExists: false });
    expect((await request(app).post("/api/search/news/save").send(body).expect(201)).body).toEqual(item());
    expect(m.storage.addInboxItem).toHaveBeenCalledExactlyOnceWith(m.scope, {
      headline: "Story", source: "Wire", articleUrl: "https://wire.test/a", summary: "Short", matchedKeywords: [], relevanceScore: "0",
      relevanceReason: "Saved from a news search; relevance has not been scored.", status: "saved", publishedAt: new Date("2026-11-15T08:00:00Z"),
    });
  });

  it("returns an existing story as it is, and moves a dismissed one to the Shortlist", async () => {
    m.storage.addInboxItem.mockResolvedValueOnce({ item: item({ status: "active" }), alreadyExists: true });
    expect((await request(app).post("/api/search/news/save").send(body).expect(200)).body.status).toBe("active");
    expect(m.storage.updateInboxItem).not.toHaveBeenCalled();
    m.storage.addInboxItem.mockResolvedValueOnce({ item: item({ status: "dismissed" }), alreadyExists: true });
    m.storage.updateInboxItem.mockResolvedValueOnce(item({ status: "saved" }));
    expect((await request(app).post("/api/search/news/save").send(body).expect(200)).body.status).toBe("saved");
    expect(m.storage.updateInboxItem).toHaveBeenCalledWith(m.scope, "i1", { status: "saved" });
  });

  it("drops a publication date in the future", async () => {
    m.storage.addInboxItem.mockResolvedValue({ item: item(), alreadyExists: false });
    await request(app).post("/api/search/news/save").send({ ...body, publishedAt: "2099-01-01T00:00:00Z", snippet: null }).expect(201);
    expect(m.storage.addInboxItem.mock.calls[0][1]).toMatchObject({ publishedAt: null, summary: null });
  });

  it.each([
    ["no title", { ...body, title: " " }], ["a 501-character title", { ...body, title: "x".repeat(501) }], ["no source", { ...body, source: undefined }],
    ["an invalid date", { ...body, publishedAt: "yesterday" }], ["a long snippet", { ...body, snippet: "x".repeat(1001) }],
    ["an ftp link", { ...body, url: "ftp://wire.test/a" }], ["a javascript link", { ...body, url: "javascript:alert(1)" }],
    ["localhost", { ...body, url: "http://localhost:3000/a" }], ["an IP address", { ...body, url: "http://169.254.169.254/latest" }],
    ["a blocked domain", { ...body, url: "https://example.com/a" }], ["a link with credentials", { ...body, url: "https://user:pw@wire.test/a" }],
    ["an internal host", { ...body, url: "https://db.internal/a" }],
  ])("rejects %s with 400 before storage", async (_label, payload) => {
    await request(app).post("/api/search/news/save").send(payload).expect(400);
    expect(m.storage.addInboxItem).not.toHaveBeenCalled();
  });

  it("returns 500 when storage fails", async () => {
    m.storage.addInboxItem.mockRejectedValue(new Error("boom"));
    await request(app).post("/api/search/news/save").send(body).expect(500);
  });
});

describe("safeArticleUrl", () => {
  it("canonicalizes public links", () => {
    expect(safeArticleUrl("https://news.site.co/story?id=1&utm_medium=x#top")).toBe("https://news.site.co/story?id=1");
    expect(safeArticleUrl("https://[::1]/a")).toBeNull();
  });
});

describe("/api/searches", () => {
  it("lists the member's followed searches", async () => {
    m.repo.listSavedSearches.mockResolvedValue([saved]);
    expect((await request(app).get("/api/searches").expect(200)).body).toEqual([saved]);
    expect(m.repo.listSavedSearches).toHaveBeenCalledWith(m.scope);
  });

  it("follows the normalized query, named after it unless a name is given", async () => {
    m.repo.createSavedSearch.mockResolvedValue({ search: saved, created: true });
    await request(app).post("/api/searches").send({ query: "  AI   source:FT ", tenantId: "forged" }).expect(201);
    expect(m.repo.createSavedSearch).toHaveBeenLastCalledWith(m.scope, { query: "AI source:FT", name: "AI source:FT" });
    m.repo.createSavedSearch.mockResolvedValue({ search: saved, created: false });
    await request(app).post("/api/searches").send({ query: "ai", name: " My AI " }).expect(200);
    expect(m.repo.createSavedSearch).toHaveBeenLastCalledWith(m.scope, { query: "ai", name: "My AI" });
    const long = Array.from({ length: 20 }, (_, i) => `word${i}`).join(" ");
    await request(app).post("/api/searches").send({ query: long }).expect(200);
    const { name } = m.repo.createSavedSearch.mock.lastCall![1];
    expect(name).toHaveLength(60);
    expect(name.endsWith("\u2026")).toBe(true);
  });

  it.each([
    ["no query", {}], ["a 301-character query", { query: "x".repeat(301) }], ["only exclusions", { query: "-crypto" }], ["a 61-character name", { query: "ai", name: "x".repeat(61) }],
  ])("rejects %s with 400", async (_label, payload) => {
    await request(app).post("/api/searches").send(payload).expect(400);
    expect(m.repo.createSavedSearch).not.toHaveBeenCalled();
  });

  it("maps the 25-search cap to 409 and other failures to 500", async () => {
    m.repo.createSavedSearch.mockRejectedValueOnce(new m.LimitError());
    expect((await request(app).post("/api/searches").send({ query: "ai" }).expect(409)).body).toEqual({ message: "You can follow up to 25 searches. Remove one first." });
    m.repo.createSavedSearch.mockRejectedValueOnce(new Error("boom"));
    await request(app).post("/api/searches").send({ query: "ai" }).expect(500);
  });

  it("renames, removes and marks viewed in the session scope, with 404 for unknown ids", async () => {
    m.repo.renameSavedSearch.mockResolvedValueOnce({ ...saved, name: "Chips" }).mockResolvedValueOnce(undefined);
    expect((await request(app).patch("/api/searches/s1").send({ name: " Chips " }).expect(200)).body.name).toBe("Chips");
    expect(m.repo.renameSavedSearch).toHaveBeenCalledWith(m.scope, "s1", "Chips");
    await request(app).patch("/api/searches/nope").send({ name: "Chips" }).expect(404);
    await request(app).patch("/api/searches/s1").send({ name: "" }).expect(400);

    m.repo.deleteSavedSearch.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect((await request(app).delete("/api/searches/s1").expect(200)).body).toEqual({ success: true });
    expect(m.repo.deleteSavedSearch).toHaveBeenCalledWith(m.scope, "s1");
    await request(app).delete("/api/searches/nope").expect(404);
    await request(app).delete(`/api/searches/${"x".repeat(101)}`).expect(404);

    m.repo.markSavedSearchViewed.mockResolvedValueOnce({ ...saved, lastViewedAt: "2026-11-16T10:00:00.000Z" }).mockResolvedValueOnce(undefined);
    expect((await request(app).post("/api/searches/s1/viewed").expect(200)).body.lastViewedAt).toBe("2026-11-16T10:00:00.000Z");
    expect(m.repo.markSavedSearchViewed).toHaveBeenCalledWith(m.scope, "s1");
    await request(app).post("/api/searches/nope/viewed").expect(404);
  });

  it("limits each member to 60 changes a minute", async () => {
    m.repo.deleteSavedSearch.mockResolvedValue(true);
    for (let i = 0; i < 60; i++) await request(app).delete("/api/searches/s1").expect(200);
    await request(app).delete("/api/searches/s1").expect(429);
  });
});
