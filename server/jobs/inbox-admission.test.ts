import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inboxRefreshMessage } from "@shared/inbox-refresh";

const f = vi.hoisted(() => ({
  queues: new Map<string, any>(), process: vi.fn(), receipt: vi.fn(),
  profile: vi.fn(), log: vi.fn(), getRun: vi.fn(),
  scope: { tenantId: "tenant", userId: "reader" },
}));
vi.mock("../lib/redis", () => ({ redis: {} }));
vi.mock("../lib/redis-options", () => ({ createRedisClient: () => { throw new Error("No Redis allowed"); } }));
vi.mock("../db", () => ({ db: new Proxy({}, { get() { throw new Error("No database allowed"); } }) }));
vi.mock("../storage", () => ({
  storage: { getInboxRefreshReceipt: f.receipt, getUserProfile: f.profile, getUser: async () => ({ industry: "other" }), createEngineRunLog: f.log },
  InboxOperationConflictError: class extends Error {}, InboxCapacityError: class extends Error {},
}));
vi.mock("../middlewares/requireDbUser", () => ({
  requireDbUser: (req: any, _res: any, next: () => void) => { req.tenant = f.scope; next(); },
  authedOf: () => ({ tenant: f.scope, dbUser: { id: f.scope.userId, industry: "other" } }),
}));
vi.mock("../middlewares/requirePermission", () => ({ requirePermission: () => (_req: any, _res: any, next: () => void) => next() }));
vi.mock("../middlewares/rateLimit", () => ({ inboxRefreshRateLimit: (_req: any, _res: any, next: () => void) => next() }));
vi.mock("../services/engines/index.js", () => ({ engineRegistry: { getEngine: () => ({ config: { displayName: "Fixture" }, processForUser: f.process }) } }));
vi.mock("../services/metaEngine", () => ({ normalizeIndustryToSlug: () => "other" }));
vi.mock("../services/adminService", () => ({ getEngineRunById: f.getRun }));
vi.mock("../services/urlValidator", () => ({ validateUrl: vi.fn(), validateUrlSync: vi.fn() }));
vi.mock("./handlers/publish-draft", () => ({ handlePublishDraft: vi.fn() }));
vi.mock("bull", async original => {
  // Bull exposes Job at runtime but only declares its instance interface.
  type JobConstructor = {
    new(queue: any, data: any, opts: any): import("bull").Job;
    create(queue: any, data: any, opts: any): Promise<import("bull").Job>;
  };
  const { default: RealBull } = await original<{ default: { Job: JobConstructor } }>();
  // Real Bull Job.create and Job.retry, backed by in-memory Redis command
  // boundaries. addJob mirrors addJob-6.lua's duplicate-ID early return;
  // reprocessJob mirrors reprocessJob-6.lua's atomic failed -> waiting move.
  return { default: class {
    rows = new Map<string, any>();
    events = new Map<string, Function[]>();
    processor!: Function;
    transitions = 0;
    token = "fixture";
    keys: Record<string, string>;
    constructor(public name: string) {
      this.keys = Object.fromEntries(["", "wait", "paused", "meta-paused", "id", "delayed", "priority"].map(key => [key, this.toKey(key)]));
      f.queues.set(name, this);
    }
    toKey = (key: string) => `bull:${this.name}:${key}`;
    isReady = async () => this;
    on = (event: string, callback: Function) => { this.events.set(event, [...this.events.get(event) ?? [], callback]); };
    process = (_concurrency: number, handler: Function) => { this.processor = handler; };
    close = async () => {};
    client = {
      addJob: vi.fn(async (args: any[]) => {
        const id = String(args[7]);
        if (!this.rows.has(id)) this.rows.set(id, { data: JSON.parse(args[9]), state: "waiting", attemptsMade: 0,
          progress: 0, failedReason: null, returnvalue: null, reservations: 0 });
        return id;
      }),
      eval: vi.fn(async (_script: string, count: number, key: string, failed: string, lock: string, id: string) => {
        expect([count, key, failed, lock]).toEqual([3, this.toKey(id), this.toKey("failed"), this.toKey(`${id}:lock`)]);
        const row = this.rows.get(id);
        if (!row || row.state !== "failed" || row.locked) return 0;
        if (row.reservations >= 2) return -1;
        row.reservations++;
        return 1;
      }),
      reprocessJob: vi.fn(async (args: any[]) => {
        const row = this.rows.get(String(args[6]));
        if (!row) return 0;
        if (row.locked) return -1;
        row.failedReason = null;
        if (row.state !== "failed") return -2;
        row.state = "waiting";
        this.transitions++;
        return 1;
      }),
    };
    add = vi.fn((data: any, opts: any) => RealBull.Job.create(this as any, data, { attempts: 3, ...opts }));
    getJob = vi.fn(async (id: string) => {
      const row = this.rows.get(String(id));
      if (!row) return null;
      const job = new RealBull.Job(this as any, row.data, { attempts: 3 });
      Object.assign(job, { id, attemptsMade: row.attemptsMade, failedReason: row.failedReason, returnvalue: row.returnvalue });
      job.getState = async () => row.state;
      job.progress = vi.fn((value?: any) => {
        if (value === undefined) return row.progress;
        row.progress = value;
        return Promise.resolve();
      }) as any;
      return job;
    });
  } };
});

