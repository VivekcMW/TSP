import { expect, it, vi } from "vitest";
vi.mock("../db", () => ({ db: {} }));
vi.mock("../jobs/queue", () => ({ getQueueHealth: vi.fn() }));
vi.mock("../jobs/worker-health", () => ({ readWorkerHealth: vi.fn() }));
vi.mock("../jobs/execution-health", () => ({ readSchedulerExecutionHealth: vi.fn() }));
vi.mock("./admin-jobs", () => ({ waitingAge: vi.fn() }));
vi.mock("./admin-quotas", () => ({ AdminControlConflict: class extends Error {} }));
import { incidentSignals, type OperationalSnapshot } from "./admin-incidents";
function snapshot(): OperationalSnapshot {
  return { generatedAt: new Date().toISOString(), expected: true, queue: { configured: true, reachable: true, queuesReady: true },
    workers: { available: true, inbox: 1, publishing: 1 }, execution: { available: true, tasks: [] },
    ages: { inbox: { available: true, complete: true, oldestMs: 0, scanned: 0 }, publishing: { available: true, complete: true, oldestMs: 0, scanned: 0 } } };
}
it("does not create production incidents for deliberate local worker disablement", () => {
  const input = snapshot(); input.expected = false; input.queue.reachable = false;
  expect(incidentSignals(input)).toEqual([]);
});
it("does not resolve a worker absence or old backlog from missing/incomplete observations", () => {
  const input = snapshot(); input.workers = { available: false, inbox: null, publishing: null };
  input.ages!.inbox.complete = false;
  const signals = incidentSignals(input);
  expect(signals.some(signal => signal.signal === "workers:inbox")).toBe(false);
  expect(signals.some(signal => signal.signal === "queue:age:inbox")).toBe(false);
});
it("uses exact fifteen-minute backlog threshold and detects missing workers", () => {
  const input = snapshot(); input.workers.inbox = 0; input.ages!.inbox.oldestMs = 900_001;
  expect(incidentSignals(input)).toContainEqual(expect.objectContaining({ signal: "workers:inbox", active: true }));
  expect(incidentSignals(input)).toContainEqual(expect.objectContaining({ signal: "queue:age:inbox", active: true }));
});
