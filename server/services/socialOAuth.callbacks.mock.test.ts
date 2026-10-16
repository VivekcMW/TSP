import crypto from "node:crypto";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({ session: vi.fn(), tenant: vi.fn(), user: vi.fn(), createState: vi.fn(), consume: vi.fn(),
  get: vi.fn(), create: vi.fn(), update: vi.fn(), analytics: vi.fn(), exchange: vi.fn() }));
vi.mock("../authentication", () => ({ auth: { api: { getSession: f.session } } }));
vi.mock("./tenancy", () => ({ resolveTenantContext: f.tenant }));
vi.mock("../middlewares/devAuth", () => ({ devAuthEnabled: false }));
vi.mock("../db", () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: f.user }) }) }) } }));
vi.mock("../storage", () => ({ storage: { getUser: async () => (await f.user())[0], createSocialOAuthState: f.createState,
  consumeSocialOAuthState: f.consume, getSocialAccountByProvider: f.get, createSocialAccount: f.create,
  updateSocialAccount: f.update, createSocialAnalytics: f.analytics } }));
vi.mock("passport", () => ({ default: { initialize: () => (_req: any, _res: any, next: any) => next(), use: vi.fn(),
  authenticate: () => (req: any, _res: any, next: any) => {
    f.exchange(); req.user = { accessToken: "fake-linkedin-token", profile: { id: "member" } }; next();
  } } }));
vi.mock("passport-oauth2", () => ({ Strategy: class { name = ""; } }));
import { requireDbUser } from "../middlewares/requireDbUser";
import { registerTwitterAuth } from "./twitterAuth";
import { registerRedditAuth } from "./redditAuth";
import { registerLinkedInAnalyticsAuth } from "./linkedinAnalyticsAuth";

