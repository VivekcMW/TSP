import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ admission: vi.fn(), run: vi.fn() }));
vi.mock("../lib/redis", () => ({ redis: undefined }));
vi.mock("./queue", () => ({ queueOptions: vi.fn() }));
vi.mock("../services/editorial-request", () => ({ executeEditorialRequest: vi.fn() }));
vi.mock("../services/tenancy", () => ({ resolveTenantContext: vi.fn() }));
vi.mock("../db", () => ({ db: {} }));
vi.mock("../services/generation-quota", async original => ({ ...await original<typeof import("../services/generation-quota")>(), assertGenerationAdmission: mocks.admission, runGeneration: mocks.run }));
import { EditorialJobs } from "./editorial";
import { GenerationQuotaError } from "../services/generation-quota";
import type { PreparedEditorialRequest } from "../services/editorial-request";

const scope = { tenantId: "trusted-tenant", userId: "trusted-user" };
const intent = "00000000-0000-4000-8000-000000000001";
const prepared: PreparedEditorialRequest = { input: { requestIntent: intent, title: "Trial", content: "A bounded source for generation.", selectedPlatforms: ["linkedin"], media: [], format: "short-post" }, options: { scope: { tenantId: "untrusted" }, format: "short-post" } };
let record: Record<string, string>, jobs: EditorialJobs;
const add = vi.fn(), execute = vi.fn();
const store = {
  hgetall: vi.fn(async () => ({ ...record })), get: vi.fn(async () => null),
  eval: vi.fn(async (script: string, _keys: number, ...args: any[]) => {
    if (script.includes("editorial:create")) {
      const [, , id, tenantId, userId, input, progress, createdAt, , identity] = args;
      record = { tenantId, userId, input, progress, createdAt: String(createdAt), identity, status: "queued" }; return id;
    }
    if (script.includes("editorial:claim")) { if (record.status !== "queued") return 0; record.status = "active"; delete record.input; return 1; }
    if (script.includes("editorial:finish")) { const [, , , status, key, value] = args; if (!["queued", "active"].includes(record.status)) return 0; record.status = status; record[key] = value; return 1; }
    return 1;
  }),
};
beforeEach(() => {
  vi.clearAllMocks(); record = {}; mocks.admission.mockResolvedValue(undefined);
  mocks.run.mockImplementation(async (_scope, _id, _kind, _input, _signal, work) => work());
  execute.mockResolvedValue({ posts: {}, details: {}, format: "short-post" }); add.mockResolvedValue({});
  jobs = new EditorialJobs(store as any, { add } as any, execute, async () => true);
});
describe("billing at editorial admission and execution (no Redis/DB/provider)", () => {
  it("never exposes completed output when durable success recording fails", async () => {
    mocks.run.mockImplementationOnce(async (_scope, _id, _kind, _input, _signal, work) => {
      await work();
      expect(record.status).toBe("active");
      expect(record.result).toBeUndefined();
      throw new GenerationQuotaError(503, "generation_usage_unavailable", "Outcome recording unavailable");
    });
    const id = await jobs.enqueue(scope, prepared); await jobs.process(id);
    expect(execute).toHaveBeenCalledTimes(1); expect(record.status).toBe("failed");
    expect(record.result).toBeUndefined(); expect(JSON.parse(record.error).body.code).toBe("generation_usage_unavailable");
  });
  it("denies admission before queue work", async () => {
    mocks.admission.mockRejectedValueOnce(new GenerationQuotaError(403, "entitlement_required", "Denied"));
    await expect(jobs.enqueue(scope, prepared)).rejects.toMatchObject({ statusCode: 403 });
    expect(add).not.toHaveBeenCalled(); expect(store.eval).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  });
  it("rechecks at execution and preserves denial without running providers", async () => {
    const id = await jobs.enqueue(scope, prepared);
    mocks.run.mockRejectedValueOnce(new GenerationQuotaError(429, "generation_quota_exceeded", "Exhausted", 60));
    await jobs.process(id);
    expect(mocks.admission).toHaveBeenCalledWith(scope.tenantId);
    expect(mocks.run).toHaveBeenCalledWith(scope, intent, "manual", prepared.input, expect.any(AbortSignal), expect.any(Function));
    expect(execute).not.toHaveBeenCalled(); expect(record.status).toBe("failed");
    expect(JSON.parse(record.error)).toMatchObject({ status: 429, body: { code: "generation_quota_exceeded" } });
    await jobs.process(id); expect(mocks.run).toHaveBeenCalledTimes(1);
  });
  it("uses trusted owner and durable request intent, not transient job ID, for one attempt", async () => {
    const id = await jobs.enqueue(scope, prepared); await jobs.process(id); await jobs.process(id);
    expect(mocks.run).toHaveBeenCalledTimes(1); expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0].options).toMatchObject({ scope: { tenantId: scope.tenantId }, voiceScope: scope });
    expect(record.status).toBe("completed");
  });
});