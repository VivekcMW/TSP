import type Bull from "bull";
import { closeQueues, getInboxRefreshQueue, getPublishDraftQueue } from "./queue";
import { handleInboxRefresh } from "./handlers/inbox-refresh";
import { handlePublishDraft } from "./handlers/publish-draft";
import type { InboxRefreshJobData, InboxRefreshJobProgress } from "./queue";
import type { PublishDraftJobData, PublishDraftJobProgress } from "./handlers/publish-draft";

/**
 * Register all job handlers.
 * Called on app startup to set up queue event listeners and processors.
 */
export async function registerJobHandlers(): Promise<void> {
  const inboxQueue = getInboxRefreshQueue();
  const publishQueue = getPublishDraftQueue();

  if (!inboxQueue && !publishQueue) {
    console.log("[jobs] Queue not initialized, job handlers not registered");
    return;
  }

  // Register inbox refresh queue
  if (inboxQueue) {
    inboxQueue.process(1, async (job: Bull.Job<InboxRefreshJobData>) => {
      return handleInboxRefresh(job);
    });

    inboxQueue.on("active", (job) => {
      console.log(`[jobs] Job ${job.id} is now active (attempt ${job.attemptsMade + 1}/${job.opts.attempts})`);
    });

    inboxQueue.on("progress", (job, progress: InboxRefreshJobProgress) => {
      console.log(
        `[jobs] Job ${job.id} progress: ${progress.articlesProcessed} processed, ${progress.articlesMatched} matched, ${progress.articlesCreated} created`
      );
    });

    inboxQueue.on("completed", (job, result: InboxRefreshJobProgress) => {
      console.log(`[jobs] Job ${job.id} completed: ${result.articlesCreated} articles created`);
    });

    inboxQueue.on("failed", () => {
      console.error("[jobs] Inbox refresh attempt failed");
    });

    inboxQueue.on("error", () => {
      console.error("[jobs] Inbox queue unavailable");
    });
  }

  // Register publish draft queue
  if (publishQueue) {
    publishQueue.process(2, async (job: Bull.Job<PublishDraftJobData>) => {
      return handlePublishDraft(job);
    });

    publishQueue.on("active", (job) => {
      console.log(
        `[jobs:publish] Job ${job.id} is now active - ${job.data.platform} (attempt ${job.attemptsMade + 1}/${job.opts.attempts})`
      );
    });

    publishQueue.on("progress", (job, progress: PublishDraftJobProgress) => {
      console.log(`[jobs:publish] Job ${job.id} progress: ${progress.status} on ${progress.platform}`);
    });

    publishQueue.on("completed", (job, result: PublishDraftJobProgress) => {
      console.log(`[jobs:publish] Job ${job.id} completed: ${result.platform} - ${result.postId}`);
    });

    publishQueue.on("failed", () => {
      console.error("[jobs:publish] Publish attempt failed");
    });

    publishQueue.on("error", () => {
      console.error("[jobs:publish] Publish queue unavailable");
    });
  }

  console.log("[jobs] Job handlers registered successfully");
}

/**
 * Cleanup function for graceful shutdown.
 */
export async function closeJobHandlers(): Promise<void> {
  await closeQueues();
  console.log("[jobs] Job queues closed");
}
