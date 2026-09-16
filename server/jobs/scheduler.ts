import cron from "node-cron";
import { enqueueInboxRefresh, enqueuePublishDraft } from "./queue";
import { storage, type TenantScope } from "../storage";
import { pool } from "../db";
import { redis } from "../lib/redis";

const tasks = new Map<string, ReturnType<typeof cron.schedule>>();
const running = new Map<string, Promise<void>>();

/** Only accept intervals expressible exactly by a five-field UTC cron. */
export function intervalCron(minutes: number): string {
  if (!Number.isInteger(minutes) || minutes < 1) throw new Error("Cron interval must be a positive integer");
  if (minutes < 60 && 60 % minutes === 0) return `*/${minutes} * * * *`;
  if (minutes % 60 === 0 && minutes <= 1440 && 24 % (minutes / 60) === 0) return `0 */${minutes / 60} * * *`;
  throw new Error(`Unsupported cron interval: ${minutes} minutes`);
}

async function* scopes() {
  let cursor: TenantScope | undefined;
  for (;;) {
    const page = await storage.getSchedulerScopes(cursor);
    if (!page.length) return;
    for (const scope of page) yield scope;
    cursor = page[page.length - 1];
  }
}

/**
 * Transaction advisory lock works with transaction-pooling proxies too. A Redis
 * slot marker suppresses a second instance arriving after the first completes.
 * Redis failure is fail-closed. Pending DB targets are retried next cycle.
 */
export async function runSchedulerCycle(name: string, minutes: number, work: (slot: number, assertConnected: () => Promise<void>) => Promise<void>): Promise<void> {
  if (running.has(name)) return;
  const slot = Math.floor(Date.now() / (minutes * 60_000));
  const cycle = (async () => {
    if (!redis) throw new Error("Scheduler requires Redis");
    const client = await pool.connect();
    let broken = false;
    const onError = () => { broken = true; };
    client.on("error", onError);
    try {
      await client.query("BEGIN");
      const lock = await client.query("SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked", [`tsp:scheduler:${name}`]);
      if (!lock.rows[0]?.locked) return;
      const claimed = await redis.set(`scheduler:slot:${name}:${slot}`, "1", "EX", Math.max(120, minutes * 120), "NX");
      if (!claimed) return;
      const assertConnected = async () => {
        if (broken) throw new Error("Scheduler lock connection lost");
        await client.query("SELECT 1");
      };
      await work(slot, assertConnected);
    } finally {
      try { await client.query("ROLLBACK"); } catch { broken = true; }
      client.removeListener("error", onError);
      client.release(broken);
    }
  })();
  running.set(name, cycle);
  try { await cycle; } finally { running.delete(name); }
}

function schedule(name: string, minutes: number, work: (slot: number, assertConnected: () => Promise<void>) => Promise<void>): string {
  const expression = intervalCron(minutes);
  if (tasks.has(name)) return expression;
  tasks.set(name, cron.schedule(expression, async () => {
    try { await runSchedulerCycle(name, minutes, work); }
    catch (error) { console.error(`[scheduler] ${name} cycle failed:`, error); }
  }, { timezone: "UTC", noOverlap: true }));
  return expression;
}

export function scheduleActiveUserRefresh(intervalMinutes = 360): string {
  return schedule("active", intervalMinutes, async (slot, assertConnected) => {
    for await (const scope of scopes()) {
      await assertConnected();
      if (!(await storage.getSchedulerActivity(scope)).active) continue;
      await enqueueInboxRefresh({ ...scope, priority: "low", triggeredBy: "cron", dedupeKey: `cron:active:${slot}:${scope.tenantId}:${scope.userId}` });
    }
  });
}

export function scheduleTopUserRefresh(intervalMinutes = 30): string {
  return schedule("top", intervalMinutes, async (slot, assertConnected) => {
    // Bounded top-k, not an unbounded cross-tenant in-memory result set.
    const top: Array<TenantScope & { engagement: number }> = [];
    for await (const scope of scopes()) {
      await assertConnected();
      const { engagement } = await storage.getSchedulerActivity(scope);
      if (engagement <= 0) continue;
      top.push({ ...scope, engagement });
      top.sort((a, b) => b.engagement - a.engagement);
      if (top.length > 50) top.pop();
    }
    for (const { tenantId, userId } of top) {
      await assertConnected();
      await enqueueInboxRefresh({ tenantId, userId, priority: "high", triggeredBy: "cron", dedupeKey: `cron:top:${slot}:${tenantId}:${userId}` });
    }
  });
}

export async function publishDueDrafts(assertConnected: () => Promise<void> = async () => undefined): Promise<void> {
  for await (const scope of scopes()) {
    await assertConnected();
    const schedules = await storage.getScheduledDraftsForPublishing(scope, 50);
    for (const scheduled of schedules) {
      const targets = await storage.getDraftScheduleTargetsForPublishing(scope, scheduled.id);
      for (const target of targets) {
        await assertConnected();
        // Do not mark the parent queued before enqueue: partial failures and
        // crashes must leave remaining targets discoverable for reconciliation.
        const id = await enqueuePublishDraft({ ...scope, draftId: scheduled.draftId, draftScheduleId: scheduled.id,
          draftScheduleTargetId: target.id, platform: target.platform, publishAt: scheduled.scheduledPublishAt, attemptNumber: 1 });
        if (!id) throw new Error("Publish scheduler queue unavailable");
      }
    }
  }
}

export function schedulePublishRefresh(intervalMinutes = 1): string {
  return schedule("publish", intervalMinutes, async (_slot, assertConnected) => publishDueDrafts(assertConnected));
}

export async function initializeScheduler(): Promise<boolean> {
  if (process.env.BACKGROUND_JOBS_ENABLED !== "true" || process.env.NODE_ENV !== "production" || process.env.CRON_SCHEDULER !== "true") return false;
  const active = Number(process.env.CRON_REFRESH_INTERVAL || "360");
  const top = Number(process.env.CRON_REFRESH_TOPUSERS_INTERVAL || "30");
  const publish = Number(process.env.CRON_PUBLISH_INTERVAL || "1");
  // Validate everything before registering any task (no half-started scheduler).
  [active, top, publish].forEach(intervalCron);
  if (!redis) throw new Error("Scheduler requires Redis");
  scheduleActiveUserRefresh(active);
  scheduleTopUserRefresh(top);
  schedulePublishRefresh(publish);
  return true;
}

export async function stopScheduler(): Promise<void> {
  for (const task of tasks.values()) await task.stop();
  tasks.clear();
  await Promise.allSettled(running.values());
}
