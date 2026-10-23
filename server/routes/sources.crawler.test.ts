import express from "express";
import type { NextFunction, Request, Response } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { storage, discovery, scope, audit } = vi.hoisted(() => ({
  storage: { createUserSource: vi.fn(), getUserSources: vi.fn(), getUserProfile: vi.fn(), getPublicationResolutions: vi.fn(),
    claimPublicationResolution: vi.fn(), finishPublicationResolution: vi.fn(), completePublicationResolution: vi.fn(), updateUserSource: vi.fn(), deleteUserSource: vi.fn() },
  discovery: vi.fn(), audit: vi.fn(), scope: { tenantId: "tenant", userId: "user" },
}));
vi.mock("../storage", () => ({ storage }));
vi.mock("../lib/redis", () => ({ redis: undefined }));
vi.mock("../services/metaEngine", () => ({ normalizeIndustryToSlug: () => "other" }));
vi.mock("../services/feedDiscovery", () => ({ discoverFeed: discovery }));
vi.mock("../middlewares/requireDbUser", () => ({
  requireDbUser: (req: Request, res: Response, next: NextFunction) => {
    if (req.headers["x-test-anonymous"]) return res.status(401).json({ message: "Unauthorized" });
    req.dbUser = { id: scope.userId } as NonNullable<Request["dbUser"]>;
    req.tenant = { ...scope, role: "member", platformRole: null, viaPlatformRole: !!req.headers["x-test-no-permission"] } as NonNullable<Request["tenant"]>;
    next();
  },
  authedOf: () => ({ tenant: scope, dbUser: { id: scope.userId } }),
}));
vi.mock("../services/tenancy", () => ({ writeAuditLog: audit }));
import { registerSourcesRoutes } from "./sources";
const makeApp = () => { const app = express(); app.use(express.json()); registerSourcesRoutes(app); return app; };
beforeEach(() => {
  vi.resetAllMocks(); scope.userId = "user"; scope.tenantId = "tenant";
  storage.getUserProfile.mockResolvedValue(undefined); storage.getUserSources.mockResolvedValue([]); storage.getPublicationResolutions.mockResolvedValue([]);
  discovery.mockResolvedValue({ name: "Actual page", feedUrl: "https://news.test/canonical", sourceType: "webpage" });
  storage.createUserSource.mockImplementation(async (_scope, source) => source);
});

