import Bull from "bull";
import Redis from "ioredis";
import { randomUUID } from "node:crypto";
import { redis, redisOptions } from "../lib/redis";
import type { PublishDraftJobData } from "./handlers/publish-draft";

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
export interface InboxRefreshJobProgress {
  articlesProcessed: number;
  articlesMatched: number;
  articlesCreated: number;
  needsSetup?: boolean;
}

let inboxRefreshQueue: Bull.Queue<InboxRefreshJobData> | undefined;
let publishDraftQueue: Bull.Queue<PublishDraftJobData> | undefined;
const queueClients = new Set<Redis>();

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
    createClient: (type) => {
      // Keep the complete URL: parsing only host/port drops credentials and rediss TLS.
      const client = new Redis(redisUrl, redisOptions(type !== "client"));
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
    // Redis provider that requires a password or TLS (e.g. Render Key Value).
    const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
    inboxRefreshQueue = new Bull<InboxRefreshJobData>("inbox_refresh", queueOptions(redisUrl));
    publishDraftQueue = new Bull<PublishDraftJobData>("publish_draft", queueOptions(redisUrl));
    for (const queue of [inboxRefreshQueue, publishDraftQueue]) {
      queue.on("error", (error) => console.error("[queue] Redis error:", error.message));
    }

    console.log("[queue] Inbox refresh queue initialized");
    console.log("[queue] Publish draft queue initialized");
    return inboxRefreshQueue;
  } catch (error) {
    console.error("[queue] Failed to initialize queue:", error);
    if (backgroundJobsRequired()) throw error;
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
    const job = await enqueueWithDeadline(queue.add(jobData, {
      priority: priorityMap[config.priority || "normal"],
      jobId: config.dedupeKey ?? `${config.tenantId}:${config.userId ?? "tenant"}:${randomUUID()}`,
    }));

    console.log(`[queue] Enqueued inbox_refresh job ${job.id} for tenant ${config.tenantId}`);
    return String(job.id);
  } catch (error) {
    console.error("[queue] Failed to enqueue job:", error);
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
        progress: job.progress(),
        data: job.data,
        error: job.failedReason,
        attemptsMade: job.attemptsMade,
        attempts: job.opts.attempts,
      };
    }
    return null;
  } catch (error) {
    console.error("[queue] Failed to get job status:", error);
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

    console.log(`[queue] Enqueued publish_draft job ${job.id} for draft ${config.draftId}`);
    return String(job.id);
  } catch (error) {
    console.error("[queue] Failed to enqueue publish job:", error);
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
