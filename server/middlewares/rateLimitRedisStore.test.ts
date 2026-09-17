import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import express from "express";
import type { RateLimitRequestHandler } from "express-rate-limit";
import Redis from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { RateLimitStoreUnavailableError, RecoverableRateLimitRedisStore } from "./rateLimitRedisStore";

const transport = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("../lib/redis", () => ({ redis: transport }));

it("does no initialization I/O and does not cache failed commands for any store method", async () => {
  const call = vi.fn();
  const store = new RecoverableRateLimitRedisStore("test:", call);
  store.init({ windowMs: 1000 });
  expect(call).not.toHaveBeenCalled();
  for (const method of ["increment", "get", "decrement", "resetKey"] as const) {
    call.mockRejectedValueOnce(new Error("private-driver-marker"));
    await expect(store[method]("key")).rejects.toBeInstanceOf(RateLimitStoreUnavailableError);
    call.mockResolvedValueOnce(method === "increment" || method === "get" ? [1, 1000] : 1);
    await expect(store[method]("key")).resolves.not.toThrow();
  }
  expect(call).toHaveBeenCalledTimes(8);
});

it("rejects use before initialization and invalid windows without issuing Redis commands", async () => {
  const call = vi.fn();
  const store = new RecoverableRateLimitRedisStore("test:", call);
  await expect(store.increment("key")).rejects.toBeInstanceOf(RateLimitStoreUnavailableError);
  for (const windowMs of [0, -1, 0.5, NaN, Infinity]) {
    expect(() => store.init({ windowMs })).toThrow("Invalid rate-limit window");
  }
  expect(call).not.toHaveBeenCalled();
});

