import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { inboxRefreshMessage, type InboxRefreshOutcome, type InboxRefreshResult } from "@shared/inbox-refresh";

const fixtures = vi.hoisted(() => ({
  scope: { tenantId: "tenant", userId: "reader" },
  storage: { getInboxRefreshReceipt: vi.fn(), getUserProfile: vi.fn(), getUser: vi.fn(), createEngineRunLog: vi.fn(),
    updateInboxItem: vi.fn(), getInboxItems: vi.fn(), addInboxItem: vi.fn() },
  process: vi.fn(), enqueue: vi.fn(), status: vi.fn(), getQueue: vi.fn(), getRun: vi.fn(),
  Capacity: class extends Error {}, Conflict: class extends Error {},
}));
vi.mock("../storage", () => ({ storage: fixtures.storage, InboxCapacityError: fixtures.Capacity, InboxOperationConflictError: fixtures.Conflict }));
vi.mock("../middlewares/requireDbUser", () => ({
  requireDbUser: (req: any, _res: any, next: () => void) => { req.tenant = fixtures.scope; next(); },
  authedOf: () => ({ tenant: fixtures.scope, dbUser: { id: fixtures.scope.userId, industry: "other" } }),
}));
vi.mock("../middlewares/requirePermission", () => ({ requirePermission: () => (_req: any, _res: any, next: () => void) => next() }));
vi.mock("../middlewares/rateLimit", () => ({ inboxRefreshRateLimit: (_req: any, _res: any, next: () => void) => next() }));
vi.mock("../services/engines/index.js", () => ({ engineRegistry: { getEngine: () => ({ config: { displayName: "Test" }, processForUser: fixtures.process }) } }));
vi.mock("../services/metaEngine", () => ({ normalizeIndustryToSlug: () => "other" }));
vi.mock("../jobs/queue", () => ({ enqueueInboxRefresh: fixtures.enqueue, getJobStatus: fixtures.status, getInboxRefreshQueue: fixtures.getQueue, InboxRefreshAdmissionError: class extends Error {} }));
vi.mock("../services/adminService", () => ({ getEngineRunById: fixtures.getRun }));
vi.mock("../services/urlValidator", () => ({ validateUrlSync: () => true, validateUrl: vi.fn().mockResolvedValue({ isValid: true }) }));
vi.mock("../db", () => ({ db: {} }));
vi.mock("node-fetch", () => ({ default: () => { throw new Error("Unexpected network"); } }));

import { registerInboxRoutes } from "./inbox";
import { registerAdminRoutes } from "./admin";
import { handleInboxRefresh } from "../jobs/handlers/inbox-refresh";

const app = express(); app.use(express.json()); registerInboxRoutes(app); registerAdminRoutes(app);
function result(outcome: InboxRefreshOutcome): InboxRefreshResult {
  const count = outcome === "updated" ? 2 : 0;
  return { success: outcome !== "failure", outcome, count, articlesCreated: count, newInboxItems: count,
    items: [], activeCount: 10, replacedCount: count, articlesProcessed: 20, articlesMatched: 12, durationMs: 4,
    needsSetup: outcome === "needs_setup", message: inboxRefreshMessage(outcome, count) };
}
function job(id = "same-job") {
  return { id, data: { ...fixtures.scope, startedAt: Date.now(), autoRefresh: true }, progress: vi.fn().mockResolvedValue(undefined) };
}
beforeEach(() => {
  vi.resetAllMocks();
  fixtures.storage.getInboxRefreshReceipt.mockResolvedValue(undefined);
  fixtures.storage.getUserProfile.mockResolvedValue({ id: "profile" });
  fixtures.storage.getUser.mockResolvedValue({ industry: "other" });
  fixtures.storage.createEngineRunLog.mockResolvedValue(undefined);
  fixtures.enqueue.mockResolvedValue(null);
  fixtures.getRun.mockResolvedValue({ id: "run", industry: "other", userId: fixtures.scope.userId });
  fixtures.process.mockResolvedValue(result("updated"));
});

