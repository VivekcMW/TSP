import Bull from "bull";
import { redis } from "../lib/redis";
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

export function backgroundJobsRequired(): boolean {
  return process.env.NODE_ENV === "production" && process.env.BACKGROUND_JOBS_ENABLED === "true";
}

/**
 * Initialize the inbox refresh queue.
 * Returns undefined if Redis is not configured (local dev fallback).
 */
export function initializeQueues(): Bull.Queue<InboxRefreshJobData> | undefined {
  if (!redis) {
    if (backgroundJobsRequired()) {
      throw new Error("REDIS_URL must be configured when BACKGROUND_JOBS_ENABLED=true in production");
    }
    console.log("[queue] Redis not configured, queues disabled (sync fallback will be used)");
    return undefined;
  }

  try {
    inboxRefreshQueue = new Bull<InboxRefreshJobData>("inbox_refresh", {
      redis: {
        host: new URL(process.env.REDIS_URL || "redis://localhost:6379").hostname,
        port: Number.parseInt(new URL(process.env.REDIS_URL || "redis://localhost:6379").port || "6379"),
      },
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 2000,
        },
        removeOnComplete: {
          age: 3600, // Keep completed jobs for 1 hour
        },
      },
    });

    publishDraftQueue = new Bull<PublishDraftJobData>("publish_draft", {
      redis: {
        host: new URL(process.env.REDIS_URL || "redis://localhost:6379").hostname,
        port: Number.parseInt(new URL(process.env.REDIS_URL || "redis://localhost:6379").port || "6379"),
      },
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 2000,
        },
        removeOnComplete: {
          age: 3600, // Keep completed jobs for 1 hour
        },
      },
    });

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
    console.log("[queue] Queue disabled, returning null (caller should fall back to sync)");
    return null;
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
    const job = await queue.add(jobData, {
      priority: priorityMap[config.priority || "normal"],
      jobId: `${config.tenantId}:${Date.now()}`,
    });

    console.log(`[queue] Enqueued inbox_refresh job ${job.id} for tenant ${config.tenantId}`);
    return String(job.id);
  } catch (error) {
    console.error("[queue] Failed to enqueue job:", error);
    return null;
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
    console.log("[queue] Publish queue disabled, returning null (caller should fall back to sync)");
    return null;
  }

  try {
    const jobId = `${config.tenantId}:${config.draftId}:${config.draftScheduleTargetId ?? config.draftScheduleId}:${config.attemptNumber ?? 1}`;
    const job = await queue.add(config, {
      priority: 5, // Normal priority for publications
      jobId,
    });

    console.log(`[queue] Enqueued publish_draft job ${job.id} for draft ${config.draftId}`);
    return String(job.id);
  } catch (error) {
    console.error("[queue] Failed to enqueue publish job:", error);
    return null;
  }
}

/**
 * Cleanup function for graceful shutdown.
 */
export async function closeQueues(): Promise<void> {
  if (inboxRefreshQueue) {
    await inboxRefreshQueue.close();
    console.log("[queue] Inbox refresh queue closed");
  }
  if (publishDraftQueue) {
    await publishDraftQueue.close();
    console.log("[queue] Publish draft queue closed");
  }
}
