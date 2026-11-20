import type { Express } from "express";
import { inboxRefreshRateLimit } from "../middlewares/rateLimit";
import { authedOf, requireDbUser } from "../middlewares/requireDbUser";
import { requirePermission } from "../middlewares/requirePermission";
import { engineRegistry } from "../services/engines/index.js";
import { normalizeIndustryToSlug } from "../services/metaEngine";
import { validateUrl, validateUrlSync } from "../services/urlValidator";
import { storage, InboxCapacityError, InboxOperationConflictError, DiscoverStateUnavailableError, InboxSnoozeError } from "../storage";
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { enqueueInboxRefresh, getJobStatus, InboxRefreshAdmissionError } from "../jobs/queue";

const updateInboxItemSchema = z.object({
  status: z.enum(["active", "saved", "dismissed"]),
});
const refreshSchema = z.object({ autoRefresh: z.boolean().optional(), operationId: z.string().uuid().optional() });

const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  status: z.enum(["active", "saved", "dismissed"]).optional(),
  snoozed: z.enum(["exclude", "only", "include"]).optional(),
});

const SNOOZE_MIN_MS = 60 * 1000;
const SNOOZE_MAX_MS = 90 * 24 * 60 * 60 * 1000;
const snoozeSchema = z.object({ until: z.string().datetime({ offset: true }) });

