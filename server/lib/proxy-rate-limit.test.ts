import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { once } from "node:events";
import Redis from "ioredis";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createAuthRateLimitStorage } from "./proxy-rate-limit";

// No configured Redis/DB is ever used. This suite owns a socket-only Redis
// process with persistence disabled; CI without redis-server skips it explicitly.
const available = spawnSync("redis-server", ["--version"], { stdio: "ignore" }).status === 0;
describe.skipIf(!available)("auth limiter with isolated Redis", () => {
  let directory: string;
  let server: ChildProcess;
  let first: Redis;
  let second: Redis;

  beforeAll(async () => {
    // Short path avoids macOS's Unix socket path-length limit.
    directory = await mkdtemp("/tmp/tsp-auth-redis-");
    const socket = `${directory}/redis.sock`;
    server = spawn("redis-server", ["--port", "0", "--unixsocket", socket,
      "--unixsocketperm", "700", "--save", "", "--appendonly", "no", "--dir", directory],
    { stdio: ["ignore", "pipe", "pipe"] });
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Isolated Redis startup timed out")), 5000);
      server.once("error", (error) => { clearTimeout(timeout); reject(error); });
      server.once("exit", () => { clearTimeout(timeout); reject(new Error("Isolated Redis exited")); });
      server.stdout?.on("data", (chunk: Buffer) => {
        if (/ready to accept connections/i.test(chunk.toString())) { clearTimeout(timeout); resolve(); }
      });
    });
    const options = { path: socket, lazyConnect: true, enableOfflineQueue: false,
      retryStrategy: () => null, maxRetriesPerRequest: 0, commandTimeout: 1000 };
    first = new Redis(options);
    second = new Redis(options);
    first.on("error", () => {});
    second.on("error", () => {});
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

  it("atomically enforces one shared budget across clients under concurrency", async () => {
    const stores = [createAuthRateLimitStorage(first), createAuthRateLimitStorage(second)];
    const decisions = await Promise.all(Array.from({ length: 40 }, (_, index) =>
      stores[index % 2].consume("198.51.100.20|/concurrent", { max: 3, window: 60 })));
    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(3);
    expect(decisions.filter((decision) => !decision.allowed)).toHaveLength(37);
    expect(decisions.find((decision) => !decision.allowed)?.retryAfter).toBeGreaterThan(0);
    expect((await first.keys("tsp:auth:rate-limit:*"))[0]).not.toContain("198.51.100.20");
  });

  it("refreshes expiry only on acceptance and starts a new budget after expiry", async () => {
    const store = createAuthRateLimitStorage(first);
    const key = "198.51.100.21|/expiry";
    const before = new Set(await first.keys("tsp:auth:rate-limit:*"));
    await store.consume(key, { max: 2, window: 60 });
    const redisKey = (await first.keys("tsp:auth:rate-limit:*")).find((entry) => !before.has(entry))!;
    await first.pexpire(redisKey, 1000);
    expect((await store.consume(key, { max: 2, window: 60 })).allowed).toBe(true);
    expect(await first.pttl(redisKey)).toBeGreaterThan(50_000);
    await first.pexpire(redisKey, 1000);
    expect((await store.consume(key, { max: 2, window: 60 })).allowed).toBe(false);
    expect(await first.pttl(redisKey)).toBeLessThanOrEqual(1000);
    // Expire the key immediately without timing-dependent sleeps.
    await first.pexpire(redisKey, 0);
    expect((await store.consume(key, { max: 2, window: 60 })).allowed).toBe(true);
    expect(await first.get(redisKey)).toBe("1");
  });

  it("denies on a real disconnected client rather than using process-local memory", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const store = createAuthRateLimitStorage(second);
      second.disconnect();
      expect(await store.consume("outage|/ok", { max: 100, window: 10 }))
        .toEqual({ allowed: false, retryAfter: 5 });
    } finally { log.mockRestore(); }
  });
});