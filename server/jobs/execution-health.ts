import { z } from "zod";
import { redis } from "../lib/redis";
import { queuePrefix } from "../lib/redis-options";
import type { AdminMonitoring } from "@shared/admin";

const recordSchema = z.object({
  run: z.string(), status: z.enum(["running", "succeeded", "failed"]), interval: z.coerce.number().int().positive(),
  started: z.coerce.number().positive(), finished: z.coerce.number().nonnegative().optional(), success: z.coerce.number().nonnegative().optional(),
});
const key = (name: string) => `${queuePrefix()}:scheduler:health:${name}`;
const retentionSeconds = 30 * 24 * 60 * 60;
const finishScript = `if redis.call('HGET', KEYS[1], 'run') ~= ARGV[1] then return 0 end
redis.call('HSET', KEYS[1], 'status', ARGV[2], 'finished', ARGV[3])
if ARGV[2] == 'succeeded' then redis.call('HSET', KEYS[1], 'success', ARGV[3]) end
redis.call('EXPIRE', KEYS[1], ARGV[4])
return 1`;

export async function observeSchedulerStart(name: string, minutes: number, run: string) {
  if (!redis) throw new Error("Execution observations require Redis");
  await redis.multi().hset(key(name), { run, status: "running", interval: String(minutes), started: String(Date.now()), finished: "0" })
    .expire(key(name), retentionSeconds).exec().then(result => {
      if (!result || result.some(([error]) => error)) throw new Error("Execution observation could not be persisted");
    });
}
export async function observeSchedulerFinish(name: string, run: string, success: boolean) {
  if (!redis) throw new Error("Execution observations require Redis");
  const saved = await redis.eval(finishScript, 1, key(name), run, success ? "succeeded" : "failed", Date.now(), retentionSeconds);
  if (saved !== 1) throw new Error("Execution observation was superseded");
}
function configuredTasks() {
  const tasks = [
    { name: "active", intervalMinutes: Number(process.env.CRON_REFRESH_INTERVAL || "360") },
    { name: "top", intervalMinutes: Number(process.env.CRON_REFRESH_TOPUSERS_INTERVAL || "30") },
    { name: "publish", intervalMinutes: Number(process.env.CRON_PUBLISH_INTERVAL || "1") },
    { name: "email-communications", intervalMinutes: 1 },
  ];
  if (process.env.EMAIL_DIGEST_ENABLED === "true") tasks.push({ name: "email-digest", intervalMinutes: 1 });
  if (process.env.ADMIN_OPERATIONS_ENABLED === "true") tasks.push({ name: "admin-operations", intervalMinutes: 1 });
  if (process.env.ADMIN_ROLLUPS_ENABLED === "true") tasks.push({ name: "admin-rollups", intervalMinutes: 15 });
  if (process.env.POOL_CRAWL_ENABLED !== "false") tasks.push({ name: "pool-crawl", intervalMinutes: Number(process.env.POOL_CRAWL_INTERVAL || "15") });
  return tasks;
}
export function executionState(raw: Record<string, string>, intervalMinutes: number, now = Date.now()) {
  if (!Number.isSafeInteger(intervalMinutes) || intervalMinutes < 1) throw new Error("Invalid scheduler observation cadence");
  const parsed = recordSchema.safeParse(raw);
  if (!parsed.success) {
    if (Object.keys(raw).length) throw new Error("Invalid scheduler execution observation");
    return { state: "never_observed" as const, startedAt: null, finishedAt: null, lastSuccessAt: null };
  }
  const row = parsed.data;
  const threshold = Math.max(5 * 60_000, intervalMinutes * 2 * 60_000);
  const age = now - (row.finished || row.started);
  const state = age > threshold ? "stale" as const : row.status;
  return { state, startedAt: new Date(row.started).toISOString(), finishedAt: row.finished ? new Date(row.finished).toISOString() : null,
    lastSuccessAt: row.success ? new Date(row.success).toISOString() : null };
}
export async function readSchedulerExecutionHealth(): Promise<NonNullable<AdminMonitoring["execution"]>> {
  if (!redis) return { available: false, tasks: [] };
  try {
    const tasks = configuredTasks();
    const rows = await Promise.all(tasks.map(task => redis!.hgetall(key(task.name))));
    return { available: true, tasks: tasks.map((task, index) => ({ ...task, ...executionState(rows[index], task.intervalMinutes) })) };
  } catch {
    console.error("[scheduler:health] Execution observations unavailable");
    return { available: false, tasks: [] };
  }
}
