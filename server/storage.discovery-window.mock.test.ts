import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { personalTrends } from "./services/personalTrends";

const { transaction } = vi.hoisted(() => ({ transaction: vi.fn() }));
// Never import server/db or create a pool. The real Drizzle compiler below only
// talks to this fake query boundary, not to PostgreSQL or environment settings.
vi.mock("./db", () => ({ db: { transaction } }));
import { storage } from "./storage";

const query = vi.fn();
const database = drizzle({ query } as unknown as Pool);
const now = new Date("2026-09-19T12:00:00.000Z");
const scope = { tenantId: "review-tenant", userId: "review-user" };
beforeEach(() => {
  query.mockReset().mockResolvedValue({ rows: [] });
  transaction.mockReset().mockImplementation(callback => callback(database));
});

describe("discovery-window compiled SQL (mocked driver, no DB)", () => {
  it("scopes tenant/user before chronological limit 5001, with exact half-open dates and evidence predicates", async () => {
    expect(await storage.getInboxDiscoveryWindow(scope, now)).toEqual([]);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(2);
    const [setup, setupParams] = query.mock.calls[0];
    expect(setup.text).toBe("select set_config('app.tenant_id', $1, true)");
    expect(setupParams).toEqual([scope.tenantId]);
    const [compiled, params] = query.mock.calls[1];
    const sql = compiled.text.replace(/\s+/g, " ");
    expect(sql).toContain('"inbox_items"."tenant_id" = $1');
    expect(sql).toContain('"inbox_items"."user_id" = $2');
    expect(sql).toContain('"inbox_items"."discovered_at" >= $3');
    expect(sql).toContain('"inbox_items"."discovered_at" < $4');
    expect(sql).toContain('"inbox_items"."relevance_score" > 0');
    expect(sql).toContain("jsonb_typeof(\"inbox_items\".\"quality_metadata\"->'relevance'->'evidence') = 'array'");
    expect(sql).toContain("jsonb_array_length(\"inbox_items\".\"quality_metadata\"->'relevance'->'evidence') > 0 else false end");
    expect(sql).toMatch(/order by "inbox_items"\."discovered_at", "inbox_items"\."id" limit \$5$/);
    expect(sql).not.toMatch(/status|created_at|offset|desc\b/i);
    expect(params).toEqual([scope.tenantId, scope.userId, "2026-09-05T12:00:00.000Z", now, 5001]);
  });
  it.each([5000, 5001])("retains the %i-row driver result so the aggregator sees the sentinel", async count => {
    const quality = { relevance: { evidence: [{ label: "AI" }] }, diversity: { sourceOrigin: null } };
    const rows = Array.from({ length: count }, (_, i) => [
      `https://news.test/${i}`, `Story ${i}`, "Fixture", "2026-09-18T00:00:00.000Z", ["AI"], "0.5", quality,
    ]);
    query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows });
    const result = await storage.getInboxDiscoveryWindow(scope, now);
    expect(result).toHaveLength(count);
    expect(result.at(-1)?.articleUrl).toBe(`https://news.test/${count - 1}`);
    expect(personalTrends(result, now)[0]).toMatchObject({ count: 5000, coverage: { partial: count === 5001, rowLimit: 5000, rowsExamined: 5000 } });
  });
  it("rejects invalid clocks before starting a transaction", async () => {
    await expect(storage.getInboxDiscoveryWindow(scope, new Date(NaN))).rejects.toThrow("Invalid discovery window");
    expect(transaction).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });
});