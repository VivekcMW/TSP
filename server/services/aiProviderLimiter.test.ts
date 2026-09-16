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
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const redisMock = () => state.redis = { status: "ready", eval: vi.fn().mockResolvedValue([1, 0]), zrem: vi.fn().mockResolvedValue(1) };

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