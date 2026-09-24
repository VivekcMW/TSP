import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { toNodeHandler } from "better-auth/node";
import { configureProxy, CLIENT_IP_HEADER } from "./lib/proxy";
import { sendExistingAccountEmail, sendPasswordChangedEmail, sendPasswordResetEmail, sendVerificationEmail } from "./services/email";

const { evalRedis, setRedis, fakeRedis } = vi.hoisted(() => {
  const evalRedis = vi.fn(), setRedis = vi.fn();
  return { evalRedis, setRedis, fakeRedis: { eval: evalRedis, set: setRedis } };
});
vi.mock("./db", async () => ({ pool: (await import("better-auth/adapters/memory")).memoryAdapter({}) }));
vi.mock("./lib/redis", () => ({ redis: fakeRedis }));
vi.mock("./services/email", () => ({ sendPasswordResetEmail: vi.fn(), sendVerificationEmail: vi.fn(), sendExistingAccountEmail: vi.fn(), sendPasswordChangedEmail: vi.fn() }));

beforeEach(() => {
  evalRedis.mockReset().mockResolvedValue([1, 0]);
  setRedis.mockReset().mockResolvedValue("OK");
  vi.mocked(sendExistingAccountEmail).mockReset();
  vi.mocked(sendPasswordResetEmail).mockReset();
  vi.mocked(sendVerificationEmail).mockReset();
  vi.mocked(sendPasswordChangedEmail).mockReset();
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

async function authApp(peer = "198.51.100.20", proxies = "") {
  const { auth } = await import("./authentication");
  const instance = betterAuth({
    ...auth.options,
    baseURL: "http://localhost:4300",
    trustedOrigins: ["http://localhost:4300"],
    // Better Auth skips origin checks by default in NODE_ENV=test. Exercise
    // production-like checks here, with isolated in-memory tables only.
    advanced: { ...auth.options.advanced, disableOriginCheck: false, disableCSRFCheck: false },
    database: memoryAdapter({ users: [], accounts: [], sessions: [], verifications: [] }),
    socialProviders: {},
    logger: { disabled: true },
  });
  const app = express();
  app.use((req, _res, next) => {
    Object.defineProperty(req.socket, "remoteAddress", { configurable: true, value: peer });
    next();
  });
  configureProxy(app, proxies);
  const handler = toNodeHandler(instance);
  app.all("/api/auth/*", (req, res, next) => { void handler(req, res).catch(next); });
  return { app, options: auth.options, instance };
}

describe("Better Auth safeguards", () => {
  it.each(["attacker@x.placeholder.invalid", "attacker@twitter.placeholder.invalid", "attacker@X.PLACEHOLDER.INVALID", "ordinary@example.com"])
    ("does not let email signup verify %s or issue a session", async (email) => {
      const { app, instance } = await authApp();
      const credentials = { email, password: "auth-regression-password" };
      const signedUp = await request(app).post("/api/auth/sign-up/email")
        .set("Origin", "http://localhost:4300")
        .send({ ...credentials, name: "Auth regression", emailVerified: true, provider: "twitter" });
      expect(signedUp.status).toBe(200);
      expect(signedUp.body.user.emailVerified).toBe(false);
      expect(signedUp.body.token).toBeNull();
      expect(signedUp.headers["set-cookie"]).toBeUndefined();
      const context = await instance.$context;
      const stored = await context.internalAdapter.findUserByEmail(email.toLowerCase());
      expect(stored?.user.emailVerified).toBe(false);
      expect(sendVerificationEmail).toHaveBeenCalledTimes(1);
      const signedIn = await request(app).post("/api/auth/sign-in/email")
        .set("Origin", "http://localhost:4300").send(credentials);
      expect(signedIn.status).toBe(403);
      expect(signedIn.body.code).toBe("EMAIL_NOT_VERIFIED");
      expect(signedIn.headers["set-cookie"]).toBeUndefined();
      expect((await request(app).get("/api/auth/get-session")).body).toBeNull();
    });

  describe("sign-up with an email that already has an account", () => {
    const origin = "http://localhost:4300";
    const owner = { email: "owner@example.com", password: "auth-regression-password", name: "Owner" };
    async function signUpTwice(verify: boolean) {
      const { app, instance } = await authApp();
      const fresh = await request(app).post("/api/auth/sign-up/email").set("Origin", origin).send(owner);
      const context = await instance.$context;
      const stored = (await context.internalAdapter.findUserByEmail(owner.email))!.user;
      if (verify) await context.internalAdapter.updateUser(stored.id, { emailVerified: true });
      vi.mocked(sendVerificationEmail).mockReset();
      const again = await request(app).post("/api/auth/sign-up/email").set("Origin", origin).send({ ...owner, password: "a-different-password-123" });
      return { app, context, stored, fresh, again };
    }

    it("emails a verified owner a sign-in link and answers exactly like a new sign-up", async () => {
      const { fresh, again } = await signUpTwice(true);
      expect(again.status).toBe(fresh.status);
      expect(again.body.token).toBeNull();
      expect(Object.keys(again.body).sort()).toEqual(Object.keys(fresh.body).sort());
      expect(sendExistingAccountEmail).toHaveBeenCalledExactlyOnceWith(owner.email, owner.name, `${origin}/sign-in`);
      expect(sendVerificationEmail).not.toHaveBeenCalled();
    });

    it("sends an unverified owner a verification link that works", async () => {
      const { app, context, stored } = await signUpTwice(false);
      expect(sendExistingAccountEmail).not.toHaveBeenCalled();
      expect(sendVerificationEmail).toHaveBeenCalledTimes(1);
      const [email, name, url] = vi.mocked(sendVerificationEmail).mock.calls[0];
      expect([email, name]).toEqual([owner.email, owner.name]);
      const link = new URL(url);
      expect(link.origin + link.pathname).toBe(`${origin}/api/auth/verify-email`);
      expect(link.searchParams.get("callbackURL")).toBe(`${origin}/complete-registration`);
      await request(app).get(link.pathname + link.search);
      expect((await context.internalAdapter.findUserById(stored.id))?.emailVerified).toBe(true);
    });

    it("still answers like a new sign-up when the notice cannot be sent", async () => {
      vi.mocked(sendExistingAccountEmail).mockRejectedValue(new Error("PRIVATE email outage"));
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { fresh, again } = await signUpTwice(true);
      expect(again.status).toBe(fresh.status);
      expect(Object.keys(again.body).sort()).toEqual(Object.keys(fresh.body).sort());
      expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(owner.email);
    });

    it("sends at most one such email per account per hour", async () => {
      setRedis.mockResolvedValueOnce("OK").mockResolvedValueOnce(null);
      const { app, stored } = await signUpTwice(true);
      await request(app).post("/api/auth/sign-up/email").set("Origin", origin).send(owner);
      expect(sendExistingAccountEmail).toHaveBeenCalledTimes(1);
      expect(setRedis).toHaveBeenCalledWith(expect.stringContaining(stored.id), "1", "EX", 3600, "NX");
    });
  });

  it("resets through real HTTP endpoints once, without verifying an unverified email", async () => {
    const { app, instance } = await authApp();
    const email = "reset@example.com";
    await request(app).post("/api/auth/sign-up/email")
      .send({ email, name: "Reset regression", password: "original-password" }).expect(200);
    await request(app).post("/api/auth/request-password-reset")
      .send({ email, redirectTo: "http://localhost:4300/reset-password" }).expect(200);
    expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    const link = new URL(vi.mocked(sendPasswordResetEmail).mock.calls[0][2]);
    const callback = await request(app).get(link.pathname + link.search).expect(302);
    const destination = new URL(callback.headers.location);
    expect(destination.origin + destination.pathname).toBe("http://localhost:4300/reset-password");
    const token = destination.searchParams.get("token");
    expect(token).toBeTruthy();
    const body = { token, newPassword: "replacement-password" };
    await request(app).post("/api/auth/reset-password").send({ ...body, newPassword: "short" }).expect(400);
    expect(sendPasswordChangedEmail).not.toHaveBeenCalled();
    const reset = await request(app).post("/api/auth/reset-password").send(body).expect(200);
    // The owner is told their password changed, once.
    expect(sendPasswordChangedEmail).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendPasswordChangedEmail).mock.calls[0].slice(0, 2)).toEqual([email, "Reset regression"]);
    expect(reset.body.status).toBe(true);
    expect(reset.headers["set-cookie"]).toBeUndefined();
    const repeated = await request(app).post("/api/auth/reset-password").send(body).expect(400);
    expect(repeated.body.code).toBe("INVALID_TOKEN");
    const context = await instance.$context;
    const stored = await context.internalAdapter.findUserByEmail(email);
    expect(stored?.user.emailVerified).toBe(false);
    const account = await context.internalAdapter.findCredentialAccount(stored!.user.id);
    expect(await context.password.verify({ hash: account!.password!, password: body.newPassword })).toBe(true);
    expect(await context.password.verify({ hash: account!.password!, password: "original-password" })).toBe(false);
  });

  it("completes a reset even when the password-changed notice cannot be sent", async () => {
    vi.mocked(sendPasswordChangedEmail).mockRejectedValue(new Error("PRIVATE email outage"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { app } = await authApp();
    const email = "notice@example.com";
    await request(app).post("/api/auth/sign-up/email").send({ email, name: "Notice", password: "original-password" }).expect(200);
    await request(app).post("/api/auth/request-password-reset").send({ email, redirectTo: "http://localhost:4300/reset-password" }).expect(200);
    const link = new URL(vi.mocked(sendPasswordResetEmail).mock.calls.at(-1)![2]);
    const token = new URL((await request(app).get(link.pathname + link.search).expect(302)).headers.location).searchParams.get("token");
    const reset = await request(app).post("/api/auth/reset-password").send({ token, newPassword: "replacement-password" }).expect(200);
    expect(reset.body.status).toBe(true);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(email);
  });

  it("rejects expired reset tokens in callbacks and reset submissions", async () => {
    const { app, instance } = await authApp();
    const context = await instance.$context;
    const token = "expired-auth-regression-token";
    await context.internalAdapter.createVerificationValue({
      identifier: `reset-password:${token}`, value: "unused-user",
      expiresAt: new Date(Date.now() - 60_000),
    });
    const callback = await request(app).get(`/api/auth/reset-password/${token}`)
      .query({ callbackURL: "http://localhost:4300/reset-password" }).expect(302);
    const destination = new URL(callback.headers.location);
    expect(destination.searchParams.get("error")).toBe("INVALID_TOKEN");
    expect(destination.searchParams.has("token")).toBe(false);
    const reset = await request(app).post("/api/auth/reset-password")
      .send({ token, newPassword: "replacement-password" }).expect(400);
    expect(reset.body.code).toBe("INVALID_TOKEN");
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it.each(["https://untrusted.example/reset", "//untrusted.example/reset", "javascript:alert(1)"])
    ("rejects unsafe reset callbacks: %s", async (callbackURL) => {
      const { app } = await authApp();
      await request(app).post("/api/auth/request-password-reset")
        .send({ email: "reset@example.com", redirectTo: callbackURL }).expect(403);
      const callback = await request(app).get("/api/auth/reset-password/not-a-token")
        .query({ callbackURL }).expect(403);
      expect(callback.headers.location).toBeUndefined();
      expect(sendPasswordResetEmail).not.toHaveBeenCalled();
    });

  it("configures only the canonical IP header and rate-limit-only storage", async () => {
    const { options } = await authApp();
    expect(options.advanced?.ipAddress?.ipAddressHeaders).toEqual([CLIENT_IP_HEADER]);
    expect(options.advanced?.trustedProxyHeaders).toBe(false);
    expect(options).not.toHaveProperty("secondaryStorage");
    expect(options.session?.modelName).toBe("sessions");
    expect(options.rateLimit?.enabled).toBe(true);
    expect(options.rateLimit?.customStorage).toHaveProperty("consume");
  });
  it("keeps forged headers in the same real handler bucket, and separates real peers", async () => {
    const first = await authApp();
    for (const forged of ["1.1.1.1", "2.2.2.2"]) {
      expect((await request(first.app).get("/api/auth/ok").set(CLIENT_IP_HEADER, forged).set("X-Forwarded-For", forged)).status).toBe(200);
    }
    expect(evalRedis.mock.calls[0][2]).toBe(evalRedis.mock.calls[1][2]);
    const second = await authApp("198.51.100.21");
    await request(second.app).get("/api/auth/ok");
    expect(evalRedis.mock.calls[2][2]).not.toBe(evalRedis.mock.calls[0][2]);
  });
  it("uses the same client bucket on vetted short and long proxy routes", async () => {
    const direct = await authApp("198.51.100.20");
    const proxied = await authApp("192.0.2.10", "192.0.2.10,192.0.2.11");
    await request(direct.app).get("/api/auth/ok");
    await request(proxied.app).get("/api/auth/ok").set("X-Forwarded-For", "198.51.100.20,192.0.2.11");
    await request(proxied.app).get("/api/auth/ok").set("X-Forwarded-For", "6.6.6.6,198.51.100.20");
    expect(new Set(evalRedis.mock.calls.map((call) => call[2])).size).toBe(1);
  });
  it.each(["/sign-in/email", "/sign-up/email", "/request-password-reset", "/send-verification-email"])
    ("retains Better Auth's stricter built-in rule for %s", async (path) => {
      const { app } = await authApp();
      evalRedis.mockResolvedValue([0, 10]);
      expect((await request(app).post(`/api/auth${path}`).send({})).status).toBe(429);
      expect(evalRedis.mock.calls[0][3]).toBe(3);
      expect(evalRedis.mock.calls[0][4]).toBe(path.includes("password-reset") || path.includes("verification-email") ? 60_000 : 10_000);
    });
  it("denies Redis failures without memory fallback or secret leakage and recovers", async () => {
    const { app } = await authApp();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    evalRedis.mockRejectedValue(new Error("Redis connection failed: DO_NOT_LEAK"));
    const failed = await request(app).get("/api/auth/ok");
    expect(failed.status).toBe(429);
    expect(failed.headers["x-retry-after"]).toBe("5");
    expect(failed.text).not.toContain("DO_NOT_LEAK");
    expect(JSON.stringify(log.mock.calls)).not.toContain("DO_NOT_LEAK");
    evalRedis.mockResolvedValue([1, 0]);
    expect((await request(app).get("/api/auth/ok")).status).toBe(200);
  });
  it("rejects malformed Redis replies", async () => {
    const { app } = await authApp();
    vi.spyOn(console, "error").mockImplementation(() => {});
    evalRedis.mockResolvedValue(["unexpected"]);
    expect((await request(app).get("/api/auth/ok")).status).toBe(429);
  });
  it("requires a 32-character auth secret without echoing it", async () => {
    vi.resetModules();
    vi.stubEnv("BETTER_AUTH_SECRET", "short-secret");
    await expect(import("./authentication")).rejects.toThrow("at least 32 characters");
  });
  it("requires Redis in production but permits local memory storage", async () => {
    vi.resetModules();
    vi.doMock("./lib/redis", () => ({ redis: undefined }));
    try {
      vi.stubEnv("NODE_ENV", "production");
      await expect(import("./authentication")).rejects.toThrow("REDIS_URL is required");
      vi.resetModules();
      vi.stubEnv("NODE_ENV", "test");
      const { auth } = await import("./authentication");
      expect(auth.options.rateLimit?.customStorage).toBeUndefined();
      expect(auth.options.rateLimit?.storage).toBe("memory");
    } finally {
      vi.doMock("./lib/redis", () => ({ redis: fakeRedis }));
      vi.resetModules();
    }
  });
});