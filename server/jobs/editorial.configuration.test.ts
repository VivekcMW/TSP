import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  enabled: true, construct: vi.fn(), process: vi.fn(), close: vi.fn(), on: vi.fn(), disconnect: vi.fn(),
  options: vi.fn(), hgetall: vi.fn(),
}));
vi.mock("../lib/redis", () => ({ get redis() { return mocks.enabled ? { hgetall: mocks.hgetall } : undefined; } }));
vi.mock("./queue", () => ({ queueOptions: mocks.options }));
vi.mock("../services/editorial-request", () => ({ executeEditorialRequest: vi.fn() }));
vi.mock("../services/tenancy", () => ({ resolveTenantContext: vi.fn() }));
vi.mock("../services/generation-quota", () => ({ assertGenerationAdmission: vi.fn(), generationAccessFailure: () => undefined, generationOperationId: (id: string) => id, runGeneration: vi.fn() }));
vi.mock("bull", () => ({ default: class {
  constructor(name: string, options: any) {
    mocks.construct(name, options);
    options.createClient("client", {}); options.createClient("subscriber", {}); options.createClient("bclient", {});
  }
  process = mocks.process; close = mocks.close; on = mocks.on;
} }));
import { initializeEditorialJobs, closeEditorialJobs } from "./editorial";

beforeEach(() => {
  vi.clearAllMocks(); mocks.enabled = true;
  mocks.options.mockReturnValue({ createClient: () => ({ disconnect: mocks.disconnect }), defaultJobOptions: { attempts: 3 } });
  mocks.close.mockResolvedValue(undefined);
  vi.stubEnv("REDIS_URL", "rediss://redis.invalid:6380/2");
});
afterEach(async () => { await closeEditorialJobs(); vi.unstubAllEnvs(); });

describe("editorial worker initialization", () => {
  it("uses the existing full-URL Redis options, disables all Bull replay, and starts once", async () => {
    expect(initializeEditorialJobs()).toBeDefined(); initializeEditorialJobs();
    expect(mocks.options).toHaveBeenCalledWith("rediss://redis.invalid:6380/2");
    expect(mocks.construct).toHaveBeenCalledTimes(1);
    expect(mocks.construct).toHaveBeenCalledWith("editorial_generation", expect.objectContaining({
      settings: { maxStalledCount: 0 }, defaultJobOptions: { attempts: 1, removeOnComplete: true, removeOnFail: true },
    }));
    expect(mocks.process).toHaveBeenCalledWith(2, expect.any(Function));
    await closeEditorialJobs();
    expect(mocks.close).toHaveBeenCalledTimes(1); expect(mocks.disconnect).toHaveBeenCalledTimes(3);
  });

  it("sanitizes Redis errors before Bull can persist a failedReason", async () => {
    initializeEditorialJobs();
    mocks.hgetall.mockRejectedValueOnce(new Error("PRIVATE_REDIS_DETAILS"));
    const handler = mocks.process.mock.calls[0][1];
    await expect(handler({ data: { id: "00000000-0000-4000-8000-000000000001" } })).rejects.toThrow("Editorial queue unavailable");
  });

  it("does not initialize a worker when Redis is deliberately absent", () => {
    mocks.enabled = false;
    expect(initializeEditorialJobs()).toBeUndefined();
    expect(mocks.construct).not.toHaveBeenCalled();
  });
});