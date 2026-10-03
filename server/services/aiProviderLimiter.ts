import { createHash, randomUUID } from "node:crypto";
import { redis } from "../lib/redis";

// Renewed while transport is held; bounded recovery if a worker dies.
export const AI_LEASE_TTL_MS = 30_000;
const MAX_LEASE_TTL_MS = 600_000;
const CONTROL_TIMEOUT_MS = 5_000;
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
local last = redis.call('ZREVRANGE', KEYS[1], 0, 0, 'WITHSCORES')
redis.call('PEXPIREAT', KEYS[1], math.ceil(tonumber(last[2])))
return {1, 0}
`;

// XX alone is insufficient: an expired member may still be in the sorted set.
// Neither a delayed renewal nor one racing release may recreate membership.
export const RENEW_AI_LEASE = `
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
local expiry = redis.call('ZSCORE', KEYS[1], ARGV[1])
if not expiry then return 0 end
redis.call('ZADD', KEYS[1], 'XX', math.max(tonumber(expiry), now + tonumber(ARGV[2])), ARGV[1])
local last = redis.call('ZREVRANGE', KEYS[1], 0, 0, 'WITHSCORES')
redis.call('PEXPIREAT', KEYS[1], math.ceil(tonumber(last[2])))
return 1
`;

export type AILease = () => void;

export interface AILeaseOptions {
  /** Trusted server duration, integer 1,000..600,000 ms; normally operation timeout + 30s. */
  ttlMs?: number;
  /** Called once on lost/uncertain ownership. Abort transport; release only when it settles. */
  onLost?: (error: AIProviderLimitError) => void;
}

/** A hung command cannot hold up admission/loss detection. Observe late rejection
 * too, and fence late success even if an event-loop stall delayed the timeout. */
function boundedCommand(command: () => Promise<unknown>, timeoutMs: number, onLateSuccess: () => void) {
  let cancel: () => void = () => undefined;
  const started = performance.now();
  const result = new Promise<unknown>((resolve, reject) => {
    let pending = true;
    const finish = (error?: AIProviderLimitError, value?: unknown) => {
      if (!pending) return;
      pending = false;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    cancel = () => finish(new AIProviderLimitError("ai_unavailable"));
    const timer = setTimeout(() => cancel(), timeoutMs);
    timer.unref?.();
    void (async () => {
      try {
        const value = await command();
        if (!pending || performance.now() - started >= timeoutMs) {
          cancel();
          onLateSuccess();
        } else finish(undefined, value);
      } catch { cancel(); }
    })();
  });
  return { result, cancel };
}

async function acquireSharedLease(client: NonNullable<typeof redis>, tenantKey: string, limit: number,
  budget: number, windowMs: number, ttlMs: number, onLost: AILeaseOptions["onLost"]): Promise<AILease> {
  const id = randomUUID();
  const waitMs = Math.min(CONTROL_TIMEOUT_MS, Math.floor(ttlMs / 3));
  const removeOwnMember = async () => {
    // Never enqueue cleanup on a disconnected client. Expiry remains the backstop.
    if (client.status !== "ready") return;
    try { await client.zrem(GLOBAL_KEY, id); } catch { /* best effort */ }
  };
  const started = performance.now();
  const admission = boundedCommand(
    () => client.eval(ACQUIRE_AI_LEASE, 2, GLOBAL_KEY, tenantKey, id, limit, budget, windowMs, ttlMs),
    waitMs, removeOwnMember,
  );
  try {
    const result = await admission.result;
    if (client.status !== "ready" || performance.now() - started >= waitMs ||
      !Array.isArray(result) || result.length !== 2) throw new AIProviderLimitError("ai_unavailable");
    if (result[0] === 0) throw new AIProviderLimitError("ai_busy", 5);
    if (result[0] === 2 && Number.isSafeInteger(result[1]) && result[1] > 0) {
      throw new AIProviderLimitError("ai_budget", result[1]);
    }
    if (result[0] !== 1 || result[1] !== 0) throw new AIProviderLimitError("ai_unavailable");
  } catch (error) {
    // A rejection/timeout may hide a successful write. Do not refund admission
    // budget, and repeat owned cleanup if a late success arrives after this.
    if (!(error instanceof AIProviderLimitError) || error.code === "ai_unavailable") void removeOwnMember();
    throw error instanceof AIProviderLimitError ? error : new AIProviderLimitError("ai_unavailable");
  }

  let state: "held" | "lost" | "released" = "held";
  let liveUntil = started + ttlMs; // Conservative monotonic bound, not a host wall clock.
  let renewalTimer: ReturnType<typeof setTimeout>;
  let cancelPending: (() => void) | undefined;
  const lose = () => {
    if (state !== "held") return;
    state = "lost";
    clearTimeout(renewalTimer);
    // Keep the remaining reservation until release/expiry, not merely abort.
    try { void Promise.resolve(onLost?.(new AIProviderLimitError("ai_unavailable"))).catch(() => undefined); }
    catch { /* A caller's notification must not become an unhandled rejection. */ }
  };
  const schedule = () => {
    renewalTimer = setTimeout(() => { void renew(); }, Math.floor(ttlMs / 3));
    renewalTimer.unref?.();
  };
  const renew = async () => {
    if (state !== "held") return;
    const renewalStarted = performance.now();
    if (client.status !== "ready" || renewalStarted >= liveUntil) { lose(); return; }
    const renewal = boundedCommand(
      () => client.eval(RENEW_AI_LEASE, 1, GLOBAL_KEY, id, ttlMs),
      Math.min(waitMs, liveUntil - renewalStarted),
      () => { if (state === "released") void removeOwnMember(); },
    );
    cancelPending = renewal.cancel;
    try {
      const result = await renewal.result;
      // Release may have run while the response was in flight.
      if (state !== "held") {
        if (state === "released") void removeOwnMember();
        return;
      }
      if (result !== 1 || client.status !== "ready" || performance.now() >= liveUntil ||
        performance.now() - renewalStarted >= waitMs) { lose(); return; }
      liveUntil = renewalStarted + ttlMs;
      schedule();
    } catch { lose(); }
    finally { cancelPending = undefined; }
  };
  schedule();
  return () => {
    if (state === "released") return;
    state = "released";
    clearTimeout(renewalTimer);
    cancelPending?.();
    void removeOwnMember();
  };
}

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
 * Do not release on parent cancellation: retain/renew until transport settles.
 * Worker death/partition can still let leases expire while remote compute runs;
 * neither expiry nor onLost proves provider cancellation or stopped billing.
 */
export function acquireAILease(tenantId?: string, options: AILeaseOptions = {}): AILease | Promise<AILease> {
  const limit = setting("AI_SHARED_MAX_CONCURRENT_REQUESTS", 4, 1000);
  const budget = process.env.AI_TENANT_REQUEST_BUDGET ? setting("AI_TENANT_REQUEST_BUDGET", 0, 1_000_000) : 0;
  const windowMs = setting("AI_TENANT_BUDGET_WINDOW_SECONDS", 3600, 86400) * 1000;
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new AIProviderLimitError("ai_configuration");
  const { ttlMs = AI_LEASE_TTL_MS } = options;
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1000 || ttlMs > MAX_LEASE_TTL_MS ||
    (options.onLost !== undefined && typeof options.onLost !== "function")) throw new AIProviderLimitError("ai_configuration");
  const tenantKey = `tsp:{ai-generation}:budget:${createHash("sha256").update(tenantId ?? "unscoped").digest("hex")}`;
  if (!redis) return spendLocalBudget(tenantKey, budget, windowMs);
  const client = redis;
  // Do not queue admissions during an outage and start stale work on reconnect.
  if (client.status !== "ready") throw new AIProviderLimitError("ai_unavailable");
  return acquireSharedLease(client, tenantKey, limit, budget, windowMs, ttlMs, options.onLost);
}