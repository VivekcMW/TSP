import type Bull from "bull";
import { engineRegistry } from "../../services/engines";
import { normalizeIndustryToSlug } from "../../services/metaEngine";
import { storage, type TenantScope } from "../../storage";
import type { InboxRefreshJobData, InboxRefreshJobProgress } from "../queue";

/**
 * Job handler for inbox refresh.
 * Processes articles, scores them, and creates inbox items.
 * Emits progress updates to the job queue.
 */
export async function handleInboxRefresh(job: Bull.Job<InboxRefreshJobData>): Promise<InboxRefreshJobProgress> {
  const { tenantId, userId, autoRefresh = false } = job.data;

  if (!userId) {
    throw new Error("Job requires userId");
  }

  const scope: TenantScope = { tenantId, userId };

  const jobId = job.id;
  console.log(`[job:inbox_refresh] ${jobId} started for tenant ${tenantId}, user ${userId}`);

  const progress: InboxRefreshJobProgress = {
    articlesProcessed: 0,
    articlesMatched: 0,
    articlesCreated: 0,
  };

  try {
    // Get user profile and validate
    const profile = await storage.getUserProfile(scope);
    if (!profile) {
      throw new Error("Profile not found. Please complete onboarding first.");
    }

    // Get industry (a soft display/voice signal only - Discover itself is
    // driven entirely by the user's own sources/keywords, not by industry)
    const dbUser = await storage.getUser(userId);
    const industry = normalizeIndustryToSlug(dbUser?.industry);
    const engine = engineRegistry.getEngine(industry);

    console.log(`[job:inbox_refresh] ${jobId} using ${engine.config.displayName} engine`);

    // Check existing active items
    const existingItems = await storage.getInboxItems(scope);
    const activeItems = existingItems.filter((item: any) => item.status === "active");
    const activeCount = activeItems.length;

    // Dismiss active items if at limit and autoRefresh is enabled
    if (activeCount >= 10) {
      if (!autoRefresh) {
        console.log(
          `[job:inbox_refresh] ${jobId} user has ${activeCount} active items, skipping refresh (not auto-refresh)`
        );
        return progress;
      }

      console.log(
        `[job:inbox_refresh] ${jobId} dismissing ${activeCount} stale articles to make room for fresh ones`
      );
      for (const item of activeItems) {
        await storage.updateInboxItem(scope, item.id, { status: "dismissed" });
      }
    }

    // Process articles via engine
    const startTime = Date.now();
    const result = await engine.processForUser(scope, profile);
    const durationMs = Date.now() - startTime;

    progress.articlesProcessed = result.articlesProcessed;
    progress.articlesMatched = result.articlesMatched;
    progress.articlesCreated = result.newInboxItems;
    progress.needsSetup = result.needsSetup;

    // Log engine run
    await storage.createEngineRunLog(scope, {
      industry,
      status: result.success ? "success" : "failed",
      articlesProcessed: result.articlesProcessed,
      articlesMatched: result.articlesMatched,
      errorMessage: result.errors?.join("; ") || null,
      durationMs,
      completedAt: new Date(),
    });

    if (!result.success) {
      console.warn(`[job:inbox_refresh] ${jobId} engine processing failed:`, result.errors);
    } else if (result.needsSetup) {
      console.log(`[job:inbox_refresh] ${jobId} user has no keywords/sources configured yet - nothing to fetch`);
    } else {
      console.log(`[job:inbox_refresh] ${jobId} engine created ${result.newInboxItems} articles`);
    }

    // Final progress update
    await job.progress(progress);

    console.log(
      `[job:inbox_refresh] ${jobId} completed in ${durationMs}ms: ${progress.articlesProcessed} processed, ${progress.articlesMatched} matched, ${progress.articlesCreated} created`
    );

    return progress;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[job:inbox_refresh] ${jobId} failed:`, errorMessage);

    // Log the failure
    await storage.createEngineRunLog(scope, {
      industry: "unknown",
      status: "failed",
      articlesProcessed: progress.articlesProcessed,
      articlesMatched: progress.articlesMatched,
      errorMessage,
      durationMs: Date.now() - job.data.startedAt,
      completedAt: new Date(),
    });

    throw error;
  }
}

