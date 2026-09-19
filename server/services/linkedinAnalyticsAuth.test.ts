import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Express, RequestHandler } from "express";

const fixture = vi.hoisted(() => ({ verify: null as any, getSession: vi.fn(), tenant: vi.fn(), getUser: vi.fn(), createSocialOAuthState: vi.fn(), consumeSocialOAuthState: vi.fn(), getSocialAccountByProvider: vi.fn(), updateSocialAccount: vi.fn(), createSocialAccount: vi.fn(), createSocialAnalytics: vi.fn() }));
vi.mock("../authentication", () => ({ auth: { api: { getSession: fixture.getSession } } }));
vi.mock("./tenancy", () => ({ resolveTenantContext: fixture.tenant }));
vi.mock("../storage", () => ({ storage: fixture }));
vi.mock("../db", () => { throw new Error("DB forbidden in mocked callback tests"); });
vi.mock("./webhookSecrets", () => ({ encryptWebhookUrl: (value: string) => `encrypted:${value}` }));
vi.mock("passport", () => ({ default: { initialize: () => (_req: any, _res: any, next: any) => next(), use: vi.fn(), authenticate: () => (_req: any, _res: any, next: any) => next() } }));
vi.mock("passport-oauth2", () => ({ Strategy: class { name = ""; constructor(_options: unknown, verify: unknown) { fixture.verify = verify; } } }));
import { registerLinkedInAnalyticsAuth } from "./linkedinAnalyticsAuth";

