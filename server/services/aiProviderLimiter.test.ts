import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ redis: undefined as undefined | { status: string; eval: ReturnType<typeof vi.fn>; zrem: ReturnType<typeof vi.fn> } }));
vi.mock("../lib/redis", () => ({ get redis() { return state.redis; } }));
let limiter: typeof import("./aiProviderLimiter");
beforeEach(async () => {
  vi.resetModules();
  state.redis = undefined;
  for (const key of ["AI_SHARED_MAX_CONCURRENT_REQUESTS", "AI_TENANT_REQUEST_BUDGET", "AI_TENANT_BUDGET_WINDOW_SECONDS"]) vi.stubEnv(key, "");
  limiter = await import("./aiProviderLimiter");
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const redisMock = () => state.redis = { status: "ready", eval: vi.fn().mockImplementation(script =>
  Promise.resolve(script === limiter.RENEW_AI_LEASE ? 1 : [1, 0])), zrem: vi.fn().mockResolvedValue(1) };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("shared AI admission", () => {
  it("uses atomic admission, bounded TTL, hashed scope and an idempotent release", async () => {
    const redis = redisMock();
    vi.stubEnv("AI_TENANT_REQUEST_BUDGET", "10");
    const release = await limiter.acquireAILease("tenant-private-id");
    const args = redis.eval.mock.calls[0];
    expect(args[0]).toContain("ZREMRANGEBYSCORE");
    expect(args[0]).toContain("redis.call('TIME')");
    expect(args[0]).toContain("PEXPIRE");
    expect(args[1]).toBe(2);
    expect(args[3]).not.toContain("tenant-private-id");
    expect(args.slice(5)).toEqual([4, 10, 3_600_000, 30_000]);
    release(); release();
    expect(redis.zrem).toHaveBeenCalledExactlyOnceWith(args[2], args[4]);
  });

  it.each([[0, 5, "ai_busy"], [2, 17, "ai_budget"]])("rejects denied admission %s", async (result, retryAfterSeconds, code) => {
    const redis = redisMock();
    redis.eval.mockResolvedValue([result, retryAfterSeconds]);
    await expect(limiter.acquireAILease("tenant")).rejects.toMatchObject({ code, retryAfterSeconds });
    expect(redis.zrem).not.toHaveBeenCalled();
  });

  it("fails closed for Redis failures, malformed responses and not-ready connections", async () => {
    const redis = redisMock();
    redis.eval.mockRejectedValueOnce(new Error("redis-secret"));
    await expect(limiter.acquireAILease()).rejects.toMatchObject({ code: "ai_unavailable", message: "ai_unavailable" });
    redis.eval.mockResolvedValueOnce(null);
    await expect(limiter.acquireAILease()).rejects.toMatchObject({ code: "ai_unavailable" });
    redis.status = "reconnecting";
    expect(() => limiter.acquireAILease()).toThrow("ai_unavailable");
    expect(redis.eval).toHaveBeenCalledTimes(2);
  });

  it("uses a unique lease ID per generation and ignores failed release safely", async () => {
    const redis = redisMock();
    redis.zrem.mockRejectedValue(new Error("unavailable"));
    const releaseA = await limiter.acquireAILease();
    const releaseB = await limiter.acquireAILease();
    expect(redis.eval.mock.calls[0][4]).not.toBe(redis.eval.mock.calls[1][4]);
    expect(() => { releaseA(); releaseB(); }).not.toThrow();
    await Promise.resolve();
  });

  it("bounds local per-tenant budgets and resets them after the configured window", async () => {
    vi.useFakeTimers();
    vi.stubEnv("AI_TENANT_REQUEST_BUDGET", "1");
    vi.stubEnv("AI_TENANT_BUDGET_WINDOW_SECONDS", "2");
    const release = await limiter.acquireAILease("a");
    release();
    expect(() => limiter.acquireAILease("a")).toThrow("ai_budget");
    expect(() => limiter.acquireAILease("b")).not.toThrow();
    await vi.advanceTimersByTimeAsync(2001);
    expect(() => limiter.acquireAILease("a")).not.toThrow();
  });

  it.each(["0", "-1", "NaN", "1.5", "1000001"])("rejects invalid configured budget %s", value => {
    vi.stubEnv("AI_TENANT_REQUEST_BUDGET", value);
    expect(() => limiter.acquireAILease()).toThrow("ai_configuration");
  });

  it("releases a late Redis admission after cancellation without starting a provider", async () => {
    const redis = redisMock();
    let admitted!: (result: number[]) => void;
    redis.eval.mockImplementation(() => new Promise(resolve => { admitted = resolve; }));
    const http = vi.fn();
    vi.stubGlobal("fetch", http);
    vi.stubEnv("AI_PROVIDER", "anthropic");
    vi.stubEnv("AI_FALLBACK_PROVIDER", "openrouter");
    vi.stubEnv("CLAUDE_API_KEY", "unit-test-only");
    const ai = await import("./openRouter");
    const controller = new AbortController();
    const result = ai.generateText("article", { signal: controller.signal }).catch(ai.getAIErrorResponse);
    controller.abort();
    expect(await result).toMatchObject({ body: { code: "ai_cancelled" } });
    admitted([1, 0]);
    await vi.waitFor(() => expect(redis.zrem).toHaveBeenCalledTimes(1));
    expect(http).not.toHaveBeenCalled();
  });

  it("never uses provider fallback to bypass failed shared admission", async () => {
    const redis = redisMock();
    redis.eval.mockRejectedValue(new Error("Redis unavailable"));
    const http = vi.fn();
    vi.stubGlobal("fetch", http);
    vi.stubEnv("AI_PROVIDER", "anthropic");
    vi.stubEnv("AI_FALLBACK_PROVIDER", "openrouter");
    const ai = await import("./openRouter");
    await expect(ai.generateText("article")).rejects.toMatchObject({ code: "ai_unavailable" });
    expect(http).not.toHaveBeenCalled();
  });
});

describe("lease lifetime and control-plane fencing", () => {
  beforeEach(() => { vi.useFakeTimers(); });

  it.each([1000, 120_000, 600_000])("accepts a trusted bounded TTL of %s ms", async ttlMs => {
    const redis = redisMock();
    const release = await limiter.acquireAILease("tenant", { ttlMs });
    expect(redis.eval.mock.calls[0][8]).toBe(ttlMs);
    release(); release();
    expect(vi.getTimerCount()).toBe(0);
    expect(redis.zrem).toHaveBeenCalledTimes(1);
  });

  it.each([0, -1, 999, 600_001, 1000.5, NaN, Infinity, null, "30000"])("rejects invalid TTL %s before Redis or local budget spend", ttlMs => {
    vi.stubEnv("AI_TENANT_REQUEST_BUDGET", "1");
    const options = { ttlMs } as unknown as import("./aiProviderLimiter").AILeaseOptions;
    expect(() => limiter.acquireAILease("tenant", options)).toThrow("ai_configuration");
    expect(() => limiter.acquireAILease("tenant")).not.toThrow();
    const redis = redisMock();
    expect(() => limiter.acquireAILease("tenant", options)).toThrow("ai_configuration");
    expect(redis.eval).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([null, [], "invalid", { onLost: true }].map(value => ({ value })))("rejects malformed options $value", ({ value }) => {
    const redis = redisMock();
    expect(() => limiter.acquireAILease(undefined, value as import("./aiProviderLimiter").AILeaseOptions)).toThrow("ai_configuration");
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it("renews default leases beyond 30 seconds, through parent cancellation until transport settles", async () => {
    const redis = redisMock();
    const controller = new AbortController();
    const onLost = vi.fn(error => controller.abort(error));
    const release = await limiter.acquireAILease("tenant", { onLost });
    const transport = deferred<void>();
    const settled = transport.promise.finally(release);
    controller.abort(); // Parent cancellation is not transport settlement.
    await vi.advanceTimersByTimeAsync(91_000);
    const [script, , key, , id] = redis.eval.mock.calls[0];
    expect(redis.eval.mock.calls.filter(call => call[0] === script)).toHaveLength(1);
    expect(redis.eval.mock.calls.slice(1)).toHaveLength(9);
    for (const args of redis.eval.mock.calls.slice(1)) expect(args).toEqual([limiter.RENEW_AI_LEASE, 1, key, id, 30_000]);
    expect(redis.zrem).not.toHaveBeenCalled();
    expect(onLost).not.toHaveBeenCalled();
    transport.resolve();
    await settled;
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(redis.eval).toHaveBeenCalledTimes(10);
    expect(redis.zrem).toHaveBeenCalledExactlyOnceWith(key, id);
  });

  it("rejects a hung acquisition within 5s; late admission only cleans its own ID and never starts transport", async () => {
    const redis = redisMock();
    const admission = deferred<number[]>();
    redis.eval.mockReturnValueOnce(admission.promise);
    const transport = vi.fn();
    const onLost = vi.fn();
    const result = Promise.resolve(limiter.acquireAILease("tenant", { onLost })).then(transport).catch(error => error);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await result).toMatchObject({ code: "ai_unavailable", message: "ai_unavailable" });
    expect(transport).not.toHaveBeenCalled();
    expect(onLost).not.toHaveBeenCalled(); // No held lease was delivered.
    expect(vi.getTimerCount()).toBe(0);
    admission.resolve([1, 0]);
    await vi.advanceTimersByTimeAsync(0);
    expect(transport).not.toHaveBeenCalled();
    expect(redis.zrem).toHaveBeenCalledTimes(2); // Uncertain write, then late confirmed write.
    for (const args of redis.zrem.mock.calls) expect(args).toEqual([redis.eval.mock.calls[0][2], redis.eval.mock.calls[0][4]]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("observes a late acquisition rejection without leaking timers or unhandled rejections", async () => {
    const redis = redisMock();
    const admission = deferred<number[]>();
    redis.eval.mockReturnValueOnce(admission.promise);
    const result = Promise.resolve(limiter.acquireAILease()).catch(error => error);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await result).toMatchObject({ code: "ai_unavailable" });
    admission.reject(new Error("late private Redis error"));
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects an overdue acknowledgement even before the watchdog timer gets CPU time", async () => {
    const redis = redisMock();
    const admission = deferred<number[]>();
    redis.eval.mockReturnValueOnce(admission.promise);
    const result = Promise.resolve(limiter.acquireAILease()).catch(error => error);
    vi.spyOn(performance, "now").mockReturnValue(5001);
    admission.resolve([1, 0]);
    expect(await result).toMatchObject({ code: "ai_unavailable" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not hand out an admission after Redis becomes not-ready", async () => {
    const redis = redisMock();
    const admission = deferred<number[]>();
    redis.eval.mockReturnValueOnce(admission.promise);
    const result = Promise.resolve(limiter.acquireAILease()).catch(error => error);
    redis.status = "reconnecting";
    admission.resolve([1, 0]);
    expect(await result).toMatchObject({ code: "ai_unavailable" });
    expect(redis.zrem).not.toHaveBeenCalled(); // No offline cleanup queue either.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("normalizes a synchronous command failure and clears its watchdog", async () => {
    const redis = redisMock();
    redis.eval.mockImplementationOnce(() => { throw new Error("private Redis error"); });
    await expect(limiter.acquireAILease()).rejects.toMatchObject({ code: "ai_unavailable", message: "ai_unavailable" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([null, [], [1], [1, 7], [2, -1], [3, 0], ["1", 0]].map(reply => ({ reply })))("rejects uncertain admission reply $reply", async ({ reply }) => {
    const redis = redisMock();
    redis.eval.mockResolvedValueOnce(reply);
    await expect(limiter.acquireAILease()).rejects.toMatchObject({ code: "ai_unavailable" });
    expect(redis.zrem).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([0, null, [1], "1"].map(reply => ({ reply })))("loses ownership once on renewal reply $reply without releasing transport's reservation", async ({ reply }) => {
    const redis = redisMock();
    const onLost = vi.fn();
    const release = await limiter.acquireAILease("tenant", { onLost });
    redis.eval.mockResolvedValueOnce(reply);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onLost).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ code: "ai_unavailable", message: "ai_unavailable" }));
    expect(onLost.mock.calls[0][0]).toBeInstanceOf(limiter.AIProviderLimitError);
    expect(redis.zrem).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(redis.eval).toHaveBeenCalledTimes(2);
    release(); release();
    expect(redis.zrem).toHaveBeenCalledTimes(1);
  });

  it("bounds hung renewal, notifies once, and ignores late success until explicit release", async () => {
    const redis = redisMock();
    const renewal = deferred<number>();
    const onLost = vi.fn();
    const release = await limiter.acquireAILease(undefined, { onLost });
    redis.eval.mockReturnValueOnce(renewal.promise);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(onLost).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    renewal.resolve(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(redis.eval).toHaveBeenCalledTimes(2);
    expect(redis.zrem).not.toHaveBeenCalled();
    release();
    expect(redis.zrem).toHaveBeenCalledTimes(1);
  });

  it("uses a smaller watchdog for a short supported lease", async () => {
    const redis = redisMock();
    const onLost = vi.fn();
    const release = await limiter.acquireAILease(undefined, { ttlMs: 1000, onLost });
    redis.eval.mockReturnValueOnce(new Promise(() => {}));
    await vi.advanceTimersByTimeAsync(666);
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    release();
  });

  it("fails closed without issuing renewal on a not-ready client", async () => {
    const redis = redisMock();
    const onLost = vi.fn();
    const release = await limiter.acquireAILease(undefined, { onLost });
    redis.status = "reconnecting";
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(redis.eval).toHaveBeenCalledTimes(1);
    release();
    expect(redis.zrem).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not attempt renewal after a worker stall passes the conservative live bound", async () => {
    const redis = redisMock();
    const onLost = vi.fn();
    const release = await limiter.acquireAILease(undefined, { onLost });
    vi.spyOn(performance, "now").mockReturnValue(30_001);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(redis.eval).toHaveBeenCalledTimes(1);
    release();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects an overdue renewal reply before its watchdog callback runs", async () => {
    const redis = redisMock();
    const renewal = deferred<number>();
    const onLost = vi.fn();
    const release = await limiter.acquireAILease(undefined, { onLost });
    redis.eval.mockReturnValueOnce(renewal.promise);
    await vi.advanceTimersByTimeAsync(10_000);
    vi.spyOn(performance, "now").mockReturnValue(15_001);
    renewal.resolve(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(onLost).toHaveBeenCalledTimes(1);
    release();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["resolve", "reject"] as const)("release cancels a pending renewal watchdog; late %s cannot restart it", async outcome => {
    const redis = redisMock();
    const renewal = deferred<number>();
    const onLost = vi.fn();
    const release = await limiter.acquireAILease(undefined, { onLost });
    redis.eval.mockReturnValueOnce(renewal.promise);
    await vi.advanceTimersByTimeAsync(10_000);
    release(); release();
    expect(vi.getTimerCount()).toBe(0);
    if (outcome === "resolve") renewal.resolve(1);
    else renewal.reject(new Error("late renewal failure"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onLost).not.toHaveBeenCalled();
    expect(redis.eval).toHaveBeenCalledTimes(2);
    expect(redis.zrem).toHaveBeenCalledTimes(outcome === "resolve" ? 2 : 1);
    for (const args of redis.zrem.mock.calls) expect(args).toEqual([redis.eval.mock.calls[0][2], redis.eval.mock.calls[0][4]]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["sync", "async"])("isolates %s onLost callback failures and supports reentrant release", async failure => {
    const redis = redisMock();
    let release!: import("./aiProviderLimiter").AILease;
    const onLost = vi.fn(() => {
      release();
      if (failure === "sync") throw new Error("notification failed");
      return Promise.reject(new Error("notification failed"));
    });
    release = await limiter.acquireAILease(undefined, { onLost });
    redis.eval.mockRejectedValueOnce(new Error("private renewal failure"));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(redis.zrem).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("release between renewal acknowledgement and continuation cannot schedule another renewal", async () => {
    const redis = redisMock();
    const renewal = deferred<number>();
    const onLost = vi.fn();
    const release = await limiter.acquireAILease(undefined, { onLost });
    redis.eval.mockReturnValueOnce(renewal.promise);
    await vi.advanceTimersByTimeAsync(10_000);
    renewal.resolve(1);
    await Promise.resolve(); // boundedCommand accepted the reply; renew has not resumed.
    release();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(redis.eval).toHaveBeenCalledTimes(2);
    expect(redis.zrem).toHaveBeenCalledTimes(2);
    expect(onLost).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("fails closed if the renewal continuation resumes after the control-plane deadline", async () => {
    const redis = redisMock();
    const renewal = deferred<number>();
    const onLost = vi.fn();
    const release = await limiter.acquireAILease(undefined, { onLost });
    redis.eval.mockReturnValueOnce(renewal.promise);
    await vi.advanceTimersByTimeAsync(10_000);
    renewal.resolve(1);
    await Promise.resolve(); // Reply accepted just before a simulated event-loop stall.
    vi.spyOn(performance, "now").mockReturnValue(15_001);
    await vi.advanceTimersByTimeAsync(0);
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    release();
  });

  it.each(["sync", "hung"])("release tolerates %s cleanup without timers or repeat renewal", async failure => {
    const redis = redisMock();
    const release = await limiter.acquireAILease();
    redis.zrem.mockImplementation(() => {
      if (failure === "sync") throw new Error("cleanup failed");
      return new Promise(() => {});
    });
    expect(() => { release(); release(); }).not.toThrow();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(redis.eval).toHaveBeenCalledTimes(1);
    expect(redis.zrem).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});