describe("read-only publication source status", () => {
  const url = (name: string) => `https://${name}.test/`;
  const timestamp = new Date("2026-01-01T00:00:00Z");
  const resolution = (name: string, status: string, extra = {}) => ({ ...scope, url: url(name), status,
    lastAttemptAt: timestamp, sourceId: null, claimToken: null, leaseUntil: null, error: null, ...extra });
  const source = (id: string, feedUrl: string, isActive = true, name = "Unrelated label") => ({ id, feedUrl, isActive, name });

  it("returns every selected name with honest statuses, safe messages and no side effects", async () => {
    const names = ["Plain name", "pending", "checking", "expired", "failed", "connected", "paused", "removed", "manual", "manual-paused", "changed", "alias"];
    storage.getUserProfile.mockResolvedValue({ publications: names, publicationCandidates: names.slice(1).map(name => ({ name, url: url(name === "alias" ? "connected" : name) })) });
    storage.getPublicationResolutions.mockResolvedValue([
      resolution("checking", "checking", { claimToken: "private-lease", leaseUntil: new Date(Date.now() + 30000) }),
      resolution("expired", "checking", { claimToken: "expired-lease", leaseUntil: new Date(0) }),
      resolution("failed", "failed", { error: "https://user:password@10.0.0.1/ <script>unsafe</script>" }),
      resolution("connected", "resolved", { sourceId: "connected-id" }),
      resolution("paused", "resolved", { sourceId: "paused-id" }),
      resolution("removed", "resolved", { sourceId: "deleted-id" }),
      resolution("old", "resolved", { sourceId: "old-id" }),
    ]);
    storage.getUserSources.mockResolvedValue([
      source("connected-id", "https://canonical.test/feed"), source("paused-id", url("paused"), false),
      source("manual-id", url("manual")), source("manual-paused-id", url("manual-paused"), false),
      source("old-id", url("old"), true, "changed"),
      // A replacement at the old URL must not erase a deletion tombstone.
      source("replacement-id", url("removed")), source("unrelated-id", url("unrelated"), true, "Plain name"),
    ]);
    const response = await request(makeApp()).get("/api/sources/publications?tenantId=attacker&userId=attacker");
    expect(response.status).toBe(200); expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body.map((entry: { status: string }) => entry.status)).toEqual([
      "needs-url", "pending", "checking", "pending", "failed", "connected", "paused", "removed", "connected", "paused", "pending", "connected",
    ]);
    expect(response.body.map((entry: { name: string }) => entry.name)).toEqual(names);
    expect(response.body[5]).toMatchObject({ url: url("connected"), sourceId: "connected-id", lastAttemptAt: timestamp.toISOString() });
    expect(response.body[7]).not.toHaveProperty("sourceId"); expect(response.body[0]).not.toHaveProperty("url");
    expect(response.body[11]).toMatchObject({ url: url("connected"), sourceId: "connected-id" });
    expect(JSON.stringify(response.body)).not.toMatch(/password|script|10\.0\.0\.1|claimToken|leaseUntil|private-lease/);
    expect(response.body.every((entry: { message: string }) => entry.message.length > 0)).toBe(true);
    expect(storage.getUserProfile).toHaveBeenCalledExactlyOnceWith(scope);
    expect(storage.getUserSources).toHaveBeenCalledExactlyOnceWith(scope);
    expect(storage.getPublicationResolutions).toHaveBeenCalledExactlyOnceWith(scope, names.slice(1, -1).map(url));
    for (const method of [storage.claimPublicationResolution, storage.finishPublicationResolution, storage.completePublicationResolution,
      storage.createUserSource, storage.updateUserSource, storage.deleteUserSource, discovery, audit]) expect(method).not.toHaveBeenCalled();
  });

  it("keeps first-seen metadata deterministic, supports legacy domains and ignores deselected metadata", async () => {
    storage.getUserProfile.mockResolvedValue({ publications: ["Brand", "brand", "legacy.test", "No URL"], publicationCandidates: [
      { name: "Brand", url: url("first") }, { name: "brand", url: url("second") }, { name: "Unselected", url: url("unselected") },
    ] });
    const response = await request(makeApp()).get("/api/sources/publications");
    expect(response.body).toMatchObject([{ name: "Brand", url: url("first"), status: "pending" },
      { name: "legacy.test", url: url("legacy"), status: "pending" }, { name: "No URL", status: "needs-url" }]);
    expect(storage.getPublicationResolutions).toHaveBeenCalledWith(scope, [url("first"), url("legacy")]);
    expect(discovery).not.toHaveBeenCalled();
  });

  it("returns an empty list for a missing profile without probing or writing", async () => {
    const response = await request(makeApp()).get("/api/sources/publications");
    expect(response.status).toBe(200); expect(response.body).toEqual([]);
    expect(storage.getPublicationResolutions).not.toHaveBeenCalled(); expect(discovery).not.toHaveBeenCalled();
  });

  it.each([true, false])("projects a persisted canonical reconnect without repairing anything (active=%s)", async isActive => {
    storage.getUserProfile.mockResolvedValue({ publications: ["Brand"], publicationCandidates: [{ name: "Brand", url: url("brand") }] });
    storage.getPublicationResolutions.mockResolvedValue([resolution("brand", "resolved", {
      sourceId: "reconnected-id", resolvedFeedUrl: "https://canonical.test/feed",
    })]);
    storage.getUserSources.mockResolvedValue([source("reconnected-id", "https://canonical.test/feed", isActive)]);
    const response = await request(makeApp()).get("/api/sources/publications");
    expect(response.body).toMatchObject([{ status: isActive ? "connected" : "paused", sourceId: "reconnected-id", lastAttemptAt: timestamp.toISOString() }]);
    for (const method of [storage.createUserSource, storage.updateUserSource, storage.deleteUserSource,
      storage.claimPublicationResolution, storage.finishPublicationResolution, storage.completePublicationResolution, discovery]) expect(method).not.toHaveBeenCalled();
  });

  it("never repairs even an exact canonical feed match during GET and reports unknown legacy identities conservatively", async () => {
    storage.getUserProfile.mockResolvedValue({ publications: ["known", "legacy"], publicationCandidates: [
      { name: "known", url: url("known") }, { name: "legacy", url: url("legacy") },
    ] });
    const rows = [resolution("known", "resolved", { sourceId: "deleted", resolvedFeedUrl: "https://canonical.test/feed" }),
      resolution("legacy", "resolved", { sourceId: "legacy-deleted", resolvedFeedUrl: null })];
    storage.getPublicationResolutions.mockResolvedValue(rows);
    storage.getUserSources.mockResolvedValue([source("new-id", "https://canonical.test/feed"), source("legacy-new", url("legacy"))]);
    const response = await request(makeApp()).get("/api/sources/publications");
    expect(response.body.map((row: { status: string }) => row.status)).toEqual(["removed", "removed"]);
    expect(response.body[1].message).toContain("cannot be restored automatically");
    expect(rows.map(row => row.sourceId)).toEqual(["deleted", "legacy-deleted"]);
    expect(storage.createUserSource).not.toHaveBeenCalled(); expect(storage.updateUserSource).not.toHaveBeenCalled();
    expect(storage.completePublicationResolution).not.toHaveBeenCalled(); expect(discovery).not.toHaveBeenCalled();
  });

  it.each([["x-test-anonymous", 401], ["x-test-no-permission", 403]] as const)("requires authentication and inbox read permission (%s)", async (header, expected) => {
    const response = await request(makeApp()).get("/api/sources/publications").set(header, "yes");
    expect(response.status).toBe(expected);
    expect(storage.getUserProfile).not.toHaveBeenCalled(); expect(storage.getUserSources).not.toHaveBeenCalled();
    expect(storage.getPublicationResolutions).not.toHaveBeenCalled(); expect(discovery).not.toHaveBeenCalled();
  });

  it("uses the authenticated tenant and user for every read", async () => {
    const app = makeApp();
    storage.getUserProfile.mockResolvedValue({ publications: [url("news")], publicationCandidates: [] });
    scope.tenantId = "other-tenant"; scope.userId = "coworker";
    expect((await request(app).get("/api/sources/publications").set("x-tenant-id", "untrusted-query")).status).toBe(200);
    const expected = { tenantId: "other-tenant", userId: "coworker" };
    expect(storage.getUserProfile).toHaveBeenCalledWith(expected); expect(storage.getUserSources).toHaveBeenCalledWith(expected);
    expect(storage.getPublicationResolutions).toHaveBeenCalledWith(expected, [url("news")]);
  });

  it.each(["getUserProfile", "getPublicationResolutions", "getUserSources"] as const)("fails safely when %s fails", async method => {
    storage.getUserProfile.mockResolvedValue({ publications: [url("news")], publicationCandidates: [] });
    storage[method].mockRejectedValue(new Error("sensitive persistence details"));
    const response = await request(makeApp()).get("/api/sources/publications");
    expect(response.status).toBe(500); expect(response.body).toEqual({ message: "Failed to fetch publication source statuses" });
    expect(discovery).not.toHaveBeenCalled();
  });
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