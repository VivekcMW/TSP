import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ set: vi.fn(), del: vi.fn(), scan: vi.fn(), mget: vi.fn() }));
vi.mock("../lib/redis", () => ({ redis: m }));
import { readWorkerHealth, startWorkerHeartbeat, stopWorkerHeartbeat } from "./worker-health";
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); m.set.mockResolvedValue("OK"); m.scan.mockResolvedValue(["0", ["key"]]); m.mget.mockResolvedValue([JSON.stringify({ queues: ["inbox"], observedAt: Date.now() })]); });
afterEach(async () => { await stopWorkerHeartbeat(); vi.useRealTimers(); });
it("registers expiring heartbeat metadata and stops its timer on shutdown", async () => {
  await startWorkerHeartbeat(["inbox", "publishing"]);
  expect(m.set).toHaveBeenCalledWith(expect.stringContaining(":workers:"), expect.any(String), "EX", 60);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(m.set).toHaveBeenCalledTimes(2);
  await stopWorkerHeartbeat(); await vi.advanceTimersByTimeAsync(30_000);
  expect(m.set).toHaveBeenCalledTimes(2);
});
it("counts only recent queue workers and returns unknown on corrupt/unavailable observations", async () => {
  expect(await readWorkerHealth()).toEqual({ available: true, inbox: 1, publishing: 0 });
  m.mget.mockResolvedValue([JSON.stringify({ queues: ["inbox"], observedAt: Date.now() - 61_000 })]);
  expect(await readWorkerHealth()).toEqual({ available: true, inbox: 0, publishing: 0 });
  m.mget.mockResolvedValue(["invalid"]);
  expect(await readWorkerHealth()).toEqual({ available: false, inbox: null, publishing: null });
});
it("clears the timer and permits queue shutdown even if heartbeat removal fails", async () => {
  await startWorkerHeartbeat(["inbox"]);
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  m.del.mockRejectedValueOnce(new Error("Redis unavailable"));
  await expect(stopWorkerHeartbeat()).resolves.toBeUndefined();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(m.set).toHaveBeenCalledTimes(1);
  expect(log).toHaveBeenCalledWith("[workers:health] Heartbeat cleanup unavailable; observation will expire");
  log.mockRestore();
});
