import type { Express } from "express";
import { toSafeSocialAccount } from "../lib/sanitize";
import { requireDbUser } from "../middlewares/requireDbUser";
import { storage } from "../storage";
import { users } from "@shared/models/auth";

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

export function registerSocialRoutes(app: Express) {
  app.get("/api/social/connections", requireDbUser, async (req: any, res) => {
    try {
      const userId = req.dbUser.id;
      const scope = req.tenant;
      const accounts = await storage.getSocialAccounts(scope);
      res.json(accounts.map(toSafeSocialAccount));
    } catch (error) {
      console.error("Error fetching social connections:", error);
      res.status(500).json({ message: "Failed to fetch social connections" });
    }
  });

  // Connect a social account (creates with demo data for now)

  app.post("/api/social/connect/:provider", requireDbUser, async (req: any, res) => {
    try {
      const userId = req.dbUser.id;
      const scope = req.tenant;
      const { provider } = req.params;
      
      if (!["linkedin", "twitter"].includes(provider)) {
        return res.status(400).json({ message: "Invalid provider. Must be 'linkedin' or 'twitter'" });
      }
      
      // Check if already connected
      const existing = await storage.getSocialAccountByProvider(scope, provider);
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
      const account = await storage.createSocialAccount(scope, {
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
      await storage.createSocialAnalytics(scope, {
        socialAccountId: account.id,
        provider,
        snapshotDate: new Date(),
        metrics: demoMetrics.metrics,
        topPosts: demoMetrics.topPosts,
      });
      
      res.json({ 
        success: true, 
        account: toSafeSocialAccount(account),
        message: `${provider} account connected successfully` 
      });
    } catch (error) {
      console.error("Error connecting social account:", error);
      res.status(500).json({ message: "Failed to connect social account" });
    }
  });

  // Disconnect a social account

  app.delete("/api/social/disconnect/:provider", requireDbUser, async (req: any, res) => {
    try {
      const userId = req.dbUser.id;
      const scope = req.tenant;
      const { provider } = req.params;
      
      const account = await storage.getSocialAccountByProvider(scope, provider);
      if (!account) {
        return res.status(404).json({ message: `No ${provider} account connected` });
      }
      
      await storage.deleteSocialAccount(scope, account.id);
      res.json({ success: true, message: `${provider} account disconnected` });
    } catch (error) {
      console.error("Error disconnecting social account:", error);
      res.status(500).json({ message: "Failed to disconnect social account" });
    }
  });

  // Sync analytics data for a provider

  app.post("/api/social/sync/:provider", requireDbUser, async (req: any, res) => {
    try {
      const userId = req.dbUser.id;
      const scope = req.tenant;
      const { provider } = req.params;
      
      const account = await storage.getSocialAccountByProvider(scope, provider);
      if (!account) {
        return res.status(404).json({ message: `No ${provider} account connected` });
      }
      
      // Generate new demo analytics data
      const demoMetrics = generateDemoMetrics(provider);
      const analytics = await storage.createSocialAnalytics(scope, {
        socialAccountId: account.id,
        provider,
        snapshotDate: new Date(),
        metrics: demoMetrics.metrics,
        topPosts: demoMetrics.topPosts,
      });
      
      // Update last sync time
      await storage.updateSocialAccount(scope, account.id, { lastSyncAt: new Date() });
      
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
}
