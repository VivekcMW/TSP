import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { add, clients, redisState, redisConstructor, bull } = vi.hoisted(() => ({
  add: vi.fn(), clients: [] as any[], redisState: { enabled: true }, redisConstructor: vi.fn(), bull: vi.fn(),
}));
vi.mock("ioredis", () => ({ default: class { constructor(...args: unknown[]) { redisConstructor(...args); clients.push(this); } on = vi.fn(); disconnect = vi.fn(); } }));
vi.mock("../lib/redis", async (original) => ({ ...await original<typeof import("../lib/redis")>(), get redis() { return redisState.enabled ? { ping: vi.fn() } : undefined; } }));
vi.mock("bull", () => ({ default: class { constructor(...args: unknown[]) { bull(...args); } add = add; on = vi.fn(); close = vi.fn(); } }));
import { initializeQueues, closeQueues, enqueuePublishDraft, enqueueInboxRefresh, queueOptions } from "./queue";
import { redisOptions } from "../lib/redis";

beforeEach(() => { vi.clearAllMocks(); redisState.enabled = true; vi.stubEnv("NODE_ENV", "test"); add.mockResolvedValue({ id: "job" }); });
afterEach(async () => { await closeQueues(); vi.unstubAllEnvs(); vi.useRealTimers(); });
const data = { tenantId: "t", userId: "u", draftId: "d", draftScheduleId: "s", draftScheduleTargetId: "target", platform: "twitter", publishAt: new Date(0), attemptNumber: 1 };

describe("queue reliability", () => {
  it("uses complete TLS URLs and distinct blocking/request settings", () => {
    const url = "rediss://test-user:test-password@redis.invalid:6380/2";
    const options = queueOptions(url);
    options.createClient!("client", {}); options.createClient!("bclient", {}); options.createClient!("subscriber", {});
    expect(redisConstructor).toHaveBeenNthCalledWith(1, url, expect.objectContaining({ maxRetriesPerRequest: 2, commandTimeout: 5000, keepAlive: 5000, connectTimeout: 5000 }));
    expect(redisConstructor).toHaveBeenNthCalledWith(2, url, expect.objectContaining({ maxRetriesPerRequest: null, enableReadyCheck: false }));
    expect(redisConstructor.mock.calls[0][1]).toMatchObject({ socketTimeout: 10000, autoResendUnfulfilledCommands: false });
    for (const index of [1, 2]) {
      expect(redisConstructor.mock.calls[index][1]).toMatchObject({ maxRetriesPerRequest: null, enableReadyCheck: false,
        commandTimeout: undefined, socketTimeout: undefined, blockingTimeout: undefined, autoResendUnfulfilledCommands: true });
    }
    expect(redisOptions().retryStrategy!(100)).toBe(3000);
    expect(options.defaultJobOptions?.removeOnFail).toEqual({ age: 604800, count: 1000 });
    expect(options.defaultJobOptions?.removeOnComplete).toEqual({ age: 3600, count: 1000 });
  });
  it("keeps production on Bull's default key prefix and isolates every other environment", () => {
    // A dev server sharing production's Redis must never claim production jobs
    // (their tenants exist only in production's database), nor vice versa.
    vi.stubEnv("NODE_ENV", "production");
    expect(queueOptions("redis://redis.invalid:6379").prefix).toBe("bull");
    vi.stubEnv("NODE_ENV", "development");
    expect(queueOptions("redis://redis.invalid:6379").prefix).toBe("bull-development");
  });
  it("removes lifecycle query overrides for all three Bull connection types", () => {
    const options = queueOptions("rediss://test-user:test-password@redis.invalid:6380/2?retryStrategy=0&commandTimeout=1&socketTimeout=1&blockingTimeout=1&maxRetriesPerRequest=0&enableReadyCheck=true");
    for (const type of ["client", "bclient", "subscriber"] as const) options.createClient!(type, {});
    for (const [url, policy] of redisConstructor.mock.calls) {
      expect(url).toBe("rediss://test-user:test-password@redis.invalid:6380/2");
      expect(policy.retryStrategy(100)).toBe(3000);
    }
  });
  it("initializes once and gives target generations stable job IDs", async () => {
    initializeQueues(); initializeQueues();
    expect(bull).toHaveBeenCalledTimes(2);
    await enqueuePublishDraft(data); await enqueuePublishDraft(data);
    expect(add.mock.calls[0][1].jobId).toBe(add.mock.calls[1][1].jobId);
    await enqueuePublishDraft({ ...data, draftScheduleTargetId: "replacement" });
    expect(add.mock.calls[2][1].jobId).not.toBe(add.mock.calls[0][1].jobId);
  });
  it.each(["test", "production"])("never falls back on enqueue errors in %s", async (env) => {
    vi.stubEnv("NODE_ENV", env); initializeQueues(); add.mockRejectedValue(new Error("offline"));
    await expect(enqueuePublishDraft(data)).rejects.toThrow("Background queue unavailable");
    await expect(enqueueInboxRefresh({ tenantId: "t", userId: "u" })).rejects.toThrow("Background queue unavailable");
  });
  it("allows null only for disabled local queues, not production", async () => {
    redisState.enabled = false;
    expect(await enqueuePublishDraft(data)).toBeNull();
    vi.stubEnv("NODE_ENV", "production");
    await expect(enqueuePublishDraft(data)).rejects.toThrow("Background queue unavailable");
    await expect(enqueueInboxRefresh({ tenantId: "t" })).rejects.toThrow("Background queue unavailable");
  });
  it("bounds enqueue latency even when Bull never becomes ready", async () => {
    vi.useFakeTimers(); initializeQueues();
    add.mockReturnValue(new Promise(() => undefined));
    const assertion = expect(enqueuePublishDraft(data)).rejects.toThrow("Background queue unavailable");
    await vi.advanceTimersByTimeAsync(8_000);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });
});