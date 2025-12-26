import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { isAuthenticated, registerAuthRoutes, setupAuth } from "./replit_integrations/auth";
import { z } from "zod";
import { db } from "./db";
import { users } from "@shared/models/auth";
import { eq } from "drizzle-orm";
import { analyzeProfessionalIdentity, generateArticleMatches, generatePostContent } from "./services/punditBrain";

const completeOnboardingSchema = z.object({
  focusDescription: z.string().min(10).max(150).optional(),
  publications: z.array(z.string()).max(20).optional(),
  keywords: z.array(z.string()).max(20).optional(),
  influencers: z.array(z.string()).max(20).optional(),
  companies: z.array(z.string()).max(20).optional(),
});

const createDraftSchema = z.object({
  inboxItemId: z.string().optional(),
  platform: z.enum(["linkedin", "twitter"]),
  tone: z.enum(["professional", "authoritative", "contrarian", "ai-recommended"]),
  content: z.string().min(1).max(3000),
});

const updateDraftSchema = z.object({
  content: z.string().min(1).max(3000).optional(),
  status: z.enum(["draft", "published"]).optional(),
});

const updateInboxItemSchema = z.object({
  status: z.enum(["active", "saved", "dismissed"]),
});

const completeRegistrationSchema = z.object({
  firstName: z.string().min(1).max(50),
  lastName: z.string().min(1).max(50),
  city: z.string().min(1).max(100),
  country: z.string().min(1).max(100),
});

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  await setupAuth(app);
  registerAuthRoutes(app);

  app.post("/api/complete-registration", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      
      const validation = completeRegistrationSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ message: "Invalid request data", errors: validation.error.errors });
      }
      
      const { firstName, lastName, city, country } = validation.data;
      
      const [updatedUser] = await db
        .update(users)
        .set({
          firstName,
          lastName,
          city,
          country,
          registrationCompleted: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId))
        .returning();
      
      res.json(updatedUser);
    } catch (error) {
      console.error("Error completing registration:", error);
      res.status(500).json({ message: "Failed to complete registration" });
    }
  });

  app.get("/api/profile", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      let profile = await storage.getUserProfile(userId);
      
      if (!profile) {
        profile = await storage.createUserProfile({
          userId,
          onboardingStatus: "pending",
          publications: [],
          keywords: [],
          influencers: [],
          companies: [],
        });
      }
      
      res.json(profile);
    } catch (error) {
      console.error("Error fetching profile:", error);
      res.status(500).json({ message: "Failed to fetch profile" });
    }
  });

  app.patch("/api/profile", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { focusDescription, publications, keywords, influencers, companies } = req.body;
      
      const existingProfile = await storage.getUserProfile(userId);
      if (!existingProfile) {
        return res.status(404).json({ message: "Profile not found" });
      }
      
      const updateData: any = {};
      if (focusDescription !== undefined) updateData.focusDescription = focusDescription;
      if (publications !== undefined) updateData.publications = publications;
      if (keywords !== undefined) updateData.keywords = keywords;
      if (influencers !== undefined) updateData.influencers = influencers;
      if (companies !== undefined) updateData.companies = companies;
      
      const profile = await storage.updateUserProfile(userId, updateData);
      
      res.json(profile);
    } catch (error) {
      console.error("Error updating profile:", error);
      res.status(500).json({ message: "Failed to update profile" });
    }
  });

  app.post("/api/profile/complete-onboarding", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      
      const validation = completeOnboardingSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ message: "Invalid request data", errors: validation.error.errors });
      }
      
      const { focusDescription, publications, keywords, influencers, companies } = validation.data;

      let profile = await storage.getUserProfile(userId);
      
      if (!profile) {
        profile = await storage.createUserProfile({
          userId,
          focusDescription,
          onboardingStatus: "completed",
          publications: publications || [],
          keywords: keywords || [],
          influencers: influencers || [],
          companies: companies || [],
        });
      } else {
        profile = await storage.updateUserProfile(userId, {
          focusDescription,
          onboardingStatus: "completed",
          publications: publications || [],
          keywords: keywords || [],
          influencers: influencers || [],
          companies: companies || [],
        });
      }

      res.json(profile);
    } catch (error) {
      console.error("Error completing onboarding:", error);
      res.status(500).json({ message: "Failed to complete onboarding" });
    }
  });

  app.post("/api/ai/analyze-identity", isAuthenticated, async (req: any, res) => {
    try {
      const { focusDescription } = req.body;
      
      if (!focusDescription || focusDescription.length < 10) {
        return res.status(400).json({ message: "Please provide a description of at least 10 characters" });
      }
      
      const analysis = await analyzeProfessionalIdentity(focusDescription);
      
      res.json({
        primaryIndustry: analysis.primaryIndustry,
        confidence: analysis.confidence,
        subDomains: analysis.subDomains,
        keywords: analysis.keywords.slice(0, 20),
        publications: analysis.publications.slice(0, 20).map(p => p.name),
        topics: analysis.topics.slice(0, 20).map(t => t.phrase),
        personalities: analysis.personalities.slice(0, 20).map(p => p.name),
        companies: analysis.companies.slice(0, 20).map(c => c.name),
      });
    } catch (error) {
      console.error("Error analyzing identity:", error);
      res.status(500).json({ message: "Failed to analyze professional identity" });
    }
  });

  app.post("/api/ai/generate-post", isAuthenticated, async (req: any, res) => {
    try {
      const { headline, summary, source, platform, tone } = req.body;
      
      if (!headline || !platform || !tone) {
        return res.status(400).json({ message: "Missing required fields" });
      }
      
      const content = await generatePostContent(
        { headline, summary: summary || "", source: source || "" },
        platform as "linkedin" | "twitter",
        tone
      );
      
      res.json({ content });
    } catch (error) {
      console.error("Error generating post:", error);
      res.status(500).json({ message: "Failed to generate post content" });
    }
  });

  app.get("/api/inbox", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const items = await storage.getInboxItems(userId);
      res.json(items);
    } catch (error) {
      console.error("Error fetching inbox:", error);
      res.status(500).json({ message: "Failed to fetch inbox" });
    }
  });

  app.post("/api/inbox/refresh", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      
      const profile = await storage.getUserProfile(userId);
      if (!profile) {
        return res.status(400).json({ message: "Profile not found. Please complete onboarding first." });
      }
      
      const keywords = profile.keywords || [];
      const publications = profile.publications || [];
      
      if (keywords.length === 0) {
        return res.status(400).json({ message: "No keywords configured. Please update your profile." });
      }

      const existingItems = await storage.getInboxItems(userId);
      const activeCount = existingItems.filter(item => item.status === "active").length;
      
      if (activeCount >= 10) {
        return res.json({ 
          message: "You have enough articles to review. Save or dismiss some before refreshing.", 
          count: 0, 
          items: [] 
        });
      }
      
      const numToCreate = Math.min(4, 10 - activeCount);
      
      const articles = await generateArticleMatches(keywords, publications, numToCreate);
      
      const createdItems = [];
      for (const article of articles) {
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
      
      res.json({ message: "Inbox refreshed successfully", count: createdItems.length, items: createdItems });
    } catch (error) {
      console.error("Error refreshing inbox:", error);
      res.status(500).json({ message: "Failed to refresh inbox" });
    }
  });

  app.patch("/api/inbox/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
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

  app.get("/api/drafts", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const userDrafts = await storage.getDrafts(userId);
      res.json(userDrafts);
    } catch (error) {
      console.error("Error fetching drafts:", error);
      res.status(500).json({ message: "Failed to fetch drafts" });
    }
  });

  app.post("/api/drafts", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      
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

  app.patch("/api/drafts/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
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

  app.delete("/api/drafts/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { id } = req.params;
      await storage.deleteDraft(id, userId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting draft:", error);
      res.status(500).json({ message: "Failed to delete draft" });
    }
  });

  return httpServer;
}
