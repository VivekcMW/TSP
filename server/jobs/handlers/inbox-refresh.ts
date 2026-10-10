import type Bull from "bull";
import { engineRegistry } from "../../services/engines";
import { normalizeIndustryToSlug } from "../../services/metaEngine";
import { storage, type TenantScope } from "../../storage";
import type { InboxRefreshJobData, InboxRefreshJobProgress } from "../queue";
import { createHash } from "node:crypto";
import { inboxRefreshMessage } from "@shared/inbox-refresh";

/**
 * Job handler for inbox refresh.
 * Processes articles, scores them, and creates inbox items.
 * Emits progress updates to the job queue.
 */
export async function handleInboxRefresh(job: Bull.Job<InboxRefreshJobData>): Promise<InboxRefreshJobProgress> {
  const { tenantId, userId, autoRefresh = false } = job.data;

  if (!tenantId || !userId) {
    throw new Error("Job requires userId");
  }

  const scope: TenantScope = { tenantId, userId };
  const operationId = job.data.operationId ?? `job:${createHash("sha256").update(String(job.id)).digest("hex")}`;

  const jobId = job.id;
  console.log(`[job:inbox_refresh] ${jobId} started for tenant ${tenantId}, user ${userId}`);

  const progress: InboxRefreshJobProgress = {
    articlesProcessed: 0,
    articlesMatched: 0,
    articlesCreated: 0,
  };

  try {
    const receipt = await storage.getInboxRefreshReceipt(scope, operationId, autoRefresh);
    if (receipt) {
      Object.assign(progress, receipt);
      await job.progress(receipt);
      return receipt;
    }
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

    // Process articles via engine
    const startTime = Date.now();
    const result = await engine.processForUser(scope, profile, { operationId, autoRefresh });
    const durationMs = Date.now() - startTime;

    Object.assign(progress, result);

    // Log engine run
    await storage.createEngineRunLog(scope, {
      industry,
      status: result.success ? "success" : "failed",
      articlesProcessed: result.articlesProcessed,
      articlesMatched: result.articlesMatched,
      errorMessage: result.errors?.join("; ") || null,
      durationMs,
      completedAt: new Date(),
    }).catch(() => { console.warn("Inbox refresh log unavailable"); });

    if (!result.success) {
      throw new Error(inboxRefreshMessage("failure"));
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
  } catch {
    const errorMessage = progress.success
      ? "Refresh committed, but its status could not be reported. Please check again."
      : inboxRefreshMessage("failure");
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
    }).catch(() => { console.warn("Inbox refresh failure log unavailable"); });

    throw new Error(errorMessage);
  }
}