export function registerInboxRoutes(app: Express) {
  app.get("/api/inbox", requireDbUser, requirePermission("inbox:read:own"), async (req, res) => {
    try {
      const { tenant: scope } = authedOf(req);
      const parsed = paginationQuerySchema.safeParse(req.query);
      if (!parsed.success) return res.status(400).json({ message: "Invalid inbox query" });
      const { limit, offset, status } = parsed.data;
      // Snoozed stories leave For you until they return; other views include them unless asked.
      const snoozed = parsed.data.snoozed ?? (status === "active" ? "exclude" : "include");
      const items = await storage.getInboxItems(scope, { limit, offset, order: "relevance", ...(status ? { status } : {}),
        ...(snoozed === "include" ? {} : { snoozed }) });
      res.json(items);
    } catch (error) {
      console.error("Error fetching inbox:", error);
      res.status(500).json({ message: "Failed to fetch inbox" });
    }
  });

  app.get("/api/engines", requireDbUser, requirePermission("inbox:read:own"), async (req, res) => {
    try {
      const industry = normalizeIndustryToSlug(authedOf(req).dbUser.industry);
      
      const currentEngine = engineRegistry.getEngine(industry);
      const allEngines = Array.from(engineRegistry.getAllEngines().entries()).map(([slug, engine]) => ({
        industry: slug,
        displayName: engine.config.displayName,
        description: engine.config.description,
        isSpecialized: engineRegistry.hasSpecializedEngine(slug),
      }));
      
      res.json({
        currentEngine: {
          industry: industry || "other",
          displayName: currentEngine.config.displayName,
          description: currentEngine.config.description,
        },
        availableEngines: allEngines.filter(e => e.isSpecialized),
        totalIndustries: allEngines.length,
      });
    } catch (error) {
      console.error("Error fetching engines:", error);
      res.status(500).json({ message: "Failed to fetch engines info" });
    }
  });

  app.get("/api/trends", requireDbUser, requirePermission("inbox:read:own"), async (req, res) => {
    try {
      const { dbUser, tenant: scope } = authedOf(req);
      const industry = normalizeIndustryToSlug(dbUser.industry);

      const engine = engineRegistry.getEngine(industry);
      const trends = await engine.getHotTrends(scope, 5);
      res.json(trends);
    } catch (error) {
      console.error("Error fetching trends:", error);
      res.status(500).json({ message: "Failed to fetch trends" });
    }
  });

  app.post("/api/inbox/refresh", requireDbUser, requirePermission("inbox:write:own"), inboxRefreshRateLimit, async (req, res) => {
    try {
      const { dbUser, tenant: scope } = authedOf(req);
      const userId = dbUser.id;
      const input = refreshSchema.safeParse(req.body ?? {});
      if (!input.success) return res.status(400).json({ message: "Invalid refresh request" });
      const autoRefresh = input.data.autoRefresh ?? false;
      const operationId = `refresh:${input.data.operationId ?? randomUUID()}`;
      const receipt = await storage.getInboxRefreshReceipt(scope, operationId, autoRefresh);
      if (receipt) return res.json(receipt);

      // Try to enqueue the job
      const jobId = await enqueueInboxRefresh({
        tenantId: scope.tenantId,
        userId,
        manual: true,
        autoRefresh,
        operationId,
        dedupeKey: createHash("sha256").update(JSON.stringify([scope.tenantId, userId, operationId])).digest("hex"),
        triggeredBy: "manual",
      });

      // If queue is available, return immediately
      if (jobId) {
        return res.json({
          jobId,
          status: "queued",
          message: "Refresh job queued, processing in background",
        });
      }

      // Fallback: process synchronously (local dev without Redis)
      console.log("[Inbox Refresh] No queue available, falling back to sync processing");

      const profile = await storage.getUserProfile(scope);
      if (!profile) {
        return res.status(400).json({ message: "Profile not found. Please complete onboarding first." });
      }

      const industry = normalizeIndustryToSlug(authedOf(req).dbUser.industry);

      const engine = engineRegistry.getEngine(industry);
      console.log(`[Inbox Refresh] Using ${engine.config.displayName} engine for user ${userId}`);

      const result = await engine.processForUser(scope, profile, { operationId, autoRefresh });

      await storage.createEngineRunLog(scope, {
        industry,
        status: result.success ? "success" : "failed",
        articlesProcessed: result.articlesProcessed,
        articlesMatched: result.articlesMatched,
        errorMessage: result.errors?.join("; ") || null,
        durationMs: result.durationMs,
        completedAt: new Date(),
      }).catch(() => { console.warn("Inbox refresh log unavailable"); });

      res.status(result.success ? 200 : 502).json({ ...result, engine: engine.config.displayName });
    } catch (error) {
      if (error instanceof InboxOperationConflictError) return res.status(409).json({ message: error.message });
      if (error instanceof InboxRefreshAdmissionError) return res.status(409).json({ status: "failed", success: false, code: error.code, message: error.message });
      console.error("Error refreshing inbox");
      res.status(500).json({ message: "Failed to refresh inbox" });
    }
  });

  app.get("/api/inbox/refresh/:jobId", requireDbUser, requirePermission("inbox:read:own"), async (req, res) => {
    try {
      const { jobId } = req.params;

      const jobStatus = await getJobStatus(jobId);
      if (!jobStatus) {
        return res.status(404).json({ message: "Job not found" });
      }
      const scope = authedOf(req).tenant;
      if (jobStatus.data?.tenantId !== scope.tenantId || jobStatus.data?.userId !== scope.userId) {
        return res.status(404).json({ message: "Job not found" });
      }

      // The database receipt, written when the stories commit, is the truth: a brief Redis hiccup can
      // stop the queue recording completion, and the page would wait for Bull's retry.
      if (!["completed", "failed"].includes(jobStatus.state) && typeof jobStatus.data?.operationId === "string") {
        const receipt = await storage.getInboxRefreshReceipt(scope, jobStatus.data.operationId, Boolean(jobStatus.data.autoRefresh)).catch(() => undefined);
        if (receipt) {
          return res.json({ id: jobStatus.id, status: "completed", progress: receipt, attemptsMade: jobStatus.attemptsMade, totalAttempts: jobStatus.attempts, error: null });
        }
      }

      res.json({
        id: jobStatus.id,
        status: jobStatus.state,
        progress: jobStatus.progress,
        attemptsMade: jobStatus.attemptsMade,
        totalAttempts: jobStatus.attempts,
        error: jobStatus.state === "failed" ? "Article fetching could not complete. Please try again." : null,
      });
    } catch (error) {
      console.error("Error fetching job status");
      res.status(500).json({ message: "Failed to fetch job status" });
    }
  });


  app.post("/api/inbox/add-trend", requireDbUser, requirePermission("inbox:write:own"), async (req, res) => {
    try {
      const { dbUser, tenant: scope } = authedOf(req);
      const userId = dbUser.id;
      const { title, source, link, topic } = req.body;
      
      if (!link || !title) {
        return res.status(400).json({ message: "Missing required fields" });
      }
      
      if (!validateUrlSync(link)) {
        return res.status(400).json({ message: "Invalid URL format or blocked domain" });
      }
      
      const urlResult = await validateUrl(link, true);
      if (!urlResult.isValid) {
        return res.status(400).json({ message: urlResult.reason || "URL validation failed" });
      }
      
      const { item, alreadyExists } = await storage.addInboxItem(scope, {
        headline: title,
        source: source || "Hot Trends",
        articleUrl: link,
        summary: `Trending topic: ${topic || "Industry News"}`,
        matchedKeywords: [],
        relevanceScore: "0",
        relevanceReason: "Manually added from trends; relevance has not been scored.",
        status: "active",
      });
      
      if (alreadyExists) return res.json({ message: "Article already in inbox", alreadyExists: true });
      res.json({ message: "Article added to inbox", item });
    } catch (error) {
      if (error instanceof InboxCapacityError) return res.status(409).json({ message: error.message, outcome: "capacity" });
      console.error("Error adding trend to inbox:", error);
      res.status(500).json({ message: "Failed to add article to inbox" });
    }
  });

  // Called once per Discover mount; the server decides whether a new visit starts.
  app.post("/api/inbox/visit", requireDbUser, requirePermission("inbox:write:own"), async (req, res) => {
    try {
      res.json(await storage.recordDiscoverVisit(authedOf(req).tenant));
    } catch (error) {
      console.error("Error recording Discover visit:", error);
      res.status(500).json({ message: "Failed to record Discover visit" });
    }
  });

  // Explicit row open only. Idempotent: repeated opens keep the first read time.
  app.post("/api/inbox/:id/read", requireDbUser, requirePermission("inbox:write:own"), async (req, res) => {
    try {
      const readAt = await storage.markInboxItemRead(authedOf(req).tenant, req.params.id);
      if (!readAt) return res.status(404).json({ message: "Item not found" });
      res.json({ id: req.params.id, readAt });
    } catch (error) {
      if (error instanceof DiscoverStateUnavailableError) return res.status(503).json({ message: "Reading state is not available yet" });
      console.error("Error marking inbox item read:", error);
      res.status(500).json({ message: "Failed to mark article read" });
    }
  });

  app.delete("/api/inbox/:id/read", requireDbUser, requirePermission("inbox:write:own"), async (req, res) => {
    try {
      if (!await storage.markInboxItemUnread(authedOf(req).tenant, req.params.id)) return res.status(404).json({ message: "Item not found" });
      res.json({ id: req.params.id, readAt: null });
    } catch (error) {
      if (error instanceof DiscoverStateUnavailableError) return res.status(503).json({ message: "Reading state is not available yet" });
      console.error("Error marking inbox item unread:", error);
      res.status(500).json({ message: "Failed to mark article unread" });
    }
  });

  app.post("/api/inbox/:id/snooze", requireDbUser, requirePermission("inbox:write:own"), async (req, res) => {
    const parsed = snoozeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Choose a valid snooze time." });
    const until = new Date(parsed.data.until);
    const delay = until.getTime() - Date.now();
    if (!(delay > SNOOZE_MIN_MS && delay <= SNOOZE_MAX_MS)) {
      return res.status(400).json({ message: "Snooze time must be more than 1 minute and at most 90 days from now." });
    }
    try {
      const item = await storage.snoozeInboxItem(authedOf(req).tenant, req.params.id, until);
      if (!item) return res.status(404).json({ message: "Item not found" });
      res.json(item);
    } catch (error) {
      if (error instanceof InboxSnoozeError) return res.status(409).json({ message: error.message });
      console.error("Error snoozing inbox item:", error);
      res.status(500).json({ message: "Failed to snooze article" });
    }
  });

  app.delete("/api/inbox/:id/snooze", requireDbUser, requirePermission("inbox:write:own"), async (req, res) => {
    try {
      const item = await storage.snoozeInboxItem(authedOf(req).tenant, req.params.id, null);
      if (!item) return res.status(404).json({ message: "Item not found" });
      res.json(item);
    } catch (error) {
      if (error instanceof InboxSnoozeError) return res.status(409).json({ message: error.message });
      console.error("Error clearing inbox item snooze:", error);
      res.status(500).json({ message: "Failed to unsnooze article" });
    }
  });

  app.patch("/api/inbox/:id", requireDbUser, requirePermission("inbox:write:own"), async (req, res) => {
    try {
      const { dbUser, tenant: scope } = authedOf(req);
      const userId = dbUser.id;
      const { id } = req.params;
      
      const validation = updateInboxItemSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ message: "Invalid request data" });
      }
      
      const updated = await storage.updateInboxItem(scope, id, { status: validation.data.status });
      
      if (!updated) {
        return res.status(404).json({ message: "Item not found" });
      }
      
      res.json(updated);
    } catch (error) {
      if (error instanceof InboxCapacityError) return res.status(409).json({ message: error.message, outcome: "capacity" });
      console.error("Error updating inbox item:", error);
      res.status(500).json({ message: "Failed to update inbox item" });
    }
  });
}
