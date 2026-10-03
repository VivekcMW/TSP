import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Redis from "ioredis";
import type { AILease, AILeaseOptions } from "./aiProviderLimiter";
import { disposableRedisAvailable, startDisposableRedis } from "../../test/disposable-redis";

// Only the owned port-0 Unix-socket fixture; never import the app Redis client.
const key = "tsp:{ai-generation}:leases";
const budgetKey = (tenant: string) => `tsp:{ai-generation}:budget:${createHash("sha256").update(tenant).digest("hex")}`;
let fixture: Awaited<ReturnType<typeof startDisposableRedis>> | undefined;
let clients: Redis[];
let workers: Array<typeof import("./aiProviderLimiter")>;
let releases: AILease[];

beforeEach(async () => {
  expect(disposableRedisAvailable, "redis-server is required for lease Lua acceptance").toBe(true);
  releases = [];
  fixture = await startDisposableRedis();
  clients = [fixture.client(), fixture.client()];
  await Promise.all(clients.map(client => client.connect()));
  expect(await clients[0].call("CLIENT", "ID")).not.toBe(await clients[1].call("CLIENT", "ID"));
  for (const name of ["AI_SHARED_MAX_CONCURRENT_REQUESTS", "AI_TENANT_REQUEST_BUDGET", "AI_TENANT_BUDGET_WINDOW_SECONDS"]) vi.stubEnv(name, "");
  workers = [];
  for (const client of clients) {
    vi.resetModules();
    vi.doMock("../lib/redis", () => ({ redis: client }));
    workers.push(await import("./aiProviderLimiter"));
  }
  expect(workers[0].acquireAILease).not.toBe(workers[1].acquireAILease);
});

afterEach(async () => {
  for (const release of releases ?? []) release();
  try {
    // Fence fire-and-forget cleanup before the fixture disconnects its clients.
    await Promise.all((clients ?? []).filter(client => client.status === "ready").map(client => client.ping()));
  } finally {
    vi.restoreAllMocks();
    await fixture?.stop();
    fixture = undefined;
    vi.doUnmock("../lib/redis");
    vi.unstubAllEnvs();
    vi.resetModules();
  }
});

async function hold(worker: number, tenant = "tenant", options?: AILeaseOptions) {
  const previous = new Set(await clients[1].zrange(key, "0", "-1"));
  const release = await workers[worker].acquireAILease(tenant, options);
  releases.push(release);
  const ids = (await clients[1].zrange(key, "0", "-1")).filter(id => !previous.has(id));
  expect(ids).toHaveLength(1);
  return { release, id: ids[0] };
}

async function serverNow() {
  const [seconds, micros] = await clients[1].time();
  return Number(seconds) * 1000 + Math.floor(Number(micros) / 1000);
}

async function expectTTLThroughLastMember() {
  // One atomic Redis transaction avoids cross-command elapsed-time ambiguity.
  const result = await clients[1].multi().time().pttl(key).zrevrange(key, 0, 0, "WITHSCORES").exec();
  const [seconds, micros] = result![0][1] as string[];
  const now = Number(seconds) * 1000 + Math.floor(Number(micros) / 1000);
  const ttl = Number(result![1][1]);
  const maximum = Number((result![2][1] as string[])[1]);
  expect(ttl).toBeGreaterThan(0);
  expect(now + ttl).toBeGreaterThanOrEqual(maximum - 2);
  expect(now + ttl).toBeLessThanOrEqual(maximum + 2);
}

