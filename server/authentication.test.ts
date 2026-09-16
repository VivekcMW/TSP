import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { toNodeHandler } from "better-auth/node";
import { configureProxy, CLIENT_IP_HEADER } from "./lib/proxy";

const { evalRedis, fakeRedis } = vi.hoisted(() => {
  const evalRedis = vi.fn();
  return { evalRedis, fakeRedis: { eval: evalRedis } };
});
vi.mock("./db", async () => ({ pool: (await import("better-auth/adapters/memory")).memoryAdapter({}) }));
vi.mock("./lib/redis", () => ({ redis: fakeRedis }));
vi.mock("./services/email", () => ({ sendPasswordResetEmail: vi.fn(), sendVerificationEmail: vi.fn() }));

beforeEach(() => { evalRedis.mockReset().mockResolvedValue([1, 0]); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

async function authApp(peer = "198.51.100.20", proxies = "") {
  const { auth } = await import("./authentication");
  const instance = betterAuth({ ...auth.options, database: memoryAdapter({}), socialProviders: {}, logger: { disabled: true } });
  const app = express();
  app.use((req, _res, next) => {
    Object.defineProperty(req.socket, "remoteAddress", { configurable: true, value: peer });
    next();
  });
  configureProxy(app, proxies);
  const handler = toNodeHandler(instance);
  app.all("/api/auth/*", (req, res, next) => { void handler(req, res).catch(next); });
  return { app, options: auth.options };
}

describe("Better Auth safeguards", () => {
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