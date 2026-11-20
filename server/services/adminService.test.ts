import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getTableName, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
const m = vi.hoisted(() => ({
  health: vi.fn(), inbox: vi.fn(), publish: vi.fn(), active: 0, maxActive: 0, execute: vi.fn(),
  queries: [] as { table: string; fields: string[]; limit?: number; where?: SQL }[],
}));
vi.mock("../jobs/queue", () => ({
  getQueueHealth: m.health, getInboxRefreshQueue: () => ({ getJobCounts: m.inbox }), getPublishDraftQueue: () => ({ getJobCounts: m.publish }),
}));
vi.mock("../jobs/execution-health", () => ({ readSchedulerExecutionHealth: async () => ({ available: true, tasks: [] }) }));
vi.mock("../db", () => {
  const select = (fields: Record<string, unknown>) => {
    const query: typeof m.queries[number] = { table: "", fields: Object.keys(fields) };
    const chain = {
      from(table: Parameters<typeof getTableName>[0]) { query.table = getTableName(table); return chain; },
      where(where: SQL) { query.where = where; return chain; },
      orderBy() { return chain; },
      limit(limit: number) { query.limit = limit; return chain; },
      then(resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) {
        m.queries.push(query);
        const tenantId = query.where ? new PgDialect().sqlToQuery(query.where).params[0] : undefined;
        const rows = query.table === "tenants" ? Array.from({ length: 6 }, (_, i) => ({ id: `tenant-${i}`, name: `Workspace ${i}` }))
          : query.table === "draft_schedules" ? [{ scheduled: 3, publishing: 1, failed: 2, overdue: 1 }]
          : [{ id: `${query.table}-${tenantId}`, platform: "linkedin", startedAt: new Date("2026-10-20T09:00:00Z") }];
        return Promise.resolve(rows).then(resolve, reject);
      },
    };
    return chain;
  };
  const tx = { select, execute: m.execute };
  return { db: { select, transaction: async (work: (connection: typeof tx) => Promise<unknown>) => {
    m.active++; m.maxActive = Math.max(m.maxActive, m.active);
    try { return await work(tx); } finally { m.active--; }
  } } };
});
import { getPlatformMonitoring } from "./adminService";
beforeEach(() => {
  vi.clearAllMocks(); m.active = 0; m.maxActive = 0; m.queries = [];
  m.health.mockResolvedValue({ configured: true, reachable: true, queuesReady: true });
  const counts = { waiting: 2, active: 1, completed: 4, failed: 0, delayed: 0, paused: 0 };
  m.inbox.mockResolvedValue(counts); m.publish.mockResolvedValue(counts);
  vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("BACKGROUND_JOBS_ENABLED", "true"); vi.stubEnv("CRON_SCHEDULER", "true");
});
afterEach(() => vi.unstubAllEnvs());
it("aggregates retained schedule states without loading all schedules and bounds tenant fanout to four", async () => {
  const result = await getPlatformMonitoring();
  expect(result).toMatchObject({ tenantCount: 6, scheduled: 18, publishing: 6, failed: 12, overdue: 6 });
  expect(m.maxActive).toBe(4);
  const schedules = m.queries.filter(query => query.table === "draft_schedules");
  expect(schedules).toHaveLength(6);
  expect(schedules.every(query => query.fields.join(",") === "scheduled,publishing,failed,overdue")).toBe(true);
  const scopes = m.execute.mock.calls.map(([query]) => new PgDialect().sqlToQuery(query)).filter(query => query.sql.includes("app.tenant_id"));
  expect(scopes.map(query => query.params[0])).toEqual(Array.from({ length: 6 }, (_, i) => `tenant-${i}`));
  expect(result.tenantSignals[0]).toMatchObject({ tenantId: "tenant-0", failed: 2, overdue: 1 });
});
it("labels development as ineligible for automatic production scheduling even with both flags enabled", async () => {
  const result = await getPlatformMonitoring();
  expect(result.environment).toBe("development");
  expect(result.scheduler).toEqual({ enabled: true, designated: true, production: false });
});
it("returns unavailable queue counts rather than successful zero-shaped fallbacks", async () => {
  m.health.mockResolvedValue({ configured: true, reachable: false, queuesReady: false });
  const result = await getPlatformMonitoring();
  expect(result.jobs).toEqual({ inbox: null, publishing: null });
  expect(m.inbox).not.toHaveBeenCalled(); expect(m.publish).not.toHaveBeenCalled();
});
it("projects safe failure metadata and includes the affected tenant for investigation", async () => {
  const result = await getPlatformMonitoring();
  expect(result.recentFailures[0]).toMatchObject({ tenantId: "tenant-0", tenantName: "Workspace 0" });
  const logs = m.queries.filter(query => ["publish_job_logs", "engine_run_logs"].includes(query.table));
  expect(logs.every(query => query.limit === 10 && !query.fields.includes("errorMessage") && !query.fields.includes("evidence"))).toBe(true);
});
it("surfaces queue counter failures instead of reporting a healthy empty backlog", async () => {
  m.inbox.mockRejectedValue(new Error("Queue read failed"));
  await expect(getPlatformMonitoring()).rejects.toThrow("Queue read failed");
});