let routes: Map<string, RequestHandler[]>;
function response() {
  return { location: "", redirect(value: string) { this.location = value; return this; } };
}
async function start() {
  const res = response();
  const req: any = { headers: {}, dbUser: { id: "signed-user" }, tenant: { tenantId: "signed-tenant" } };
  await routes.get("/auth/linkedin/analytics")![1](req, res as any, () => {});
  return new URL(res.location).searchParams.get("state")!;
}
async function callback(state: string | undefined, user: unknown = { accessToken: "fixture-token", profile: { id: "member", displayName: "Member" } }) {
  const res = response();
  const req: any = { headers: {}, query: { state, code: "fixture-code" }, user };
  for (const handler of routes.get("/auth/linkedin/analytics/callback")!) {
    let next = false;
    await handler(req, res as any, (() => { next = true; }) as any);
    if (!next) break;
  }
  return res;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("LINKEDIN_CLIENT_ID", "fixture-client"); vi.stubEnv("LINKEDIN_CLIENT_SECRET", "fixture-secret");
  vi.stubEnv("OAUTH_STATE_SECRET", "fixture-only-signing-secret-not-a-real-credential");
  vi.stubEnv("APP_URL", "https://fixture.invalid");
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-19T12:00:00Z"));
  fixture.getSession.mockResolvedValue({ user: { id: "signed-user" }, session: { id: "fixture-session", userId: "signed-user", expiresAt: new Date("2026-09-20") } });
  fixture.getUser.mockResolvedValue({ id: "signed-user", emailVerified: true });
  fixture.tenant.mockResolvedValue({ tenantId: "signed-tenant", userId: "signed-user", role: "owner", platformRole: null, viaPlatformRole: false });
  const nonces = new Map<string, string>();
  fixture.createSocialOAuthState.mockImplementation(async (_scope, data) => { nonces.set(data.stateDigest, data.sessionBinding); });
  fixture.consumeSocialOAuthState.mockImplementation(async (_scope, data) => {
    if (nonces.get(data.stateDigest) !== data.sessionBinding) return false;
    return nonces.delete(data.stateDigest);
  });
  vi.spyOn(console, "log").mockImplementation(() => {}); vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn());
  fixture.createSocialAccount.mockResolvedValue({ id: "account" });
  routes = new Map();
  registerLinkedInAnalyticsAuth({ use: vi.fn(), get: (route: string, ...handlers: RequestHandler[]) => routes.set(route, handlers) } as unknown as Express, (_req, _res, next) => next());
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("actual LinkedIn analytics callback with mocked OAuth transport", () => {
  it("stores unsupported nulls only under the initiating authenticated session and tenant", async () => {
    expect((await callback(await start())).location).toBe("/dashboard/connections?connected=linkedin");
    expect(fixture.createSocialAnalytics).toHaveBeenCalledWith({ tenantId: "signed-tenant", userId: "signed-user" }, expect.objectContaining({ socialAccountId: "account", topPosts: null,
      metrics: expect.objectContaining({ followers: null, impressions: null, engagements: null, engagementRate: null }),
      metricAvailability: expect.objectContaining({ impressions: expect.objectContaining({ supported: false, measuredAt: null, reason: "unsupported" }) }) }));
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects the former cross-identity success case without consuming the nonce", async () => {
    const state = await start();
    fixture.getSession.mockResolvedValueOnce({ user: { id: "attacker-user" }, session: { id: "attacker-session", userId: "attacker-user", expiresAt: new Date("2026-09-20") } });
    expect((await callback(state)).location).toContain("state_mismatch");
    expect(fixture.consumeSocialOAuthState).not.toHaveBeenCalled();
    expect(fixture.getSocialAccountByProvider).not.toHaveBeenCalled();
    expect((await callback(state)).location).toContain("connected=linkedin");
    expect((await callback(state)).location).toContain("state_mismatch");
    expect(fixture.createSocialAccount).toHaveBeenCalledTimes(1);
  });
  it("writes the same profile-only availability on reconnect", async () => {
    fixture.getSocialAccountByProvider.mockResolvedValue({ id: "existing" });
    await callback(await start());
    expect(fixture.createSocialAccount).not.toHaveBeenCalled();
    expect(fixture.updateSocialAccount).toHaveBeenCalledWith({ tenantId: "signed-tenant", userId: "signed-user" }, "existing", expect.objectContaining({ providerAccountId: "member", isActive: true }));
    expect(fixture.createSocialAnalytics.mock.calls[0][1].socialAccountId).toBe("existing");
    expect(Object.values(fixture.createSocialAnalytics.mock.calls[0][1].metrics).every(value => value === null)).toBe(true);
  });
  it.each([undefined, "invalid.signature"])("refuses missing/invalid state %s", async state => {
    expect((await callback(state)).location).toContain("state_mismatch");
    expect(fixture.createSocialAnalytics).not.toHaveBeenCalled();
    expect(fixture.getSocialAccountByProvider).not.toHaveBeenCalled();
  });
  it("refuses expired state without writes", async () => {
    const state = await start();
    vi.advanceTimersByTime(11 * 60_000);
    expect((await callback(state)).location).toContain("state_mismatch");
    expect(fixture.getSocialAccountByProvider).not.toHaveBeenCalled();
  });
  it.each([{}, { accessToken: "fixture", profile: { id: 42 } }, { accessToken: "fixture", profile: { id: "" } }, { profile: { id: "member" } }])("rejects invalid callback identity %j", async user => {
    expect((await callback(await start(), user)).location).toContain("linkedin_connect_failed");
    expect(fixture.getSocialAccountByProvider).not.toHaveBeenCalled();
  });
  it.each([null, {}, { sub: 12 }, { sub: "member", name: 123 }])("validates the actual OAuth verification function response %j", async body => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(body)));
    const done = vi.fn();
    await fixture.verify("fixture-token", "", {}, {}, done);
    expect(done).toHaveBeenCalledWith(expect.any(Error));
    expect(fixture.createSocialAnalytics).not.toHaveBeenCalled();
  });
  it("accepts real-shaped identity only, not identity-endpoint follower metrics", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ sub: "member", name: "Member", followers: 100, engagements: 50 })));
    const done = vi.fn();
    await fixture.verify("fixture-token", "", {}, {}, done);
    expect(done.mock.calls[0][0]).toBeNull();
    const identity = done.mock.calls[0][1];
    expect(identity.profile).not.toHaveProperty("followers");
    await callback(await start(), identity);
    expect(fixture.createSocialAnalytics.mock.calls[0][1].metrics.followers).toBeNull();
  });
  it("does not claim connection success if the snapshot write fails", async () => {
    fixture.createSocialAnalytics.mockRejectedValue(new Error("fixture persistence failure"));
    expect((await callback(await start())).location).toContain("linkedin_connect_failed");
  });
});