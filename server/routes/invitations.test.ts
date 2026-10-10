import { createHash, createHmac } from "node:crypto";
import express, { type RequestHandler } from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { guardNotificationsMediaNetwork } from "../../test/notifications-media-network";
import { installSupertestTransport } from "../../test/supertest-transport";
import type { ReserveInvitationInput } from "../services/invitations-store";
import type { AppEmail } from "../services/email";

const m = vi.hoisted(() => ({
  auth: vi.fn<RequestHandler>(), requestLimit: vi.fn<RequestHandler>(), optOutLimit: vi.fn<RequestHandler>(),
  config: vi.fn(), send: vi.fn(), reserve: vi.fn(), suppress: vi.fn(),
}));
vi.mock("../middlewares/requireDbUser", () => ({ requireDbUser: m.auth }));
vi.mock("../middlewares/rateLimit", () => ({ invitationRequestRateLimit: m.requestLimit, invitationOptOutRateLimit: m.optOutLimit }));
vi.mock("../services/email", () => ({ getInvitationDeliveryConfiguration: m.config, sendAppEmail: m.send }));
vi.mock("../services/invitations-store", () => ({ reserveInvitation: m.reserve, suppressInvitation: m.suppress }));
// Tripwires: these tests must never initialize auth/DB/Redis/provider infrastructure or dotenv.
vi.mock("../db", () => { throw new Error("Database imports forbidden in invitation route tests"); });
vi.mock("pg", () => { throw new Error("Postgres forbidden in invitation route tests"); });
vi.mock("ioredis", () => { throw new Error("Redis forbidden in invitation route tests"); });
vi.mock("resend", () => { throw new Error("Provider forbidden in invitation route tests"); });
vi.mock("dotenv", () => { throw new Error("Environment file loads forbidden in invitation route tests"); });
vi.mock("dotenv/config", () => { throw new Error("Environment file loads forbidden in invitation route tests"); });
import { registerInvitationRoutes } from "./invitations";
import { invitationContent, invitationPreview } from "../services/invitation-content";

guardNotificationsMediaNetwork();
let restoreTransport: ReturnType<typeof installSupertestTransport>;
beforeAll(() => { restoreTransport = installSupertestTransport(); });
afterAll(async () => { await restoreTransport(); });

const origin = "https://app.test";
const config = { origin, invitationPreferencesUrl: `${origin}/invitation-preferences`, privacyUrl: `${origin}/privacy` };
const secret = "invitation-route-test-only-secret-at-least-32-characters";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const requestId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const valid = { email: "friend@example.test", firstName: "Friend", consent: true, requestId };
const accepted = { status: "accepted", message: "Invitation requested. If the address is eligible, we will send it." };
const unavailable = { message: "Invitations are temporarily unavailable. Please try again later." };
const invalid = { message: "Enter a valid email and first name, and confirm permission." };
const invalidToken = { message: "This link is invalid or has expired." };
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const sign = (purpose: string, value: string) => createHmac("sha256", secret).update(`${purpose}:${value}`).digest("hex");
const tokenFor = (userId = "verified-user", uuid = requestId) => sign("friend-invitation-optout-v1", JSON.stringify([userId, uuid]));
let user: { id: string; email: string; emailVerified: boolean; name: string | null; firstName: string | null };
let authenticated: boolean;
let app: express.Express;

beforeEach(() => {
  // Do not reset the network guard's spies along with the dependency mocks.
  for (const mock of Object.values(m)) mock.mockReset();
  vi.stubEnv("INVITATIONS_ENABLED", "true");
  vi.stubEnv("RESEND_API_KEY", "test-placeholder-not-real");
  vi.stubEnv("BETTER_AUTH_SECRET", secret);
  vi.stubEnv("DEV_AUTH_BYPASS", "false");
  vi.stubEnv("NODE_ENV", "production");
  // The route must get its origin from the delivery helper, not APP_URL or Host.
  vi.stubEnv("APP_URL", "https://not-the-configured-origin.test");
  authenticated = true;
  user = { id: "verified-user", email: "sender@example.test", emailVerified: true, name: " Database Person ", firstName: "Fallback" };
  m.auth.mockImplementation((req, res, next) => {
    if (!authenticated) { res.status(401).json({ message: "Unauthorized" }); return; }
    // A real-account-shaped fixture, not dev auth. Leave verification to the route
    // to exercise its defense-in-depth check even if upstream auth changes.
    req.dbUser = user as NonNullable<typeof req.dbUser>;
    next();
  });
  m.requestLimit.mockImplementation((_req, _res, next) => next());
  m.optOutLimit.mockImplementation((_req, _res, next) => next());
  m.config.mockReturnValue(config);
  m.reserve.mockResolvedValue({ kind: "reserved", id });
  m.send.mockResolvedValue({ queued: true });
  m.suppress.mockResolvedValue(true);
  app = express();
  app.use(express.json());
  registerInvitationRoutes(app);
});
afterEach(() => { vi.unstubAllEnvs(); });

