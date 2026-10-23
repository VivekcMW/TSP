import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { query, release, connect, set, storage, enqueuePublishDraft, enqueueInboxRefresh, cronSchedule, observeStart, observeFinish } = vi.hoisted(() => ({
  query: vi.fn(), release: vi.fn(), connect: vi.fn(), set: vi.fn(),
  storage: { getSchedulerScopes: vi.fn(), getScheduledDraftsForPublishing: vi.fn(), getDraftScheduleTargetsForPublishing: vi.fn(), getSchedulerActivity: vi.fn() },
  enqueuePublishDraft: vi.fn(), enqueueInboxRefresh: vi.fn(), cronSchedule: vi.fn(),
  observeStart: vi.fn(), observeFinish: vi.fn(),
}));
vi.mock("../db", () => ({ pool: { connect } }));
vi.mock("../storage", () => ({ storage }));
vi.mock("../lib/redis", () => ({ redis: { set } }));
vi.mock("./queue", () => ({ enqueuePublishDraft, enqueueInboxRefresh }));
vi.mock("node-cron", () => ({ default: { schedule: cronSchedule } }));
vi.mock("./execution-health", () => ({ observeSchedulerStart: observeStart, observeSchedulerFinish: observeFinish }));
import { intervalCron, runSchedulerCycle, publishDueDrafts, scheduleActiveUserRefresh, initializeScheduler, stopScheduler } from "./scheduler";

