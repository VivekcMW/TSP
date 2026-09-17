import express, { type ErrorRequestHandler } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Never import the configured Redis client, DB, jobs, or real providers.
const transport = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("../lib/redis", () => ({ redis: transport }));

let limiters: typeof import("./rateLimit");
let errorLog: ReturnType<typeof vi.spyOn>;
const policies = ["aiGenerationRateLimit", "instantReviewRateLimit", "inboxRefreshRateLimit"] as const;
const unavailableBody = { message: "Rate limiting is temporarily unavailable. Please try again shortly." };

beforeAll(async () => {
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  // With rate-limit-redis v6 this rejects SCRIPT LOAD during module init and
  // poisons the same instance forever, even after the transport recovers.
  transport.call.mockRejectedValue(new Error("initial script connection failure"));
  limiters = await import("./rateLimit");
});
afterAll(() => errorLog.mockRestore());
beforeEach(() => { transport.call.mockReset(); errorLog.mockClear(); });

function appFor(policy: typeof policies[number], userId = "user-a", ip = "198.51.100.1", tenantId = "tenant-a") {
  const app = express();
  const provider = vi.fn();
  const handler = vi.fn((_req, res) => { provider(); res.json({ ok: true }); });
  const errors = vi.fn();
  app.use((req, _res, next) => {
    if (userId) Object.assign(req, { dbUser: { id: userId }, tenant: { id: tenantId } });
    Object.defineProperty(req, "ip", { value: ip });
    next();
  });
  app.post("/protected", limiters[policy], handler);
  app.use(((err, _req, res, _next) => {
    errors(err);
    res.status(500).json({ message: "Generic error handler reached" });
  }) as ErrorRequestHandler);
  return { app, handler, provider, errors };
}

describe.each(policies)("production %s", (policy) => {
  it("fails closed during the initial outage and recovers without rebuilding the middleware", async () => {
    const { app, handler, provider, errors } = appFor(policy);
    // Synthetic marker only; no real credentials are used by these tests.
    transport.call.mockRejectedValue(new Error("ECONNRESET private-connection-marker"));
    const responses = await Promise.all(Array.from({ length: 3 }, () => request(app).post("/protected")));
    for (const response of responses) {
      expect(response.status).toBe(503);
      expect(response.headers["retry-after"]).toBe("5");
      expect(response.body).toEqual(unavailableBody);
      expect(response.headers["ratelimit-remaining"]).toBeUndefined();
    }
    expect(handler).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("private-connection-marker");

    transport.call.mockResolvedValue([1, 60_000]);
    expect((await request(app).post("/protected")).status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(transport.call.mock.calls.every(([command]) => command === "EVAL")).toBe(true);
    expect(transport.call).toHaveBeenCalledTimes(4); // no ambiguous-operation retries
  });

  it("recovers on the next request after a NOSCRIPT-equivalent failure", async () => {
    const { app, handler, provider, errors } = appFor(policy);
    transport.call.mockResolvedValueOnce([1, 60_000]);
    expect((await request(app).post("/protected")).status).toBe(200);
    handler.mockClear(); provider.mockClear();
    transport.call.mockRejectedValueOnce(new Error("NOSCRIPT No matching script. Please use EVAL."));
    const denied = await request(app).post("/protected");
    expect(denied.status).toBe(503);
    expect(denied.body).toEqual(unavailableBody);
    expect(denied.headers["retry-after"]).toBe("5");
    expect(handler).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
    transport.call.mockResolvedValueOnce([2, 59_000]);
    expect((await request(app).post("/protected")).status).toBe(200);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(transport.call).toHaveBeenCalledTimes(3);
  });
});

it.each([
  null, [], [0, 1000], [-1, 1000], [1, -1], [NaN, 1000], [1.5, 1000],
  [1, Infinity], ["1x", 1000], [1, "1000"], [false, 1000], [1, null],
  [Number.MAX_SAFE_INTEGER + 1, 1000], [1, Number.MAX_SAFE_INTEGER],
].map((reply, index) => ({ reply, index })))(
  "fails closed on malformed increment reply case $index", async ({ reply }) => {
    const { app, handler, provider } = appFor("aiGenerationRateLimit");
    transport.call.mockResolvedValue(reply);
    const response = await request(app).post("/protected");
    expect(response.status).toBe(503);
    expect(response.body).toEqual(unavailableBody);
    expect(response.headers["retry-after"]).toBe("5");
    expect(handler).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
  },
);

it("keeps user keys independent of IP/tenant switching and retains IPv6 subnet fallback", async () => {
  transport.call.mockResolvedValue([1, 60_000]);
  for (const [user, ip, tenant] of [
    ["user-a", "198.51.100.1", "tenant-a"], ["user-a", "198.51.100.2", "tenant-b"],
    ["user-b", "198.51.100.1", "tenant-a"],
    ["", "2001:db8:1234:5600::1", ""], ["", "2001:db8:1234:56ff::2", ""],
  ]) {
    expect((await request(appFor("aiGenerationRateLimit", user, ip, tenant).app).post("/protected")).status).toBe(200);
  }
  const keys = transport.call.mock.calls.map((args) => args[3]);
  expect(keys).toEqual([
    "rl:ai-generation:user-a", "rl:ai-generation:user-a", "rl:ai-generation:user-b",
    "rl:ai-generation:2001:db8:1234:5600::/56", "rl:ai-generation:2001:db8:1234:5600::/56",
  ]);
});

it("preserves getKey/resetKey methods and their same-instance recovery", async () => {
  const limiter = limiters.aiGenerationRateLimit;
  transport.call.mockRejectedValueOnce(new Error("get unavailable"));
  await expect(limiter.getKey("user-a")).rejects.toThrow("Rate limiting is temporarily unavailable");
  transport.call.mockResolvedValueOnce(["2", 1000]);
  expect(await limiter.getKey("user-a")).toMatchObject({ totalHits: 2, resetTime: expect.any(Date) });
  transport.call.mockRejectedValueOnce(new Error("reset unavailable"));
  await expect(limiter.resetKey("user-a")).rejects.toThrow("Rate limiting is temporarily unavailable");
  transport.call.mockResolvedValueOnce(1);
  await limiter.resetKey("user-a");
  expect(transport.call).toHaveBeenLastCalledWith("DEL", "rl:ai-generation:user-a");
});