function post(body: object = valid, from: string | null = origin) {
  const call = request(app).post("/api/invitations");
  if (from !== null) call.set("Origin", from);
  return call.send(body);
}
function noEffects() {
  expect(m.reserve).not.toHaveBeenCalled();
  expect(m.send).not.toHaveBeenCalled();
  expect(m.suppress).not.toHaveBeenCalled();
}
function responseIs(response: request.Response, status: number, body: object) {
  expect(response.status).toBe(status);
  expect(response.headers["cache-control"]).toBe("no-store");
  expect(response.body).toEqual(body);
}
const reservation = (index = 0) => m.reserve.mock.calls[index][0] as ReserveInvitationInput;
const email = (index = 0) => m.send.mock.calls[index][0] as AppEmail;

describe("invitation authorization and configuration", () => {
  it.each(["template", "send"])("requires authentication for %s (401)", async endpoint => {
    authenticated = false;
    const response = endpoint === "template" ? await request(app).get("/api/invitations/template") : await post();
    responseIs(response, 401, { message: "Unauthorized" });
    expect(m.auth).toHaveBeenCalledTimes(1);
    expect(m.requestLimit).not.toHaveBeenCalled();
    noEffects();
  });

  it.each(["unverified", "bypass"])("rejects production %s accounts (403)", async reason => {
    if (reason === "unverified") user.emailVerified = false;
    else vi.stubEnv("DEV_AUTH_BYPASS", "true");
    responseIs(await post(), 403, { message: "Sign in with a verified email before inviting friends." });
    noEffects();
  });

  it("uses an explicit false feature flag as an emergency kill switch", async () => {
    vi.stubEnv("INVITATIONS_ENABLED", "false");
    responseIs(await post(), 503, unavailable);
    noEffects();
  });

  it.each([undefined, "", "true"])("is available by default for feature flag %j", async flag => {
    vi.stubEnv("INVITATIONS_ENABLED", flag);
    responseIs(await post(), 202, accepted);
    expect(m.reserve).toHaveBeenCalledTimes(1);
    expect(m.send).toHaveBeenCalledTimes(1);
  });

  it.each(["localhost", "127.0.0.1", "[::1]"])("allows direct development bypass with loopback origin %s", async hostname => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEV_AUTH_BYPASS", "true");
    user.emailVerified = false;
    const localOrigin = `http://${hostname}:4301`;
    const local = { origin: localOrigin, invitationPreferencesUrl: `${localOrigin}/invitation-preferences`, privacyUrl: `${localOrigin}/privacy` };
    m.config.mockReturnValue(local);
    responseIs(await post(valid, local.origin), 202, accepted);
    expect(m.reserve).toHaveBeenCalledTimes(1);
    expect(m.send).toHaveBeenCalledTimes(1);
  });

  it.each(["production", "test", "remote-origin", "remote-peer", "forwarded", "x-forwarded-for", "unverified-real-user"])("rejects a local exception for %s", async reason => {
    vi.stubEnv("NODE_ENV", reason === "production" || reason === "test" ? reason : "development");
    vi.stubEnv("DEV_AUTH_BYPASS", reason === "unverified-real-user" ? "false" : "true");
    user.emailVerified = false;
    const localOrigin = reason === "remote-origin" ? origin : "http://localhost:4301";
    m.config.mockReturnValue({ origin: localOrigin, invitationPreferencesUrl: `${localOrigin}/invitation-preferences`, privacyUrl: `${localOrigin}/privacy` });
    if (reason === "remote-peer") {
      m.auth.mockImplementationOnce((req, _res, next) => {
        req.dbUser = user as NonNullable<typeof req.dbUser>;
        Object.defineProperty(req.socket, "remoteAddress", { value: "192.0.2.10", configurable: true });
        next();
      });
    }
    const call = post(valid, localOrigin);
    if (reason === "forwarded") call.set("Forwarded", "for=127.0.0.1");
    if (reason === "x-forwarded-for") call.set("X-Forwarded-For", "127.0.0.1");
    responseIs(await call, 403, { message: "Sign in with a verified email before inviting friends." });
    noEffects();
  });

  it.each(["missing-key", "blank-key", "missing-secret", "short-secret", "invalid-config"])("fails closed for %s", async reason => {
    if (reason === "missing-key") vi.stubEnv("RESEND_API_KEY", undefined);
    if (reason === "blank-key") vi.stubEnv("RESEND_API_KEY", "   ");
    if (reason === "missing-secret") vi.stubEnv("BETTER_AUTH_SECRET", undefined);
    if (reason === "short-secret") vi.stubEnv("BETTER_AUTH_SECRET", "x".repeat(31));
    if (reason === "invalid-config") m.config.mockReturnValue(undefined);
    responseIs(await post(), 503, unavailable);
    noEffects();
  });

  it.each([null, "null", "https://other.test", "http://app.test", "https://app.test:8443", "https://app.test.evil.test", "https://app.test/"])("rejects missing/nonmatching Origin %j", async from => {
    responseIs(await post(valid, from), 403, { message: "Open Settings in this app to send an invitation." });
    noEffects();
  });

  it.each([true, false])("returns the shared preview with enabled=%s and no side effects", async enabled => {
    vi.stubEnv("INVITATIONS_ENABLED", String(enabled));
    responseIs(await request(app).get("/api/invitations/template"), 200, { ...invitationPreview, enabled });
    expect(m.auth).toHaveBeenCalledTimes(1);
    expect(m.requestLimit).not.toHaveBeenCalled();
    noEffects();
  });
});

