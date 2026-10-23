import { beforeEach, expect, it, vi } from "vitest";
import { getTableName, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
const m = vi.hoisted(() => ({ results: [] as unknown[][], queries: [] as { fields: string[]; where?: SQL; table?: string; limit?: number; offset?: number }[] }));
vi.mock("../db", () => ({ db: { select: (fields: Record<string, unknown>) => {
  const query: typeof m.queries[number] = { fields: Object.keys(fields) };
  const chain = {
    from(table: Parameters<typeof getTableName>[0]) { query.table = getTableName(table); return chain; },
    where(where: SQL) { query.where = where; return chain; },
    orderBy() { return chain; }, innerJoin() { return chain; },
    limit(limit: number) { query.limit = limit; return chain; }, offset(offset: number) { query.offset = offset; return chain; },
    then(resolve: (rows: unknown[]) => unknown) { m.queries.push(query); return Promise.resolve(m.results.shift() ?? []).then(resolve); },
  }; return chain;
} } }));
import { auditDirectoryFilter, emailDirectoryFilter, getEmailDirectory, userDirectoryFilter, getAuditDirectory, getUserDirectory, getUserOverview } from "./admin-records";
const filters = { q: "", actor: "", tenant: "", action: "", page: 1 };
const user = { id: "u", name: "User", email: "dev@example.com", emailVerified: true, platformRole: "platform_admin", registrationCompleted: null, createdAt: null };
beforeEach(() => { m.results = []; m.queries = []; });
it("binds literal user search without letting wildcard syntax expand the audience", () => {
  const query = new PgDialect().sqlToQuery(userDirectoryFilter({ ...filters, q: "%_\\hello" })!);
  expect(query.params).toEqual(["%\\%\\_\\\\hello%", "%\\%\\_\\\\hello%", "%_\\hello"]);
});
it("uses exact actor/tenant/action audit predicates and safely bound resource search", () => {
  const query = new PgDialect().sqlToQuery(auditDirectoryFilter({ ...filters, q: "request", actor: "u", tenant: "tenant", action: "tenant:read:all" })!);
  expect(query.params).toEqual(["request", "request", "%request%", "u", "tenant", "tenant:read:all"]);
});
it("paginates users beyond 200 rows and masks ineffective staff roles", async () => {
  m.results = [[user], [{ value: 260 }]];
  const result = await getUserDirectory({ ...filters, page: 9 });
  expect(m.queries[0]).toMatchObject({ limit: 25, offset: 200 });
  expect(result).toMatchObject({ total: 260, items: [{ platformRole: null, createdAt: null }] });
  expect(m.queries[0].fields).not.toContain("password");
});
it("omits arbitrary audit metadata and strips query parameters from resource paths", async () => {
  m.results = [[{ id: "event", resourceId: "/api/admin/users-directory?q=private", createdAt: new Date(0) }], [{ value: 1 }]];
  const result = await getAuditDirectory(filters);
  expect(result.items[0].resourceId).toBe("/api/admin/users-directory");
  expect(m.queries[0].fields).not.toContain("metadata");
  expect(m.queries[0].limit).toBe(25);
});
it("loads only the specified user and bounds memberships", async () => {
  m.results = [[user], Array.from({ length: 101 }, (_, index) => ({ tenantId: `t${index}` }))];
  const result = await getUserOverview("u");
  expect(result?.memberships).toHaveLength(100); expect(result?.membershipsTruncated).toBe(true);
  expect(new PgDialect().sqlToQuery(m.queries[0].where!).params).toEqual(["u"]);
  expect(new PgDialect().sqlToQuery(m.queries[1].where!).params).toEqual(["u"]);
});
it("exposes bounded attributable email state without provider errors, addresses or delivery keys", async () => {
  m.results = [[user], [], [{ id: "delivery", type: "daily_digest", status: "unknown", attempts: 1, createdAt: new Date(0), sentAt: null }],
    [{ dailyDigest: true, weeklySummary: false, productUpdates: false, unsubscribedAt: null }]];
  const result = await getUserOverview("u");
  expect(result?.emailHistory).toEqual([{ id: "delivery", type: "daily_digest", status: "unknown", attempts: 1, createdAt: new Date(0).toISOString(), sentAt: null }]);
  expect(m.queries[2].limit).toBe(20);
  expect(m.queries[2].fields).toEqual(["id", "type", "status", "attempts", "createdAt", "sentAt"]);
  expect(new PgDialect().sqlToQuery(m.queries[2].where!).params).toEqual(["u"]);
  expect(result?.preferences?.dailyDigest).toBe(true);
});
it("binds literal delivery search and exact account/type/status filters, paginating safely", async () => {
  const query = { q: "50%_\\", user: "u", type: "daily_digest", status: "unknown" as const, page: 9 };
  const sql = new PgDialect().sqlToQuery(emailDirectoryFilter(query)!);
  expect(sql.params).toEqual(["50%_\\", "%50\\%\\_\\\\%", "u", "daily_digest", "unknown"]);
  m.results = [[{ id: "delivery", userId: "u", recipient: "reader@example.invalid", type: "daily_digest", status: "unknown", attempts: 1, createdAt: new Date(0), sentAt: null, retryAt: null }], [{ value: 260 }]];
  const result = await getEmailDirectory(query);
  expect(result).toMatchObject({ total: 260, page: 9, items: [{ status: "unknown" }] });
  expect(m.queries[0]).toMatchObject({ limit: 25, offset: 200 });
  expect(m.queries[0].fields).not.toContain("errorMessage");
  expect(m.queries[0].fields).not.toContain("dedupeKey");
});
it("pages account memberships without dropping the target account predicate", async () => {
  m.results = [[user], []];
  const result = await getUserOverview("u", 2);
  expect(result?.membershipPage).toBe(2);
  expect(m.queries[1]).toMatchObject({ limit: 101, offset: 100 });
  expect(new PgDialect().sqlToQuery(m.queries[1].where!).params).toEqual(["u"]);
});