describe("refresh caller outcome parity", () => {
  it.each(["active", "saved", "dismissed"])("passes a validated %s filter before pagination with more than 500 historical rows", async status => {
    const rows = [...Array.from({ length: 620 }, (_, id) => ({ id, status: "dismissed" })),
      { id: 621, status: "active" }, { id: 622, status: "saved" }];
    fixtures.storage.getInboxItems.mockImplementation(async (_scope, page) =>
      rows.filter(row => !page.status || row.status === page.status).slice(page.offset ?? 0, (page.offset ?? 0) + (page.limit ?? 500)));
    const response = await request(app).get(`/api/inbox?status=${status}&limit=1&offset=0`).expect(200);
    expect(fixtures.storage.getInboxItems).toHaveBeenCalledExactlyOnceWith(fixtures.scope, { status, order: "relevance", limit: 1, offset: 0 });
    expect(response.body).toEqual([rows.find(row => row.status === status)]);
    const history = await request(app).get("/api/inbox").expect(200);
    expect(history.body).toEqual(rows.slice(0, 500));
    expect(fixtures.storage.getInboxItems.mock.calls[1][1]).not.toHaveProperty("status");
  });

  it.each(["status=unknown", "status=", "status=ACTIVE", "status=active&status=saved", "status[x]=active", "status[]=active", "limit=0", "limit=201", "offset=-1"])("rejects malformed inbox query %s before storage", async query => {
    await request(app).get(`/api/inbox?${query}`).expect(400);
    expect(fixtures.storage.getInboxItems).not.toHaveBeenCalled();
  });

  it.each(["active", "delayed", "waiting", "completed"])("does not expose stale errors for %s jobs", async state => {
    fixtures.status.mockResolvedValue({ id: "job", state, data: fixtures.scope, progress: result("updated"), error: "old secret failure" });
    const response = await request(app).get("/api/inbox/refresh/job").expect(200);
    expect(response.body).toMatchObject({ status: state, progress: result("updated"), error: null });
  });

  it.each(["updated", "capacity", "no_new", "needs_setup"] as const)("returns %s with committed counts in sync, worker and admin", async outcome => {
    const expected = result(outcome); fixtures.process.mockResolvedValue(expected);
    const sync = await request(app).post("/api/inbox/refresh").send({ autoRefresh: true }).expect(200);
    expect(sync.body).toMatchObject(expected);
    const task = job();
    expect(await handleInboxRefresh(task as any)).toEqual(expected);
    expect(task.progress).toHaveBeenCalledExactlyOnceWith(expected);
    const admin = await request(app).post("/api/admin/engine-runs/run/rerun").send({ tenantId: fixtures.scope.tenantId }).expect(200);
    expect(admin.body).toEqual(expected);
    expect(fixtures.storage.updateInboxItem).not.toHaveBeenCalled();
    expect(fixtures.storage.getInboxItems).not.toHaveBeenCalled();
  });

  it("returns 502 for sync/admin failures and throws for worker retry without prefetch dismissal", async () => {
    fixtures.process.mockResolvedValue(result("failure"));
    for (const [url, body] of [["/api/inbox/refresh", { autoRefresh: true }],
      ["/api/admin/engine-runs/run/rerun", { tenantId: fixtures.scope.tenantId }]] as const) {
      const response = await request(app).post(url).send(body).expect(502);
      expect(response.body).toMatchObject({ success: false, outcome: "failure", count: 0, replacedCount: 0 });
    }
    await expect(handleInboxRefresh(job() as any)).rejects.toThrow(inboxRefreshMessage("failure"));
    expect(fixtures.storage.updateInboxItem).not.toHaveBeenCalled();
  });

  it("ignores postcommit logging failures and returns the committed result", async () => {
    fixtures.storage.createEngineRunLog.mockRejectedValue(new Error("private log connection"));
    expect((await request(app).post("/api/inbox/refresh").send({}).expect(200)).body).toMatchObject(result("updated"));
    expect(await handleInboxRefresh(job() as any)).toEqual(result("updated"));
    expect((await request(app).post("/api/admin/engine-runs/run/rerun").send({ tenantId: fixtures.scope.tenantId }).expect(200)).body).toEqual(result("updated"));
  });

  it("replays a worker receipt before profile lookup or fetch after postcommit progress failure", async () => {
    const task = job(); let receipt: InboxRefreshResult | undefined;
    fixtures.storage.getInboxRefreshReceipt.mockImplementation(async () => receipt);
    fixtures.process.mockImplementation(async () => { receipt = result("updated"); return receipt; });
    task.progress.mockRejectedValueOnce(new Error("queue response lost"));
    await expect(handleInboxRefresh(task as any)).rejects.toThrow("Refresh committed, but its status could not be reported");
    const lookups = fixtures.storage.getUserProfile.mock.calls.length;
    expect(await handleInboxRefresh(task as any)).toEqual(receipt);
    expect(fixtures.process).toHaveBeenCalledTimes(1);
    expect(fixtures.storage.getUserProfile).toHaveBeenCalledTimes(lookups);
    const calls = fixtures.storage.getInboxRefreshReceipt.mock.calls;
    expect(calls[0]).toEqual(calls[1]);
    expect(calls[0]).toEqual([fixtures.scope, expect.stringMatching(/^job:/), true]);
  });

  it("returns sync retry receipts before enqueue/profile/fetch and binds operation ID to authenticated scope", async () => {
    const operationId = randomUUID();
    fixtures.storage.getInboxRefreshReceipt.mockResolvedValue(result("updated"));
    const response = await request(app).post("/api/inbox/refresh").send({ operationId, autoRefresh: true, tenantId: "forged", userId: "forged" }).expect(200);
    expect(response.body).toEqual(result("updated"));
    expect(fixtures.storage.getInboxRefreshReceipt).toHaveBeenCalledExactlyOnceWith(fixtures.scope, `refresh:${operationId}`, true);
    expect(fixtures.enqueue).not.toHaveBeenCalled(); expect(fixtures.process).not.toHaveBeenCalled();
    expect(fixtures.storage.getUserProfile).not.toHaveBeenCalled();
  });

  it("propagates the same validated operation to queue admission and sync execution", async () => {
    const operationId = randomUUID();
    await request(app).post("/api/inbox/refresh").send({ operationId, autoRefresh: true }).expect(200);
    expect(fixtures.process.mock.calls[0][2]).toEqual({ operationId: `refresh:${operationId}`, autoRefresh: true });
    const queued = fixtures.enqueue.mock.calls[0][0];
    expect(queued).toMatchObject({ ...fixtures.scope, operationId: `refresh:${operationId}`, autoRefresh: true });
    fixtures.enqueue.mockResolvedValue("queued-job");
    await request(app).post("/api/inbox/refresh").send({ operationId, autoRefresh: true }).expect(200);
    expect(fixtures.enqueue.mock.calls[1][0].dedupeKey).toBe(queued.dedupeKey);
    expect(fixtures.process).toHaveBeenCalledTimes(1);
  });

  it.each([{ operationId: "bad" }, { operationId: 1 }, { autoRefresh: "true" }])("rejects malformed refresh operation data before admission", async body => {
    await request(app).post("/api/inbox/refresh").send(body).expect(400);
    expect(fixtures.enqueue).not.toHaveBeenCalled(); expect(fixtures.process).not.toHaveBeenCalled();
  });

  it("rejects a committed operation reused with different mode", async () => {
    fixtures.storage.getInboxRefreshReceipt.mockRejectedValue(new fixtures.Conflict("Refresh operation does not match its original request."));
    await request(app).post("/api/inbox/refresh").send({ operationId: randomUUID() }).expect(409);
    expect(fixtures.enqueue).not.toHaveBeenCalled();
  });

  it("returns conflicts discovered after the route preflight as 409", async () => {
    fixtures.process.mockRejectedValue(new fixtures.Conflict("Refresh operation does not match its original request."));
    await request(app).post("/api/inbox/refresh").send({ operationId: randomUUID() }).expect(409);
    expect(fixtures.storage.createEngineRunLog).not.toHaveBeenCalled();
  });

  it("reports manual duplicate admission truthfully and maps capacity for add/reactivation", async () => {
    const { validateUrl } = await import("../services/urlValidator");
    vi.mocked(validateUrl).mockResolvedValue({ isValid: true, url: "https://news.test/story" });
    const input = { title: "Story", link: "https://news.test/story" };
    fixtures.storage.addInboxItem.mockResolvedValue({ alreadyExists: true, item: { status: "saved" } });
    expect((await request(app).post("/api/inbox/add-trend").send(input).expect(200)).body)
      .toEqual({ message: "Article already in inbox", alreadyExists: true });
    fixtures.storage.addInboxItem.mockRejectedValue(new fixtures.Capacity(inboxRefreshMessage("capacity")));
    expect((await request(app).post("/api/inbox/add-trend").send(input).expect(409)).body.outcome).toBe("capacity");
    fixtures.storage.updateInboxItem.mockRejectedValue(new fixtures.Capacity(inboxRefreshMessage("capacity")));
    expect((await request(app).patch("/api/inbox/saved").send({ status: "active" }).expect(409)).body.outcome).toBe("capacity");
  });

  it("preserves admin target scope validation and rejects malformed IDs before work", async () => {
    await request(app).post("/api/admin/engine-runs/run/rerun").send({ tenantId: "foreign" }).expect(403);
    await request(app).post("/api/admin/engine-runs/run/rerun").send({ tenantId: fixtures.scope.tenantId, operationId: "bad" }).expect(400);
    expect(fixtures.process).not.toHaveBeenCalled(); expect(fixtures.getRun).not.toHaveBeenCalled();
  });

  it("replays admin receipts and propagates operation identity to admin jobs", async () => {
    fixtures.getQueue.mockReturnValue({}); fixtures.enqueue.mockResolvedValue("admin-job");
    const body = { tenantId: fixtures.scope.tenantId, operationId: randomUUID() };
    await request(app).post("/api/admin/engine-runs/run/rerun").send(body).expect(202);
    const config = fixtures.enqueue.mock.calls[0][0];
    expect(config.operationId).toMatch(/^admin:/);
    expect(config).toMatchObject(fixtures.scope);
    fixtures.storage.getInboxRefreshReceipt.mockResolvedValue(result("no_new"));
    const replay = await request(app).post("/api/admin/engine-runs/run/rerun").send(body).expect(200);
    expect(replay.body).toEqual(result("no_new"));
    expect(fixtures.storage.getInboxRefreshReceipt.mock.calls[1]).toEqual([fixtures.scope, config.operationId, false]);
    expect(fixtures.enqueue).toHaveBeenCalledTimes(1); expect(fixtures.process).not.toHaveBeenCalled();
  });

  it("sanitizes worker errors and job status output and does not leak foreign jobs", async () => {
    fixtures.process.mockRejectedValue(new Error("https://user:secret@private.provider/"));
    await expect(handleInboxRefresh(job() as any)).rejects.toThrow(inboxRefreshMessage("failure"));
    fixtures.status.mockResolvedValue({ id: "job", state: "failed", data: fixtures.scope, error: "secret provider details" });
    const response = await request(app).get("/api/inbox/refresh/job").expect(200);
    expect(JSON.stringify(response.body)).not.toContain("secret");
    fixtures.status.mockResolvedValue({ data: { ...fixtures.scope, userId: "someone-else" } });
    await request(app).get("/api/inbox/refresh/job").expect(404);
  });
});