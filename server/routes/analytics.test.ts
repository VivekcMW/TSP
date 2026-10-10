import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Express, RequestHandler } from "express";
import { normalizeAnalytics } from "@shared/analytics-availability";

const mocks = vi.hoisted(() => ({ getSocialAccounts: vi.fn(), getLatestSocialAnalytics: vi.fn(), getSocialAccountByProvider: vi.fn(), getSocialAnalytics: vi.fn(), writeAuditLog: vi.fn() }));
vi.mock("../storage", () => ({ storage: mocks }));
vi.mock("../db", () => { throw new Error("Database import forbidden in analytics route tests"); });
vi.mock("../services/tenancy", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("../middlewares/requireDbUser", () => ({
  requireDbUser: (req: any, res: any, next: any) => req.dbUser ? next() : res.status(401).json({ message: "Unauthorized" }),
  authedOf: (req: any) => ({ dbUser: req.dbUser, tenant: req.tenant }),
}));
// Actual permission middleware and actual route registration, not a reconstructed handler.
import { registerAnalyticsRoutes } from "./analytics";

const scope = { tenantId: "tenant-a", userId: "user-a", role: "member", platformRole: null, viaPlatformRole: false };
const account = (provider = "linkedin", patch = {}) => ({ ...scope, id: `${provider}-account`, provider, isActive: true, accountName: "Fixture", accountHandle: "@fixture", lastSyncAt: new Date("2026-09-18T10:00:00Z"), accessToken: "DO_NOT_RETURN", ...patch });
const snapshot = (provider = "linkedin", patch = {}) => ({ ...scope, id: "snapshot", provider, socialAccountId: `${provider}-account`, snapshotDate: new Date("2026-09-18T09:00:00Z"), metrics: { impressions: 0, followers: 50 }, metricAvailability: { impressions: { status: "measured", reason: null, supported: true, measuredAt: "2026-09-18T14:30:00+05:30", source: "provider_response", endpoint: "/fixture/metrics", sourceField: "impressions", period: null } }, topPosts: [{ content: "LEGACY_UNVERIFIED" }], ...patch });
const routes = new Map<string, RequestHandler[]>();
registerAnalyticsRoutes({ get: (route: string, ...handlers: RequestHandler[]) => routes.set(route, handlers) } as unknown as Express);

async function invoke(route = "/api/analytics/summary", options: Record<string, unknown> = {}) {
  const req: any = { dbUser: { id: "user-a" }, tenant: scope, query: {}, params: { provider: "linkedin" }, headers: {}, method: "GET", originalUrl: route, ...options };
  const res: any = { code: 200, body: undefined, headers: {}, status(code: number) { this.code = code; return this; }, json(body: unknown) { this.body = body; return this; }, setHeader(key: string, value: string) { this.headers[key] = value; } };
  for (const handler of routes.get(route)!) {
    let next = false;
    await handler(req, res, (() => { next = true; }) as any);
    if (!next) break;
  }
  return res;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-19T12:00:00Z"));
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.getSocialAccounts.mockResolvedValue([account()]);
  mocks.getSocialAccountByProvider.mockResolvedValue(account());
  mocks.getLatestSocialAnalytics.mockResolvedValue(snapshot());
  mocks.getSocialAnalytics.mockResolvedValue([snapshot()]);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("registered analytics routes with mocked persistence", () => {
  it("uses authenticated tenant/user scope, exposes measured zero and no credentials/top posts", async () => {
    const result = await invoke(undefined, { query: { userId: "victim", tenantId: "victim" } });
    expect(result.code).toBe(200);
    expect(mocks.getSocialAccounts).toHaveBeenCalledWith(scope);
    expect(mocks.getLatestSocialAnalytics).toHaveBeenCalledWith(scope, "linkedin");
    expect(result.body.combined.impressions).toBe(0);
    expect(result.body.combined.followers).toBeNull();
    expect(result.body.availability.impressions.measuredAt).toBe("2026-09-18T09:00:00.000Z");
    expect(result.body.lastSync).toBe("2026-09-18T10:00:00.000Z");
    expect(JSON.stringify(result.body)).not.toMatch(/DO_NOT_RETURN|LEGACY_UNVERIFIED/);
    expect(result.headers["Cache-Control"]).toBe("no-store");
  });
  it.each(["/api/analytics/summary", "/api/analytics/:provider"])("requires authentication and real read permission for %s", async route => {
    expect((await invoke(route, { dbUser: undefined })).code).toBe(401);
    expect((await invoke(route, { tenant: { ...scope, role: null, viaPlatformRole: true } })).code).toBe(403);
    expect(mocks.getSocialAccounts).not.toHaveBeenCalled();
    expect(mocks.getSocialAccountByProvider).not.toHaveBeenCalled();
  });
  it("keeps no connections unknown rather than zero", async () => {
    mocks.getSocialAccounts.mockResolvedValue([]);
    const { body } = await invoke();
    expect(body.connected).toEqual({ linkedin: false, twitter: false });
    expect(body.combined.impressions).toBeNull();
    expect(body.availability.impressions.reason).toBe("not_connected");
    expect(mocks.getLatestSocialAnalytics).not.toHaveBeenCalled();
  });
  it("ignores disconnected, unsupported and foreign connections", async () => {
    mocks.getSocialAccounts.mockResolvedValue([account("linkedin", { isActive: false }), account("twitter", { userId: "other" }), account("linkedin", { tenantId: "other" }), account("mastodon")]);
    expect((await invoke()).body.connected).toEqual({ linkedin: false, twitter: false });
    expect(mocks.getLatestSocialAnalytics).not.toHaveBeenCalled();
  });
  it.each([{ tenantId: "other" }, { userId: "other" }, { socialAccountId: "old-connection" }, { provider: "twitter" }])("rejects mismatched snapshot %j", async patch => {
    mocks.getLatestSocialAnalytics.mockResolvedValue(snapshot("linkedin", patch));
    expect((await invoke()).body.linkedin.availability.impressions.reason).toBe("account_mismatch");
  });
  it("isolates failed provider lookup while retaining a healthy provider", async () => {
    mocks.getSocialAccounts.mockResolvedValue([account(), account("twitter")]);
    mocks.getLatestSocialAnalytics.mockImplementation(async (_scope, provider) => {
      if (provider === "linkedin") throw new Error("secret DB details");
      return snapshot("twitter");
    });
    const { body } = await invoke();
    expect(body.twitter.metrics.impressions).toBe(0);
    expect(body.linkedin.availability.impressions.reason).toBe("fetch_failed");
    expect(body.combined.impressions).toBeNull();
    expect(body.availability.impressions.coverage).toMatchObject({ expectedAccounts: 2, measuredAccounts: 1 });
    expect(JSON.stringify(body)).not.toContain("secret");
  });
  it("never double counts a provider snapshot across duplicate account rows", async () => {
    mocks.getSocialAccounts.mockResolvedValue([account(), account("linkedin", { id: "second-account" })]);
    const { body } = await invoke();
    expect(body.combined.impressions).toBeNull();
    expect(body.availability.impressions.coverage).toMatchObject({ expectedAccounts: 2, measuredAccounts: 1 });
  });
  it("fails an account-list error instead of reporting no connections", async () => {
    mocks.getSocialAccounts.mockRejectedValue(new Error("fixture"));
    expect((await invoke()).code).toBe(500);
    mocks.getSocialAccounts.mockResolvedValue({});
    expect((await invoke()).code).toBe(500);
  });
  it("normalizes legacy history and strips foreign/account-mismatched rows", async () => {
    mocks.getSocialAnalytics.mockResolvedValue([snapshot("linkedin", { metricAvailability: null }), snapshot("linkedin", { userId: "other" }), snapshot("linkedin", { socialAccountId: "old" })]);
    const { body } = await invoke("/api/analytics/:provider", { query: { days: "7" } });
    expect(mocks.getSocialAnalytics).toHaveBeenCalledWith(scope, "linkedin", 7);
    expect(body.current.metrics.impressions).toBeNull();
    expect(body.history[0].availability.impressions.reason).toBe("legacy_unverified");
    expect(body.historyCoverage).toEqual({ days: 7, returnedSnapshots: 1, excludedSnapshots: 2 });
  });
  it("does not hide invalid or future snapshot dates as measured history", async () => {
    mocks.getSocialAnalytics.mockResolvedValue([snapshot("linkedin", { snapshotDate: new Date("bad") }), snapshot("linkedin", { snapshotDate: new Date("2026-09-20") })]);
    const { body } = await invoke("/api/analytics/:provider");
    expect(body.history).toEqual([]);
    expect(body.historyCoverage.excludedSnapshots).toBe(2);
    expect(body.current.availability.impressions.reason).toBe("invalid_provenance");
  });
  it("returns explicit availability on empty history without a false measured zero", async () => {
    mocks.getSocialAnalytics.mockResolvedValue([]);
    expect((await invoke("/api/analytics/:provider")).body.current.availability.impressions.reason).toBe("no_snapshot");
  });
  it.each(["0", "-1", "366", "NaN", "3.5", "7x", ["7", "30"], {}])("rejects invalid history days %j", async days => {
    expect((await invoke("/api/analytics/:provider", { query: { days } })).code).toBe(400);
    expect(mocks.getSocialAnalytics).not.toHaveBeenCalled();
  });
  it("rejects unsupported provider before persistence", async () => {
    expect((await invoke("/api/analytics/:provider", { params: { provider: "__proto__" } })).code).toBe(400);
    expect(mocks.getSocialAccountByProvider).not.toHaveBeenCalled();
  });
  it.each([undefined, account("linkedin", { isActive: false }), account("linkedin", { tenantId: "other" }), account("linkedin", { userId: "other" })])("returns 404 without analytics for absent/foreign/inactive account %j", async value => {
    mocks.getSocialAccountByProvider.mockResolvedValue(value);
    expect((await invoke("/api/analytics/:provider")).code).toBe(404);
    expect(mocks.getSocialAnalytics).not.toHaveBeenCalled();
  });
  it("does not return empty history on failed or malformed persistence response", async () => {
    mocks.getSocialAnalytics.mockRejectedValueOnce(new Error("fixture")).mockResolvedValueOnce({});
    expect((await invoke("/api/analytics/:provider")).code).toBe(500);
    expect((await invoke("/api/analytics/:provider")).code).toBe(500);
  });
  it("uses the same per-field contract for summary and provider history", async () => {
    const { body } = await invoke("/api/analytics/:provider");
    expect(body.current.metrics).toEqual(normalizeAnalytics(snapshot()).metrics);
    expect(body.current.availability).toEqual((await invoke()).body.linkedin.availability);
  });
});