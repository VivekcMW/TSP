import type { Express, Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { instantReviewRateLimit } from "../middlewares/rateLimit";
import { authedOf, requireDbUser } from "../middlewares/requireDbUser";
import { requirePermission } from "../middlewares/requirePermission";
import { generateInstantReviewDetailed } from "../services/punditBrain";
import { prepareEditorialRequest, executeEditorialRequest } from "../services/editorial-request";
import { fetchArticleFromUrl } from "../services/urlFetcher";
import { storage, ScheduleConflictError, type TenantScope } from "../storage";
import { getAIErrorResponse } from "../services/openRouter";
import { platformIntegrations } from "@shared/schema";
import { PUBLISHING_PLATFORM_KEYS as ALL_PLATFORM_KEYS, type PublishingMode } from "@shared/publishing-capabilities";
import { PublishingPolicyError } from "../services/publishing-policy";
import { reconciliationSchema } from "@shared/publishing-reconciliation";
import { enqueuePublishDraft, QueueUnavailableError } from "../jobs/queue";
import { handlePublishDraft, type PublishDraftJobData } from "../jobs/handlers/publish-draft";
import { z } from "zod";
import { CrawlError, sourceFailureBody } from "../services/crawlerFetch";
import { editorialCancellation, editorialContext, editorialPreferences, reviewUrl, validateEditorialFormat } from "./editorial-context";
import { generationAccessFailure } from "../services/generation-quota";
import { runHttpGeneration } from "./generation-operation";
import { DraftConflictError, draftPreconditionSchema } from "@shared/draft-revision";
import { PublishingConsentError, publishingConsentSchema } from "@shared/publishing-consent";
import { findSelfRepetitionMatches } from "@shared/selfRepetition";

const createDraftSchema = z.object({
  inboxItemId: z.string().optional(),
  platform: z.enum(ALL_PLATFORM_KEYS),
  tone: z.enum(["professional", "authoritative", "contrarian", "ai-recommended"]),
  content: z.string().trim().min(1).max(5000),
  media: z.array(z.object({ id: z.string().uuid(), type: z.enum(["image", "video", "audio"]), name: z.string().max(255), url: z.string().max(2_000) })).max(8).default([]),
});

const updateDraftSchema = z.object({
  content: z.string().trim().min(1).max(5000).optional(),
  status: z.literal("draft").optional(),
  ...draftPreconditionSchema.partial().shape,
}).refine(data => data.content === undefined
  ? data.expectedContent === undefined && data.expectedUpdatedAt === undefined
  : data.expectedContent !== undefined && data.expectedUpdatedAt !== undefined,
{ message: "Content edits require the exact baseline content and revision (including null)." });

const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const repetitionCheckSchema = z.object({
  content: z.string().trim().min(1).max(5000),
  excludeId: z.string().uuid().optional(),
});

const publishingRuleSchema = z.object({
  enabled: z.boolean().optional(),
  minCharacters: z.number().int().min(0).max(5000).nullable().optional(),
  maxCharacters: z.number().int().min(1).max(5000).nullable().optional(),
  autoOptimizeTone: z.boolean().optional(),
  preferScheduling: z.boolean().optional(),
}).refine((rule) => rule.minCharacters == null || rule.maxCharacters == null || rule.minCharacters <= rule.maxCharacters, { message: "Minimum characters cannot exceed maximum characters" });

const scheduleDraftSchema = z.object({
  publishAt: z.string().datetime(),
  platforms: z.array(z.enum(ALL_PLATFORM_KEYS)).min(1).max(4).refine(items => new Set(items).size === items.length).optional(),
  consent: publishingConsentSchema,
});

const bulkScheduleSchema = z.object({
  draftIds: z.array(z.string()).min(1).max(50).refine(ids => new Set(ids).size === ids.length),
  publishAt: z.string().datetime().optional(),
  schedule: z.record(z.string(), z.string().datetime()).optional(),
  // Validate per item so one stale/missing consent cannot discard sibling outcomes.
  consents: z.record(z.string(), z.unknown()),
}).refine(
  (data) => data.publishAt || data.schedule,
  { message: "Either publishAt or schedule must be provided" }
);

function generationError(res: Response, error: unknown) {
  const access = generationAccessFailure(error);
  if (access) {
    if (access.retryAfterSeconds) res.setHeader("Retry-After", String(access.retryAfterSeconds));
    return res.status(access.status).json(access.body);
  }
  if (error instanceof Error && "status" in error && error.status === 403) return res.status(403).json({ message: "An attached media item is not available to this account" });
  if (error instanceof CrawlError) return res.status(422).json(sourceFailureBody(error));
  const failure = getAIErrorResponse(error);
  if (failure.retryAfterSeconds !== undefined) res.setHeader("Retry-After", String(failure.retryAfterSeconds));
  return res.status(failure.status).json(failure.body);
}

function schedulingError(res: Response, error: unknown, fallback: string) {
  if (error instanceof PublishingConsentError) return res.status(409).json({ code: error.code, message: error.message });
  if (error instanceof PublishingPolicyError) return res.status(error.statusCode).json({ code: error.code, message: error.message });
  if (error instanceof ScheduleConflictError) return res.status(409).json({ message: error.message });
  if (error instanceof QueueUnavailableError) {
    res.setHeader("Retry-After", "5");
    return res.status(503).json({ message: error.message });
  }
  return res.status(500).json({ message: fallback });
}

async function dispatchScheduledTargets(scope: TenantScope, draftId: string, targetIds?: string[], admittedSchedule?: Awaited<ReturnType<typeof storage.getDraftSchedule>>) {
  const schedule = admittedSchedule ?? await storage.getDraftSchedule(scope, draftId);
  if (!schedule) throw new ScheduleConflictError("Schedule no longer exists");
  const targets = (await storage.getDraftScheduleTargetsForPublishing(scope, schedule.id))
    .filter((target) => !targetIds || targetIds.includes(target.id));
  const jobIds: string[] = [];
  const results: Array<{ platform: string; status: string }> = [];
  for (const target of targets) {
    if (!["sandbox", "dry-run", "live"].includes(target.executionMode ?? "")) throw new ScheduleConflictError("Legacy attempt requires explicit readmission");
    await storage.checkDraftPublishingPolicy(scope, draftId, [target.platform], target.intent === "publish" ? "publish" : "schedule", target.executionMode as PublishingMode);
    const data: PublishDraftJobData = { ...scope, draftId, draftScheduleId: schedule.id,
      draftScheduleTargetId: target.id, platform: target.platform, publishAt: schedule.scheduledPublishAt, attemptNumber: 1 };
    const jobId = await enqueuePublishDraft(data);
    if (jobId) jobIds.push(jobId);
    else {
      // Null is exclusively a deliberately disabled local queue, never an outage.
      results.push(await handlePublishDraft({ id: `sync:${target.id}`, data, attemptsMade: 0,
        opts: { attempts: 1 }, progress: async () => undefined, discard: () => undefined } as unknown as Parameters<typeof handlePublishDraft>[0]));
    }
  }
  return { jobId: jobIds[0] ?? null, jobIds, results, status: jobIds.length ? "queued" : results.length ? "completed" : schedule.status };
}

export function registerDraftsRoutes(app: Express) {
  app.get("/api/drafts", requireDbUser, requirePermission("draft:read:own"), async (req, res) => {
    try {
      const { dbUser, tenant: scope } = authedOf(req);
      const userId = dbUser.id;
      const { limit, offset } = paginationQuerySchema.parse(req.query);
      const userDrafts = await storage.getDrafts(scope, { limit, offset });
      res.json(userDrafts);
    } catch (error) {
      console.error("Error fetching drafts");
      res.status(500).json({ message: "Failed to fetch drafts" });
    }
  });

  app.get("/api/drafts/published", requireDbUser, requirePermission("draft:read:own"), async (req, res) => {
    try {
      const { tenant: scope } = authedOf(req);
      const published = (await storage.getDrafts(scope, { limit: 200 }))
        .filter((draft) => draft.publishStatus === "published")
        .sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0));
      res.json(published);
    } catch (error) {
      console.error("Error fetching published drafts");
      res.status(500).json({ message: "Failed to fetch published drafts" });
    }
  });

  // Lexical-only, own history only: a "you've said this before" signal, not a
  // plagiarism/copyright check and not blocking — callers decide what to do.
  app.post("/api/drafts/repetition-check", requireDbUser, requirePermission("draft:read:own"), async (req, res) => {
    const validation = repetitionCheckSchema.safeParse(req.body);
    if (!validation.success) return res.status(400).json({ message: "Provide the draft content to check." });
    try {
      const { tenant: scope } = authedOf(req);
      const history = await storage.getDrafts(scope, { limit: 200 });
      const matches = findSelfRepetitionMatches(validation.data.content, history, validation.data.excludeId);
      res.json({ matches });
    } catch (error) {
      console.error("Error checking draft for self-repetition");
      res.status(500).json({ message: "Failed to check for repeated content" });
    }
  });

  app.get("/api/drafts/:id/publish-logs", requireDbUser, requirePermission("draft:read:own"), async (req, res) => {
    try {
      const { tenant: scope } = authedOf(req);
      if (!await storage.getDraft(scope, req.params.id)) return res.status(404).json({ message: "Draft not found" });
      res.json(await storage.getPublishLogs(scope, req.params.id));
    } catch (error) {
      console.error("Error fetching publish logs");
      res.status(500).json({ message: "Failed to fetch publish logs" });
    }
  });

  app.post("/api/drafts", requireDbUser, requirePermission("draft:write:own"), async (req, res) => {
    try {
      const { dbUser, tenant: scope } = authedOf(req);
      const userId = dbUser.id;
      
      const validation = createDraftSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ message: "Invalid request data", errors: validation.error.errors });
      }
      
      const { inboxItemId, platform, tone, content, media } = validation.data;
      for (const item of media) {
        if (!(await storage.getMediaAsset(scope, item.id))) return res.status(403).json({ message: "An attached media item is not available to this account" });
      }

      // A platform an admin has switched off platform-wide (Integration
      // Management) is rejected here even if the caller's own
      // enabledPlatforms preference still lists it — the global switch wins.
      const [integration] = await db
        .select({ enabled: platformIntegrations.enabled })
        .from(platformIntegrations)
        .where(eq(platformIntegrations.key, platform));
      if (integration && !integration.enabled) {
        return res.status(403).json({ message: "This platform is temporarily unavailable. Please try again later." });
      }

      const draft = await storage.createDraft(scope, {
        inboxItemId,
        platform,
        tone,
        content,
        media,
        status: "draft",
      });
      
      res.json(draft);
    } catch (error) {
      console.error("Error creating draft");
      res.status(500).json({ message: "Failed to create draft" });
    }
  });

  app.patch("/api/drafts/:id", requireDbUser, requirePermission("draft:write:own"), async (req, res) => {
    try {
      const { dbUser, tenant: scope } = authedOf(req);
      const userId = dbUser.id;
      const { id } = req.params;
      
      const validation = updateDraftSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ message: "Invalid request data" });
      }
      
      const { expectedContent, expectedUpdatedAt, ...data } = validation.data;
      const updated = await storage.updateDraft(scope, id, data, data.content === undefined ? undefined : {
        expectedContent: expectedContent!, expectedUpdatedAt: expectedUpdatedAt!,
      });
      
      if (!updated) {
        return res.status(404).json({ message: "Draft not found" });
      }
      
      res.json(updated);
    } catch (error) {
      if (error instanceof DraftConflictError) return res.status(409).json({ code: "draft_conflict", message: error.message });
      if (error instanceof ScheduleConflictError) return res.status(409).json({ code: "draft_immutable", message: error.message });
      console.error("Error updating draft");
      res.status(500).json({ message: "Failed to update draft" });
    }
  });

  // Suffix avoids collisions with /published, /scheduled and /scheduled-info.
  // Exact-ID read shares the list's receipt-aware projection, not its row cap.
  app.get("/api/drafts/:id/details", requireDbUser, requirePermission("draft:read:own"), async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const [draft] = await storage.getDrafts(authedOf(req).tenant, { id: req.params.id, limit: 1 });
      if (!draft) return res.status(404).json({ message: "Draft not found or no longer accessible" });
      res.json({ ...draft, publishApprovalHash: undefined, publishApprovedBy: undefined });
    } catch {
      res.status(503).json({ message: "Draft details could not be checked. Refresh before publishing." });
    }
  });

  // Do not infer deletion from the bounded listing or reuse an error cache.
  app.get("/api/drafts/:id/editing-snapshot", requireDbUser, requirePermission("draft:read:own"), async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const draft = await storage.getDraft(authedOf(req).tenant, req.params.id);
      if (!draft) return res.status(404).json({ message: "Draft not found or no longer accessible" });
      res.json({ id: draft.id, content: draft.content, updatedAt: draft.updatedAt,
        platform: draft.platform, tone: draft.tone });
    } catch {
      res.status(503).json({ message: "Latest draft could not be checked. Your local text is retained." });
    }
  });

  app.delete("/api/drafts/:id", requireDbUser, requirePermission("draft:write:own"), async (req, res) => {
    try {
      const { dbUser, tenant: scope } = authedOf(req);
      const userId = dbUser.id;
      const { id } = req.params;
      await storage.deleteDraft(scope, id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting draft");
      schedulingError(res, error, "Failed to delete draft");
    }
  });

  app.post("/api/instant-review", requireDbUser, requirePermission("generation:create:own"), instantReviewRateLimit, async (req, res) => {
    const cancellation = editorialCancellation(req, res);
    try {
      const scope = authedOf(req).tenant;
      const validation = z.object({ url: reviewUrl, ...editorialPreferences }).safeParse(req.body);
      if (!validation.success) return res.status(400).json({ code: "ai_invalid_input", message: "Supply a public HTTP(S) URL and valid generation preferences." });
      validateEditorialFormat(["linkedin", "twitter"], validation.data.format);
      const options = await editorialContext(req, validation.data, cancellation.signal);
      const { article, result } = await runHttpGeneration(req, res, "instant-review", validation.data, cancellation.signal, async () => {
        const article = await fetchArticleFromUrl(validation.data.url, cancellation.signal);
        return { article, result: await generateInstantReviewDetailed(article, options) };
      });
      
      const profile = await storage.getUserProfile(scope);
      if (profile) {
        const publications = profile.publications || [];
        if (!publications.includes(article.source) && !publications.includes(article.domain)) {
          const updatedPublications = [...publications, article.source].slice(0, 20);
          await storage.updateUserProfile(scope, { publications: updatedPublications });
          console.log(`Added ${article.source} to user publications`);
        }
      }
      
      res.json({
        article: {
          title: article.title,
          source: article.source,
          url: article.url,
          domain: article.domain,
          content: article.content,
          contentMetadata: article.contentMetadata,
        },
        ...result,
        format: validation.data.format,
      });
    } catch (error) {
      console.error("Instant review failed");
      generationError(res, error);
    } finally {
      cancellation.dispose();
    }
  });

  app.post("/api/instant-review/selected", requireDbUser, requirePermission("generation:create:own"), instantReviewRateLimit, async (req, res) => {
    const cancellation = editorialCancellation(req, res);
    try {
      const prepared = await prepareEditorialRequest(req, "selected", cancellation.signal);
      res.json(await runHttpGeneration(req, res, "selected", prepared.input, cancellation.signal,
        () => executeEditorialRequest(prepared, cancellation.signal)));
    } catch (error) {
      console.error("Selected instant review failed");
      generationError(res, error);
    } finally {
      cancellation.dispose();
    }
  });

  app.post("/api/instant-review/manual", requireDbUser, requirePermission("generation:create:own"), instantReviewRateLimit, async (req, res) => {
    const cancellation = editorialCancellation(req, res);
    try {
      const prepared = await prepareEditorialRequest(req, "manual", cancellation.signal);
      res.json(await runHttpGeneration(req, res, "manual", prepared.input, cancellation.signal,
        () => executeEditorialRequest(prepared, cancellation.signal)));
    } catch (error) {
      console.error("Manual review failed");
      generationError(res, error);
    } finally {
      cancellation.dispose();
    }
  });

  // Draft Scheduling Endpoints

  app.post("/api/drafts/:id/approve-publishing", requireDbUser, requirePermission("draft:write:own"), async (req, res) => {
    const parsed = z.object({ content: z.string().min(1).max(5000), updatedAt: z.string().datetime() }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Supply the exact reviewed draft and revision." });
    try {
      const draft = await storage.approveDraftForPublishing(authedOf(req).tenant, req.params.id, parsed.data.content, parsed.data.updatedAt);
      if (!draft) return res.status(404).json({ message: "Draft not found" });
      res.json(draft);
    } catch (error) { schedulingError(res, error, "Could not record review approval"); }
  });

  app.post("/api/drafts/:id/schedule/targets/:targetId/reconcile", requireDbUser, requirePermission("draft:write:own"), async (req, res) => {
    const parsed = reconciliationSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Supply an explicit decision, current revision and supporting evidence. Delivery claims require a receipt; replay clearance requires stopped workers." });
    try {
      const target = await storage.reconcilePublishTarget(authedOf(req).tenant, req.params.id, req.params.targetId, parsed.data);
      if (!target) return res.status(404).json({ message: "Schedule target not found" });
      res.json({ target, message: "Manual decision recorded. No provider verification or publishing was performed." });
    } catch (error) { schedulingError(res, error, "Reconciliation could not be recorded"); }
  });

  app.get("/api/drafts/:id/publish-status", requireDbUser, requirePermission("draft:read:own"), async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const result = await storage.getDraftPublishStatus(authedOf(req).tenant, req.params.id);
      if (!result) return res.status(404).json({ message: "Draft not found" });
      res.json(result);
    } catch (error) {
      console.error("Error fetching publication status");
      res.status(503).json({ message: "Delivery status could not be verified. Check status before retrying." });
    }
  });

  app.post("/api/drafts/:id/schedule", requireDbUser, requirePermission("draft:write:own"), async (req, res) => {
    try {
      const { dbUser, tenant: scope } = authedOf(req);
      const { id: draftId } = req.params;

      const validation = scheduleDraftSchema.safeParse(req.body);
      if (!validation.success) {
        if (!publishingConsentSchema.safeParse(req.body?.consent).success) throw new PublishingConsentError();
        return res.status(400).json({ message: "Invalid request data", errors: validation.error.errors });
      }

      const { publishAt, platforms, consent } = validation.data;
      const publishAtDate = new Date(publishAt);

      // Check draft exists
      const draft = await storage.getDraft(scope, draftId);
      if (!draft) {
        return res.status(404).json({ message: "Draft not found" });
      }

      // Schedule the draft
      const schedule = await storage.scheduleDraftPublish(scope, draftId, publishAtDate, platforms, "schedule", consent);
      const targets = await storage.getDraftScheduleTargets(scope, schedule.id);

      res.json({
        id: schedule.id,
        draftId: schedule.draftId,
        scheduledPublishAt: schedule.scheduledPublishAt,
        status: schedule.status,
        targets,
        message: "Draft scheduled successfully",
      });
    } catch (error) {
      console.error("Error scheduling draft");
      schedulingError(res, error, "Failed to schedule draft");
    }
  });

  app.post("/api/drafts/bulk-schedule", requireDbUser, requirePermission("draft:write:own"), async (req, res) => {
    try {
      const { dbUser, tenant: scope } = authedOf(req);

      const validation = bulkScheduleSchema.safeParse(req.body);
      if (!validation.success) {
        if (!req.body?.consents || typeof req.body.consents !== "object" || Array.isArray(req.body.consents)) throw new PublishingConsentError();
        return res.status(400).json({ message: "Invalid request data", errors: validation.error.errors });
      }

      const { draftIds, publishAt, schedule: individualSchedule, consents } = validation.data;

      const scheduled: string[] = [];
      const failed: string[] = [];
      const errors: Record<string, { code: string; message: string; status: number }> = Object.create(null);

      for (const draftId of draftIds) {
        try {
          const consent = publishingConsentSchema.safeParse(consents[draftId]);
          if (!consent.success) throw new PublishingConsentError();
          const publishTime = individualSchedule?.[draftId] || publishAt;
          if (!publishTime) {
            failed.push(draftId);
            errors[draftId] = { code: "schedule_time_required", message: "Choose a publication time for this draft.", status: 400 };
            continue;
          }

          const publishAtDate = new Date(publishTime);
          const draft = await storage.getDraft(scope, draftId);
          if (!draft) throw new ScheduleConflictError("Draft not found");
          // Bulk confirmation is one saved destination per draft. Never revive
          // an old cancelled cross-post's implicit destination set.
          await storage.scheduleDraftPublish(scope, draftId, publishAtDate, [draft.platform], "schedule", consent.data);
          scheduled.push(draftId);
        } catch (error) {
          console.error("Failed to schedule draft");
          failed.push(draftId);
          errors[draftId] = error instanceof PublishingConsentError || error instanceof PublishingPolicyError
            ? { code: error.code, message: error.message, status: error instanceof PublishingConsentError ? 409 : error.statusCode }
            : { code: "schedule_failed", message: "Could not schedule this draft. Review its current status before trying again.", status: error instanceof ScheduleConflictError ? 409 : 500 };
        }
      }

      res.json({
        scheduled,
        failed,
        errors,
        message: `${scheduled.length} drafts scheduled, ${failed.length} failed`,
      });
    } catch (error) {
      console.error("Error in bulk schedule");
      schedulingError(res, error, "Failed to schedule drafts");
    }
  });

  app.get("/api/drafts/scheduled", requireDbUser, requirePermission("draft:read:own"), async (req, res) => {
    try {
      const { dbUser, tenant: scope } = authedOf(req);
      const { limit, offset } = paginationQuerySchema.parse(req.query);

      const filters = z.object({ status: z.string().max(32).optional(), platform: z.string().max(32).optional() }).parse(req.query);
      const scheduled = filters.status ? await storage.getScheduledDraftsByStatus(scope, filters.status, { limit, offset }, filters.platform) : await storage.getScheduledDrafts(scope, { limit, offset }, filters.platform);
      const total = await storage.countScheduledDrafts(scope, filters.status, filters.platform);

      // Get full draft details for each schedule
      const results = await Promise.all(scheduled.map(async (schedule) => {
        const draft = await storage.getDraft(scope, schedule.draftId);
        const snapshot = await storage.getDraftPublishStatus(scope, schedule.draftId);
        return {
          ...(snapshot?.schedule ?? schedule),
          targets: snapshot?.schedule?.targets ?? [],
          draft: draft || null,
        };
      }));

      res.json({ items: results, total });
    } catch (error) {
      console.error("Error fetching scheduled drafts");
      res.status(500).json({ message: "Failed to fetch scheduled drafts" });
    }
  });

  app.post("/api/drafts/:id/retry-publish", requireDbUser, requirePermission("draft:write:own"), async (req, res) => {
    try {
      const { tenant: scope } = authedOf(req);
      const targets = await storage.retryDraftScheduleTargets(scope, req.params.id);
      if (!targets) return res.status(404).json({ message: "Scheduled draft not found" });
      res.json(await dispatchScheduledTargets(scope, req.params.id, targets.map((target) => target.id)));
    } catch (error) {
      console.error("Error retrying publish");
      schedulingError(res, error, "Failed to retry publication");
    }
  });

  app.post("/api/drafts/:id/schedule/targets/:targetId/retry", requireDbUser, requirePermission("draft:write:own"), async (req, res) => {
    try {
      const scope = authedOf(req).tenant;
      const targets = await storage.retryDraftScheduleTargets(scope, req.params.id, req.params.targetId);
      if (!targets) return res.status(404).json({ message: "Schedule target not found" });
      res.json(await dispatchScheduledTargets(scope, req.params.id, targets.map((target) => target.id)));
    } catch (error) { schedulingError(res, error, "Failed to retry target"); }
  });

  app.delete("/api/drafts/:id/schedule/targets/:targetId", requireDbUser, requirePermission("draft:write:own"), async (req, res) => {
    try {
      const target = await storage.cancelDraftScheduleTarget(authedOf(req).tenant, req.params.id, req.params.targetId);
      if (!target) return res.status(404).json({ message: "Schedule target not found" });
      res.json({ target, message: "Target cancelled; other platforms are unchanged" });
    } catch (error) { schedulingError(res, error, "Failed to cancel target"); }
  });

  app.get("/api/publishing-rules", requireDbUser, requirePermission("draft:read:own"), async (req, res) => {
    res.json(await storage.getPublishingRules(authedOf(req).tenant));
  });

  app.put("/api/publishing-rules/:platform", requireDbUser, requirePermission("draft:write:own"), async (req, res) => {
    const validation = publishingRuleSchema.safeParse(req.body);
    if (!validation.success) return res.status(400).json({ message: "Invalid publishing rule", errors: validation.error.errors });
    const normalized = req.params.platform.toLowerCase();
    if (!(ALL_PLATFORM_KEYS as readonly string[]).includes(normalized)) return res.status(400).json({ message: "Unknown platform" });
    res.json(await storage.upsertPublishingRule(authedOf(req).tenant, normalized, validation.data));
  });

  app.put("/api/drafts/:id/schedule", requireDbUser, requirePermission("draft:write:own"), async (req, res) => {
    try {
      const { dbUser, tenant: scope } = authedOf(req);
      const { id: draftId } = req.params;

      const validation = scheduleDraftSchema.safeParse(req.body);
      if (!validation.success) {
        if (!publishingConsentSchema.safeParse(req.body?.consent).success) throw new PublishingConsentError();
        return res.status(400).json({ message: "Invalid request data", errors: validation.error.errors });
      }

      const { publishAt, platforms, consent } = validation.data;
      const publishAtDate = new Date(publishAt);

      // Check schedule exists
      const existing = await storage.getDraftSchedule(scope, draftId);
      if (!existing) {
        return res.status(404).json({ message: "Schedule not found for this draft" });
      }

      // Reschedule
      const schedule = await storage.scheduleDraftPublish(scope, draftId, publishAtDate, platforms, "schedule", consent);
      const targets = await storage.getDraftScheduleTargets(scope, schedule.id);

      res.json({
        id: schedule.id,
        draftId: schedule.draftId,
        scheduledPublishAt: schedule.scheduledPublishAt,
        status: schedule.status,
        targets,
        message: "Draft rescheduled successfully",
      });
    } catch (error) {
      console.error("Error rescheduling draft");
      schedulingError(res, error, "Failed to reschedule draft");
    }
  });

  app.delete("/api/drafts/:id/schedule", requireDbUser, requirePermission("draft:write:own"), async (req, res) => {
    try {
      const { dbUser, tenant: scope } = authedOf(req);
      const { id: draftId } = req.params;

      // Check schedule exists
      const existing = await storage.getDraftSchedule(scope, draftId);
      if (!existing) {
        return res.status(404).json({ message: "Schedule not found for this draft" });
      }

      // Cancel schedule
      await storage.cancelDraftSchedule(scope, draftId);

      res.json({ message: "Schedule cancelled successfully" });
    } catch (error) {
      console.error("Error cancelling schedule");
      schedulingError(res, error, "Failed to cancel schedule");
    }
  });

  app.post("/api/drafts/:id/publish-now", requireDbUser, requirePermission("draft:write:own"), async (req, res) => {
    try {
      const { dbUser, tenant: scope } = authedOf(req);
      const { id: draftId } = req.params;
      const parsed = publishingConsentSchema.safeParse(req.body?.consent);
      if (!parsed.success) throw new PublishingConsentError();

      // Get draft
      const draft = await storage.getDraft(scope, draftId);

      if (!draft) {
        return res.status(404).json({ message: "Draft not found" });
      }

      // Consent comparison and the reuse/new-generation decision share the
      // owner row lock. Dispatch only IDs returned by that admission.
      const admitted = await storage.scheduleDraftPublish(scope, draftId, new Date(), undefined, "publish", parsed.data);
      const result = await dispatchScheduledTargets(scope, draftId, admitted.targets.map(target => target.id), admitted);
      res.json({ ...result, message: result.jobIds.length ? "Draft queued for immediate publishing" : "Publication request processed" });
    } catch (error) {
      console.error("Error publishing draft");
      schedulingError(res, error, "Failed to publish draft");
    }
  });

  // Social Media Analytics Endpoints
  
  // Get all connected social accounts
}
