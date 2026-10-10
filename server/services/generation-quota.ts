import { createHash, randomUUID } from "node:crypto";
import { and, eq, gte, lt, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { billingGenerationOperations as operations } from "@shared/schema";
import type { TenantScope } from "../storage";
import { tenantBilling, type BillingTransaction } from "./billing-repository";
import { assertTenantEntitlement, EntitlementError, getTenantEntitlements, type TenantEntitlements } from "./entitlements";
import { AIGenerationError } from "./openRouter";
import { CrawlError } from "./crawlerFetch";

// These failures happen before any AI work is billed: the source could not be read, or
// the provider refused the call. They are recorded but do not use up the allowance.
const UNCHARGED_AI_FAILURES = new Set(["ai_configuration", "ai_quota", "ai_unavailable", "ai_busy", "ai_rate_limit", "ai_budget", "ai_invalid_input"]);
function consumesAllowance(error: unknown): boolean {
  if (error instanceof CrawlError) return false;
  return !(error instanceof AIGenerationError && UNCHARGED_AI_FAILURES.has(error.code));
}

export class GenerationQuotaError extends Error {
  constructor(public readonly statusCode: number, public readonly code: string, message: string,
    public readonly retryAfterSeconds?: number) { super(message); }
}
export function generationAccessFailure(error: unknown) {
  if (!(error instanceof GenerationQuotaError || error instanceof EntitlementError)) return undefined;
  return { status: error.statusCode, body: { code: error.code, message: error.message },
    retryAfterSeconds: error instanceof GenerationQuotaError ? error.retryAfterSeconds : undefined };
}
const unavailable = () => new GenerationQuotaError(503, "generation_usage_unavailable", "Generation usage could not be confirmed. Do not retry with a new intent until you check the operation.");

export function generationOperationId(intent?: unknown): string {
  if (intent === undefined) return randomUUID();
  const parsed = z.string().uuid().safeParse(intent);
  if (!parsed.success) throw new GenerationQuotaError(400, "generation_intent_invalid", "requestIntent must be a UUID.");
  return parsed.data.toLowerCase();
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return "{" + Object.entries(value).filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",") + "}";
  return JSON.stringify(value) ?? "null";
}
export function generationInputHash(input: unknown): string {
  const serialized = stable(input);
  if (Buffer.byteLength(serialized) > 100_000) throw new GenerationQuotaError(400, "generation_input_too_large", "Generation input exceeds the operation limit.");
  return createHash("sha256").update(serialized).digest("hex");
}

export function generationPeriod(access: TenantEntitlements, now: Date) {
  if (!Number.isFinite(now.getTime())) throw unavailable();
  if (access.planKey !== "free") {
    const start = access.currentPeriodStart, end = access.currentPeriodEnd;
    if (!start || !end || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > now || end <= now || start >= end) throw unavailable();
    return { start, end };
  }
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return { start, end: new Date(start.getTime() + 86_400_000) };
}
async function dbSafe<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (error) {
    if (error instanceof GenerationQuotaError || error instanceof EntitlementError) throw error;
    throw unavailable();
  }
}

/** Caller holds billing:<tenant> lock, shared with webhook/cancel/verify. */
async function allowance(tx: BillingTransaction, tenantId: string) {
  const time = await tx.execute(sql`select clock_timestamp() as now`);
  const now = new Date(time.rows[0].now as string | Date);
  const access = await getTenantEntitlements(tenantId, tx, now);
  // Denied/unknown plans must not turn into an invented free billing period.
  if (access.maxDailyGenerations === 0) await assertTenantEntitlement(tenantId, "generate", { transaction: tx, now });
  const period = generationPeriod(access, now);
  const [usage] = await tx.select({ used: sql<string>`count(*)::text` }).from(operations).where(and(
    eq(operations.tenantId, tenantId), gte(operations.createdAt, period.start), lt(operations.createdAt, period.end),
    ne(operations.status, "failed_uncharged"),
  ));
  const used = Number(usage?.used);
  if (typeof usage?.used !== "string" || !/^\d+$/.test(usage.used) || !Number.isSafeInteger(used) || used < 0) throw unavailable();
  if (access.maxDailyGenerations !== null && access.maxDailyGenerations > 0 && used >= access.maxDailyGenerations) {
    throw new GenerationQuotaError(429, "generation_quota_exceeded", "Generation attempt allowance exhausted. Free allowances reset at midnight UTC.", Math.max(1, Math.ceil((period.end.getTime() - now.getTime()) / 1000)));
  }
  await assertTenantEntitlement(tenantId, "generate", { transaction: tx, now, dailyGenerationsUsed: used });
  return { access, period, now };
}