describe("strict invitation input", () => {
  it.each([
    { email: undefined }, { email: "invalid" }, { email: [valid.email] }, { email: "a".repeat(243) + "@example.test" },
    { email: "friend@example.test\r\nBcc: other@example.test" }, { email: "friend\u0000@example.test" },
    { firstName: null }, { firstName: 42 }, { firstName: "a".repeat(81) },
    { firstName: "Friend\r\nBcc: other@example.test" }, { firstName: "a\u0000b" }, { firstName: "a\tb" }, { firstName: "a\u007fb" },
    { consent: undefined }, { consent: false }, { consent: "true" },
    { requestId: undefined }, { requestId: "not-a-uuid" }, { requestId: 42 },
    { userId: "attacker" }, { inviterName: "Spoofed Sender" }, { subject: "Injected subject" },
    { html: "<p>Injected body</p>" }, { token: "forged" }, { ipHash: "forged" },
    { invitationUnsubscribeUrl: "https://other.test" },
  ])("rejects malformed/extra/header-injection fields %# before side effects", async change => {
    responseIs(await post({ ...valid, ...change }), 400, invalid);
    noEffects();
  });

  it.each([{ body: {} }, { body: [] }])("rejects a nonconforming top-level body %j", async ({ body }) => {
    responseIs(await post(body), 400, invalid);
    noEffects();
  });

  it("normalizes the recipient, name and UUID and derives identity and URLs on the server", async () => {
    const response = await post({ ...valid, email: "  FRIEND@Example.Test  ", firstName: " Friend ", requestId: requestId.toUpperCase() })
      .set("Host", "spoofed.test").set("X-User-Id", "attacker").set("X-Inviter-Name", "Spoofed").set("X-Forwarded-For", "203.0.113.9");
    responseIs(response, 202, accepted);
    expect(m.config).toHaveBeenCalled();
    expect(m.reserve).toHaveBeenCalledExactlyOnceWith({
      userId: user.id, email: valid.email, firstName: "Friend", inviterName: "Database Person", requestId,
      ipHash: sign("friend-invitation-ip-v1", "127.0.0.1"), tokenHash: sha(tokenFor()),
    });
    expect(m.send).toHaveBeenCalledExactlyOnceWith({
      type: "friend_invitation", invitationId: id, recipient: valid.email, recipientName: "Friend",
      dedupeKey: `friend-invitation:${id}`, invitationUnsubscribeUrl: `${config.invitationPreferencesUrl}#token=${tokenFor()}`,
      ...invitationContent("Database Person", `${origin}/sign-up`),
    });
    expect(email()).not.toHaveProperty("userId");
  });

  it.each([
    { name: null, firstName: " First ", expected: "First" },
    { name: "  ", firstName: null, expected: "Your friend" },
    { name: "\r\nSender\u0000\tName\u007f\n", firstName: "Ignored", expected: "Sender  Name " },
    { name: "A".repeat(201), firstName: null, expected: "A".repeat(200) },
  ])("sanitizes/falls back to server profile name %#", async ({ name, firstName, expected }) => {
    Object.assign(user, { name, firstName });
    responseIs(await post(), 202, accepted);
    expect(reservation().inviterName).toBe(expected);
    expect(email().text).toContain(`${expected} invited you`);
    expect(email().subject).toBe(invitationPreview.subject);
    expect(email().subject).not.toMatch(/[\r\n]/);
  });

  it.each([undefined, "", "   "])("accepts absent/blank optional recipient name %j", async firstName => {
    responseIs(await post({ ...valid, firstName }), 202, accepted);
    expect(email().recipientName).toBeUndefined();
  });
});

