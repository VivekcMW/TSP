import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
const mocks = vi.hoisted(() => ({ tenantBilling: vi.fn(), readEntitlementState: vi.fn() }));
vi.mock("./billing-repository", () => mocks);
import { assertGenerationAdmission, finishGeneration, generationInputHash, generationOperationId, generationPeriod, readGenerationOperation, reserveGeneration, runGeneration } from "./generation-quota";
import { resolveTenantEntitlements } from "./entitlements";
import type { BillingPlan, Subscription } from "@shared/schema";

// Transactional double, NOT PostgreSQL lock/RLS proof. Real DB tests are opt-in.
type Row = Record<string, any>;
const dialect = new PgDialect();
let rows: Row[], now: Date, plans: BillingPlan[], subscriptions: Subscription[];
let serial: Promise<unknown>, countOverride: unknown, failInsert: boolean, failUpdate: boolean, failCommit: boolean;
const scope = { tenantId: "tenant-a", userId: "user-a" };
const free = { id: "free", key: "free", name: "Free", amount: 0, isActive: true } as BillingPlan;
const pro = { id: "pro", key: "pro_monthly", name: "Pro", amount: 4900, isActive: true } as BillingPlan;
function matches(row: Row, predicate: SQL) {
  const query = dialect.sqlToQuery(predicate);
  return [...query.sql.matchAll(/"[^\"]+"\."([^\"]+)" (=|>=|<) \$(\d+)/g)].every(([, column, operator, index]) => {
    const key = column.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    const expected = query.params[Number(index) - 1];
    const actual = row[key] instanceof Date ? row[key].toISOString() : row[key];
    return operator === "=" ? actual === expected : operator === ">=" ? actual >= expected! : actual < expected!;
  });
}
function query(operation: "select" | "insert" | "update", fields?: Record<string, unknown>) {
  let predicate: SQL, values: Row;
  const chain = {
    from() { return chain; }, where(value: SQL) { predicate = value; return chain; },
    values(value: Row) { values = value; return chain; }, set(value: Row) { values = value; return chain; }, returning() { return chain; },
    then(resolve: (value: Row[]) => unknown, reject: (error: unknown) => unknown) {
      return Promise.resolve().then(() => {
        if (operation === "insert") {
          if (failInsert) throw new Error("PRIVATE insert failure");
          rows.push({ ...values, completedAt: null }); return [];
        }
        const selected = rows.filter(row => matches(row, predicate));
        if (operation === "select") return fields?.used ? [{ used: countOverride === undefined ? String(selected.length) : countOverride }] : selected;
        if (failUpdate) throw new Error("PRIVATE update failure");
        return selected.map(row => Object.assign(row, values));
      }).then(resolve, reject);
    },
  };
  return chain;
}
const tx = { execute: vi.fn(async () => ({ rows: [{ now }] })), select: (fields?: Record<string, unknown>) => query("select", fields), insert: () => query("insert"), update: () => query("update") };
const input = { title: "Not persisted private title", content: "Not persisted source body" };
const hash = generationInputHash(input);
const reserve = (id = randomUUID(), selected = scope) => reserveGeneration(selected, id, "manual", hash);
beforeEach(() => {
  vi.clearAllMocks(); rows = []; now = new Date("2026-09-19T23:59:00Z"); plans = [free, pro]; subscriptions = [];
  serial = Promise.resolve(); countOverride = undefined; failInsert = false; failUpdate = false; failCommit = false;
  mocks.readEntitlementState.mockImplementation(async () => ({ plans, subscriptions }));
  mocks.tenantBilling.mockImplementation((_tenant: string, callback: (tx: any) => Promise<unknown>) => {
    const result = serial.then(async () => {
      const snapshot = structuredClone(rows);
      try { const result = await callback(tx); if (failCommit) throw new Error("PRIVATE commit failure"); return result; }
      catch (error) { rows = snapshot; throw error; }
    });
    serial = result.catch(() => undefined); return result;
  });
});