/** Admission is advisory; execution reserves again under the same tenant lock. */
export async function assertGenerationAdmission(tenantId: string) {
  await dbSafe(() => tenantBilling(tenantId, async tx => { await allowance(tx, tenantId); }));
}

export async function reserveGeneration(scope: TenantScope, operationId: string, kind: string, inputHash: string) {
  if (!scope.tenantId || !scope.userId || generationOperationId(operationId) !== operationId || !/^[a-f0-9]{64}$/.test(inputHash) || !/^[a-z-]{1,32}$/.test(kind)) {
    throw new GenerationQuotaError(400, "generation_operation_invalid", "Invalid generation operation.");
  }
  await dbSafe(() => tenantBilling(scope.tenantId, async tx => {
    const [previous] = await tx.select().from(operations).where(and(eq(operations.tenantId, scope.tenantId), eq(operations.operationId, operationId)));
    if (previous) {
      const same = previous.userId === scope.userId && previous.kind === kind && previous.inputHash === inputHash;
      const outcome = previous.status === "started" ? "in progress or outcome unknown" : previous.status;
      throw new GenerationQuotaError(409, same ? "generation_operation_consumed" : "generation_intent_conflict",
        same ? `Operation already consumed (${outcome}). No provider retry was made.` : "This intent is already bound to another operation.");
    }
    const { access, period, now } = await allowance(tx, scope.tenantId);
    await tx.insert(operations).values({ ...scope, operationId, kind, inputHash, planKey: access.planKey,
      periodStart: period.start, periodEnd: period.end, createdAt: now, status: "started" });
  }));
}

export async function finishGeneration(scope: TenantScope, operationId: string, status: "succeeded" | "failed" | "failed_uncharged" | "cancelled") {
  await dbSafe(() => tenantBilling(scope.tenantId, async tx => {
    const rows = await tx.update(operations).set({ status, completedAt: new Date() }).where(and(
      eq(operations.tenantId, scope.tenantId), eq(operations.userId, scope.userId), eq(operations.operationId, operationId), eq(operations.status, "started"),
    )).returning({ operationId: operations.operationId });
    if (rows.length !== 1) throw unavailable();
  }));
}

/** One bounded whole-operation attempt. Cancellation and failures after AI work are NOT
 * refunded; failures before any AI work (see consumesAllowance) do not use the allowance.
 * Provider-internal retries remain bounded by the existing editorial pipeline.
 * Crashes/commit uncertainty retain started, never authorize automatic replay. */
export async function runGeneration<T>(scope: TenantScope, operationId: string, kind: string, input: unknown,
  signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  await reserveGeneration(scope, operationId, kind, generationInputHash(input));
  let result: T;
  try {
    signal.throwIfAborted();
    result = await work();
    signal.throwIfAborted();
  } catch (error) {
    await finishGeneration(scope, operationId, signal.aborted ? "cancelled" : consumesAllowance(error) ? "failed" : "failed_uncharged");
    throw error;
  }
  // A failed success-commit must not be mislabeled as provider failure.
  await finishGeneration(scope, operationId, "succeeded");
  return result;
}

export async function readGenerationOperation(scope: TenantScope, operationId: string): Promise<Pick<typeof operations.$inferSelect, "operationId" | "kind" | "status" | "periodStart" | "periodEnd" | "createdAt" | "completedAt"> | null> {
  operationId = generationOperationId(operationId);
  return dbSafe(() => tenantBilling(scope.tenantId, async tx => {
    const [row] = await tx.select({ operationId: operations.operationId, kind: operations.kind, status: operations.status,
      periodStart: operations.periodStart, periodEnd: operations.periodEnd, createdAt: operations.createdAt, completedAt: operations.completedAt,
    }).from(operations).where(and(eq(operations.tenantId, scope.tenantId), eq(operations.userId, scope.userId), eq(operations.operationId, operationId)));
    return row ?? null;
  }));
}