describe("reservation, dedupe and privacy", () => {
  it("uses stable 64-hex HMAC tokens, hashed IP and identical dedupe/opt-out links on reserved and duplicate retries", async () => {
    m.reserve.mockResolvedValueOnce({ kind: "reserved", id }).mockResolvedValueOnce({ kind: "duplicate", id });
    responseIs(await post(), 202, accepted);
    responseIs(await post(), 202, accepted);
    expect(m.reserve).toHaveBeenCalledTimes(2);
    expect(m.send).toHaveBeenCalledTimes(2);
    expect(reservation(1)).toEqual(reservation());
    expect(email(1)).toEqual(email());
    const url = new URL(email().invitationUnsubscribeUrl!);
    const token = new URLSearchParams(url.hash.slice(1)).get("token")!;
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(token).toBe(tokenFor());
    expect(url.origin).toBe(origin);
    expect(url.pathname).toBe("/invitation-preferences");
    expect(url.search).toBe("");
    expect(reservation().tokenHash).toBe(sha(token));
    expect(reservation().ipHash).toBe(sign("friend-invitation-ip-v1", "127.0.0.1"));
    expect(reservation().ipHash).toMatch(/^[a-f0-9]{64}$/);
    expect(reservation().ipHash).not.toBe(sha("127.0.0.1"));
    expect(JSON.stringify(m.reserve.mock.calls)).not.toContain(token);
    expect(JSON.stringify(m.reserve.mock.calls)).not.toContain("127.0.0.1");
    expect(Object.keys(reservation()).sort()).toEqual(["email", "firstName", "inviterName", "ipHash", "requestId", "tokenHash", "userId"]);
    expect(email().dedupeKey).toBe(`friend-invitation:${id}`);
  });

  it("binds the opt-out token to both authenticated user and request UUID", async () => {
    await post();
    user.id = "another-verified-user";
    await post();
    const anotherId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    await post({ ...valid, requestId: anotherId });
    expect(reservation(1).tokenHash).toBe(sha(tokenFor(user.id)));
    expect(reservation(2).tokenHash).toBe(sha(tokenFor(user.id, anotherId)));
    expect(new Set([0, 1, 2].map(index => reservation(index).tokenHash)).size).toBe(3);
  });

  it("hashes the trusted client IPv6 subnet separately from the retry token", async () => {
    app.set("trust proxy", "loopback");
    for (const ip of ["2001:db8:abcd:1200::1", "2001:db8:abcd:12ff::2", "2001:db8:abcd:1300::1"]) {
      responseIs(await post().set("X-Forwarded-For", ip), 202, accepted);
    }
    expect(reservation().ipHash).toBe(sign("friend-invitation-ip-v1", "2001:db8:abcd:1200::/56"));
    expect(reservation(1).ipHash).toBe(reservation().ipHash);
    expect(reservation(2).ipHash).not.toBe(reservation().ipHash);
    expect(reservation(2).tokenHash).toBe(reservation().tokenHash);
    expect(JSON.stringify(m.reserve.mock.calls)).not.toContain("2001:db8");
  });

  it("suppresses eligible-policy rejections with the same generic 202 and no mail", async () => {
    m.reserve.mockResolvedValue({ kind: "suppressed" });
    responseIs(await post(), 202, accepted);
    expect(m.reserve).toHaveBeenCalledTimes(1);
    expect(m.send).not.toHaveBeenCalled();
    expect(m.suppress).not.toHaveBeenCalled();
  });

  it.each([{ queued: true }, { messageId: "private-provider-id" }, { skipped: true }])("does not disclose delivery outcome %j", async outcome => {
    m.send.mockResolvedValue(outcome);
    responseIs(await post(), 202, accepted);
  });

  it("returns 429 and Retry-After for a limited reservation without mail", async () => {
    m.reserve.mockResolvedValue({ kind: "limited" });
    const response = await post();
    responseIs(response, 429, { message: "Invitation limit reached. Please try again tomorrow." });
    expect(response.headers["retry-after"]).toBe("86400");
    expect(m.send).not.toHaveBeenCalled();
  });

  it("returns 409 for conflicting reuse without mail", async () => {
    m.reserve.mockResolvedValue({ kind: "conflict" });
    responseIs(await post(), 409, { message: "This request was already used with different details. Refresh Settings and try again." });
    expect(m.send).not.toHaveBeenCalled();
  });

  it.each(["store", "mail"])("returns generic 503 for %s failures without leaking details", async failure => {
    const error = new Error(`private provider/database failure ${valid.email} ${secret} ${tokenFor()}`);
    (failure === "store" ? m.reserve : m.send).mockRejectedValue(error);
    responseIs(await post(), 503, unavailable);
    expect(m.reserve).toHaveBeenCalledTimes(1);
    expect(m.send).toHaveBeenCalledTimes(failure === "store" ? 0 : 1);
  });

  it("honors the mocked request rate limiter before reservation", async () => {
    m.requestLimit.mockImplementation((_req, res) => { res.status(429).json({ message: "Fixture rate limit" }); });
    responseIs(await post(), 429, { message: "Fixture rate limit" });
    expect(m.auth).toHaveBeenCalledTimes(1);
    noEffects();
  });
});

