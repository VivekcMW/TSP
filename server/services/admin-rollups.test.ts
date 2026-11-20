import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ execute: vi.fn(), values: vi.fn(), upsert: vi.fn(), transaction: vi.fn(), pages: [] as { id: string }[][] }));
vi.mock("../db", () => ({ db: {
  transaction: m.transaction,
  select: () => {
    const chain = { from() { return chain; }, where() { return chain; }, orderBy() { return chain; },
      limit: async () => m.pages.shift() ?? [] };
    return chain;
  },
} }));
import { collectAdminRollups, collectTenantRollup } from "./admin-rollups";
beforeEach(() => {
  vi.resetAllMocks(); m.pages = [];
  m.execute.mockResolvedValue({ rows: [{ inboxItems: 2, drafts: 3, engineRuns: 4, failedSchedules: 0 }] });
  m.values.mockReturnValue({ onConflictDoUpdate: m.upsert });
  m.transaction.mockImplementation(async callback => callback({ execute: m.execute, insert: () => ({ values: m.values }) }));
});
afterEach(() => vi.restoreAllMocks());
it("upserts only observed counts after tenant-local measurement succeeds", async () => {
  expect(await collectTenantRollup("tenant")).toMatchObject({ tenantId: "tenant", inboxItems: 2, drafts: 3 });
  expect(m.execute).toHaveBeenCalledTimes(3);
  expect(m.upsert).toHaveBeenCalledWith(expect.objectContaining({ set: expect.objectContaining({ tenantId: "tenant", observedAt: expect.any(Date) }) }));
});
it.each([undefined, { inboxItems: -1 }, { inboxItems: null }, { inboxItems: 1.5 }, { inboxItems: 1 }])("does not overwrite a prior snapshot with invalid measurements (%j)", async row => {
  m.execute.mockResolvedValue({ rows: row ? [row] : [] });
  await expect(collectTenantRollup("tenant")).rejects.toThrow("Invalid rollup");
  expect(m.values).not.toHaveBeenCalled();
});
it("does not upsert after a failed database measurement", async () => {
  m.execute.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(new Error("Statement timeout"));
  await expect(collectTenantRollup("tenant")).rejects.toThrow("Statement timeout");
  expect(m.values).not.toHaveBeenCalled();
});
it("collects keyset pages with at most four transactions and rechecks the scheduler before each batch", async () => {
  m.pages = [Array.from({ length: 9 }, (_, id) => ({ id: String(id) })), []];
  const original = m.transaction.getMockImplementation()!;
  let active = 0, peak = 0;
  m.transaction.mockImplementation(async callback => {
    active++; peak = Math.max(peak, active);
    try { return await original(callback); } finally { active--; }
  });
  const connected = vi.fn().mockResolvedValue(undefined);
  expect(await collectAdminRollups(connected)).toEqual({ collected: 9 });
  expect(peak).toBe(4); expect(connected).toHaveBeenCalledTimes(3);
});
it("reports partial collection as failed and retains successful observations without fabricating the failed one", async () => {
  m.pages = [[{ id: "a" }, { id: "b" }], []];
  m.transaction.mockRejectedValueOnce(new Error("Database unavailable"));
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  await expect(collectAdminRollups()).rejects.toThrow("1 workspaces unavailable");
  expect(m.upsert).toHaveBeenCalledTimes(1);
  expect(log).toHaveBeenCalledWith("[admin:rollups] Workspace collection unavailable; prior observation retained");
});
it("stops collection when scheduler connectivity is lost before a batch", async () => {
  m.pages = [[{ id: "a" }]];
  await expect(collectAdminRollups(async () => { throw new Error("Scheduler lock lost"); })).rejects.toThrow("Scheduler lock lost");
  expect(m.transaction).not.toHaveBeenCalled();
});
