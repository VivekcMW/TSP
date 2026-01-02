import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { isAuthenticated, registerAuthRoutes, setupAuth } from "./replit_integrations/auth";
import { z } from "zod";
import { db } from "./db";
import { users } from "@shared/models/auth";
import { eq } from "drizzle-orm";
import { analyzeProfessionalIdentity, generateArticleMatches, generatePostContent, generateInstantReview } from "./services/punditBrain";
import { sendWelcomeEmail } from "./services/emailService";
import { getHotTrends } from "./services/rssService";
import { fetchArticleFromUrl } from "./services/urlFetcher";
import { validateUrl, validateUrlSync } from "./services/urlValidator";
import { engineRegistry } from "./services/engines/index.js";
import { selectIndustryEngine, getAvailableVerticals, normalizeIndustryToSlug } from "./services/metaEngine";
import type { IndustrySlug } from "@shared/schema";

const completeOnboardingSchema = z.object({
  focusDescription: z.string().min(10).max(150).optional(),
  publications: z.array(z.string()).max(20).optional(),
  keywords: z.array(z.string()).max(20).optional(),
  influencers: z.array(z.string()).max(20).optional(),
  companies: z.array(z.string()).max(20).optional(),
  recommendedIndustry: z.string().optional(),
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
  country: z.string().min(1).max(100),
  industry: z.string().min(1).max(100),
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
      
      const { firstName, lastName, country, industry } = validation.data;
      
      const [updatedUser] = await db
        .update(users)
        .set({
          firstName,
          lastName,
          country,
          industry,
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
      
      const { focusDescription, publications, keywords, influencers, companies, recommendedIndustry } = validation.data;

      if (recommendedIndustry) {
        await db.update(users).set({ industry: recommendedIndustry }).where(eq(users.id, userId));
        console.log(`[Onboarding] Updated user ${userId} industry to: ${recommendedIndustry}`);
      }

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

      const industryToUse = (recommendedIndustry || "other") as IndustrySlug;
      const engine = engineRegistry.getEngine(industryToUse);
      
      res.json({
        ...profile,
        assignedEngine: {
          industry: industryToUse,
          displayName: engine.config.displayName,
        },
      });
    } catch (error) {
      console.error("Error completing onboarding:", error);
      res.status(500).json({ message: "Failed to complete onboarding" });
    }
  });

  app.post("/api/ai/analyze-identity", isAuthenticated, async (req: any, res) => {
    try {
      const { focusDescription, selectedIndustry } = req.body;
      
      if (!focusDescription || focusDescription.length < 10) {
        return res.status(400).json({ message: "Please provide a description of at least 10 characters" });
      }
      
      const [analysis, engineSelection] = await Promise.all([
        analyzeProfessionalIdentity(focusDescription),
        selectIndustryEngine(selectedIndustry || "Other", focusDescription),
      ]);
      
      res.json({
        primaryIndustry: analysis.primaryIndustry,
        confidence: analysis.confidence,
        subDomains: analysis.subDomains,
        keywords: analysis.keywords.slice(0, 20),
        publications: analysis.publications.slice(0, 20).map(p => p.name),
        topics: analysis.topics.slice(0, 20).map(t => t.phrase),
        personalities: analysis.personalities.slice(0, 20).map(p => p.name),
        companies: analysis.companies.slice(0, 20).map(c => c.name),
        recommendedEngine: {
          industry: engineSelection.recommendedIndustry,
          displayName: engineSelection.engineDisplayName,
          confidence: engineSelection.confidence,
          reasoning: engineSelection.reasoning,
          matchedSignals: engineSelection.matchedSignals,
        },
      });
    } catch (error) {
      console.error("Error analyzing identity:", error);
      res.status(500).json({ message: "Failed to analyze professional identity" });
    }
  });

  app.post("/api/ai/select-engine", isAuthenticated, async (req: any, res) => {
    try {
      const { selectedIndustry, focusDescription } = req.body;
      
      if (!focusDescription || focusDescription.length < 10) {
        return res.status(400).json({ message: "Please provide a description of at least 10 characters" });
      }
      
      const result = await selectIndustryEngine(selectedIndustry || "Other", focusDescription);
      
      res.json(result);
    } catch (error) {
      console.error("Error selecting engine:", error);
      res.status(500).json({ message: "Failed to select industry engine" });
    }
  });

  app.get("/api/verticals", async (_req, res) => {
    try {
      const verticals = getAvailableVerticals();
      res.json(verticals);
    } catch (error) {
      console.error("Error fetching verticals:", error);
      res.status(500).json({ message: "Failed to fetch verticals" });
    }
  });

  app.post("/api/ai/generate-post", isAuthenticated, async (req: any, res) => {
    try {
      const { headline, summary, source, articleUrl, platform, tone } = req.body;
      
      if (!headline || !platform || !tone) {
        return res.status(400).json({ message: "Missing required fields" });
      }
      
      const content = await generatePostContent(
        { headline, summary: summary || "", source: source || "", articleUrl: articleUrl || "" },
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

  app.get("/api/engines", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      const industry = normalizeIndustryToSlug(user?.industry);
      
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

  app.get("/api/trends", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      const industry = normalizeIndustryToSlug(user?.industry);
      
      const engine = engineRegistry.getEngine(industry);
      const trends = await engine.getHotTrends(5);
      res.json(trends);
    } catch (error) {
      console.error("Error fetching trends:", error);
      res.status(500).json({ message: "Failed to fetch trends" });
    }
  });

  app.post("/api/inbox/refresh", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      
      const profile = await storage.getUserProfile(userId);
      if (!profile) {
        return res.status(400).json({ message: "Profile not found. Please complete onboarding first." });
      }
      
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      const industry = normalizeIndustryToSlug(user?.industry);
      
      const engine = engineRegistry.getEngine(industry);
      console.log(`[Inbox Refresh] Using ${engine.config.displayName} engine for user ${userId}`);
      
      const existingItems = await storage.getInboxItems(userId);
      const activeCount = existingItems.filter(item => item.status === "active").length;
      
      if (activeCount >= 10) {
        return res.json({ 
          message: "You have enough articles to review. Save or dismiss some before refreshing.", 
          count: 0, 
          items: [],
          engine: engine.config.displayName,
        });
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

  app.post("/api/inbox/add-trend", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
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

  app.post("/api/instant-review", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
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

  // Test endpoint for sending welcome email (remove in production)
  app.post("/api/test/welcome-email", async (req, res) => {
    try {
      const { email, firstName } = req.body;
      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }
      const result = await sendWelcomeEmail(email, firstName || "Test User");
      res.json(result);
    } catch (error: any) {
      console.error("Error sending test email:", error);
      res.status(500).json({ message: error.message || "Failed to send email" });
    }
  });

  // Test Mode Endpoints (development only)
  const isDev = process.env.NODE_ENV !== "production";
  
  if (isDev) {
    // Quick test login - creates or finds test user and logs them in
    app.post("/api/test/login", async (req: any, res) => {
      try {
        const testEmail = "test@thesocialpundit.com";
        
        // Find or create test user
        let [testUser] = await db.select().from(users).where(eq(users.email, testEmail));
        
        if (!testUser) {
          [testUser] = await db.insert(users).values({
            email: testEmail,
            firstName: "Test",
            lastName: "User",
            country: "United States",
            industry: "media_advertising",
            registrationCompleted: new Date(),
          }).returning();
          
          // Create initial profile
          await storage.createUserProfile({
            userId: testUser.id,
            onboardingStatus: "completed",
            focusDescription: "Digital marketing and social media strategy expert",
            publications: ["TechCrunch", "Marketing Week", "AdAge"],
            keywords: ["digital marketing", "social media", "content strategy", "brand building"],
            influencers: ["Gary Vaynerchuk", "Neil Patel", "Seth Godin"],
            companies: ["Google", "Meta", "HubSpot"],
          });
        }
        
        // Use passport's req.login to properly establish the session
        req.login(testUser, (err: any) => {
          if (err) {
            console.error("Test login session error:", err);
            return res.status(500).json({ message: "Failed to establish session" });
          }
          
          res.json({ 
            success: true, 
            message: "Test user logged in",
            user: {
              id: testUser.id,
              email: testUser.email,
              firstName: testUser.firstName,
              lastName: testUser.lastName,
            }
          });
        });
      } catch (error) {
        console.error("Error in test login:", error);
        res.status(500).json({ message: "Test login failed" });
      }
    });
    
    // Reset test user data
    app.post("/api/test/reset", isAuthenticated, async (req: any, res) => {
      try {
        const userId = req.user.claims.sub;
        
        // Clear inbox items
        await storage.clearUserInboxItems(userId);
        
        // Clear drafts
        await storage.clearUserDrafts(userId);
        
        // Reset profile to initial state
        await storage.updateUserProfile(userId, {
          focusDescription: null,
          onboardingStatus: "pending",
          publications: [],
          keywords: [],
          influencers: [],
          companies: [],
        });
        
        res.json({ success: true, message: "Test data reset successfully" });
      } catch (error) {
        console.error("Error resetting test data:", error);
        res.status(500).json({ message: "Failed to reset test data" });
      }
    });
    
    // Populate demo data
    app.post("/api/test/demo-data", isAuthenticated, async (req: any, res) => {
      try {
        const userId = req.user.claims.sub;
        
        // Update profile with demo data
        await storage.updateUserProfile(userId, {
          focusDescription: "Marketing technology leader focused on AI-driven content strategies",
          onboardingStatus: "completed",
          publications: ["TechCrunch", "Marketing Week", "AdAge", "The Drum", "Digiday"],
          keywords: ["AI marketing", "content automation", "social media strategy", "brand voice", "thought leadership"],
          influencers: ["Gary Vaynerchuk", "Neil Patel", "Ann Handley", "Joe Pulizzi"],
          companies: ["HubSpot", "Salesforce", "Adobe", "Canva"],
        });
        
        // Clear existing and add demo inbox items
        await storage.clearUserInboxItems(userId);
        
        const demoArticles = [
          {
            userId,
            headline: "AI Is Transforming How Brands Create Content at Scale",
            source: "TechCrunch",
            articleUrl: "https://techcrunch.com/ai-content-marketing",
            summary: "New AI tools are enabling marketing teams to produce personalized content 10x faster while maintaining brand consistency.",
            matchedKeywords: ["AI marketing", "content automation"],
            status: "active" as const,
          },
          {
            userId,
            headline: "The Death of Generic Social Media Posts",
            source: "Marketing Week",
            articleUrl: "https://marketingweek.com/social-media-personalization",
            summary: "Audiences are demanding authentic voices. Here's how top brands are adapting their social strategies.",
            matchedKeywords: ["social media strategy", "brand voice"],
            status: "active" as const,
          },
          {
            userId,
            headline: "Why Your LinkedIn Strategy Needs a Complete Overhaul in 2026",
            source: "AdAge",
            articleUrl: "https://adage.com/linkedin-strategy-2026",
            summary: "Algorithm changes and new features mean the old playbook no longer works. Industry experts share what's working now.",
            matchedKeywords: ["thought leadership", "social media strategy"],
            status: "active" as const,
          },
          {
            userId,
            headline: "Building Authority Through Consistent Thought Leadership",
            source: "The Drum",
            articleUrl: "https://thedrum.com/thought-leadership-guide",
            summary: "A comprehensive guide to establishing yourself as an industry voice through strategic content creation.",
            matchedKeywords: ["thought leadership", "content automation"],
            status: "saved" as const,
          },
        ];
        
        for (const article of demoArticles) {
          await storage.createInboxItem(article);
        }
        
        // Clear and add demo drafts
        await storage.clearUserDrafts(userId);
        
        const demoDrafts = [
          {
            userId,
            platform: "linkedin" as const,
            tone: "professional" as const,
            content: "The future of content marketing isn't about creating more—it's about creating smarter.\n\nI've been experimenting with AI tools for the past 6 months, and here's what I've learned:\n\n1. AI doesn't replace creativity, it amplifies it\n2. The best results come from human-AI collaboration\n3. Authenticity still wins over volume\n\nWhat's your experience with AI in your content workflow?",
            status: "draft" as const,
          },
          {
            userId,
            platform: "twitter" as const,
            tone: "contrarian" as const,
            content: "Hot take: Most \"thought leaders\" on LinkedIn are just repeating the same tired advice.\n\nThe real authority builders? They're sharing genuine failures, not polished success stories.\n\nStop performing expertise. Start demonstrating it.",
            status: "draft" as const,
          },
        ];
        
        for (const draft of demoDrafts) {
          await storage.createDraft(draft);
        }
        
        res.json({ 
          success: true, 
          message: "Demo data populated successfully",
          data: {
            articlesAdded: demoArticles.length,
            draftsAdded: demoDrafts.length,
          }
        });
      } catch (error) {
        console.error("Error populating demo data:", error);
        res.status(500).json({ message: "Failed to populate demo data" });
      }
    });
    
    // Check if test mode is available
    app.get("/api/test/status", (req, res) => {
      res.json({ testMode: true, environment: "development" });
    });
  }

  return httpServer;
}
