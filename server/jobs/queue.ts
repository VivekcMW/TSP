import Bull from "bull";
import type Redis from "ioredis";
import { randomUUID } from "node:crypto";
import { redis } from "../lib/redis";
import { createRedisClient, queuePrefix } from "../lib/redis-options";
import type { PublishDraftJobData } from "./handlers/publish-draft";
import type { InboxRefreshResult } from "@shared/inbox-refresh";

/**
 * Configuration for enqueueing an inbox refresh job.
 * Used by both manual API calls and cron pre-warming.
 */
export interface InboxRefreshJobConfig {
  tenantId: string;
  userId?: string;
  manual?: boolean;
  priority?: "high" | "normal" | "low";
  autoRefresh?: boolean;
  triggeredBy?: "manual" | "cron";
  dedupeKey?: string;
  operationId?: string;
}

/**
 * Job data structure persisted in the queue.
 */
export interface InboxRefreshJobData extends InboxRefreshJobConfig {
  startedAt: number;
}

/**
 * Job progress tracking.
 */
export interface InboxRefreshJobProgress extends Partial<InboxRefreshResult> {
  articlesProcessed: number;
  articlesMatched: number;
  articlesCreated: number;
  needsSetup?: boolean;
}

let inboxRefreshQueue: Bull.Queue<InboxRefreshJobData> | undefined;
let publishDraftQueue: Bull.Queue<PublishDraftJobData> | undefined;
const queueClients = new Set<Redis>();

export class InboxRefreshAdmissionError extends Error {
  constructor(public readonly code: "refresh_operation_conflict" | "refresh_retry_exhausted" | "refresh_job_failed") {
    super(code === "refresh_operation_conflict"
      ? "Refresh operation does not match its original request."
      : "This refresh failed. Its recovery budget is exhausted or it failed again; start a new refresh with a new operationId.");
    this.name = "InboxRefreshAdmissionError";
  }
}

// At most two explicit recovery reservations per retained Bull job, across all
// API instances. Never reset attemptsMade or remove/recreate a failed job.
// A lost retry acknowledgement consumes a reservation conservatively. Receipts
// are checked by both callers and the worker before any replayed engine work.
const reserveInboxRetry = `
  if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
  if not redis.call('ZSCORE', KEYS[2], ARGV[1]) then return 0 end
  if redis.call('EXISTS', KEYS[3]) == 1 then return 0 end
  local used = tonumber(redis.call('HGET', KEYS[1], 'inboxRecoveryReservations') or '0')
  if used >= 2 then return -1 end
  redis.call('HINCRBY', KEYS[1], 'inboxRecoveryReservations', 1)
  return 1
`;

export class QueueUnavailableError extends Error {
  constructor() {
    super("Background queue unavailable. Scheduled work remains saved; please try again later.");
    this.name = "QueueUnavailableError";
  }
}

function disabledQueue(): null {
  // Null means deliberately disabled local development, never a failed enqueue.
  if (process.env.NODE_ENV === "production" || redis) throw new QueueUnavailableError();
  return null;
}

export function queueOptions(redisUrl: string): Bull.QueueOptions {
  return {
    prefix: queuePrefix(),
    createClient: (type) => {
      // Preserve auth/TLS/db without letting URL queries override lifecycle policy.
      const client = createRedisClient(redisUrl, type !== "client");
      queueClients.add(client);
      // Bull carries ioredis v5 types; the app uses v6's compatible legacy API.
      return client as unknown as ReturnType<NonNullable<Bull.QueueOptions["createClient"]>>;
    },
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 7 * 24 * 3600, count: 1000 },
    },
  };
}

export function backgroundJobsRequired(): boolean {
  return process.env.NODE_ENV === "production" && process.env.BACKGROUND_JOBS_ENABLED === "true";
}

async function enqueueWithDeadline<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new QueueUnavailableError()), 8_000);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Initialize the inbox refresh queue.
 * Returns undefined if Redis is not configured (local dev fallback).
 */
export function initializeQueues(): Bull.Queue<InboxRefreshJobData> | undefined {
  if (inboxRefreshQueue && publishDraftQueue) return inboxRefreshQueue;
  if (!redis) {
    if (backgroundJobsRequired()) {
      throw new Error("REDIS_URL must be configured when BACKGROUND_JOBS_ENABLED=true in production");
    }
    console.log("[queue] Redis not configured, queues disabled (sync fallback will be used)");
    return undefined;
  }

  try {
    // Pass the full connection string (not just host/port) so ioredis picks up
    // auth credentials and TLS (rediss://) from the URL itself — a manually
    // extracted {host, port} object silently drops both, which breaks any
    // Redis provider that requires a password or TLS (e.g. Redis Cloud).
    const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
    inboxRefreshQueue = new Bull<InboxRefreshJobData>("inbox_refresh", queueOptions(redisUrl));
    publishDraftQueue = new Bull<PublishDraftJobData>("publish_draft", queueOptions(redisUrl));
    
    let lastErrorLog = 0;
    let errorCount = 0;
    const ERROR_LOG_INTERVAL_MS = 30_000; // Log errors max once per 30s
    
    for (const queue of [inboxRefreshQueue, publishDraftQueue]) {
      queue.on("error", () => {
        const now = Date.now();
        errorCount++;
        // Reduce error log spam: queue errors are usually transient reconnects
        if (now - lastErrorLog >= ERROR_LOG_INTERVAL_MS) {
          console.warn(`[queue] Connection unavailable (${errorCount} errors since last log)`);
          lastErrorLog = now;
          errorCount = 0;
        }
      });
    }

    console.log("[queue] Inbox refresh queue initialized");
    console.log("[queue] Publish draft queue initialized");
    return inboxRefreshQueue;
  } catch {
    console.error("[queue] Failed to initialize queue");
    if (backgroundJobsRequired()) throw new QueueUnavailableError();
    return undefined;
  }
}

