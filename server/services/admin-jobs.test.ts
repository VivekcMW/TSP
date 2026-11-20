import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ getJob: vi.fn(), enqueue: vi.fn(), receipt: vi.fn(), results: [] as unknown[][], getWaiting: vi.fn() }));
vi.mock("../db", () => ({ db: { select: () => {
  const chain = { from() { return chain; }, where() { return chain; }, limit: async () => m.results.shift() ?? [] }; return chain;
} } }));
vi.mock("../jobs/queue", () => ({
  getInboxRefreshQueue: () => ({ getJob: m.getJob, getWaiting: m.getWaiting }), getPublishDraftQueue: () => ({ getJob: m.getJob, getWaiting: m.getWaiting }),
  enqueueInboxRefresh: m.enqueue, QueueUnavailableError: class extends Error {},
}));
vi.mock("../storage", () => ({ storage: { getInboxRefreshReceipt: m.receipt } }));
vi.mock("./admin-quotas", () => ({ AdminControlConflict: class extends Error {} }));
import { getAdminJob, recoverDiscoveryJob, waitingAge } from "./admin-jobs";
const data = { tenantId: "tenant", userId: "user", operationId: "original", dedupeKey: "job" };
let state: string;
beforeEach(() => {
  vi.clearAllMocks(); state = "failed"; m.results = [[{ status: "active" }], [{ userId: "user" }]];
  m.getJob.mockImplementation(async () => ({ id: "job", data, timestamp: Date.now(), attemptsMade: 3, getState: async () => state }));
  m.receipt.mockResolvedValue(null); m.enqueue.mockImplementation(async () => { state = "waiting"; return "job"; });
});
it("recovers only the original retained discovery operation and verifies post-admission state", async () => {
  expect(await recoverDiscoveryJob("job", "original", "tenant")).toMatchObject({ outcome: "waiting" });
  expect(m.enqueue).toHaveBeenCalledWith({ ...data, manual: true });
  expect(m.enqueue).toHaveBeenCalledTimes(1);
});
it("never creates fresh work after a persisted receipt or already admitted state", async () => {
  m.receipt.mockResolvedValue({ status: "complete" });
  expect(await recoverDiscoveryJob("job", "original", "tenant")).toMatchObject({ outcome: "completed" });
  expect(m.enqueue).not.toHaveBeenCalled();
});
it("looks up the original auto-refresh receipt without changing its mode or replaying committed work", async () => {
  m.getJob.mockResolvedValue({ id: "job", data: { ...data, autoRefresh: true }, timestamp: Date.now(), getState: async () => "failed" });
  m.receipt.mockResolvedValue({ status: "complete" });
  expect(await recoverDiscoveryJob("job", "original", "tenant")).toMatchObject({ outcome: "completed" });
  expect(m.receipt).toHaveBeenCalledWith({ tenantId: "tenant", userId: "user" }, "original", true);
  expect(m.enqueue).not.toHaveBeenCalled();
});
it("rejects different tenant/operation, inactive membership and a dedupe key not bound to the retained ID", async () => {
  await expect(recoverDiscoveryJob("job", "other", "tenant")).rejects.toThrow("original");
  await expect(recoverDiscoveryJob("job", "original", "other")).rejects.toThrow("original");
  m.results = [[{ status: "suspended" }], [{ userId: "user" }]];
  await expect(recoverDiscoveryJob("job", "original", "tenant")).rejects.toThrow("active workspace");
  m.getJob.mockResolvedValue({ id: "different-job", data });
  await expect(recoverDiscoveryJob("different-job", "original", "tenant")).rejects.toThrow("original");
  expect(m.enqueue).not.toHaveBeenCalled();
});
it("never exposes publication replay eligibility or provider failure payloads", async () => {
  expect(await getAdminJob("publishing", "job")).toMatchObject({ recoveryEligible: false });
  expect(await getAdminJob("inbox", "job")).not.toHaveProperty("failedReason");
});
it("bounds backlog scans and marks incomplete rather than certifying a sampled queue", async () => {
  m.getWaiting.mockResolvedValue(Array.from({ length: 100 }, () => ({ timestamp: Date.now() - 60_000 })));
  const result = await waitingAge("inbox");
  expect(result).toMatchObject({ scanned: 5000, complete: false });
  expect(m.getWaiting).toHaveBeenCalledTimes(50);
});