describe("consumed attempt reservations", () => {
  it("counts provider work once per intent during a duplicate submission burst", async () => {
    const ids = Array.from({ length: 3 }, () => randomUUID());
    const work = vi.fn(async () => "mock provider result");
    const outcomes = await Promise.allSettled(Array.from({ length: 24 }, (_, i) =>
      runGeneration(scope, ids[i % ids.length], "manual", input, new AbortController().signal, work)));
    expect(outcomes.filter(value => value.status === "fulfilled")).toHaveLength(3);
    expect(outcomes.filter(value => value.status === "rejected" && value.reason.code === "generation_operation_consumed")).toHaveLength(21);
    expect(work).toHaveBeenCalledTimes(3);
    expect(rows).toHaveLength(3);
    expect(rows.every(row => row.status === "succeeded")).toBe(true);
    await expect(runGeneration(scope, randomUUID(), "manual", input, new AbortController().signal, work))
      .rejects.toMatchObject({ code: "generation_quota_exceeded" });
    expect(work).toHaveBeenCalledTimes(3);
    console.log(`WORKFLOW_BUDGET ${JSON.stringify({ scenario: "generation-duplicate-intents", submissions: 24,
      admittedOperations: rows.length, duplicateRejected: 21, mockProviderWorkCalls: work.mock.calls.length,
      additionalQuotaRejected: 1, databaseProof: false, productionCertification: false })}`);
  });

  it("atomically admits only three concurrent free operations across users in one tenant", async () => {
    const outcomes = await Promise.allSettled(Array.from({ length: 9 }, (_, i) => reserve(randomUUID(), { ...scope, userId: `u-${i}` })));
    expect(outcomes.filter(value => value.status === "fulfilled")).toHaveLength(3);
    for (const outcome of outcomes) if (outcome.status === "rejected") expect(outcome.reason).toMatchObject({ statusCode: 429, retryAfterSeconds: 60 });
    expect(rows).toHaveLength(3); expect(rows.every(row => row.status === "started")).toBe(true);
    expect(mocks.readEntitlementState).toHaveBeenCalledWith(scope.tenantId, tx);
  });
  it("separates tenants and resets at exact UTC midnight, not a rolling 24 hours", async () => {
    await Promise.all(Array.from({ length: 3 }, () => reserve()));
    await reserve(randomUUID(), { ...scope, tenantId: "tenant-b" });
    now = new Date("2026-09-20T00:00:00Z"); await reserve();
    expect(rows.at(-1)).toMatchObject({ periodStart: now, periodEnd: new Date("2026-09-21T00:00:00Z") });
  });
  it("deduplicates concurrent retry by tenant/intent, surviving status changes and period rollover", async () => {
    const id = randomUUID(); const outcomes = await Promise.allSettled([reserve(id), reserve(id)]);
    expect(outcomes.filter(value => value.status === "fulfilled")).toHaveLength(1);
    await finishGeneration(scope, id, "failed"); now = new Date("2026-09-20T00:00:00Z");
    await expect(reserve(id)).rejects.toMatchObject({ code: "generation_operation_consumed" });
    await expect(reserve(id, { ...scope, userId: "other" })).rejects.toMatchObject({ code: "generation_intent_conflict" });
    await expect(reserveGeneration(scope, id, "selected", hash)).rejects.toMatchObject({ code: "generation_intent_conflict" });
    await expect(reserveGeneration(scope, id, "manual", "a".repeat(64))).rejects.toMatchObject({ code: "generation_intent_conflict" });
    expect(rows).toHaveLength(1);
  });
  it("never persists prompts, raw provider errors, or generation output", async () => {
    const work = vi.fn().mockResolvedValue("private generated output");
    await runGeneration(scope, randomUUID(), "manual", input, new AbortController().signal, work);
    expect(JSON.stringify(rows)).not.toMatch(/private|Not persisted/);
    expect(rows[0]).toMatchObject({ status: "succeeded", inputHash: hash });
  });
  it("does not consume at admission but rechecks expired paid access at execution", async () => {
    subscriptions = [{ planId: "pro", status: "active", currentPeriodStart: new Date("2026-09-03T11:07:00Z"), currentPeriodEnd: new Date("2026-09-20T00:00:00Z") } as Subscription];
    await assertGenerationAdmission(scope.tenantId); expect(rows).toHaveLength(0);
    now = new Date("2026-09-20T00:00:00Z"); plans = [pro];
    await expect(reserve()).rejects.toMatchObject({ code: "entitlement_required" });
    expect(rows).toHaveLength(0);
  });
  it("records actual provider periods without assuming 30 days and meters unlimited paid attempts", async () => {
    const currentPeriodStart = new Date("2026-09-03T11:07:00Z"), currentPeriodEnd = new Date("2026-10-06T15:09:00Z");
    subscriptions = [{ planId: "pro", status: "active", currentPeriodStart, currentPeriodEnd } as Subscription];
    await Promise.all(Array.from({ length: 5 }, () => reserve()));
    expect(rows).toHaveLength(5); expect(rows[0]).toMatchObject({ planKey: "pro_monthly", periodStart: currentPeriodStart, periodEnd: currentPeriodEnd });
  });
  it.each([null, "NaN", "-1", "1.5", "9007199254740992", 0, ""])("fails closed on invalid authoritative count %s", async value => {
    countOverride = value;
    await expect(reserve()).rejects.toMatchObject({ code: "generation_usage_unavailable" }); expect(rows).toHaveLength(0);
  });
  it("does not refund failures or allow unlimited fresh failed calls", async () => {
    const work = vi.fn().mockRejectedValue(new Error("private provider error"));
    for (let i = 0; i < 3; i++) await expect(runGeneration(scope, randomUUID(), "manual", input, new AbortController().signal, work)).rejects.toThrow("private provider error");
    await expect(runGeneration(scope, randomUUID(), "manual", input, new AbortController().signal, work)).rejects.toMatchObject({ statusCode: 429 });
    expect(work).toHaveBeenCalledTimes(3); expect(rows.every(row => row.status === "failed")).toBe(true);
  });
  it("does not call providers on reserve or commit failure", async () => {
    const work = vi.fn();
    for (const failure of ["insert", "commit"]) {
      failInsert = failure === "insert"; failCommit = failure === "commit";
      await expect(runGeneration(scope, randomUUID(), "manual", input, new AbortController().signal, work)).rejects.toMatchObject({ statusCode: 503 });
    }
    expect(work).not.toHaveBeenCalled(); expect(rows).toHaveLength(0);
  });
  it("retains uncertain started state after success-record failure and blocks replay", async () => {
    const id = randomUUID(); const work = vi.fn(async () => { failUpdate = true; return "real result"; });
    await expect(runGeneration(scope, id, "manual", input, new AbortController().signal, work)).rejects.toMatchObject({ statusCode: 503 });
    expect(rows[0].status).toBe("started");
    failUpdate = false;
    await expect(runGeneration(scope, id, "manual", input, new AbortController().signal, work)).rejects.toMatchObject({ statusCode: 409 });
    expect(work).toHaveBeenCalledTimes(1);
  });
  it("consumes cancellation after reservation, but not cancellation before it", async () => {
    const controller = new AbortController(); const id = randomUUID();
    await expect(runGeneration(scope, id, "manual", input, controller.signal, async () => { controller.abort(); return "late"; })).rejects.toBeDefined();
    expect(rows[0].status).toBe("cancelled");
    await expect(runGeneration(scope, randomUUID(), "manual", input, controller.signal, vi.fn())).rejects.toBeDefined(); expect(rows).toHaveLength(1);
  });
  it("scopes ledger reads to user/tenant and never changes a terminal outcome", async () => {
    const id = randomUUID(); await reserve(id); await finishGeneration(scope, id, "succeeded");
    expect(await readGenerationOperation(scope, id)).toMatchObject({ status: "succeeded" });
    expect(await readGenerationOperation({ ...scope, userId: "other" }, id)).toBeNull();
    expect(await readGenerationOperation({ ...scope, tenantId: "other" }, id)).toBeNull();
    await expect(finishGeneration(scope, id, "failed")).rejects.toMatchObject({ statusCode: 503 });
    expect(rows[0].status).toBe("succeeded");
  });
  it("bounds intent and input identity and fails closed for malformed paid periods", () => {
    expect(generationOperationId()).toMatch(/^[a-f0-9-]{36}$/);
    for (const intent of ["", null, 1, "x".repeat(1000)]) expect(() => generationOperationId(intent)).toThrow();
    expect(() => generationInputHash("x".repeat(100_001))).toThrow();
    expect(generationInputHash({ a: 1, b: 2 })).toBe(generationInputHash({ b: 2, a: 1 }));
    const access = resolveTenantEntitlements([free], [], now);
    expect(() => generationPeriod({ ...access, planKey: "pro_monthly" }, now)).toThrow();
  });
});