export async function getQueueHealth() {
  if (!redis) return { configured: false, reachable: false, queuesReady: false };
  try {
    const response = await redis.ping();
    return { configured: true, reachable: response === "PONG", queuesReady: Boolean(inboxRefreshQueue && publishDraftQueue) };
  } catch {
    return { configured: true, reachable: false, queuesReady: Boolean(inboxRefreshQueue && publishDraftQueue) };
  }
}

/**
 * Get the inbox refresh queue instance.
 */
export function getInboxRefreshQueue(): Bull.Queue<InboxRefreshJobData> | undefined {
  return inboxRefreshQueue;
}

/**
 * Enqueue an inbox refresh job.
 * Returns the job ID if queue is available, or null if queue is disabled.
 */
export async function enqueueInboxRefresh(config: InboxRefreshJobConfig): Promise<string | null> {
  const queue = getInboxRefreshQueue();
  if (!queue) {
    return disabledQueue();
  }

  const jobData: InboxRefreshJobData = {
    ...config,
    startedAt: Date.now(),
  };

  const priorityMap = {
    high: 1,
    normal: 5,
    low: 10,
  };

  try {
    return await enqueueWithDeadline((async () => {
      const added = await queue.add(jobData, {
        priority: priorityMap[config.priority || "normal"],
        jobId: config.dedupeKey ?? `${config.tenantId}:${config.userId ?? "tenant"}:${randomUUID()}`,
      });
      // Bull.add returns a fresh object even for an existing ID. Its data and
      // attemptsMade are NOT the persisted job's data/attempts.
      const job = await queue.getJob(added.id);
      if (!job) throw new QueueUnavailableError();
      if (job.data.tenantId !== config.tenantId || job.data.userId !== config.userId
        || job.data.operationId !== config.operationId || Boolean(job.data.autoRefresh) !== Boolean(config.autoRefresh)) {
        throw new InboxRefreshAdmissionError("refresh_operation_conflict");
      }
      if (await job.getState() === "failed") {
        // Only explicit user/admin requests with stable operations may recover.
        if (!config.manual || !config.operationId) throw new InboxRefreshAdmissionError("refresh_job_failed");
        const reserved = await queue.client.eval(reserveInboxRetry, 3,
          queue.toKey(String(job.id)), queue.toKey("failed"), queue.toKey(`${job.id}:lock`), String(job.id));
        if (reserved === -1) throw new InboxRefreshAdmissionError("refresh_retry_exhausted");
        if (reserved === 1) {
          try { await job.retry(); } catch {
            // A concurrent caller may already have retried it, or the retry
            // acknowledgement was lost. Inspect state; never remove/re-add.
            if (!["waiting", "active", "delayed", "paused", "completed"].includes(await job.getState())) {
              throw new QueueUnavailableError();
            }
          }
        }
      }
      const state = await job.getState();
      if (state === "failed") throw new InboxRefreshAdmissionError("refresh_job_failed");
      if (!["waiting", "active", "delayed", "paused", "completed"].includes(state)) throw new QueueUnavailableError();
      console.log("[queue] Inbox refresh admitted");
      return String(job.id);
    })());
  } catch (error) {
    if (error instanceof InboxRefreshAdmissionError) throw error;
    console.error("[queue] Failed to enqueue inbox refresh");
    throw new QueueUnavailableError();
  }
}

/**
 * Get job status and progress.
 * Returns null if job not found or queue is disabled.
 */
export async function getJobStatus(jobId: string) {
  const queues = [getInboxRefreshQueue(), getPublishDraftQueue()].filter(Boolean) as Bull.Queue[];
  if (!queues.length) return null;

  try {
    for (const queue of queues) {
      const job = await queue.getJob(jobId);
      if (!job) continue;
      const state = await job.getState();
      return {
        id: job.id,
        state,
        progress: state === "completed" && job.returnvalue && typeof job.returnvalue === "object" ? job.returnvalue : job.progress(),
        data: job.data,
        error: state === "failed" ? job.failedReason : null,
        attemptsMade: job.attemptsMade,
        attempts: job.opts.attempts,
      };
    }
    return null;
  } catch {
    console.error("[queue] Failed to get job status");
    return null;
  }
}

/**
 * Get the publish draft queue instance.
 */
export function getPublishDraftQueue(): Bull.Queue<PublishDraftJobData> | undefined {
  return publishDraftQueue;
}

/**
 * Enqueue a publish draft job.
 * Returns the job ID if queue is available, or null if queue is disabled.
 */
export async function enqueuePublishDraft(config: PublishDraftJobData): Promise<string | null> {
  const queue = getPublishDraftQueue();
  if (!queue) {
    return disabledQueue();
  }

  try {
    const jobId = `${config.tenantId}:${config.draftId}:${config.draftScheduleTargetId ?? config.draftScheduleId}:${config.attemptNumber ?? 1}`;
    const job = await enqueueWithDeadline(queue.add(config, {
      priority: 5, // Normal priority for publications
      jobId,
    }));

    console.log("[queue] Publish draft admitted");
    return String(job.id);
  } catch {
    console.error("[queue] Failed to enqueue publish job");
    throw new QueueUnavailableError();
  }
}

/**
 * Cleanup function for graceful shutdown.
 */
export async function closeQueues(): Promise<void> {
  try {
    await Promise.all([inboxRefreshQueue?.close(), publishDraftQueue?.close()]);
  } finally {
    for (const client of queueClients) client.disconnect();
    queueClients.clear();
    inboxRefreshQueue = undefined;
    publishDraftQueue = undefined;
  }
}
