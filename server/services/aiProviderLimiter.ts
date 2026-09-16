import { createHash, randomUUID } from "node:crypto";
import { redis } from "../lib/redis";

// Longer than the entire generation deadline, but bounded if a worker dies.
export const AI_LEASE_TTL_MS = 30_000;
const GLOBAL_KEY = "tsp:{ai-generation}:leases";
const localBudgets = new Map<string, { count: number; until: number }>();

export class AIProviderLimitError extends Error {
  constructor(public readonly code: "ai_busy" | "ai_budget" | "ai_configuration" | "ai_unavailable", public readonly retryAfterSeconds?: number) {
    super(code);
  }
}

function setting(name: string, fallback: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new AIProviderLimitError("ai_configuration");
  return value;
}

// One atomic admission check: rejected concurrency does not spend tenant budget.
// Redis TIME avoids host clock skew; the common hash tag supports Redis Cluster.
export const ACQUIRE_AI_LEASE = `
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[2]) then return {0, 5} end
if tonumber(ARGV[3]) > 0 then
  local count = tonumber(redis.call('GET', KEYS[2]) or '0')
  if count >= tonumber(ARGV[3]) then
    return {2, math.max(1, math.ceil(redis.call('PTTL', KEYS[2]) / 1000))}
  end
  if redis.call('INCR', KEYS[2]) == 1 then redis.call('PEXPIRE', KEYS[2], ARGV[4]) end
end
redis.call('ZADD', KEYS[1], now + tonumber(ARGV[5]), ARGV[1])
redis.call('PEXPIRE', KEYS[1], ARGV[5])
return {1, 0}
`;

export type AILease = () => void;

function spendLocalBudget(tenantKey: string, budget: number, windowMs: number): AILease {
  const now = Date.now();
  for (const [key, value] of localBudgets) if (value.until <= now) localBudgets.delete(key);
  if (budget) {
    const current = localBudgets.get(tenantKey) ?? { count: 0, until: now + windowMs };
    if (current.count >= budget) throw new AIProviderLimitError("ai_budget", Math.max(1, Math.ceil((current.until - now) / 1000)));
    // Fail closed rather than evict live budgets and allow unlimited new tenants.
    if (!localBudgets.has(tenantKey) && localBudgets.size >= 10_000) throw new AIProviderLimitError("ai_busy", 5);
    current.count++;
    localBudgets.set(tenantKey, current);
  }
  return () => undefined;
}

/**
 * One budget unit per admitted generate call (including at most one fallback).
 * Supply only a server-authenticated tenantId. Unscoped background work shares
 * an "unscoped" bucket when AI_TENANT_REQUEST_BUDGET is enabled. Not a dollar cap.
 * Without Redis, budgets are process-local; configured Redis fails closed.
 */
export function acquireAILease(tenantId?: string): AILease | Promise<AILease> {
  const limit = setting("AI_SHARED_MAX_CONCURRENT_REQUESTS", 4, 1000);
  const budget = process.env.AI_TENANT_REQUEST_BUDGET ? setting("AI_TENANT_REQUEST_BUDGET", 0, 1_000_000) : 0;
  const windowMs = setting("AI_TENANT_BUDGET_WINDOW_SECONDS", 3600, 86400) * 1000;
  const tenantKey = `tsp:{ai-generation}:budget:${createHash("sha256").update(tenantId ?? "unscoped").digest("hex")}`;
  if (!redis) return spendLocalBudget(tenantKey, budget, windowMs);
  const client = redis;
  // Do not queue admissions during an outage and start stale work on reconnect.
  if (client.status !== "ready") throw new AIProviderLimitError("ai_unavailable");
  const id = randomUUID();
  return client.eval(ACQUIRE_AI_LEASE, 2, GLOBAL_KEY, tenantKey, id, limit, budget, windowMs, AI_LEASE_TTL_MS)
    .then(result => {
      if (!Array.isArray(result) || result.length !== 2) throw new AIProviderLimitError("ai_unavailable");
      if (Number(result[0]) === 0) throw new AIProviderLimitError("ai_busy", 5);
      if (Number(result[0]) === 2) throw new AIProviderLimitError("ai_budget", Number(result[1]));
      if (Number(result[0]) !== 1) throw new AIProviderLimitError("ai_unavailable");
      let released = false;
      return () => {
        if (released) return;
        released = true;
        // Release only this lease; failure is safe because the lease expires.
        void client.zrem(GLOBAL_KEY, id).catch(() => undefined);
      };
    }).catch(error => {
      if (error instanceof AIProviderLimitError) throw error;
      throw new AIProviderLimitError("ai_unavailable");
    });
}