// Socket-only, no persistence, no configured services or environment files.
// CI without redis-server explicitly skips only these real-Redis tests.
const available = spawnSync("redis-server", ["--version"], { stdio: "ignore" }).status === 0;
describe.skipIf(!available)("recoverable limiter with isolated Redis", () => {
  let directory: string;
  let server: ChildProcess;
  let first: Redis;
  let second: Redis;
  let limiters: typeof import("./rateLimit");

  function store(client: Redis, prefix: string, windowMs = 60_000) {
    const result = new RecoverableRateLimitRedisStore(prefix, (...args) => client.call(args[0], ...args.slice(1)));
    result.init({ windowMs });
    return result;
  }

  beforeAll(async () => {
    directory = await mkdtemp("/tmp/tsp-rl-redis-");
    const socket = `${directory}/redis.sock`;
    server = spawn("redis-server", ["--port", "0", "--unixsocket", socket,
      "--unixsocketperm", "700", "--save", "", "--appendonly", "no", "--dir", directory],
    { stdio: ["ignore", "pipe", "pipe"] });
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Isolated Redis startup timed out")), 5000);
      server.once("error", () => { clearTimeout(timeout); reject(new Error("Isolated Redis startup failed")); });
      server.once("exit", () => { clearTimeout(timeout); reject(new Error("Isolated Redis exited")); });
      server.stdout?.on("data", (chunk: Buffer) => {
        if (/ready to accept connections/i.test(chunk.toString())) { clearTimeout(timeout); resolve(); }
      });
    });
    const options = { path: socket, lazyConnect: true, enableOfflineQueue: false,
      retryStrategy: () => null, maxRetriesPerRequest: 0, commandTimeout: 1000 };
    first = new Redis(options);
    second = new Redis(options);
    first.on("error", () => {}); second.on("error", () => {});
    transport.call.mockImplementation((command: string, ...args: string[]) => first.call(command, ...args));
    // Construct the actual exported middleware before the client is connected.
    // There must be no SCRIPT LOAD promise capable of poisoning initialization.
    limiters = await import("./rateLimit");
    expect(transport.call).not.toHaveBeenCalled();
    await Promise.all([first.connect(), second.connect()]);
  });

  afterAll(async () => {
    first?.disconnect(); second?.disconnect();
    if (server && server.exitCode === null && server.signalCode === null) {
      const exited = once(server, "exit");
      server.kill("SIGTERM");
      const force = setTimeout(() => server.kill("SIGKILL"), 1000);
      try { await exited; } finally { clearTimeout(force); }
    }
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("atomically counts across clients with a shared fixed TTL under concurrency", async () => {
    const stores = [store(first, "atomic:"), store(second, "atomic:")];
    const results = await Promise.all(Array.from({ length: 100 }, (_, index) => stores[index % 2].increment("user")));
    expect(results.map((result) => result.totalHits).sort((a, b) => a - b))
      .toEqual(Array.from({ length: 100 }, (_, index) => index + 1));
    const times = results.map((result) => result.resetTime!.getTime());
    expect(Math.max(...times) - Math.min(...times)).toBeLessThan(1000);
    expect(await first.get("atomic:user")).toBe("100");
    expect(await first.pttl("atomic:user")).toBeGreaterThan(50_000);
  });

  it("preserves fixed expiry and resets atomically only after the window expires", async () => {
    const limiter = store(first, "expiry:");
    await limiter.increment("user");
    await first.pexpire("expiry:user", 10_000);
    expect((await limiter.increment("user")).totalHits).toBe(2);
    expect(await first.pttl("expiry:user")).toBeLessThanOrEqual(10_000);
    expect((await limiter.get("user"))?.totalHits).toBe(2);
    await first.pexpire("expiry:user", 0);
    expect(await limiter.get("user")).toBeUndefined();
    expect((await limiter.increment("user")).totalHits).toBe(1);
    expect(await first.pttl("expiry:user")).toBeGreaterThan(50_000);
    // Match v6's behavior for an old counter lacking expiry.
    await first.set("expiry:legacy", "9");
    expect((await limiter.increment("legacy")).totalHits).toBe(1);
    expect(await first.pttl("expiry:legacy")).toBeGreaterThan(50_000);
  });

  it("decrements without refreshing expiry, creating expired keys, or going negative; reset is scoped", async () => {
    const limiter = store(first, "refund:");
    const peer = store(second, "refund:");
    const other = store(first, "other:");
    await limiter.increment("user"); await limiter.increment("user");
    await other.increment("user"); await limiter.increment("another-user");
    await first.pexpire("refund:user", 10_000);
    await peer.decrement("user");
    expect((await limiter.get("user"))?.totalHits).toBe(1);
    expect(await first.pttl("refund:user")).toBeLessThanOrEqual(10_000);
    await Promise.all(Array.from({ length: 10 }, () => peer.decrement("user")));
    expect((await limiter.get("user"))?.totalHits).toBe(0);
    await first.pexpire("refund:user", 0);
    await peer.decrement("user");
    expect(await first.exists("refund:user")).toBe(0);
    await limiter.increment("user");
    await peer.resetKey("user");
    expect(await limiter.get("user")).toBeUndefined();
    expect((await other.get("user"))?.totalHits).toBe(1);
    expect((await limiter.get("another-user"))?.totalHits).toBe(1);
    expect((await limiter.increment("user")).totalHits).toBe(1);
  });

  function appFor(limiter: RateLimitRequestHandler, userId: string) {
    const app = express();
    const provider = vi.fn();
    const handler = vi.fn((_req, res) => { provider(); res.json({ ok: true }); });
    app.use((req, _res, next) => { Object.assign(req, { dbUser: { id: userId } }); next(); });
    app.post(["/one", "/two"], limiter, handler);
    return { app, provider, handler };
  }

  it.each([
    ["aiGenerationRateLimit", "ai-generation", 30, 900],
    ["instantReviewRateLimit", "instant-review", 10, 3600],
    ["inboxRefreshRateLimit", "inbox-refresh", 20, 900],
  ] as const)("keeps %s's real quota and 429 responses across routes and outages", async (name, prefix, quota, seconds) => {
    const limiter = limiters[name];
    const { app, provider, handler } = appFor(limiter, "quota-user");
    const responses = await Promise.all(Array.from({ length: quota + 8 }, (_, index) =>
      request(app).post(index % 2 ? "/one" : "/two")));
    expect(responses.filter((response) => response.status === 200)).toHaveLength(quota);
    const exhausted = responses.filter((response) => response.status === 429);
    expect(exhausted).toHaveLength(8);
    expect(provider).toHaveBeenCalledTimes(quota);
    expect(handler).toHaveBeenCalledTimes(quota);
    for (const response of exhausted) {
      expect(response.headers["ratelimit-limit"]).toBe(String(quota));
      expect(response.headers["ratelimit-policy"]).toBe(`${quota};w=${seconds}`);
      expect(response.headers["ratelimit-remaining"]).toBe("0");
      expect(Number(response.headers["retry-after"])).toBeGreaterThan(0);
      expect(Number(response.headers["retry-after"])).toBeLessThanOrEqual(seconds);
    }
    expect(await first.get(`rl:${prefix}:quota-user`)).toBe(String(quota + 8));

    first.disconnect();
    try {
      const denied = await request(app).post("/one");
      expect(denied.status).toBe(503);
      expect(denied.headers["retry-after"]).toBe("5");
      expect(handler).toHaveBeenCalledTimes(quota);
      expect(provider).toHaveBeenCalledTimes(quota);
    } finally { await first.connect(); }
    // Recovery must not reset the exhausted budget or fall back to memory.
    expect((await request(app).post("/one")).status).toBe(429);
    expect(provider).toHaveBeenCalledTimes(quota);
  });

  it("keeps the actual middleware/getKey usable after SCRIPT FLUSH and a failed post-flush call", async () => {
    const limiter = limiters.aiGenerationRateLimit;
    const { app, provider, handler } = appFor(limiter, "flush-user");
    expect((await request(app).post("/one")).status).toBe(200);
    const original = await limiter.getKey("flush-user");
    await second.script("FLUSH");
    expect(await first.script("EXISTS", "0000000000000000000000000000000000000000")).toEqual([0]);
    first.disconnect();
    handler.mockClear(); provider.mockClear();
    try {
      const denied = await request(app).post("/one");
      expect(denied.status).toBe(503);
      expect(handler).not.toHaveBeenCalled();
      expect(provider).not.toHaveBeenCalled();
      await expect(limiter.getKey("flush-user")).rejects.toBeInstanceOf(RateLimitStoreUnavailableError);
    } finally { await first.connect(); }
    expect((await request(app).post("/one")).status).toBe(200);
    const recovered = await limiter.getKey("flush-user");
    expect(recovered?.totalHits).toBe(2);
    expect(Math.abs(recovered!.resetTime!.getTime() - original!.resetTime!.getTime())).toBeLessThan(1000);
    await second.script("FLUSH");
    expect((await limiter.getKey("flush-user"))?.totalHits).toBe(2);
    expect((await request(app).post("/two")).status).toBe(200);
    expect(provider).toHaveBeenCalledTimes(2);
    expect((await limiter.getKey("flush-user"))?.totalHits).toBe(3);
  });
});