import { initializeQueues, closeQueues, enqueueInboxRefresh, enqueuePublishDraft, getJobStatus } from "./queue";
import { registerJobHandlers } from "./index";
import { registerInboxRoutes } from "../routes/inbox";
import { registerAdminRoutes } from "../routes/admin";

const app = express(); app.use(express.json()); registerInboxRoutes(app); registerAdminRoutes(app);
const success = { success: true, outcome: "updated", count: 2, articlesCreated: 2, newInboxItems: 2,
  articlesProcessed: 5, articlesMatched: 3, activeCount: 10, replacedCount: 2, items: [], durationMs: 1 };
const secret = "redis://private-user:PRIVATE_PASSWORD@private.example/ token=PRIVATE_TOKEN";
const queue = () => f.queues.get("inbox_refresh");
async function work(id: string) {
  const row = queue().rows.get(id); row.state = "active";
  try {
    row.returnvalue = await queue().processor(await queue().getJob(id)); row.state = "completed";
    // Bull does NOT clear failedReason after an automatic retry succeeds.
  } catch (error) {
    row.attemptsMade++; row.failedReason = (error as Error).message;
    row.state = row.attemptsMade < 3 ? "delayed" : "failed";
  }
}
beforeEach(async () => {
  vi.resetAllMocks(); f.queues.clear();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  f.receipt.mockResolvedValue(undefined); f.profile.mockResolvedValue({ id: "profile" });
  f.log.mockResolvedValue(undefined); f.process.mockResolvedValue(success);
  f.getRun.mockResolvedValue({ id: "run", userId: f.scope.userId, industry: "other" });
  initializeQueues(); await registerJobHandlers();
});
afterEach(async () => { await closeQueues(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("real routes, Bull job methods and worker with mocked infrastructure", () => {
  it.each([false, true])("retries the same failed operation after recovery (admin=%s)", async admin => {
    const url = admin ? "/api/admin/engine-runs/run/rerun" : "/api/inbox/refresh";
    const body = { operationId: randomUUID(), ...(admin ? { tenantId: f.scope.tenantId } : {}) };
    const first = await request(app).post(url).send(body).expect(admin ? 202 : 200);
    const id = first.body.jobId;
    f.process.mockRejectedValue(new Error(secret));
    for (let attempt = 0; attempt < 3; attempt++) await work(id);
    expect(queue().rows.get(id)).toMatchObject({ state: "failed", attemptsMade: 3 });
    // Prove the duplicate add itself does NOT re-enqueue and returns misleading
    // fresh in-memory attempts, just like installed Bull's Job.create.
    const stored = queue().rows.get(id);
    const duplicate = await queue().add(stored.data, { jobId: id });
    expect(duplicate.attemptsMade).toBe(0);
    expect(stored.state).toBe("failed");
    f.process.mockResolvedValue(success);
    const retried = await request(app).post(url).send(body).expect(admin ? 202 : 200);
    expect(retried.body.jobId).toBe(id);
    expect(stored).toMatchObject({ state: "waiting", attemptsMade: 3, reservations: 1 });
    await work(id);
    const polled = await request(app).get(`/api/inbox/refresh/${id}`).expect(200);
    expect(polled.body).toMatchObject({ status: "completed", error: null, progress: success });
    expect(queue().rows.size).toBe(1);
    expect(queue().transitions).toBe(1);
  });

  it("bounds explicit recovery and returns terminal failure, never falsely queued, for both routes", async () => {
    for (const admin of [false, true]) {
      const url = admin ? "/api/admin/engine-runs/run/rerun" : "/api/inbox/refresh";
      const body = { operationId: randomUUID(), ...(admin ? { tenantId: f.scope.tenantId } : {}) };
      const first = await request(app).post(url).send(body);
      const row = queue().rows.get(first.body.jobId); row.state = "failed"; row.attemptsMade = 3;
      for (let recovery = 0; recovery < 2; recovery++) {
        await request(app).post(url).send(body).expect(admin ? 202 : 200);
        row.state = "failed"; row.attemptsMade++;
      }
      const failed = await request(app).post(url).send(body).expect(409);
      expect(failed.body).toMatchObject({ status: "failed", success: false, code: "refresh_retry_exhausted" });
      expect(failed.body.message).toContain("new operationId");
      expect(failed.body).not.toHaveProperty("jobId");
      expect(row.reservations).toBe(2);
      await request(app).post(url).send({ ...body, operationId: randomUUID() }).expect(admin ? 202 : 200);
    }
  });

  it("concurrent same-ID recovery moves failed to waiting only once and never resets attempts", async () => {
    const config = { ...f.scope, operationId: "stable", dedupeKey: "stable", manual: true };
    await enqueueInboxRefresh(config);
    const row = queue().rows.get("stable"); row.state = "failed"; row.attemptsMade = 3;
    const requests = await Promise.allSettled(Array.from({ length: 10 }, () => enqueueInboxRefresh(config)));
    expect(requests.some(result => result.status === "fulfilled")).toBe(true);
    expect(row).toMatchObject({ state: "waiting", attemptsMade: 3 });
    expect(row.reservations).toBeLessThanOrEqual(2);
    expect(queue().transitions).toBe(1);
  });

  it.each(["waiting", "delayed", "active", "paused", "completed"])("does not replay a %s job", async state => {
    const config = { ...f.scope, operationId: "stable", dedupeKey: "stable", manual: true };
    await enqueueInboxRefresh(config); queue().rows.get("stable").state = state;
    expect(await enqueueInboxRefresh(config)).toBe("stable");
    expect(queue().client.reprocessJob).not.toHaveBeenCalled();
  });

  it.each([false, true])("rechecks persisted state when retry acknowledgement fails (transitioned=%s)", async transitioned => {
    const config = { ...f.scope, operationId: "stable", dedupeKey: "stable", manual: true };
    await enqueueInboxRefresh(config);
    const row = queue().rows.get("stable"); row.state = "failed"; row.attemptsMade = 3;
    queue().client.reprocessJob.mockImplementationOnce(async () => {
      if (transitioned) row.state = "waiting";
      throw new Error(secret);
    });
    if (transitioned) expect(await enqueueInboxRefresh(config)).toBe("stable");
    else await expect(enqueueInboxRefresh(config)).rejects.toThrow("Background queue unavailable");
    expect(row).toMatchObject({ state: transitioned ? "waiting" : "failed", reservations: 1, attemptsMade: 3 });
  });

  it("never reports a locked failed job as queued or recovers it automatically", async () => {
    const config = { ...f.scope, operationId: "stable", dedupeKey: "stable", manual: true };
    await enqueueInboxRefresh(config);
    const row = queue().rows.get("stable"); row.state = "failed"; row.locked = true;
    await expect(enqueueInboxRefresh(config)).rejects.toMatchObject({ code: "refresh_job_failed" });
    row.locked = false;
    await expect(enqueueInboxRefresh({ ...config, manual: false })).rejects.toMatchObject({ code: "refresh_job_failed" });
    expect(row.reservations).toBe(0);
    expect(queue().client.reprocessJob).not.toHaveBeenCalled();
  });

  it("rejects different mode/scope under a retained operation before retry", async () => {
    const config = { ...f.scope, operationId: "stable", dedupeKey: "stable", manual: true };
    await enqueueInboxRefresh(config); queue().rows.get("stable").state = "failed";
    for (const change of [{ autoRefresh: true }, { userId: "other" }, { tenantId: "other" }, { operationId: "other" }]) {
      await expect(enqueueInboxRefresh({ ...config, ...change })).rejects.toMatchObject({ code: "refresh_operation_conflict" });
    }
    expect(queue().client.reprocessJob).not.toHaveBeenCalled();
  });

  it("returns committed receipts before any recovery, and worker receipts before fetching", async () => {
    const body = { operationId: randomUUID() };
    const first = await request(app).post("/api/inbox/refresh").send(body);
    const id = first.body.jobId; const row = queue().rows.get(id);
    row.state = "failed"; row.reservations = 2;
    f.receipt.mockResolvedValue(success);
    expect((await request(app).post("/api/inbox/refresh").send(body).expect(200)).body).toEqual(success);
    await work(id);
    expect(row.returnvalue).toEqual(success);
    expect(f.process).not.toHaveBeenCalled(); expect(f.profile).not.toHaveBeenCalled();
    expect(queue().client.reprocessJob).not.toHaveBeenCalled();
  });

  it("prefers the successful worker result after automatic retry, despite stale failure/progress", async () => {
    const first = await request(app).post("/api/inbox/refresh").send({});
    f.process.mockRejectedValueOnce(new Error(secret));
    await work(first.body.jobId);
    const row = queue().rows.get(first.body.jobId);
    expect(row.state).toBe("delayed");
    expect(await getJobStatus(first.body.jobId)).toMatchObject({ error: null });
    await work(first.body.jobId);
    expect(row.failedReason).toBe(inboxRefreshMessage("failure"));
    row.progress = { success: false, error: "stale failure" };
    expect((await request(app).get(`/api/inbox/refresh/${first.body.jobId}`).expect(200)).body)
      .toMatchObject({ status: "completed", error: null, progress: success });
  });

  it("sanitizes queue admission, status and registered worker error listeners", async () => {
    for (const q of f.queues.values()) {
      for (const callback of q.events.get("error") ?? []) callback(new Error(secret));
      for (const callback of q.events.get("failed") ?? []) callback({ id: secret, data: { platform: secret } }, new Error(secret));
    }
    queue().add.mockRejectedValue(new Error(secret));
    await expect(enqueueInboxRefresh(f.scope)).rejects.toThrow("Background queue unavailable");
    f.queues.get("publish_draft").add.mockRejectedValue(new Error(secret));
    await expect(enqueuePublishDraft({ ...f.scope, draftId: "d", draftScheduleId: "s", platform: "x", publishAt: "", attemptNumber: 1 })).rejects.toThrow("Background queue unavailable");
    queue().getJob.mockRejectedValue(new Error(secret));
    expect(await getJobStatus("missing")).toBeNull();
    const logs = JSON.stringify([vi.mocked(console.error).mock.calls, vi.mocked(console.warn).mock.calls]);
    expect(logs).not.toMatch(/PRIVATE_|private\.example|private-user/);
    expect(logs).toContain("Inbox refresh attempt failed");
    expect(logs).toContain("Publish attempt failed");
  });

  it("bounds the whole admission when persisted-job lookup hangs", async () => {
    vi.useFakeTimers(); queue().getJob.mockReturnValue(new Promise(() => {}));
    const pending = expect(enqueueInboxRefresh(f.scope)).rejects.toThrow("Background queue unavailable");
    await vi.advanceTimersByTimeAsync(8000); await pending;
    expect(vi.getTimerCount()).toBe(0);
  });
});