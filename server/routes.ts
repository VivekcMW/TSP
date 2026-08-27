import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { requireAuth } from "./middlewares/requireAuth";
import { registerLinkedInAnalyticsAuth } from "./services/linkedinAnalyticsAuth";
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
  focusDescription: z.string().min(10).max(500).optional(),
  publications: z.array(z.string()).max(20).optional(),
  keywords: z.array(z.string()).max(20).optional(),
  influencers: z.array(z.string()).max(20).optional(),
  companies: z.array(z.string()).max(20).optional(),
  recommendedIndustry: z.string().optional(),
});

// Helper to sanitize onboarding data - truncates strings and arrays to prevent validation errors
function sanitizeOnboardingData(data: any) {
  return {
    ...data,
    focusDescription: data.focusDescription?.slice(0, 500),
    publications: data.publications?.slice(0, 20),
    keywords: data.keywords?.slice(0, 20),
    influencers: data.influencers?.slice(0, 20),
    companies: data.companies?.slice(0, 20),
  };
}

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
  registerLinkedInAnalyticsAuth(app, requireAuth);

  app.get("/api/me", requireAuth, (req: any, res) => {
    res.json(req.dbUser);
  });

  app.post("/api/complete-registration", requireAuth, async (req: any, res) => {
    try {
      const userId = req.dbUser.id;

      const validation = completeRegistrationSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ message: "Invalid request data", errors: validation.error.errors });
      }
      
      const { firstName, lastName, country, industry } = validation.data;
      
      // First check if user exists
      const [existingUser] = await db.select().from(users).where(eq(users.id, userId));
      
      if (!existingUser) {
        console.error("User not found for complete-registration:", userId);
        return res.status(404).json({ message: "User account not found. Please register again." });
      }
      
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
      
      // Send industry-customized welcome email
      if (updatedUser?.email) {
        sendWelcomeEmail(updatedUser.email, firstName, industry).catch((err) => {
          console.error("Failed to send welcome email:", err);
        });
      }
      
      res.json(updatedUser);
    } catch (error) {
      console.error("Error completing registration:", error);
      res.status(500).json({ message: "Failed to complete registration" });
    }
  });

  app.get("/api/profile", requireAuth, async (req: any, res) => {
    try {
      const userId = req.dbUser.id;
      
      if (!userId) {
        console.error("No user ID found in request");
        return res.status(401).json({ message: "User not authenticated" });
      }
      
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

  app.patch("/api/profile", requireAuth, async (req: any, res) => {
    try {
      const userId = req.dbUser.id;
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

  app.post("/api/profile/complete-onboarding", requireAuth, async (req: any, res) => {
    try {
      const userId = req.dbUser.id;
      
      // Sanitize data before validation to prevent truncation errors
      const sanitizedBody = sanitizeOnboardingData(req.body);
      
      const validation = completeOnboardingSchema.safeParse(sanitizedBody);
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

  app.post("/api/ai/analyze-identity", requireAuth, async (req: any, res) => {
    try {
      const { focusDescription, selectedIndustry } = req.body;
      
      if (!focusDescription || focusDescription.length < 10) {
        return res.status(400).json({ message: "Please provide a description of at least 10 characters" });
      }
      
      const industrySlug = normalizeIndustryToSlug(selectedIndustry);
      const [analysis, engineSelection] = await Promise.all([
        analyzeProfessionalIdentity(focusDescription, industrySlug),
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

  app.post("/api/ai/select-engine", requireAuth, async (req: any, res) => {
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

  app.post("/api/ai/generate-post", requireAuth, async (req: any, res) => {
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

  app.get("/api/inbox", requireAuth, async (req: any, res) => {
    try {
      const userId = req.dbUser.id;
      const items = await storage.getInboxItems(userId);
      res.json(items);
    } catch (error) {
      console.error("Error fetching inbox:", error);
      res.status(500).json({ message: "Failed to fetch inbox" });
    }
  });

  app.get("/api/engines", requireAuth, async (req: any, res) => {
    try {
      const userId = req.dbUser.id;
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

  app.get("/api/trends", requireAuth, async (req: any, res) => {
    try {
      const userId = req.dbUser.id;
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

  app.post("/api/inbox/refresh", requireAuth, async (req: any, res) => {
    try {
      const userId = req.dbUser.id;
      
      const profile = await storage.getUserProfile(userId);
      if (!profile) {
        return res.status(400).json({ message: "Profile not found. Please complete onboarding first." });
      }
      
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      const industry = normalizeIndustryToSlug(user?.industry);
      
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

  app.post("/api/inbox/add-trend", requireAuth, async (req: any, res) => {
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

  app.patch("/api/inbox/:id", requireAuth, async (req: any, res) => {
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

  app.get("/api/drafts", requireAuth, async (req: any, res) => {
    try {
      const userId = req.dbUser.id;
      const userDrafts = await storage.getDrafts(userId);
      res.json(userDrafts);
    } catch (error) {
      console.error("Error fetching drafts:", error);
      res.status(500).json({ message: "Failed to fetch drafts" });
    }
  });

  app.post("/api/drafts", requireAuth, async (req: any, res) => {
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

  app.patch("/api/drafts/:id", requireAuth, async (req: any, res) => {
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

  app.delete("/api/drafts/:id", requireAuth, async (req: any, res) => {
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

  app.post("/api/instant-review", requireAuth, async (req: any, res) => {
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
  app.get("/api/social/connections", requireAuth, async (req: any, res) => {
    try {
      const userId = req.dbUser.id;
      const accounts = await storage.getSocialAccounts(userId);
      res.json(accounts);
    } catch (error) {
      console.error("Error fetching social connections:", error);
      res.status(500).json({ message: "Failed to fetch social connections" });
    }
  });

  // Connect a social account (creates with demo data for now)
  app.post("/api/social/connect/:provider", requireAuth, async (req: any, res) => {
    try {
      const userId = req.dbUser.id;
      const { provider } = req.params;
      
      if (!["linkedin", "twitter"].includes(provider)) {
        return res.status(400).json({ message: "Invalid provider. Must be 'linkedin' or 'twitter'" });
      }
      
      // Check if already connected
      const existing = await storage.getSocialAccountByProvider(userId, provider);
      if (existing) {
        return res.status(400).json({ message: `${provider} account already connected` });
      }
      
      // Get user info for account name
      const user = await storage.getUser(userId);
      const accountName = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Demo User' : 'Demo User';
      const handle = provider === 'linkedin' 
        ? `@${(user?.firstName || 'demo').toLowerCase()}-${(user?.lastName || 'user').toLowerCase()}`
        : `@${(user?.firstName || 'demo').toLowerCase()}${Math.floor(Math.random() * 1000)}`;
      
      // Create social account with demo data
      const account = await storage.createSocialAccount({
        userId,
        provider,
        providerAccountId: `demo_${provider}_${Date.now()}`,
        accountName,
        accountHandle: handle,
        isActive: true,
        scopes: provider === 'linkedin' 
          ? ['r_liteprofile', 'r_organization_social'] 
          : ['tweet.read', 'users.read'],
        lastSyncAt: new Date(),
      });
      
      // Generate initial analytics snapshot with demo data
      const demoMetrics = generateDemoMetrics(provider);
      await storage.createSocialAnalytics({
        userId,
        socialAccountId: account.id,
        provider,
        snapshotDate: new Date(),
        metrics: demoMetrics.metrics,
        topPosts: demoMetrics.topPosts,
      });
      
      res.json({ 
        success: true, 
        account,
        message: `${provider} account connected successfully` 
      });
    } catch (error) {
      console.error("Error connecting social account:", error);
      res.status(500).json({ message: "Failed to connect social account" });
    }
  });

  // Disconnect a social account
  app.delete("/api/social/disconnect/:provider", requireAuth, async (req: any, res) => {
    try {
      const userId = req.dbUser.id;
      const { provider } = req.params;
      
      const account = await storage.getSocialAccountByProvider(userId, provider);
      if (!account) {
        return res.status(404).json({ message: `No ${provider} account connected` });
      }
      
      await storage.deleteSocialAccount(account.id, userId);
      res.json({ success: true, message: `${provider} account disconnected` });
    } catch (error) {
      console.error("Error disconnecting social account:", error);
      res.status(500).json({ message: "Failed to disconnect social account" });
    }
  });

  // Sync analytics data for a provider
  app.post("/api/social/sync/:provider", requireAuth, async (req: any, res) => {
    try {
      const userId = req.dbUser.id;
      const { provider } = req.params;
      
      const account = await storage.getSocialAccountByProvider(userId, provider);
      if (!account) {
        return res.status(404).json({ message: `No ${provider} account connected` });
      }
      
      // Generate new demo analytics data
      const demoMetrics = generateDemoMetrics(provider);
      const analytics = await storage.createSocialAnalytics({
        userId,
        socialAccountId: account.id,
        provider,
        snapshotDate: new Date(),
        metrics: demoMetrics.metrics,
        topPosts: demoMetrics.topPosts,
      });
      
      // Update last sync time
      await storage.updateSocialAccount(account.id, { lastSyncAt: new Date() });
      
      res.json({ 
        success: true, 
        analytics,
        message: `${provider} analytics synced successfully` 
      });
    } catch (error) {
      console.error("Error syncing social analytics:", error);
      res.status(500).json({ message: "Failed to sync analytics" });
    }
  });

  // Get combined analytics summary
  app.get("/api/analytics/summary", requireAuth, async (req: any, res) => {
    try {
      const userId = req.dbUser.id;
      const accounts = await storage.getSocialAccounts(userId);
      
      const summary: any = {
        connected: {
          linkedin: false,
          twitter: false,
        },
        combined: {
          followers: 0,
          following: 0,
          posts: 0,
          impressions: 0,
          engagements: 0,
          engagementRate: 0,
          likes: 0,
          comments: 0,
          shares: 0,
          clicks: 0,
        },
        linkedin: null,
        twitter: null,
        lastSync: null,
      };
      
      for (const account of accounts) {
        if (account.provider === 'linkedin' || account.provider === 'twitter') {
          summary.connected[account.provider] = true;
          
          const latest = await storage.getLatestSocialAnalytics(userId, account.provider);
          if (latest) {
            summary[account.provider] = {
              account: {
                name: account.accountName,
                handle: account.accountHandle,
                lastSync: account.lastSyncAt,
              },
              metrics: latest.metrics,
              topPosts: latest.topPosts,
            };
            
            // Add to combined totals
            const metrics = latest.metrics as any;
            summary.combined.followers += metrics.followers || 0;
            summary.combined.following += metrics.following || 0;
            summary.combined.posts += metrics.posts || 0;
            summary.combined.impressions += metrics.impressions || 0;
            summary.combined.engagements += metrics.engagements || 0;
            summary.combined.likes += metrics.likes || 0;
            summary.combined.comments += metrics.comments || 0;
            summary.combined.shares += metrics.shares || 0;
            summary.combined.clicks += metrics.clicks || 0;
            
            if (!summary.lastSync || (account.lastSyncAt && account.lastSyncAt > summary.lastSync)) {
              summary.lastSync = account.lastSyncAt;
            }
          }
        }
      }
      
      // Calculate combined engagement rate
      if (summary.combined.impressions > 0) {
        summary.combined.engagementRate = parseFloat(
          ((summary.combined.engagements / summary.combined.impressions) * 100).toFixed(2)
        );
      }
      
      res.json(summary);
    } catch (error) {
      console.error("Error fetching analytics summary:", error);
      res.status(500).json({ message: "Failed to fetch analytics summary" });
    }
  });

  // Get provider-specific analytics with history
  app.get("/api/analytics/:provider", requireAuth, async (req: any, res) => {
    try {
      const userId = req.dbUser.id;
      const { provider } = req.params;
      const daysBack = parseInt(req.query.days as string) || 30;
      
      if (!["linkedin", "twitter"].includes(provider)) {
        return res.status(400).json({ message: "Invalid provider" });
      }
      
      const account = await storage.getSocialAccountByProvider(userId, provider);
      if (!account) {
        return res.status(404).json({ message: `No ${provider} account connected` });
      }
      
      const analytics = await storage.getSocialAnalytics(userId, provider, daysBack);
      const latest = analytics[0] || null;
      
      res.json({
        account: {
          id: account.id,
          name: account.accountName,
          handle: account.accountHandle,
          lastSync: account.lastSyncAt,
          isActive: account.isActive,
        },
        current: latest ? {
          metrics: latest.metrics,
          topPosts: latest.topPosts,
          snapshotDate: latest.snapshotDate,
        } : null,
        history: analytics.map(a => ({
          date: a.snapshotDate,
          metrics: a.metrics,
        })),
      });
    } catch (error) {
      console.error("Error fetching provider analytics:", error);
      res.status(500).json({ message: "Failed to fetch analytics" });
    }
  });

  return httpServer;
}

// Helper function to generate demo metrics
function generateDemoMetrics(provider: string) {
  const baseFollowers = provider === 'linkedin' ? 2500 : 1800;
  const variance = () => Math.floor(Math.random() * 200) - 100;
  
  const metrics = {
    followers: baseFollowers + variance(),
    following: provider === 'linkedin' ? 450 + variance() : 320 + variance(),
    posts: 24 + Math.floor(Math.random() * 10),
    impressions: 12400 + Math.floor(Math.random() * 3000),
    engagements: 520 + Math.floor(Math.random() * 200),
    engagementRate: parseFloat((4.2 + Math.random() * 2).toFixed(2)),
    likes: 340 + Math.floor(Math.random() * 100),
    comments: 45 + Math.floor(Math.random() * 30),
    shares: 28 + Math.floor(Math.random() * 20),
    clicks: 156 + Math.floor(Math.random() * 50),
    profileViews: provider === 'linkedin' ? 89 + Math.floor(Math.random() * 40) : undefined,
  };
  
  const topPosts = [
    {
      postId: `post_${Date.now()}_1`,
      content: provider === 'linkedin' 
        ? "The future of B2B marketing isn't about more content—it's about better context. Here's what I learned from analyzing 500+ campaigns..."
        : "Hot take: Most SaaS companies are over-engineering their onboarding. Simple wins. Here's why...",
      impressions: 3200 + Math.floor(Math.random() * 1000),
      engagements: 180 + Math.floor(Math.random() * 50),
      likes: 120 + Math.floor(Math.random() * 30),
      comments: 24 + Math.floor(Math.random() * 10),
      shares: 18 + Math.floor(Math.random() * 8),
      postedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      postId: `post_${Date.now()}_2`,
      content: provider === 'linkedin'
        ? "Just shipped a major feature after 3 months of work. The key insight? Listen to users, not just their words, but their behaviors."
        : "Thread: 5 counterintuitive lessons from scaling to $10M ARR. Let's go...",
      impressions: 2800 + Math.floor(Math.random() * 800),
      engagements: 145 + Math.floor(Math.random() * 40),
      likes: 95 + Math.floor(Math.random() * 25),
      comments: 18 + Math.floor(Math.random() * 8),
      shares: 12 + Math.floor(Math.random() * 6),
      postedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      postId: `post_${Date.now()}_3`,
      content: provider === 'linkedin'
        ? "AI won't replace marketers. But marketers who use AI will replace those who don't. Here's my stack for 2026..."
        : "Unpopular opinion: Most productivity advice is just procrastination in disguise.",
      impressions: 2100 + Math.floor(Math.random() * 600),
      engagements: 98 + Math.floor(Math.random() * 30),
      likes: 72 + Math.floor(Math.random() * 20),
      comments: 12 + Math.floor(Math.random() * 6),
      shares: 8 + Math.floor(Math.random() * 4),
      postedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    },
  ];
  
  return { metrics, topPosts };
}
