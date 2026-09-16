import type { Express } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { instantReviewRateLimit } from "../middlewares/rateLimit";
import { authedOf, requireDbUser } from "../middlewares/requireDbUser";
import { requirePermission } from "../middlewares/requirePermission";
import { generateInstantReview, generatePlatformReviews, type PlatformKey } from "../services/punditBrain";
import { fetchArticleFromUrl } from "../services/urlFetcher";
import { storage } from "../storage";
import { platformIntegrations } from "@shared/schema";
import { enqueuePublishDraft } from "../jobs/queue";
import { handlePublishDraft, type PublishDraftJobData } from "../jobs/handlers/publish-draft";
import { z } from "zod";

const createDraftSchema = z.object({
  inboxItemId: z.string().optional(),
  platform: z.enum(["linkedin", "twitter", "threads", "bluesky", "substack", "medium", "reddit", "mastodon", "devto", "hashnode", "quora", "facebook", "telegram", "discord", "farcaster", "xiaohongshu", "weibo", "wechat", "maimai", "vk", "line", "naver", "xing"]),
  tone: z.enum(["professional", "authoritative", "contrarian", "ai-recommended"]),
  content: z.string().min(1).max(5000),
  media: z.array(z.object({ id: z.string().uuid(), type: z.enum(["image", "video", "audio"]), name: z.string().max(255), url: z.string().max(2_000) })).max(8).default([]),
});

const updateDraftSchema = z.object({
  content: z.string().min(1).max(5000).optional(),
  status: z.enum(["draft", "published"]).optional(),
});

const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const selectedReviewSchema = z.object({
  url: z.string().url(),
  selectedPlatforms: z.array(z.enum(["linkedin", "twitter", "threads", "bluesky", "substack", "medium", "reddit", "mastodon", "devto", "hashnode", "quora", "facebook", "telegram", "discord", "farcaster", "xiaohongshu", "weibo", "wechat", "maimai", "vk", "line", "naver", "xing"])).min(1).max(4),
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
  platforms: z.array(z.enum(["linkedin", "twitter", "threads", "bluesky", "substack", "medium", "reddit", "mastodon", "devto", "hashnode", "quora", "facebook", "telegram", "discord", "farcaster", "xiaohongshu", "weibo", "wechat", "maimai", "vk", "line", "naver", "xing"])).min(1).max(4).optional(),
});

const bulkScheduleSchema = z.object({
  draftIds: z.array(z.string()).min(1).max(50),
  publishAt: z.string().datetime().optional(),
  schedule: z.record(z.string(), z.string().datetime()).optional(),
}).refine(
  (data) => data.publishAt || data.schedule,
  { message: "Either publishAt or schedule must be provided" }
);

const manualReviewSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(20).max(20_000),
  media: z.array(z.object({ id: z.string().uuid().optional(), type: z.enum(["image", "video", "audio"]), name: z.string().max(255), url: z.string().max(2_000) })).max(8).default([]),
  selectedPlatforms: z.array(z.enum(["linkedin", "twitter", "threads", "bluesky", "substack", "medium", "reddit", "mastodon", "devto", "hashnode", "quora", "facebook", "telegram", "discord", "farcaster", "xiaohongshu", "weibo", "wechat", "maimai", "vk", "line", "naver", "xing"])).min(1).max(4).default(["linkedin"]),
});