describe("owned two-client lease Lua", () => {
  it("does not shorten a long member's key TTL on either short acquisition or short renewal", async () => {
    vi.stubEnv("AI_TENANT_REQUEST_BUDGET", "2");
    const long = await hold(0, "long", { ttlMs: 90_000 });
    const longExpiry = await clients[1].zscore(key, long.id);
    const short = await hold(1, "short", { ttlMs: 1000 });
    const shortExpiry = Number(await clients[0].zscore(key, short.id));
    await expectTTLThroughLastMember();
    expect(await clients[0].pttl(key)).toBeGreaterThan(80_000);
    await vi.waitFor(async () => {
      expect(Number(await clients[0].zscore(key, short.id))).toBeGreaterThan(shortExpiry + 200);
    }, { timeout: 2000, interval: 25 });
    expect(await clients[1].zscore(key, long.id)).toBe(longExpiry);
    await expectTTLThroughLastMember();
    expect(await clients[0].pttl(key)).toBeGreaterThan(80_000);
    expect(await clients[0].get(budgetKey("short"))).toBe("1");
    // Even shortening the requested duration of the same live ID cannot shorten it.
    expect(await clients[1].eval(workers[1].RENEW_AI_LEASE, 1, key, long.id, 1000)).toBe(1);
    expect(await clients[1].zscore(key, long.id)).toBe(longExpiry);
    await expectTTLThroughLastMember();
    short.release(); short.release();
    await clients[1].ping();
    expect(await clients[0].zrange(key, "0", "-1")).toEqual([long.id]);
  });

  it("keeps the default lease live beyond its original 30s expiry and excludes a second worker", async () => {
    vi.stubEnv("AI_SHARED_MAX_CONCURRENT_REQUESTS", "1");
    vi.stubEnv("AI_TENANT_REQUEST_BUDGET", "1");
    const evals = vi.spyOn(clients[0], "eval");
    const onLost = vi.fn();
    const lease = await hold(0, "slow", { onLost });
    const originalExpiry = Number(await clients[1].zscore(key, lease.id));
    // Real Redis TIME, not a Lua string assertion or a fake Redis clock. Every
    // renewal executes against the independent fixture during this 30s hold.
    await vi.waitFor(async () => { expect(await serverNow()).toBeGreaterThan(originalExpiry + 25); }, { timeout: 35_000, interval: 250 });
    expect(Number(await clients[1].zscore(key, lease.id))).toBeGreaterThan(originalExpiry + 20_000);
    expect(evals.mock.calls.filter(call => call[0] === workers[0].RENEW_AI_LEASE).length).toBeGreaterThanOrEqual(3);
    await expect(workers[1].acquireAILease("slow")).rejects.toMatchObject({ code: "ai_busy" });
    expect(await clients[1].get(budgetKey("slow"))).toBe("1");
    expect(onLost).not.toHaveBeenCalled();
    await expectTTLThroughLastMember();
    lease.release();
    await clients[0].ping();
    expect(await clients[1].zcard(key)).toBe(0);
    // Once concurrency is free, the same tenant is budget-rejected, not refunded.
    await expect(workers[1].acquireAILease("slow")).rejects.toMatchObject({ code: "ai_budget" });
  }, 40_000);

  it.each(["expired", "missing"])("fails closed for %s owned membership without changing a peer's live lease", async condition => {
    const onLost = vi.fn();
    const own = await hold(0, "own", { ttlMs: 1000, onLost });
    const peer = await hold(1, "peer", { ttlMs: 90_000 });
    const peerExpiry = await clients[1].zscore(key, peer.id);
    if (condition === "expired") await clients[1].zadd(key, 0, own.id);
    else await clients[1].zrem(key, own.id);
    await vi.waitFor(() => expect(onLost).toHaveBeenCalledTimes(1), { timeout: 2000, interval: 25 });
    expect(onLost.mock.calls[0][0]).toMatchObject({ code: "ai_unavailable" });
    expect(await clients[1].zscore(key, own.id)).toBeNull();
    expect(await clients[1].eval(workers[0].RENEW_AI_LEASE, 1, key, own.id, 1000)).toBe(0);
    expect(await clients[1].zscore(key, peer.id)).toBe(peerExpiry);
    own.release(); own.release();
    await clients[0].ping();
    expect(await clients[1].zrange(key, "0", "-1")).toEqual([peer.id]);
    await expectTTLThroughLastMember();
  });

  it("does not resurrect an expired key or another worker's released ID", async () => {
    const onLost = vi.fn();
    const own = await hold(0, "own", { ttlMs: 1000, onLost });
    // Expire the owned key deterministically, without modifying Redis's clock.
    await clients[1].pexpire(key, 0);
    await vi.waitFor(() => expect(onLost).toHaveBeenCalledTimes(1), { timeout: 2000, interval: 25 });
    expect(await clients[1].eval(workers[0].RENEW_AI_LEASE, 1, key, own.id, 30_000)).toBe(0);
    expect(await clients[1].exists(key)).toBe(0);
    const peer = await hold(1);
    peer.release();
    await clients[1].ping();
    expect(await clients[0].eval(workers[0].RENEW_AI_LEASE, 1, key, peer.id, 30_000)).toBe(0);
    expect(await clients[0].exists(key)).toBe(0);
  });

  it("uses Redis time even when the worker wall clock is far ahead", async () => {
    vi.spyOn(Date, "now").mockReturnValue(9_000_000_000_000);
    const own = await hold(0);
    const now = await serverNow();
    const expiry = Number(await clients[1].zscore(key, own.id));
    expect(expiry - now).toBeGreaterThan(29_000);
    expect(expiry - now).toBeLessThanOrEqual(30_000);
    const peer = await hold(1);
    const peerExpiry = await clients[1].zscore(key, peer.id);
    expect(await clients[1].eval(workers[0].RENEW_AI_LEASE, 1, key, "not-an-owner", 600_000)).toBe(0);
    expect(await clients[1].zscore(key, peer.id)).toBe(peerExpiry);
    await expectTTLThroughLastMember();
  });

  it("cleans only its late admission after the 333ms short-lease watchdog, never starting transport", async () => {
    vi.stubEnv("AI_TENANT_REQUEST_BUDGET", "2");
    const original = clients[0].eval.bind(clients[0]);
    let execute!: () => Promise<void>;
    let lateId = "";
    vi.spyOn(clients[0], "eval").mockImplementationOnce((...args) => new Promise(resolve => {
      lateId = String(args[4]);
      execute = async () => { resolve(await original(...args)); };
    }));
    const transport = vi.fn();
    const outcome = Promise.resolve(workers[0].acquireAILease("late", { ttlMs: 1000 })).then(transport);
    await expect(outcome).rejects.toMatchObject({ code: "ai_unavailable" });
    const peer = await hold(1, "peer", { ttlMs: 90_000 });
    await execute(); // The first owned cleanup already ran before actual admission.
    await vi.waitFor(async () => { expect(await clients[1].zscore(key, lateId)).toBeNull(); }, { timeout: 2000, interval: 25 });
    expect(await clients[1].zrange(key, "0", "-1")).toEqual([peer.id]);
    expect(await clients[1].get(budgetKey("late"))).toBe("1");
    expect(transport).not.toHaveBeenCalled();
  });

  it.each(["execution", "reply"])("safely releases with renewal %s in flight; late completion cannot resurrect or renew again", async phase => {
    const onLost = vi.fn();
    const own = await hold(0, "own", { ttlMs: 1000, onLost });
    const peer = await hold(1, "peer", { ttlMs: 90_000 });
    const original = clients[0].eval.bind(clients[0]);
    let finish: (() => Promise<void>) | undefined;
    let serverResult: unknown;
    const evals = vi.spyOn(clients[0], "eval").mockImplementationOnce((...args) => new Promise(resolve => {
      const pending = phase === "reply" ? original(...args) : undefined;
      finish = async () => {
        serverResult = await (pending ?? original(...args));
        resolve(serverResult);
      };
    }));
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"), { timeout: 1000, interval: 10 });
    // A ping fences a renewal already executed by Redis but with a delayed reply.
    await clients[0].ping();
    own.release(); own.release();
    await clients[0].ping();
    expect(await clients[1].zscore(key, own.id)).toBeNull();
    await finish!();
    expect(serverResult).toBe(phase === "execution" ? 0 : 1);
    await clients[0].ping();
    expect(await clients[1].zrange(key, "0", "-1")).toEqual([peer.id]);
    expect(evals).toHaveBeenCalledTimes(1);
    expect(onLost).not.toHaveBeenCalled();
    await expectTTLThroughLastMember();
  });
});