beforeEach(() => {
  vi.resetAllMocks();
  connect.mockResolvedValue({ query, release, on: vi.fn(), removeListener: vi.fn() });
  query.mockResolvedValue({ rows: [{ locked: true }] });
  set.mockResolvedValue("OK");
  cronSchedule.mockReturnValue({ stop: vi.fn() });
});
afterEach(async () => { await stopScheduler(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("scheduler", () => {
  it("registers essential communication recovery independently of optional digest and announcement flags", async () => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("BACKGROUND_JOBS_ENABLED", "true"); vi.stubEnv("CRON_SCHEDULER", "true");
    vi.stubEnv("EMAIL_DIGEST_ENABLED", "false"); vi.stubEnv("EMAIL_ANNOUNCEMENTS_ENABLED", "false"); vi.stubEnv("EMAIL_WEEKLY_SUMMARY_ENABLED", "false"); vi.stubEnv("POOL_CRAWL_ENABLED", "false");
    expect(await initializeScheduler()).toBe(true);
    expect(cronSchedule).toHaveBeenCalledTimes(4);
  });
  it("does not register communication senders outside production scheduler gates", async () => {
    vi.stubEnv("BACKGROUND_JOBS_ENABLED", "false");
    expect(await initializeScheduler()).toBe(false);
    expect(cronSchedule).not.toHaveBeenCalled();
  });
  it.each([[1, "*/1 * * * *"], [30, "*/30 * * * *"], [60, "0 */1 * * *"], [360, "0 */6 * * *"], [1440, "0 */24 * * *"]])("maps %i minutes to valid cadence", (minutes, expression) => {
    expect(intervalCron(Number(minutes))).toBe(expression);
  });
  it.each([0, -1, NaN, 1.5, 90, 7, 1500])("rejects inexact/invalid cadence %s", (minutes) => expect(() => intervalCron(minutes)).toThrow());
  it("registers each task only once with UTC and local no-overlap", () => {
    scheduleActiveUserRefresh(); scheduleActiveUserRefresh();
    expect(cronSchedule).toHaveBeenCalledTimes(1);
    expect(cronSchedule).toHaveBeenCalledWith("0 */6 * * *", expect.any(Function), { timezone: "UTC", noOverlap: true });
  });
  it("does not run while another instance holds the transaction lock", async () => {
    query.mockResolvedValue({ rows: [{ locked: false }] });
    const work = vi.fn();
    await runSchedulerCycle("publish", 1, work);
    expect(work).not.toHaveBeenCalled(); expect(set).not.toHaveBeenCalled();
    expect(query).toHaveBeenLastCalledWith("ROLLBACK"); expect(release).toHaveBeenCalled();
    expect(observeStart).not.toHaveBeenCalled(); expect(observeFinish).not.toHaveBeenCalled();
  });
  it("suppresses another completed execution of the same slot", async () => {
    set.mockResolvedValue(null);
    const work = vi.fn(); await runSchedulerCycle("publish", 1, work);
    expect(work).not.toHaveBeenCalled();
    expect(observeStart).not.toHaveBeenCalled(); expect(observeFinish).not.toHaveBeenCalled();
  });
  it("does not overlap inside one process", async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const work = vi.fn(async () => gate);
    const first = runSchedulerCycle("publish", 1, work);
    await runSchedulerCycle("publish", 1, work);
    finish(); await first;
    expect(work).toHaveBeenCalledTimes(1); expect(connect).toHaveBeenCalledTimes(1);
  });
  it("fails closed and releases the lock on Redis errors", async () => {
    set.mockRejectedValue(new Error("redis down"));
    const work = vi.fn(); await expect(runSchedulerCycle("publish", 1, work)).rejects.toThrow("redis down");
    expect(work).not.toHaveBeenCalled(); expect(release).toHaveBeenCalled();
  });
  it("records matching start and success observations for an admitted cycle", async () => {
    const work = vi.fn().mockResolvedValue(undefined);
    await runSchedulerCycle("publish", 1, work);
    expect(observeStart).toHaveBeenCalledWith("publish", 1, expect.any(String));
    expect(observeFinish).toHaveBeenCalledWith("publish", observeStart.mock.calls[0][2], true);
    expect(work).toHaveBeenCalledTimes(1);
  });
  it("preserves a failed work result even when completion observation also fails", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    observeFinish.mockRejectedValue(new Error("health write unavailable"));
    const work = vi.fn().mockRejectedValue(new Error("queue unavailable"));
    await expect(runSchedulerCycle("publish", 1, work)).rejects.toThrow("queue unavailable");
    expect(observeFinish).toHaveBeenCalledWith("publish", observeStart.mock.calls[0][2], false);
    expect(logged).toHaveBeenCalledWith("[scheduler:health] Could not record cycle completion");
    expect(work).toHaveBeenCalledTimes(1);
  });
  it("logs observation failures without skipping or repeating successful work", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    observeStart.mockRejectedValue(new Error("health write unavailable"));
    observeFinish.mockRejectedValue(new Error("health write unavailable"));
    const work = vi.fn().mockResolvedValue(undefined);
    await runSchedulerCycle("publish", 1, work);
    expect(work).toHaveBeenCalledTimes(1); expect(logged).toHaveBeenCalledTimes(2);
  });
  it("revisits still-pending targets after partial enqueue failure with stable IDs", async () => {
    const scope = { tenantId: "tenant", userId: "owner" };
    storage.getSchedulerScopes.mockImplementation(async (cursor) => cursor ? [] : [scope]);
    storage.getScheduledDraftsForPublishing.mockResolvedValue([{ id: "s", draftId: "d", scheduledPublishAt: new Date(0) }]);
    storage.getDraftScheduleTargetsForPublishing.mockResolvedValue([{ id: "a", platform: "linkedin" }, { id: "b", platform: "twitter" }]);
    enqueuePublishDraft.mockResolvedValue("job").mockRejectedValueOnce(new Error("down"));
    await expect(publishDueDrafts()).rejects.toThrow("down");
    await publishDueDrafts();
    expect(storage.getScheduledDraftsForPublishing).toHaveBeenCalledWith(scope, 50);
    expect(storage.getDraftScheduleTargetsForPublishing).toHaveBeenCalledWith(scope, "s");
    expect(enqueuePublishDraft.mock.calls.map(([data]) => data.draftScheduleTargetId)).toEqual(["a", "a", "b"]);
  });
});