describe("public invitation opt-out", () => {
  const endpoint = "/api/public/invitations/unsubscribe";
  const token = "ab".repeat(32);

  it("works repeatedly without auth, Origin, delivery configuration or an enabled flag, passing only the token hash", async () => {
    authenticated = false;
    vi.stubEnv("INVITATIONS_ENABLED", "false");
    vi.stubEnv("RESEND_API_KEY", undefined);
    vi.stubEnv("BETTER_AUTH_SECRET", undefined);
    m.config.mockReturnValue(undefined);
    for (let attempt = 0; attempt < 2; attempt++) {
      responseIs(await request(app).post(endpoint).send({ token }), 200, { status: "unsubscribed" });
    }
    expect(m.suppress.mock.calls).toEqual([[sha(token)], [sha(token)]]);
    expect(JSON.stringify(m.suppress.mock.calls)).not.toContain(token);
    expect(m.auth).not.toHaveBeenCalled();
    expect(m.config).not.toHaveBeenCalled();
    expect(m.requestLimit).not.toHaveBeenCalled();
    expect(m.optOutLimit).toHaveBeenCalledTimes(2);
    expect(m.reserve).not.toHaveBeenCalled();
    expect(m.send).not.toHaveBeenCalled();
  });

  it.each([
    {}, { token: "" }, { token: "a".repeat(63) }, { token: "a".repeat(65) }, { token: "g".repeat(64) },
    { token: "AB".repeat(32) }, { token: ` ${token}` }, { token: `${token}\n` }, { token: 42 },
    { token: [token] }, { token, email: valid.email }, { token, userId: "spoofed" },
  ])("rejects malformed/extra token body %# before storage", async body => {
    responseIs(await request(app).post(endpoint).send(body), 400, invalidToken);
    noEffects();
  });

  it("uses the same invalid-link response for unknown/expired tokens", async () => {
    m.suppress.mockResolvedValue(false);
    responseIs(await request(app).post(endpoint).send({ token }), 400, invalidToken);
    expect(m.suppress).toHaveBeenCalledExactlyOnceWith(sha(token));
  });

  it("returns generic 503 on storage failure without echoing the token or recipient", async () => {
    m.suppress.mockRejectedValue(new Error(`private ${token} ${valid.email}`));
    responseIs(await request(app).post(endpoint).send({ token }), 503, { message: "We could not save your preference. Please try again." });
  });

  it("honors its own mocked rate limiter without requiring auth", async () => {
    authenticated = false;
    m.optOutLimit.mockImplementation((_req, res) => { res.status(429).json({ message: "Fixture opt-out limit" }); });
    responseIs(await request(app).post(endpoint).send({ token }), 429, { message: "Fixture opt-out limit" });
    expect(m.auth).not.toHaveBeenCalled();
    noEffects();
  });

  it("never opts out on a scanner GET or a query-string-only POST", async () => {
    expect((await request(app).get(endpoint).query({ token })).status).toBe(404);
    responseIs(await request(app).post(endpoint).query({ token }).send({}), 400, invalidToken);
    noEffects();
  });
});