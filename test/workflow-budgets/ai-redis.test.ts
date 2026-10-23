import { createHash } from "node:crypto";
import { once } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import type Redis from "ioredis";
import { disposableRedisAvailable, startDisposableRedis } from "../disposable-redis";
import { metric } from "./metrics";

afterEach(() => { vi.doUnmock("../../server/lib/redis"); vi.unstubAllEnvs(); vi.resetModules(); });

it.skipIf(!disposableRedisAvailable)("shares AI admission atomically between two independent clients on owned Redis", async () => {
  const fixture = await startDisposableRedis();
  try {
    const clients = [fixture.client(), fixture.client()];
    await Promise.all(clients.map(client => client.connect()));
    expect(await clients[0].call("CLIENT", "ID")).not.toBe(await clients[1].call("CLIENT", "ID"));
    vi.stubEnv("AI_SHARED_MAX_CONCURRENT_REQUESTS", "4");
    vi.stubEnv("AI_TENANT_REQUEST_BUDGET", "6");
    vi.stubEnv("AI_TENANT_BUDGET_WINDOW_SECONDS", "3600");
    const load = async (client: Redis) => {
      vi.resetModules();
      vi.doMock("../../server/lib/redis", () => ({ redis: client }));
      return import("../../server/services/aiProviderLimiter");
    };
    const workers = [await load(clients[0]), await load(clients[1])];
    expect(workers[0].acquireAILease).not.toBe(workers[1].acquireAILease);
    const evals = clients.map(client => vi.spyOn(client, "eval"));
    const globalKey = "tsp:{ai-generation}:leases";
    const budgetKey = `tsp:{ai-generation}:budget:${createHash("sha256").update("tenant-budget").digest("hex")}`;
    const burst = (count: number) => Promise.allSettled(Array.from({ length: count }, (_, i) => workers[i % 2].acquireAILease("tenant-budget")));
    const first = await burst(40);
    expect(evals.map(spy => spy.mock.calls.length)).toEqual([20, 20]);
    const leases = first.filter(value => value.status === "fulfilled").map(value => value.value);
    expect(leases).toHaveLength(4);
    expect(first.filter(value => value.status === "rejected" && value.reason.code === "ai_busy")).toHaveLength(36);
    expect(await clients[0].zcard(globalKey)).toBe(4);
    expect(await clients[1].get(budgetKey)).toBe("4");
    expect(await clients[1].pttl(globalKey)).toBeGreaterThan(0);
    expect(await clients[1].pttl(globalKey)).toBeLessThanOrEqual(workers[0].AI_LEASE_TTL_MS);
    leases.forEach(release => { release(); release(); });
    // A PING on each issuing client fences the fire-and-forget releases.
    await Promise.all(clients.map(client => client.ping()));
    expect(await clients[0].zcard(globalKey)).toBe(0);
    const second = await burst(4);
    expect(second.filter(value => value.status === "fulfilled")).toHaveLength(2);
    expect(second.filter(value => value.status === "rejected" && value.reason.code === "ai_budget")).toHaveLength(2);
    expect(await clients[1].get(budgetKey)).toBe("6");
    for (const outcome of second) if (outcome.status === "fulfilled") outcome.value();
    await Promise.all(clients.map(client => client.ping()));
    // Deterministic expired-lease cleanup, without sleeping or Redis clock edits.
    await clients[0].zadd(globalKey, 0, "dead-worker");
    const other = await workers[1].acquireAILease("other-tenant");
    expect(await clients[0].zscore(globalKey, "dead-worker")).toBeNull();
    expect(await clients[0].zcard(globalKey)).toBe(1);
    other(); await clients[1].ping();
    const disconnected = once(clients[0], "end");
    clients[0].disconnect();
    await disconnected;
    expect(() => workers[0].acquireAILease("tenant-budget")).toThrow("ai_unavailable");
    await clients[0].connect();
    await expect(workers[0].acquireAILease("tenant-budget")).rejects.toMatchObject({ code: "ai_budget" });
    // Expire only our own counter, verifying a fresh window without a long wait.
    await clients[1].pexpire(budgetKey, 0);
    const renewed = await workers[0].acquireAILease("tenant-budget");
    expect(await clients[1].get(budgetKey)).toBe("1");
    renewed(); await clients[0].ping();
    expect(await clients[1].zcard(globalKey)).toBe(0);
    metric("shared-ai-redis", { independentClients: 2, independentLimiterModules: 2, burst: 40,
      admitted: leases.length, concurrencyRejected: 36, budgetAfterRejectedBurst: 4,
      secondBurstAdmitted: 2, budgetRejected: 2, remainingLeases: 0,
      network: "owned Unix socket only", providerCalls: 0 });
  } finally { await fixture.stop(); }
});