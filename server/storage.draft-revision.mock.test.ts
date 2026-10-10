import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { getTableColumns } from "drizzle-orm";
import type { Pool } from "pg";
import { drafts, type Draft } from "@shared/schema";
import { DraftConflictError } from "@shared/draft-revision";

const { transaction } = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock("./db", () => ({ db: { transaction } }));
import { ScheduleConflictError, storage } from "./storage";

// Real repository + SQL compiler; entirely fake transaction/query boundary.
// This checks lock/comparison/write ordering, NOT PostgreSQL lock contention.
const query = vi.fn();
const database = drizzle({ query } as unknown as Pool);
const scope = { tenantId: "revision-tenant", userId: "revision-user" };
const columns = Object.keys(getTableColumns(drafts));
const timestamp = "2030-01-01T00:00:00.000Z";
const expected = { expectedContent: "A", expectedUpdatedAt: timestamp };
let row: Partial<Draft> | undefined;
let receipts: unknown[][];
let rolledBack: boolean;
function driverRow() {
  return columns.map(key => { const value = row?.[key as keyof Draft]; return value instanceof Date ? value.toISOString().replace(/Z$/, "") : value ?? null; });
}
const writes = () => query.mock.calls.filter(([config]) => config.text.startsWith("update"));
beforeEach(() => {
  row = { id: "d", ...scope, content: "A", platform: "linkedin", tone: "professional", status: "draft", publishStatus: "draft",
    updatedAt: new Date(timestamp), publishApprovalHash: "keep-approval", publishApprovedBy: scope.userId, publishApprovedAt: new Date(timestamp) };
  receipts = []; rolledBack = false;
  query.mockReset().mockImplementation(async (config, params) => {
    if (config.text.startsWith("update")) {
      const parameter = (column: string) => params[Number(config.text.match(new RegExp('"' + column + '" = \\$(\\d+)'))?.[1]) - 1];
      row = { ...row, content: parameter("content") ?? row?.content, updatedAt: new Date(parameter("updated_at")),
        publishApprovalHash: null, publishApprovedAt: null, publishApprovedBy: null };
      return { rows: [driverRow()] };
    }
    if (config.text.includes('from "drafts"')) return { rows: row ? [driverRow()] : [] };
    if (config.text.includes('from "publish_job_logs"')) return { rows: receipts };
    return { rows: [] };
  });
  transaction.mockReset().mockImplementation(async callback => {
    try { return await callback(database); } catch (error) { rolledBack = true; throw error; }
  });
});

describe("draft editing CAS (mocked storage)", () => {
  it("locks the authenticated owner row before comparing, then writes and invalidates approval atomically", async () => {
    const result = await storage.updateDraft(scope, "d", { content: "B" }, expected);
    const lock = query.mock.calls.find(([config]) => config.text.includes('from "drafts"'))!;
    expect(lock[0].text).toMatch(/where .*"id" = .*"tenant_id" = .*"user_id" = .*for update$/);
    expect(lock[1]).toEqual(["d", scope.tenantId, scope.userId]);
    expect(query.mock.calls[0][1]).toEqual([scope.tenantId]);
    expect(writes()).toHaveLength(1);
    const [update, params] = writes()[0];
    expect(update.text).toContain('"publish_approval_hash" =');
    expect(update.text).toContain('"publish_approved_at" =');
    expect(update.text).toContain('"publish_approved_by" =');
    expect(params.slice(-3)).toEqual(["d", scope.tenantId, scope.userId]);
    expect(query.mock.calls.indexOf(lock)).toBeLessThan(query.mock.calls.indexOf(writes()[0]));
    expect(result).toMatchObject({ id: "d", content: "B", publishApprovalHash: null, publishApprovedAt: null, publishApprovedBy: null });
    expect(result!.updatedAt!.getTime()).toBeGreaterThan(Date.parse(timestamp));
  });

  it.each([
    { expectedContent: "Old", expectedUpdatedAt: timestamp },
    { expectedContent: "A", expectedUpdatedAt: "2029-12-31T23:59:59.999Z" },
    { expectedContent: "A", expectedUpdatedAt: null },
    { expectedContent: " A ", expectedUpdatedAt: timestamp },
  ])("rejects a stale baseline %j without writes or approval clearing", async baseline => {
    const before = { ...row };
    await expect(storage.updateDraft(scope, "d", { content: "C" }, baseline)).rejects.toBeInstanceOf(DraftConflictError);
    expect(writes()).toEqual([]); expect(row).toEqual(before); expect(rolledBack).toBe(true);
  });

  it("accepts the exact nullable legacy baseline, not null as a wildcard", async () => {
    row!.updatedAt = null;
    await expect(storage.updateDraft(scope, "d", { content: "B" }, expected)).rejects.toBeInstanceOf(DraftConflictError);
    expect(writes()).toEqual([]);
    expect(await storage.updateDraft(scope, "d", { content: "B" }, { ...expected, expectedUpdatedAt: null })).toMatchObject({ content: "B" });
  });

  it("the next stale writer loses after a winner, and explicit reviewed CAS can then save", async () => {
    const winner = await storage.updateDraft(scope, "d", { content: "B" }, expected);
    await expect(storage.updateDraft(scope, "d", { content: "C" }, expected)).rejects.toBeInstanceOf(DraftConflictError);
    expect(writes()).toHaveLength(1); expect(row!.content).toBe("B");
    await storage.updateDraft(scope, "d", { content: "C" }, { expectedContent: "B", expectedUpdatedAt: winner!.updatedAt!.toISOString() });
    expect(writes()).toHaveLength(2); expect(row!.content).toBe("C");
  });

  it("returns inaccessible/missing without comparing or leaking the foreign row", async () => {
    row = undefined;
    expect(await storage.updateDraft({ tenantId: "foreign", userId: "other" }, "d", { content: "C" }, expected)).toBeUndefined();
    expect(query.mock.calls[1][1]).toEqual(["d", "foreign", "other"]);
    expect(writes()).toEqual([]);
  });

  it.each(["published", "unknown", "publishing", "partial"])("preserves immutable %s conflicts even for stale baselines", async status => {
    row!.publishStatus = status;
    await expect(storage.updateDraft(scope, "d", { content: "C" }, { ...expected, expectedContent: "stale" })).rejects.toBeInstanceOf(ScheduleConflictError);
    expect(writes()).toEqual([]); expect(row!.publishApprovalHash).toBe("keep-approval");
  });

  it("retains historical receipt immutability and trusted internal-call compatibility", async () => {
    receipts = [["receipt"]];
    await expect(storage.updateDraft(scope, "d", { content: "B" }, expected)).rejects.toBeInstanceOf(ScheduleConflictError);
    expect(writes()).toEqual([]);
    receipts = [];
    expect(await storage.updateDraft(scope, "d", { content: "Internal" })).toMatchObject({ content: "Internal" });
  });

  it("scopes editing snapshot reads by both user and tenant", async () => {
    expect(await storage.getDraft(scope, "d")).toMatchObject({ content: "A" });
    const [config, params] = query.mock.calls[1];
    expect(config.text).toMatch(/where .*"id" = .*"tenant_id" = .*"user_id" = .*limit/);
    expect(params.slice(0, 3)).toEqual(["d", scope.tenantId, scope.userId]);
    expect(writes()).toEqual([]);
  });
});