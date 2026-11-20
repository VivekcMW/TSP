import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ hset: vi.fn(), expire: vi.fn(), exec: vi.fn(), eval: vi.fn(), read: vi.fn() }));
vi.mock("../lib/redis", () => ({ redis: { multi: () => ({ hset: m.hset }), eval: m.eval, hgetall: m.read } }));
import { executionState, observeSchedulerFinish, observeSchedulerStart, readSchedulerExecutionHealth } from "./execution-health";
const now = Date.parse("2026-10-23T10:00:00Z");
beforeEach(() => {
  vi.clearAllMocks(); m.hset.mockReturnValue({ expire: m.expire }); m.expire.mockReturnValue({ exec: m.exec });
  m.exec.mockResolvedValue([[null, 1], [null, 1]]); m.eval.mockResolvedValue(1); m.read.mockResolvedValue({});
});
it("shows never observed instead of assuming scheduled work succeeded", () => {
  expect(executionState({}, 1, now)).toMatchObject({ state: "never_observed", lastSuccessAt: null });
});
it("distinguishes running, explicit failed, succeeded and stale observations while preserving last success", () => {
  const raw = { run: "one", interval: "1", started: String(now - 60_000), status: "running", success: String(now - 120_000) };
  expect(executionState(raw, 1, now).state).toBe("running");
  expect(executionState({ ...raw, status: "failed", finished: String(now - 1000) }, 1, now)).toMatchObject({ state: "failed", lastSuccessAt: new Date(now - 120_000).toISOString() });
  expect(executionState({ ...raw, status: "succeeded", finished: String(now - 1000) }, 1, now).state).toBe("succeeded");
  expect(executionState({ ...raw, started: String(now - 301_000) }, 1, now).state).toBe("stale");
});
it("uses the task cadence rather than one minute for infrequent tasks", () => {
  expect(executionState({ run: "one", interval: "360", started: String(now - 60 * 60_000), status: "succeeded" }, 360, now).state).toBe("succeeded");
});
it("expires observations after 30 days and never stores provider error content", async () => {
  await observeSchedulerStart("publish", 1, "run-one");
  expect(m.hset).toHaveBeenCalledWith(expect.stringContaining("scheduler:health:publish"), expect.objectContaining({ run: "run-one", status: "running", interval: "1" }));
  expect(m.expire).toHaveBeenCalledWith(expect.any(String), 2592000);
  await observeSchedulerFinish("publish", "run-one", false);
  expect(m.eval.mock.calls[0].slice(1)).toEqual([1, expect.any(String), "run-one", "failed", expect.any(Number), 2592000]);
  expect(m.eval.mock.calls[0][0]).toContain("~= ARGV[1]");
});
it("rejects Redis transaction failures and superseded observations", async () => {
  m.exec.mockResolvedValue([[new Error("down"), null]]);
  await expect(observeSchedulerStart("publish", 1, "one")).rejects.toThrow("could not be persisted");
  m.eval.mockResolvedValue(0);
  await expect(observeSchedulerFinish("publish", "one", true)).rejects.toThrow("superseded");
});
it("returns unavailable on malformed observations rather than inventing health", async () => {
  m.read.mockResolvedValue({ status: "anything" });
  expect(await readSchedulerExecutionHealth()).toEqual({ available: false, tasks: [] });
});
it.each([0, -1, NaN, 1.5])("rejects invalid configured observation cadence %s", interval => {
  expect(() => executionState({}, interval, now)).toThrow("Invalid scheduler observation cadence");
});
