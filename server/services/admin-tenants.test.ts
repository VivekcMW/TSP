import { beforeEach, expect, it, vi } from "vitest";
import { getTableName, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
const m = vi.hoisted(() => ({
  results: [] as unknown[][], counts: {} as Record<string, number>,
  queries: [] as { table: string; fields: string[]; where?: SQL; limit?: number; offset?: number; joins: SQL[] }[],
  execute: vi.fn(),
}));
vi.mock("../db", () => {
  const select = (fields: Record<string, unknown>) => {
    const record: typeof m.queries[number] = { table: "", fields: Object.keys(fields), joins: [] };
    const chain = {
      from(table: Parameters<typeof getTableName>[0]) { record.table = getTableName(table); return chain; },
      where(where: SQL) { record.where = where; return chain; },
      innerJoin(_table: unknown, on: SQL) { record.joins.push(on); return chain; },
      leftJoin(_table: unknown, on: SQL) { record.joins.push(on); return chain; },
      groupBy() { return chain; }, orderBy() { return chain; },
      limit(limit: number) { record.limit = limit; return chain; },
      offset(offset: number) { record.offset = offset; return chain; },
      then(resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) {
        m.queries.push(record); return Promise.resolve(m.results.shift() ?? []).then(resolve, reject);
      },
    };
    return chain;
  };
  const tx = { select, execute: m.execute };
  return { db: { ...tx, transaction: (work: (connection: typeof tx) => Promise<unknown>) => work(tx) } };
});
import { getTenantDirectory, getTenantOverview, tenantDirectoryFilter } from "./admin-tenants";
const dialect = new PgDialect();
const id = "90cc5331-e6e7-4e29-bddb-8c906ed4310e";
const tenant = { id, name: "Acme", kind: "corporate", status: "active", createdAt: new Date("2026-10-01Z") };
beforeEach(() => {
  vi.clearAllMocks(); m.results = []; m.queries = [];
  m.counts = { members: 51, inboxItems: 8, drafts: 3, failedSchedules: 1, overdueSchedules: 2 };
  m.execute.mockImplementation(async (query: SQL) => ({ rows: dialect.sqlToQuery(query).sql.includes("count(*)") ? [m.counts] : [] }));
});
it("escapes LIKE wildcards and binds search/status/kind without SQL interpolation", () => {
  const query = dialect.sqlToQuery(tenantDirectoryFilter({ q: "50%_\\'test", status: "active", kind: "corporate", page: 1 })!);
  expect(query.sql).not.toContain("50%");
  expect(query.params).toEqual(["%50\\%\\_\\\\'test%", "50%_\\'test", "active", "corporate"]);
});
it("paginates in SQL with the same filters for rows and total, beyond the legacy 200-row list", async () => {
  m.results = [[{ ...tenant, memberCount: 3 }], [{ value: 260 }]];
  const result = await getTenantDirectory({ q: "Acme", status: "active", kind: "corporate", page: 9 });
  expect(result).toMatchObject({ page: 9, pageSize: 25, total: 260, items: [{ id, createdAt: tenant.createdAt.toISOString() }] });
  expect(m.queries[0]).toMatchObject({ limit: 25, offset: 200 });
  expect(dialect.sqlToQuery(m.queries[0].where!).params).toEqual(dialect.sqlToQuery(m.queries[1].where!).params);
});
it("sets transaction-local RLS and bounds every detail list with safe projections", async () => {
  const members = Array.from({ length: 51 }, (_, index) => ({ userId: `u${index}`, name: "Member", email: "member@example.invalid", role: "member", onboardingStatus: null }));
  m.results = [[tenant], members, [{ status: "active", planId: "pro", currentPeriodEnd: null, cancelAtPeriodEnd: false }],
    [{ id: "run", status: "failed", startedAt: null, articlesProcessed: 0, articlesMatched: 0 }],
    [{ id: "schedule", status: "failed", scheduledPublishAt: new Date("2026-10-22Z") }]];
  const result = await getTenantOverview(id);
  expect(dialect.sqlToQuery(m.execute.mock.calls[0][0])).toMatchObject({ params: [id] });
  expect(dialect.sqlToQuery(m.execute.mock.calls[0][0]).sql).toContain("set_config('app.tenant_id'");
  expect(result).toMatchObject({ counts: m.counts, membersTruncated: true, latestSubscription: { status: "active", currentPeriodEnd: null } });
  expect(result?.members).toHaveLength(50);
  expect(result?.recentRuns[0].startedAt).toBeNull();
  for (const query of m.queries) {
    expect(dialect.sqlToQuery(query.where!).params).toContain(id);
    expect(query.fields).not.toContain("errorMessage");
    expect(query.fields).not.toContain("accessToken");
    expect(query.fields).not.toContain("rawPayload");
  }
  expect(m.queries.map(query => query.limit)).toEqual([1, 51, 1, 10, 10, 51, 51, 10]);
  expect(dialect.sqlToQuery(m.queries[1].joins[1]).sql).toContain('"user_profiles"."tenant_id"');
  const metrics = dialect.sqlToQuery(m.execute.mock.calls[2][0]);
  expect(metrics.params.filter(param => param === id)).toHaveLength(5);
  expect(metrics.sql).toContain("'scheduled', 'queued'");
});
it("returns null for missing workspaces and does not read customer tables", async () => {
  m.results = [[]];
  expect(await getTenantOverview(id)).toBeNull();
  expect(m.queries).toHaveLength(1);
});
it("does not invent counts when the aggregate result is missing", async () => {
  m.results = [[tenant]]; m.execute.mockResolvedValue({ rows: [] });
  await expect(getTenantOverview(id)).rejects.toThrow("Tenant summary counts unavailable");
});
it("paginates members without selecting credential fields from source or connection diagnostics", async () => {
  m.results = [[tenant], [], [], [], [], [{ id: "source", name: "A source", active: true, lastFetchedAt: null, lastFetchStatus: null }],
    [{ id: "connection", provider: "linkedin", active: true, lastSyncAt: null, tokenExpiresAt: null }], []];
  const result = await getTenantOverview(id, 2);
  expect(m.queries[1].offset).toBe(50);
  expect(result).toMatchObject({ memberPage: 2, sources: [{ id: "source" }], connections: [{ provider: "linkedin" }] });
  for (const query of m.queries) {
    expect(query.fields).not.toContain("feedUrl");
    expect(query.fields).not.toContain("accessToken");
    expect(query.fields).not.toContain("refreshToken");
    expect(new PgDialect().sqlToQuery(query.where!).params).toContain(id);
  }
});
