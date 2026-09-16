import type Bull from "bull";
import { storage, type TenantScope } from "../../storage";
import { publishToPlatform } from "../../services/publishers";
import { assessProviderConnection } from "../../services/publishers/providerLifecycle";
import { emailTemplates, sendAppEmail } from "../../services/email";

export interface PublishDraftJobConfig {
  tenantId: string;
  userId: string;
  draftId: string;
  draftScheduleId: string;
  draftScheduleTargetId?: string;
  publishAt: Date | string;
}

export interface PublishDraftJobData extends PublishDraftJobConfig {
  platform: string;
  attemptNumber: number;
}

export interface PublishDraftJobProgress {
  platform: string;
  status: "publishing" | "published" | "failed" | "skipped" | "unknown";
  postId?: string;
  error?: string;
}

class PublishValidationError extends Error {}

/**
 * The DB claim fences concurrent/stale deliveries, not the external provider.
 * A crash after sending leaves the target publishing (reconciliation required).
 * Never automatically replay an ambiguous external side effect.
 */
export async function handlePublishDraft(job: Bull.Job<PublishDraftJobData>): Promise<PublishDraftJobProgress> {
  const { tenantId, userId, draftId, draftScheduleId, draftScheduleTargetId, platform } = job.data;
  if (!tenantId || !userId) throw new Error("Job missing tenant/user scope");
  const scope: TenantScope = { tenantId, userId };
  const attempt = (job.attemptsMade ?? 0) + 1;
  const maxAttempts = job.opts?.attempts ?? 3;
  const draft = await storage.claimPublishTarget(scope, job.data);
  if (!draft || !draftScheduleTargetId) return { platform, status: "skipped" };

  let sent = false;
  let postId: string | undefined;
  const finish = async (status: "published" | "failed" | "scheduled" | "unknown", error?: string) => {
    const saved = await storage.finishPublishTarget(scope, draftScheduleTargetId, status, {
      draftId, draftScheduleId, platform,
      status: status === "scheduled" ? "retrying" : status,
      publishedPostId: postId ?? null, errorMessage: error ?? null,
      attempt, maxAttempts,
    });
    if (!saved) throw new Error("Publication claim no longer current");
  };

  try {
    const rule = await storage.getPublishingRule(scope, platform);
    if (draft.platformPublishRules?.[platform] === false || rule?.enabled === false) {
      throw new PublishValidationError("Publication disabled by draft preference or publishing rule");
    }
    if ((rule?.minCharacters != null && draft.content.length < rule.minCharacters) || (rule?.maxCharacters != null && draft.content.length > rule.maxCharacters)) {
      throw new PublishValidationError(`Draft does not meet the ${platform} publishing character rule`);
    }
    const connection = await storage.getSocialAccountByProvider(scope, platform);
    const assessment = assessProviderConnection(platform, connection ?? null);
    if (!assessment.canPublish) throw new PublishValidationError(assessment.reason || "Provider is not ready for publishing");

    await storage.createPublishLog(scope, { draftId, draftScheduleId, platform, status: "pending", publishedPostId: null, errorMessage: null, attempt, maxAttempts });
    sent = true;
    const result = await publishToPlatform(scope, draftId, draft.content, platform, draft.media ?? []);
    if (!result.success || !result.postId) {
      // Existing adapters conflate rejection and transport errors. In live mode
      // do not pretend we can distinguish "not sent" from "response lost".
      if (process.env.PUBLISHING_MODE !== "live") sent = false;
      throw new PublishValidationError(result.error || "Provider returned no publication ID");
    }
    postId = result.postId;
    await finish("published");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Publication failed";
    if (sent) {
      const reason = `Delivery outcome requires provider reconciliation; automatic retry blocked. ${message}`;
      // Retain a known post ID if the database recovers after a commit failure.
      try { await finish("unknown", reason); } catch { /* keep publishing: still blocks replay */ }
      job.discard?.();
      throw new Error(reason);
    }
    const retry = !(error instanceof PublishValidationError) && attempt < maxAttempts;
    await finish(retry ? "scheduled" : "failed", message);
    if (!retry) job.discard?.();
    throw error;
  }

  const progress: PublishDraftJobProgress = { platform, status: "published", postId };
  // Auxiliary failures must never downgrade a committed publication or resend it.
  try { await job.progress(progress); } catch (error) { console.error("[publish] Progress reporting failed:", error); }
  try {
    const user = await storage.getUser(userId);
    if (user?.email) await sendAppEmail({ type: "post_published", recipient: user.email, recipientName: user.name, userId, ...emailTemplates.postPublished(platform), dedupeKey: `post-published:${draftScheduleTargetId}` });
  } catch (error) { console.error("[publish] Notification failed:", error); }
  return progress;
}
