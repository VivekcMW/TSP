import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { run } = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("../lib/redis", () => ({ redis: undefined }));
vi.mock("./queue", () => ({ queueOptions: vi.fn() }));
vi.mock("bull", () => ({ default: vi.fn() }));
vi.mock("../db", () => { throw new Error("Database access forbidden in job deadline tests"); });
vi.mock("../services/editorial-request", () => ({ executeEditorialRequest: vi.fn() }));
vi.mock("../services/tenancy", () => ({ resolveTenantContext: vi.fn() }));
vi.mock("../services/generation-quota", () => ({ assertGenerationAdmission: vi.fn(), generationAccessFailure: () => undefined,
  generationOperationId: (id: string) => id, runGeneration: run }));
import { EditorialJobs, EDITORIAL_DEADLINE_MS } from "./editorial";
import type { PreparedEditorialRequest } from "../services/editorial-request";

const start = Date.parse("2026-10-01T00:00:00Z");
const scope = { tenantId: "trusted-tenant", userId: "trusted-user" };
const intent = "00000000-0000-4000-8000-000000000001";
const attackerId = "00000000-0000-4000-8000-000000000099";
const prepared: PreparedEditorialRequest = { input: { requestIntent: intent, title: "Trial", content: "Desk reports a trial in thirty stores.", selectedPlatforms: ["linkedin"], media: [], format: "short-post" }, options: {} };
let record: Record<string, string>;
let jobs: EditorialJobs;
const execute = vi.fn(), allowed = vi.fn(), add = vi.fn();
// In-memory test double only; never creates a Redis client or TCP listener.
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
  vi.useFakeTimers(); vi.setSystemTime(start); vi.clearAllMocks(); record = {};
  allowed.mockResolvedValue(true); add.mockResolvedValue({}); execute.mockResolvedValue({ posts: {} });
  run.mockImplementation(async (_scope, _id, _kind, _input, _signal, work) => work());
  jobs = new EditorialJobs(store as any, { add } as any, execute, allowed);
});
afterEach(() => { jobs.abortWorkers(); expect(vi.getTimerCount()).toBe(0); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("persisted editorial job deadline across authorization and quota waits", () => {
  it("passes the actual job UUID and persisted 300s deadline separately from the 240s writer cap", async () => {
    const id = await jobs.enqueue(scope, prepared);
    vi.setSystemTime(start + 10_000);
    await jobs.process(id);
    expect(EDITORIAL_DEADLINE_MS).toBe(300_000);
    expect(execute.mock.calls[0].slice(3)).toEqual([240_000, { deadlineAt: start + 300_000, jobId: id }]);
    expect(id).not.toBe(intent);
    expect(run.mock.calls[0][1]).toBe(intent);
    expect(record.status).toBe("completed");
  });

  it("recomputes remaining time after queue residence, authorization and quota waits", async () => {
    const id = await jobs.enqueue(scope, prepared);
    vi.setSystemTime(start + 100_000);
    allowed.mockImplementationOnce(async () => { vi.setSystemTime(start + 150_000); return true; });
    run.mockImplementationOnce(async (_scope, _id, _kind, _input, _signal, work) => { vi.setSystemTime(start + 220_000); return work(); });
    await jobs.process(id);
    expect(execute.mock.calls[0].slice(3)).toEqual([80_000, { deadlineAt: start + 300_000, jobId: id }]);
    expect(record.status).toBe("completed");
  });

  it.each(["authorization", "quota"] as const)("does not dispatch after expiry during %s even before its timer callback fires", async wait => {
    const id = await jobs.enqueue(scope, prepared);
    if (wait === "authorization") allowed.mockImplementationOnce(async () => { vi.setSystemTime(start + 300_000); return true; });
    else run.mockImplementationOnce(async (_scope, _id, _kind, _input, _signal, work) => { vi.setSystemTime(start + 300_000); return work(); });
    await jobs.process(id);
    expect(execute).not.toHaveBeenCalled();
    if (wait === "authorization") expect(run).not.toHaveBeenCalled();
    expect(record.status).toBe("failed"); expect(JSON.parse(record.error).body.code).toBe("ai_timeout");
  });

  it("does not dispatch after cancellation while quota admission waits", async () => {
    const id = await jobs.enqueue(scope, prepared);
    run.mockImplementationOnce(async (_scope, _id, _kind, _input, _signal, work) => { jobs.abortWorkers(); return work(); });
    await jobs.process(id);
    expect(execute).not.toHaveBeenCalled(); expect(JSON.parse(record.error).body.code).toBe("ai_cancelled");
  });

  it("does not let persisted arbitrary preferences override deadline, budget, identity, or scope", async () => {
    const injected = { ...prepared, options: { voice: "Saved voice", timeoutMs: 1, deadlineAt: start + 1, jobId: attackerId,
      diagnosticContext: { jobId: attackerId }, scope: { tenantId: "attacker" }, voiceScope: { tenantId: "attacker", userId: "attacker" } } };
    const id = await jobs.enqueue(scope, injected);
    await jobs.process(id);
    const [request, , , timeoutMs, context] = execute.mock.calls[0];
    expect(request.options).toEqual({ voice: "Saved voice", scope: { tenantId: scope.tenantId }, voiceScope: scope, format: undefined, userContext: undefined });
    expect(timeoutMs).toBe(240_000); expect(context).toEqual({ deadlineAt: start + 300_000, jobId: id });
    expect(JSON.stringify(execute.mock.calls)).not.toContain(attackerId);
  });

  it("uses the persisted enqueue timestamp rather than renewing on a later worker", async () => {
    const id = await jobs.enqueue(scope, prepared);
    vi.setSystemTime(start + 300_001);
    await jobs.process(id);
    expect(allowed).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
    expect(JSON.parse(record.error).body.code).toBe("ai_timeout");
  });
});