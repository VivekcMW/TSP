import type Bull from "bull";
import { storage, type TenantScope } from "../../storage";
import { publishToPlatform } from "../../services/publishers";
import { assessProviderConnection, buildPublishSafetyKey } from "../../services/publishers/providerLifecycle";
import { emailTemplates, sendAppEmail } from "../../services/email";

/**
 * Job configuration for publishing a draft to social platforms.
 */
export interface PublishDraftJobConfig {
  tenantId: string;
  userId: string;
  draftId: string;
  draftScheduleId: string;
  draftScheduleTargetId?: string;
  publishAt: Date;
}

/**
 * Job data structure persisted in queue.
 */
export interface PublishDraftJobData extends PublishDraftJobConfig {
  platform: string;
  attemptNumber: number;
}

/**
 * Job progress for publishing.
 */
export interface PublishDraftJobProgress {
  platform: string;
  status: "publishing" | "published" | "failed";
  postId?: string;
  error?: string;
}

const MAX_RETRIES = 3;

/**
 * Publishes a draft to a social media platform.
 * Handles retries with exponential backoff and audit logging.
 */
export async function handlePublishDraft(job: Bull.Job<PublishDraftJobData>): Promise<PublishDraftJobProgress> {
  const { tenantId, userId, draftId, draftScheduleId, draftScheduleTargetId, platform, attemptNumber = 1 } = job.data;

  const scope: TenantScope = { tenantId, userId };

  const jobId = job.id;
  console.log(`[job:publish_draft] ${jobId} started for draft ${draftId} on ${platform} (attempt ${attemptNumber}/${MAX_RETRIES})`);

  const progress: PublishDraftJobProgress = {
    platform,
    status: "publishing",
  };

  try {
    // Validate job data
    if (!userId) {
      throw new Error("Job missing userId - cannot determine owner");
    }

    // Get draft
    const allDrafts = await storage.getDrafts(scope);
    const draft = allDrafts.find((d) => d.id === draftId);

    if (!draft) {
      throw new Error(`Draft ${draftId} not found`);
    }

    const rule = await storage.getPublishingRule(scope, platform);
    if (draft.platformPublishRules?.[platform] === false || rule?.enabled === false) {
      const reason = draft.platformPublishRules?.[platform] === false ? "Publication skipped by draft preference" : "Publication skipped by publishing rule";
      await storage.createPublishLog(scope, { draftId, platform, status: "failed", publishedPostId: null, errorMessage: reason, attempt: attemptNumber, maxAttempts: MAX_RETRIES });
      await storage.updateDraftScheduleStatus(scope, draftScheduleId, "failed", reason);
      return { platform, status: "failed", error: reason };
    }
    if ((rule?.minCharacters != null && draft.content.length < rule.minCharacters) || (rule?.maxCharacters != null && draft.content.length > rule.maxCharacters)) {
      throw new Error(`Draft does not meet the ${platform} publishing character rule`);
    }

    const target = draftScheduleTargetId && !draftScheduleTargetId.includes(":legacy")
      ? (await storage.getDraftScheduleTargets(scope, draftScheduleId)).find((item) => item.id === draftScheduleTargetId)
      : undefined;

    // A multi-platform draft can be marked published after its first target succeeds;
    // skip only the target that is already complete, not every later target.
    if ((target && target.status === "published") || (!draftScheduleTargetId && draft.publishStatus === "published")) {
      console.log(`[job:publish_draft] Draft ${draftId} already published, skipping`);
      return {
        platform,
        status: "published",
      };
    }

    if (draftScheduleTargetId && !draftScheduleTargetId.includes(":legacy")) await storage.updateDraftScheduleTargetStatus(scope, draftScheduleTargetId, "publishing");
    await storage.updateDraftScheduleStatus(scope, draftScheduleId, "publishing");

    const providerConnection = await storage.getSocialAccountByProvider(scope, platform);
    const assessment = assessProviderConnection(platform, providerConnection ?? null);

    if (!assessment.canPublish) {
      const errorMessage = assessment.reason || `${platform} provider is not ready for publishing`;
      await storage.createPublishLog(scope, {
        draftId,
        platform,
        status: "failed",
        publishedPostId: null,
        errorMessage,
        attempt: attemptNumber,
        maxAttempts: MAX_RETRIES,
      });
      if (draftScheduleTargetId && !draftScheduleTargetId.includes(":legacy")) await storage.updateDraftScheduleTargetStatus(scope, draftScheduleTargetId, "published");
      await storage.updateDraftScheduleStatus(scope, draftScheduleId, "failed", errorMessage);
      throw new Error(errorMessage);
    }

    const safetyKey = buildPublishSafetyKey(draftId, platform, tenantId);
    console.log(`[job:publish_draft] Publish safety key: ${safetyKey}`);

    // Create publish log entry
    await storage.createPublishLog(scope, {
      draftId,
      platform,
      status: "pending",
      publishedPostId: null,
      errorMessage: null,
      attempt: attemptNumber,
      maxAttempts: MAX_RETRIES,
    });

    // Update progress
    job.progress({ ...progress, status: "publishing" });

    // Publish to platform
    console.log(`[job:publish_draft] Calling publishToPlatform for ${platform}...`);
    const publishResult = await publishToPlatform(scope, draftId, draft.content, platform, draft.media ?? []);

    if (publishResult.success && publishResult.postId) {
      // Success: mark draft as published
      console.log(`[job:publish_draft] Successfully published to ${platform}: ${publishResult.postId}`);

      // Mark draft as published
      await storage.markDraftAsPublished(scope, draftId);

      // Update publish log with success
      await storage.createPublishLog(scope, {
        draftId,
        platform,
        status: "published",
        publishedPostId: publishResult.postId,
        errorMessage: null,
        attempt: attemptNumber,
        maxAttempts: MAX_RETRIES,
      });

      progress.status = "published";
      progress.postId = publishResult.postId;
      job.progress(progress);

      const publishedUser = await storage.getUser(userId);
      if (publishedUser?.email) sendAppEmail({ type: "post_published", recipient: publishedUser.email, recipientName: publishedUser.name, userId, ...emailTemplates.postPublished(platform), dedupeKey: `post-published:${draftId}:${platform}` }).catch((error) => console.error("Failed to send publish email:", error));

      return progress;
    } else {
      // Failure: log error and decide if we should retry
      const errorMessage = publishResult.error || "Unknown error";
      console.error(`[job:publish_draft] Failed to publish to ${platform}: ${errorMessage}`);

      // Update publish log with failure
      await storage.createPublishLog(scope, {
        draftId,
        platform,
        status: "failed",
        publishedPostId: null,
        errorMessage,
        attempt: attemptNumber,
        maxAttempts: MAX_RETRIES,
      });

      // Update draft schedule status if this was the last attempt
      if (attemptNumber >= MAX_RETRIES) {
        if (draftScheduleTargetId && !draftScheduleTargetId.includes(":legacy")) await storage.updateDraftScheduleTargetStatus(scope, draftScheduleTargetId, "failed", errorMessage);
        await storage.updateDraftScheduleStatus(scope, draftScheduleId, "failed", errorMessage);
        console.log(`[job:publish_draft] Max retries reached for draft ${draftId}, marking schedule as failed`);
        const failedUser = await storage.getUser(userId);
        if (failedUser?.email) sendAppEmail({ type: "post_failed", recipient: failedUser.email, recipientName: failedUser.name, userId, ...emailTemplates.postFailed(platform, errorMessage), dedupeKey: `post-failed:${draftId}:${platform}` }).catch((emailError) => console.error("Failed to send publishing failure email:", emailError));
      }

      progress.status = "failed";
      progress.error = errorMessage;
      job.progress(progress);

      // Throw error to trigger queue retry mechanism
      throw new Error(`Failed to publish to ${platform}: ${errorMessage}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[job:publish_draft] Job failed for draft ${draftId}:`, message);

    try {
      if (draftScheduleTargetId && !draftScheduleTargetId.includes(":legacy")) await storage.updateDraftScheduleTargetStatus(scope, draftScheduleTargetId, "failed", message);
      await storage.updateDraftScheduleStatus(scope, draftScheduleId, "failed", message);
    } catch {
      // Ignore schedule update failures to avoid masking the true job error.
    }

    progress.status = "failed";
    progress.error = message;
    job.progress(progress);

    throw error; // Re-throw to trigger queue retry
  }
}