const key = "fake-oauth-signing-key-at-least-32-characters";
const scope = { tenantId: "tenant-A", userId: "user-A" };
const tenant = { ...scope, role: "owner", platformRole: null, viaPlatformRole: false };
const session = (userId = "user-A", id = "stable-session-A") => ({ user: { id: userId }, session: { id, userId, expiresAt: new Date(Date.now() + 3_600_000), token: "fake-session-token-never-store" } });
let app: express.Express;
let states: Map<string, any>;
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("OAUTH_STATE_SECRET", key);
  vi.stubEnv("WEBHOOK_ENCRYPTION_SECRET", "fake-oauth-encryption-key-at-least-32-characters");
  vi.stubEnv("WEBHOOK_ENCRYPTION_PREVIOUS_SECRETS", "[]");
  vi.stubEnv("APP_URL", "https://fixture.invalid");
  for (const provider of ["TWITTER", "REDDIT", "LINKEDIN"]) {
    vi.stubEnv(`${provider}_CLIENT_ID`, "fake-client"); vi.stubEnv(`${provider}_CLIENT_SECRET`, "fake-secret");
  }
  vi.spyOn(console, "log").mockImplementation(() => {}); vi.spyOn(console, "error").mockImplementation(() => {});
  f.session.mockResolvedValue(session()); f.user.mockResolvedValue([{ id: "user-A", emailVerified: true }]);
  f.tenant.mockResolvedValue(tenant); f.create.mockResolvedValue({ id: "account" });
  states = new Map();
  f.createState.mockImplementation(async (owner, data) => { states.set(data.stateDigest, { ...data, ...owner }); });
  f.consume.mockImplementation(async (owner, data) => {
    const row = states.get(data.stateDigest);
    if (!row || row.tenantId !== owner.tenantId || row.userId !== owner.userId || row.provider !== data.provider ||
      row.sessionBinding !== data.sessionBinding || row.expiresAt.getTime() <= Date.now()) return false;
    return states.delete(data.stateDigest);
  });
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => {
    if (url.includes("token")) return new Response(JSON.stringify({ access_token: "fake-provider-token", refresh_token: "fake-provider-refresh" }));
    if (url.includes("users/me")) return new Response(JSON.stringify({ data: { id: "member", username: "name" } }));
    if (url.includes("/api/v1/me")) return new Response(JSON.stringify({ id: "member", name: "name" }));
    throw new Error("Unexpected provider request");
  }));
  app = express();
  registerTwitterAuth(app, requireDbUser); registerRedditAuth(app, requireDbUser); registerLinkedInAnalyticsAuth(app, requireDbUser);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const flows = [
  { provider: "twitter", start: "/auth/twitter/connect", callback: "/auth/twitter/connect/callback" },
  { provider: "reddit", start: "/auth/reddit?subreddit=testing", callback: "/auth/reddit/callback" },
  { provider: "linkedin", start: "/auth/linkedin/analytics", callback: "/auth/linkedin/analytics/callback" },
];
function resign(payload: any) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return body + "." + crypto.createHmac("sha256", key).update(`social-oauth-state-v1:${body}`).digest("hex");
}
describe.each(flows)("$provider actual callback session binding", flow => {
  async function start() {
    const response = await request(app).get(flow.start).set("Cookie", "fixture-cookie");
    expect(response.status).toBe(302);
    return new URL(response.headers.location).searchParams.get("state")!;
  }
  function callback(state: string) { return request(app).get(flow.callback).query({ state, code: "fake-code" }); }
  function noExchange() { expect(fetch).not.toHaveBeenCalled(); expect(f.exchange).not.toHaveBeenCalled(); expect(f.get).not.toHaveBeenCalled(); expect(f.create).not.toHaveBeenCalled(); }

  it("uses Better Auth's headers/session API and stores no raw session/token/state", async () => {
    const state = await start();
    const payload = JSON.parse(Buffer.from(state.split(".")[0], "base64url").toString());
    const data = f.createState.mock.calls[0][1];
    expect(data.stateDigest).toBe(crypto.createHash("sha256").update(state).digest("hex"));
    expect(data.sessionBinding).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(data)).not.toMatch(/stable-session-A|fake-session-token|fake-provider-token/);
    expect(JSON.stringify(payload)).not.toContain("stable-session-A"); expect(payload).not.toHaveProperty("sessionBinding");
    expect(data).not.toHaveProperty("codeVerifier"); expect(data).not.toHaveProperty("nonce");
    expect(f.session.mock.calls.some(([arg]) => arg.headers.get("cookie") === "fixture-cookie")).toBe(true);
    const response = await callback(state);
    expect(response.headers.location).toContain(`connected=${flow.provider}`);
    expect(f.session).toHaveBeenLastCalledWith(expect.objectContaining({ query: { disableCookieCache: true } }));
    expect(f.tenant).toHaveBeenLastCalledWith("user-A", "tenant-A");
    expect(f.create).toHaveBeenCalledWith(scope, expect.objectContaining({ providerAccountId: "member", accessToken: expect.stringMatching(/^enc:v1:/) }));
  });
  it("binds the stable session ID, not the rotating bearer token", async () => {
    const state = await start();
    f.session.mockResolvedValue({ ...session(), session: { ...session().session, token: "fake-rotated-session-token" } });
    expect((await callback(state)).headers.location).toContain(`connected=${flow.provider}`);
  });
  it.each(["unverified-user", "malformed-expiry", "session-service-failure"])("fails closed for %s", async variant => {
    const state = await start();
    if (variant === "unverified-user") f.user.mockResolvedValue([{ id: "user-A", emailVerified: false }]);
    else if (variant === "malformed-expiry") f.session.mockResolvedValue({ ...session(), session: { ...session().session, expiresAt: "invalid" } });
    else f.session.mockRejectedValue(new Error("sensitive-session-error"));
    expect((await callback(state)).headers.location).toContain("restart_connection"); noExchange();
    expect(f.consume).not.toHaveBeenCalled();
  });
  it("issues independent single-use nonces for parallel tabs", async () => {
    const first = await start(); const second = await start();
    expect(first).not.toBe(second); expect(states.size).toBe(2);
    expect((await callback(first)).headers.location).toContain(`connected=${flow.provider}`);
    expect((await callback(second)).headers.location).toContain(`connected=${flow.provider}`);
  });
  it("fails initiation closed with an absent or short signing key", async () => {
    vi.stubEnv("OAUTH_STATE_SECRET", "short");
    expect((await request(app).get(flow.start)).headers.location).toContain("restart_connection");
    expect(f.createState).not.toHaveBeenCalled(); noExchange();
  });
  it.each(["anonymous", "other-user", "other-session", "expired-session", "missing-session-id"])("rejects %s before exchange; original session can still finish", async variant => {
    const state = await start();
    const changed = variant === "anonymous" ? null : variant === "other-user" ? session("user-B", "session-B") :
      variant === "other-session" ? session("user-A", "session-B") : variant === "missing-session-id" ? session("user-A", "") :
      { ...session(), session: { ...session().session, expiresAt: new Date(0) } };
    f.session.mockResolvedValue(changed);
    expect((await callback(state)).headers.location).toContain("restart_connection"); noExchange();
    expect(states.size).toBe(1);
    f.session.mockResolvedValue(session());
    expect((await callback(state)).headers.location).toContain(`connected=${flow.provider}`);
  });
  it.each(["removed", "other-tenant", "staff-only", "permission-denied"])("denies %s membership without consuming state", async variant => {
    const state = await start();
    f.tenant.mockResolvedValue(variant === "removed" ? null : { ...tenant,
      ...(variant === "other-tenant" ? { tenantId: "tenant-B" } : variant === "staff-only" ? { viaPlatformRole: true, platformRole: "platform_admin" } : { role: null }) });
    expect((await callback(state)).headers.location).toContain("restart_connection"); noExchange();
    expect(f.consume).not.toHaveBeenCalled(); expect(states.size).toBe(1);
  });
  it("denies an explicitly different tenant even if the same user is a member", async () => {
    const state = await start();
    expect((await callback(state).set("x-tenant-id", "tenant-B")).headers.location).toContain("restart_connection");
    noExchange(); expect(f.consume).not.toHaveBeenCalled();
  });
  it("rejects replay, including simultaneous callbacks", async () => {
    const state = await start();
    const responses = await Promise.all([callback(state), callback(state)]);
    expect(responses.filter(response => response.headers.location.includes(`connected=${flow.provider}`))).toHaveLength(1);
    expect(f.create).toHaveBeenCalledTimes(1); expect(states.size).toBe(0);
  });
  it("rejects expired state without spending the nonce", async () => {
    const state = await start();
    const now = Date.now(); vi.spyOn(Date, "now").mockReturnValue(now + 11 * 60_000);
    expect((await callback(state)).headers.location).toContain("restart_connection"); noExchange();
    expect(f.consume).not.toHaveBeenCalled();
  });
  it.each(["tampered", "trailing", "legacy", "wrong-provider", "malformed-signed"])("rejects %s state before exchange", async variant => {
    const state = await start();
    const payload = JSON.parse(Buffer.from(state.split(".")[0], "base64url").toString());
    const legacyBody = Buffer.from(JSON.stringify({ ...payload, v: undefined })).toString("base64url");
    const legacy = legacyBody + "." + crypto.createHmac("sha256", key).update(legacyBody).digest("base64url");
    const invalid = variant === "tampered" ? `X${state}` : variant === "trailing" ? `${state}.extra` :
      variant === "legacy" ? legacy : variant === "wrong-provider" ? resign({ ...payload, provider: flow.provider === "twitter" ? "linkedin" : "twitter" }) : resign({ ...payload, userId: 42 });
    expect((await callback(invalid)).headers.location).toContain("restart_connection"); noExchange();
    expect(f.consume).not.toHaveBeenCalled();
  });
  it("fails closed on unavailable nonce storage", async () => {
    const state = await start(); f.consume.mockRejectedValue(new Error("sensitive-database-error"));
    expect((await callback(state)).headers.location).toContain("restart_connection"); noExchange();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("sensitive-database-error");
  });
  it("does not redirect to the provider when durable state cannot be created", async () => {
    f.createState.mockRejectedValue(new Error("sensitive-database-error"));
    expect((await request(app).get(flow.start)).headers.location).toContain("restart_connection"); noExchange();
  });
  it("requires actual authentication at initiation, not a fabricated request id", async () => {
    f.session.mockResolvedValue(null);
    expect((await request(app).get(flow.start).set("x-request-id", "user-A")).status).toBe(401);
    expect(f.createState).not.toHaveBeenCalled(); noExchange();
  });
  it("rejects missing code and provider errors without consuming state", async () => {
    const state = await start();
    await request(app).get(flow.callback).query({ state });
    await request(app).get(flow.callback).query({ state, code: "fake", error: "access_denied" });
    noExchange(); expect(f.consume).not.toHaveBeenCalled();
  });
  it("does not accept a signed but unregistered state", async () => {
    const state = await start(); states.clear();
    expect((await callback(state)).headers.location).toContain("restart_connection"); noExchange();
  });
});