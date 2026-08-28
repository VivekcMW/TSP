import type { Express } from "express";
import { inboxRefreshRateLimit } from "../middlewares/rateLimit";
import { requireDbUser } from "../middlewares/requireDbUser";
import { engineRegistry } from "../services/engines/index.js";
import { normalizeIndustryToSlug } from "../services/metaEngine";
import { generateArticleMatches } from "../services/punditBrain";
import { getHotTrends } from "../services/rssService";
import { validateUrl, validateUrlSync } from "../services/urlValidator";
import { storage } from "../storage";
import { z } from "zod";

const updateInboxItemSchema = z.object({
  status: z.enum(["active", "saved", "dismissed"]),
});

export function registerInboxRoutes(app: Express) {
  app.get("/api/inbox", requireDbUser, async (req: any, res) => {
    try {
      const userId = req.dbUser.id;
      const items = await storage.getInboxItems(userId);
      res.json(items);
    } catch (error) {
      console.error("Error fetching inbox:", error);
      res.status(500).json({ message: "Failed to fetch inbox" });
    }
  });

  app.get("/api/engines", requireDbUser, async (req: any, res) => {
    try {
      const industry = normalizeIndustryToSlug(req.dbUser.industry);
      
      const currentEngine = engineRegistry.getEngine(industry);
      const allEngines = Array.from(engineRegistry.getAllEngines().entries()).map(([slug, engine]) => ({
        industry: slug,
        displayName: engine.config.displayName,
        description: engine.config.description,
        isSpecialized: engineRegistry.hasSpecializedEngine(slug),
        feedCount: engine.config.defaultFeeds.length,
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

  app.get("/api/trends", requireDbUser, async (req: any, res) => {
    try {
      const industry = normalizeIndustryToSlug(req.dbUser.industry);
      
      const engine = engineRegistry.getEngine(industry);
      const trends = await engine.getHotTrends(5);
      res.json(trends);
    } catch (error) {
      console.error("Error fetching trends:", error);
      res.status(500).json({ message: "Failed to fetch trends" });
    }
  });

  app.post("/api/inbox/refresh", requireDbUser, inboxRefreshRateLimit, async (req: any, res) => {
    try {
      const userId = req.dbUser.id;
      
      const profile = await storage.getUserProfile(userId);
      if (!profile) {
        return res.status(400).json({ message: "Profile not found. Please complete onboarding first." });
      }
      
      const industry = normalizeIndustryToSlug(req.dbUser.industry);
      
      const engine = engineRegistry.getEngine(industry);
      console.log(`[Inbox Refresh] Using ${engine.config.displayName} engine for user ${userId}`);
      
      const autoRefresh = req.body?.autoRefresh === true;

      const existingItems = await storage.getInboxItems(userId);
      const activeItems = existingItems.filter(item => item.status === "active");
      const activeCount = activeItems.length;
      
      if (activeCount >= 10) {
        if (!autoRefresh) {
          return res.json({ 
            message: "You have enough articles to review. Save or dismiss some before refreshing.", 
            count: 0, 
            items: [],
            engine: engine.config.displayName,
          });
        }
        // Auto-refresh: dismiss all existing active articles to make room for fresh ones
        for (const item of activeItems) {
          await storage.updateInboxItem(item.id, userId, { status: "dismissed" });
        }
        console.log(`[Inbox Auto-Refresh] Dismissed ${activeCount} stale articles for user ${userId}`);
      }
      
      const result = await engine.processForUser(userId, profile);
      
      if (!result.success) {
        console.error(`Engine processing failed for user ${userId}:`, result.errors);
        
        const keywords = profile.keywords || [];
        const publications = profile.publications || [];
        
        if (keywords.length === 0) {
          return res.status(400).json({ message: "No keywords configured. Please update your profile." });
        }
        
        const numToCreate = Math.min(10, 10 - activeCount);
        const articles = await generateArticleMatches(keywords, publications, numToCreate + 5);
        
        const validatedArticles: typeof articles = [];
        for (const article of articles) {
          if (!article.articleUrl) continue;
          
          if (!validateUrlSync(article.articleUrl)) {
            console.log(`Skipping article with invalid URL: ${article.articleUrl}`);
            continue;
          }
          
          const urlResult = await validateUrl(article.articleUrl, true);
          if (!urlResult.isValid) {
            console.log(`Skipping article - ${urlResult.reason}: ${article.articleUrl}`);
            continue;
          }
          
          validatedArticles.push(article);
          if (validatedArticles.length >= numToCreate) break;
        }
        
        const createdItems = [];
        for (const article of validatedArticles) {
          const item = await storage.createInboxItem({
            userId,
            headline: article.headline,
            source: article.source,
            articleUrl: article.articleUrl,
            summary: article.summary,
            matchedKeywords: article.matchedKeywords,
            status: "active",
          });
          createdItems.push(item);
        }
        
        return res.json({ 
          message: "Inbox refreshed using fallback", 
          count: createdItems.length, 
          items: createdItems,
          engine: "Fallback",
        });
      }
      
      const updatedItems = await storage.getInboxItems(userId);
      const newItems = updatedItems.filter(item => 
        !existingItems.some(existing => existing.id === item.id)
      );
      
      res.json({ 
        message: "Inbox refreshed successfully", 
        count: result.newInboxItems,
        articlesProcessed: result.articlesProcessed,
        articlesMatched: result.articlesMatched,
        items: newItems,
        engine: engine.config.displayName,
        durationMs: result.durationMs,
      });
    } catch (error) {
      console.error("Error refreshing inbox:", error);
      res.status(500).json({ message: "Failed to refresh inbox" });
    }
  });

  app.post("/api/inbox/add-trend", requireDbUser, async (req: any, res) => {
    try {
      const userId = req.dbUser.id;
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
      
      const existingItems = await storage.getInboxItems(userId);
      const alreadyExists = existingItems.some(item => item.articleUrl === link);
      if (alreadyExists) {
        return res.json({ message: "Article already in inbox", alreadyExists: true });
      }
      
      const item = await storage.createInboxItem({
        userId,
        headline: title,
        source: source || "Hot Trends",
        articleUrl: link,
        summary: `Trending topic: ${topic || "Industry News"}`,
        matchedKeywords: topic ? [topic] : [],
        status: "active",
      });
      
      res.json({ message: "Article added to inbox", item });
    } catch (error) {
      console.error("Error adding trend to inbox:", error);
      res.status(500).json({ message: "Failed to add article to inbox" });
    }
  });

  app.patch("/api/inbox/:id", requireDbUser, async (req: any, res) => {
    try {
      const userId = req.dbUser.id;
      const { id } = req.params;
      
      const validation = updateInboxItemSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ message: "Invalid request data" });
      }
      
      const updated = await storage.updateInboxItem(id, userId, { status: validation.data.status });
      
      if (!updated) {
        return res.status(404).json({ message: "Item not found" });
      }
      
      res.json(updated);
    } catch (error) {
      console.error("Error updating inbox item:", error);
      res.status(500).json({ message: "Failed to update inbox item" });
    }
  });
}
