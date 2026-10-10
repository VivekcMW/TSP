import type Bull from "bull";
import { storage, ScheduleConflictError, type TenantScope } from "../../storage";
import { publishToPlatform } from "../../services/publishers";
import { PublishingPolicyError } from "../../services/publishing-policy";
import type { PublishingMode } from "@shared/publishing-capabilities";
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
  status: "publishing" | "published" | "simulated" | "accepted_unverified" | "failed" | "skipped" | "unknown";
  postId?: string;
  error?: string;
}

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
  const claim = draft.publishClaim;
  let sent = false;
  let postId: string | undefined;
  let receiptKind: "provider_id" | "unavailable" | "none" = "none";
  let outcome: "published" | "simulated" | "accepted_unverified";
  const finish = async (status: "published" | "simulated" | "accepted_unverified" | "failed" | "scheduled" | "unknown", error?: string) => {
    const saved = await storage.finishPublishTarget(scope, draftScheduleTargetId, status, {
      draftId, draftScheduleId, platform, targetId: draftScheduleTargetId, claimToken: claim.token,
      executionMode: claim.mode, receiptKind,
      status: status === "scheduled" ? "retrying" : status,
      publishedPostId: postId ?? null, errorMessage: error ?? null,
      attempt, maxAttempts,
    });
    if (!saved) throw new ScheduleConflictError("Publication claim no longer current");
  };

  try {
    await storage.createPublishLog(scope, { draftId, draftScheduleId, targetId: draftScheduleTargetId, claimToken: claim.token, executionMode: claim.mode, platform, status: "pending", attempt, maxAttempts });
    await storage.authorizePublishClaim(scope, draftId, draftScheduleTargetId, claim.token);
    sent = claim.mode === "live";
    const result = await publishToPlatform(scope, draftId, draft.content, platform, draft.media ?? [], claim.mode as PublishingMode);
    if (!result.success || result.mode !== claim.mode) throw new Error("Delivery not confirmed");
    if (claim.mode !== "live" && result.status === "simulated" && !result.postId) outcome = "simulated";
    else if (claim.mode === "live" && result.status === "accepted_unverified" && result.receiptKind === "unavailable") {
      outcome = "accepted_unverified"; receiptKind = "unavailable";
    } else if (claim.mode === "live" && result.status === "published" && result.receiptKind === "provider_id" && result.postId) {
      outcome = "published"; postId = result.postId; receiptKind = "provider_id";
    } else throw new Error("Provider receipt unavailable");
    await finish(outcome);
  } catch (error) {
    if (sent) {
      const reason = "Delivery outcome requires provider reconciliation; automatic retry blocked.";
      // Retain a known post ID if the database recovers after a commit failure.
      try { await finish("unknown", reason); } catch { /* keep publishing: still blocks replay */ }
      job.discard?.();
      throw new Error(reason);
    }
    const permanent = error instanceof ScheduleConflictError || error instanceof PublishingPolicyError;
    const retry = !permanent && attempt < maxAttempts;
    const message = error instanceof PublishingPolicyError ? error.message : "Publication could not be authorized or recorded. Check current status.";
    await finish(retry ? "scheduled" : "failed", message);
    if (!retry) {
      job.discard?.();
      // The failure is recorded; the email is best-effort and sent once per target.
      try {
        const user = await storage.getUser(userId);
        if (user?.email) await sendAppEmail({ type: "post_failed", recipient: user.email, recipientName: user.name, userId, ...emailTemplates.postFailed(platform, message), dedupeKey: `post-failed:${draftScheduleTargetId}` });
      } catch { console.error("[publish] Failure notification failed"); }
    }
    throw new Error(message);
  }

  const progress: PublishDraftJobProgress = { platform, status: outcome, ...(postId ? { postId } : {}) };
  // Auxiliary failures must never downgrade a committed publication or resend it.
  try { await job.progress(progress); } catch { console.error("[publish] Progress reporting failed"); }
  if (outcome !== "published") return progress;
  try {
    const user = await storage.getUser(userId);
    if (user?.email) await sendAppEmail({ type: "post_published", recipient: user.email, recipientName: user.name, userId, ...emailTemplates.postPublished(platform), dedupeKey: `post-published:${draftScheduleTargetId}` });
  } catch { console.error("[publish] Notification failed"); }
  return progress;
}
