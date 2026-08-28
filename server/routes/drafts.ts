import type { Express } from "express";
import { instantReviewRateLimit } from "../middlewares/rateLimit";
import { requireDbUser } from "../middlewares/requireDbUser";
import { generateInstantReview } from "../services/punditBrain";
import { fetchArticleFromUrl } from "../services/urlFetcher";
import { storage } from "../storage";
import { z } from "zod";

const createDraftSchema = z.object({
  inboxItemId: z.string().optional(),
  platform: z.enum(["linkedin", "twitter", "threads", "bluesky", "substack", "medium", "reddit", "mastodon", "devto", "hashnode", "quora", "facebook", "telegram", "discord", "farcaster", "xiaohongshu", "weibo", "wechat", "maimai", "vk", "line", "naver", "xing"]),
  tone: z.enum(["professional", "authoritative", "contrarian", "ai-recommended"]),
  content: z.string().min(1).max(5000),
});

const updateDraftSchema = z.object({
  content: z.string().min(1).max(5000).optional(),
  status: z.enum(["draft", "published"]).optional(),
});

export function registerDraftsRoutes(app: Express) {
  app.get("/api/drafts", requireDbUser, async (req: any, res) => {
    try {
      const userId = req.dbUser.id;
      const userDrafts = await storage.getDrafts(userId);
      res.json(userDrafts);
    } catch (error) {
      console.error("Error fetching drafts:", error);
      res.status(500).json({ message: "Failed to fetch drafts" });
    }
  });

  app.post("/api/drafts", requireDbUser, async (req: any, res) => {
    try {
      const userId = req.dbUser.id;
      
      const validation = createDraftSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ message: "Invalid request data", errors: validation.error.errors });
      }
      
      const { inboxItemId, platform, tone, content } = validation.data;
      
      const draft = await storage.createDraft({
        userId,
        inboxItemId,
        platform,
        tone,
        content,
        status: "draft",
      });
      
      res.json(draft);
    } catch (error) {
      console.error("Error creating draft:", error);
      res.status(500).json({ message: "Failed to create draft" });
    }
  });

  app.patch("/api/drafts/:id", requireDbUser, async (req: any, res) => {
    try {
      const userId = req.dbUser.id;
      const { id } = req.params;
      
      const validation = updateDraftSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ message: "Invalid request data" });
      }
      
      const updated = await storage.updateDraft(id, userId, validation.data);
      
      if (!updated) {
        return res.status(404).json({ message: "Draft not found" });
      }
      
      res.json(updated);
    } catch (error) {
      console.error("Error updating draft:", error);
      res.status(500).json({ message: "Failed to update draft" });
    }
  });

  app.delete("/api/drafts/:id", requireDbUser, async (req: any, res) => {
    try {
      const userId = req.dbUser.id;
      const { id } = req.params;
      await storage.deleteDraft(id, userId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting draft:", error);
      res.status(500).json({ message: "Failed to delete draft" });
    }
  });

  app.post("/api/instant-review", requireDbUser, instantReviewRateLimit, async (req: any, res) => {
    try {
      const userId = req.dbUser.id;
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
      
      const profile = await storage.getUserProfile(userId);
      if (profile) {
        const publications = profile.publications || [];
        if (!publications.includes(article.source) && !publications.includes(article.domain)) {
          const updatedPublications = [...publications, article.source].slice(0, 20);
          await storage.updateUserProfile(userId, { publications: updatedPublications });
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

  // Social Media Analytics Endpoints
  
  // Get all connected social accounts
}