export function registerDraftsRoutes(app: Express) {
  app.get("/api/drafts", requireDbUser, requirePermission("draft:read:own"), async (req, res) => {
    try {
      const { dbUser, tenant: scope } = authedOf(req);
      const userId = dbUser.id;
      const { limit, offset } = paginationQuerySchema.parse(req.query);
      const userDrafts = await storage.getDrafts(scope, { limit, offset });
      res.json(userDrafts);
    } catch (error) {
      console.error("Error fetching drafts:", error);
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
      console.error("Error fetching published drafts:", error);
      res.status(500).json({ message: "Failed to fetch published drafts" });
    }
  });

  app.get("/api/drafts/:id/publish-logs", requireDbUser, requirePermission("draft:read:own"), async (req, res) => {
    try {
      const { tenant: scope } = authedOf(req);
      const drafts = await storage.getDrafts(scope, { limit: 500 });
      if (!drafts.some((draft) => draft.id === req.params.id)) return res.status(404).json({ message: "Draft not found" });
      res.json(await storage.getPublishLogs(scope, req.params.id));
    } catch (error) {
      console.error("Error fetching publish logs:", error);
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
      console.error("Error creating draft:", error);
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
      
      const updated = await storage.updateDraft(scope, id, validation.data);
      
      if (!updated) {
        return res.status(404).json({ message: "Draft not found" });
      }
      
      res.json(updated);
    } catch (error) {
      console.error("Error updating draft:", error);
      res.status(500).json({ message: "Failed to update draft" });
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
      console.error("Error deleting draft:", error);
      res.status(500).json({ message: "Failed to delete draft" });
    }
  });

  app.post("/api/instant-review", requireDbUser, requirePermission("generation:create:own"), instantReviewRateLimit, async (req, res) => {
    try {
      const { dbUser, tenant: scope } = authedOf(req);
      const userId = dbUser.id;
      const { url } = req.body;
      
      if (!url || typeof url !== "string") {
        return res.status(400).json({ message: "URL is required" });
      }
      
      try {
        new URL(url);
      } catch {
        return res.status(400).json({ message: "Invalid URL format" });
      }
      
      console.log(`Fetching article from URL: ${url}`);
      const article = await fetchArticleFromUrl(url);
      
      console.log(`Generating instant review for: ${article.title}`);
      const posts = await generateInstantReview(article);
      
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
          content: article.content.slice(0, 500),
        },
        posts,
      });
    } catch (error) {
      console.error("Error in instant review:", error);
      res.status(500).json({ message: "Failed to generate instant review" });
    }
  });

  app.post("/api/instant-review/selected", requireDbUser, requirePermission("generation:create:own"), instantReviewRateLimit, async (req, res) => {
    const validation = selectedReviewSchema.safeParse(req.body);
    if (!validation.success) return res.status(400).json({ message: "Choose between one and four valid platforms", errors: validation.error.errors });
    try {
      const article = await fetchArticleFromUrl(validation.data.url);
      const posts = await generatePlatformReviews(article, validation.data.selectedPlatforms as PlatformKey[]);
      res.json({ article: { title: article.title, source: article.source, url: article.url, domain: article.domain, content: article.content.slice(0, 500) }, posts });
    } catch (error) {
      console.error("Error in selected instant review:", error);
      res.status(500).json({ message: "Failed to generate selected platform reviews" });
    }
  });

  app.post("/api/instant-review/manual", requireDbUser, requirePermission("generation:create:own"), instantReviewRateLimit, async (req, res) => {
    try {
      const validation = manualReviewSchema.safeParse(req.body);
      if (!validation.success) return res.status(400).json({ message: "Invalid article data", errors: validation.error.errors });
      const scope = authedOf(req).tenant;
      const { title, content, media, selectedPlatforms } = validation.data;
      for (const item of media) {
        if (item.id && !(await storage.getMediaAsset(scope, item.id))) return res.status(403).json({ message: "An attached media item is not available to this account" });
      }
      const mediaContext = media.length ? `\n\nAttached media: ${media.map((item) => `${item.type}: ${item.name}`).join(", ")}` : "";
      const article = { title, content: `${content}${mediaContext}`, source: "Your draft", url: "", media };
      const posts = await generatePlatformReviews(article, selectedPlatforms as PlatformKey[]);
      res.json({ article: { ...article, domain: "manual" }, posts });
    } catch (error) {
      console.error("Error reviewing manual article:", error);
      res.status(500).json({ message: "Failed to generate review" });
    }
  });

  // Draft Scheduling Endpoints

  app.post("/api/drafts/:id/schedule", requireDbUser, requirePermission("draft:write:own"), async (req, res) => {
    try {
      const { dbUser, tenant: scope } = authedOf(req);
      const { id: draftId } = req.params;

      const validation = scheduleDraftSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ message: "Invalid request data", errors: validation.error.errors });
      }

      const { publishAt, platforms } = validation.data;
      const publishAtDate = new Date(publishAt);

      // Check draft exists
      const drafts = await storage.getDrafts(scope);
      const draft = drafts.find((d) => d.id === draftId);
      if (!draft) {
        return res.status(404).json({ message: "Draft not found" });
      }

      // Schedule the draft
      const schedule = await storage.scheduleDraftPublish(scope, draftId, publishAtDate, platforms);
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
      console.error("Error scheduling draft:", error);
      res.status(500).json({ message: "Failed to schedule draft" });
    }
  });

  app.post("/api/drafts/bulk-schedule", requireDbUser, requirePermission("draft:write:own"), async (req, res) => {
    try {
      const { dbUser, tenant: scope } = authedOf(req);

      const validation = bulkScheduleSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ message: "Invalid request data", errors: validation.error.errors });
      }

      const { draftIds, publishAt, schedule: individualSchedule } = validation.data;

      const scheduled: string[] = [];
      const failed: string[] = [];

      for (const draftId of draftIds) {
        try {
          const publishTime = individualSchedule?.[draftId] || publishAt;
          if (!publishTime) {
            failed.push(draftId);
            continue;
          }

          const publishAtDate = new Date(publishTime);
          await storage.scheduleDraftPublish(scope, draftId, publishAtDate);
          scheduled.push(draftId);
        } catch (error) {
          console.error(`Failed to schedule draft ${draftId}:`, error);
          failed.push(draftId);
        }
      }

      res.json({
        scheduled,
        failed,
        message: `${scheduled.length} drafts scheduled, ${failed.length} failed`,
      });
    } catch (error) {
      console.error("Error in bulk schedule:", error);
      res.status(500).json({ message: "Failed to schedule drafts" });
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
      const allDrafts = await storage.getDrafts(scope, { limit: 500 });
      const results = await Promise.all(scheduled.map(async (schedule) => {
        const draft = allDrafts.find((d) => d.id === schedule.draftId);
        return {
          ...schedule,
          targets: await storage.getDraftScheduleTargets(scope, schedule.id),
          draft: draft || null,
        };
      }));

      res.json({ items: results, total });
    } catch (error) {
      console.error("Error fetching scheduled drafts:", error);
      res.status(500).json({ message: "Failed to fetch scheduled drafts" });
    }
  });

  app.post("/api/drafts/:id/retry-publish", requireDbUser, requirePermission("draft:write:own"), async (req, res) => {
    try {
      const { tenant: scope } = authedOf(req);
      const draft = (await storage.getDrafts(scope)).find((item) => item.id === req.params.id);
      const schedule = await storage.getDraftSchedule(scope, req.params.id);
      if (!draft || !schedule) return res.status(404).json({ message: "Scheduled draft not found" });
      if (schedule.status !== "failed") return res.status(400).json({ message: "Only failed scheduled drafts can be retried" });
      await storage.updateDraftScheduleStatus(scope, schedule.id, "scheduled");
      const jobData: PublishDraftJobData = { tenantId: scope.tenantId, userId: scope.userId, draftId: draft.id, draftScheduleId: schedule.id, platform: draft.platform, publishAt: new Date(), attemptNumber: 1 };
      const jobId = await enqueuePublishDraft(jobData);
      if (!jobId) await handlePublishDraft({ id: `sync:${draft.id}:${Date.now()}`, data: jobData, progress: () => undefined } as Parameters<typeof handlePublishDraft>[0]);
      res.json({ jobId, status: jobId ? "queued" : "completed" });
    } catch (error) {
      console.error("Error retrying publish:", error);
      res.status(500).json({ message: "Failed to retry publication" });
    }
  });

  app.get("/api/publishing-rules", requireDbUser, requirePermission("draft:read:own"), async (req, res) => {
    res.json(await storage.getPublishingRules(authedOf(req).tenant));
  });

  app.put("/api/publishing-rules/:platform", requireDbUser, requirePermission("draft:write:own"), async (req, res) => {
    const validation = publishingRuleSchema.safeParse(req.body);
    if (!validation.success) return res.status(400).json({ message: "Invalid publishing rule", errors: validation.error.errors });
    const normalized = req.params.platform.toLowerCase();
    if (!(["linkedin", "twitter", "threads", "bluesky", "substack", "medium", "reddit", "mastodon", "devto", "hashnode", "quora", "facebook", "telegram", "discord", "farcaster", "xiaohongshu", "weibo", "wechat", "maimai", "vk", "line", "naver", "xing"] as string[]).includes(normalized)) return res.status(400).json({ message: "Unknown platform" });
    res.json(await storage.upsertPublishingRule(authedOf(req).tenant, normalized, validation.data));
  });

  app.put("/api/drafts/:id/schedule", requireDbUser, requirePermission("draft:write:own"), async (req, res) => {
    try {
      const { dbUser, tenant: scope } = authedOf(req);
      const { id: draftId } = req.params;

      const validation = scheduleDraftSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ message: "Invalid request data", errors: validation.error.errors });
      }

      const { publishAt, platforms } = validation.data;
      const publishAtDate = new Date(publishAt);

      // Check schedule exists
      const existing = await storage.getDraftSchedule(scope, draftId);
      if (!existing) {
        return res.status(404).json({ message: "Schedule not found for this draft" });
      }

      // Reschedule
      const schedule = await storage.scheduleDraftPublish(scope, draftId, publishAtDate, platforms);
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
      console.error("Error rescheduling draft:", error);
      res.status(500).json({ message: "Failed to reschedule draft" });
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
      console.error("Error cancelling schedule:", error);
      res.status(500).json({ message: "Failed to cancel schedule" });
    }
  });

  app.post("/api/drafts/:id/publish-now", requireDbUser, requirePermission("draft:write:own"), async (req, res) => {
    try {
      const { dbUser, tenant: scope } = authedOf(req);
      const { id: draftId } = req.params;

      // Get draft
      const drafts = await storage.getDrafts(scope);
      const draft = drafts.find((d) => d.id === draftId);

      if (!draft) {
        return res.status(404).json({ message: "Draft not found" });
      }

      if (draft.publishStatus === "published") {
        return res.status(400).json({ message: "Draft is already published" });
      }

      // Create or get schedule for immediate publish
      const now = new Date();
      let schedule = await storage.getDraftSchedule(scope, draftId);
      if (!schedule) {
        schedule = await storage.scheduleDraftPublish(scope, draftId, now);
      }

      // Enqueue publish job
      const jobData: PublishDraftJobData = {
        tenantId: scope.tenantId,
        userId: scope.userId,
        draftId,
        draftScheduleId: schedule.id,
        platform: draft.platform,
        publishAt: now,
        attemptNumber: 1,
      };
      const jobId = await enqueuePublishDraft(jobData);

      if (!jobId) {
        // Local development can run without Redis. Match the inbox-refresh
        // behavior and execute the same handler synchronously instead.
        const progress = await handlePublishDraft({
          id: `sync:${draftId}:${Date.now()}`,
          data: jobData,
          progress: () => undefined,
        } as Parameters<typeof handlePublishDraft>[0]);
        return res.json({
          jobId: null,
          status: progress.status,
          postId: progress.postId,
          message: "Draft published synchronously because the queue is disabled",
        });
      }

      res.json({
        jobId,
        status: "publishing",
        message: "Draft queued for immediate publishing",
      });
    } catch (error) {
      console.error("Error publishing draft:", error);
      res.status(500).json({ message: "Failed to publish draft" });
    }
  });

  // Social Media Analytics Endpoints
  
  // Get all connected social accounts
}
