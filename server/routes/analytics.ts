import type { Express } from "express";
import { authedOf, requireDbUser } from "../middlewares/requireDbUser";
import { requirePermission } from "../middlewares/requirePermission";
import { storage } from "../storage";

export function registerAnalyticsRoutes(app: Express) {
  app.get("/api/analytics/summary", requireDbUser, requirePermission("analytics:read:own"), async (req, res) => {
    try {
      const { dbUser, tenant: scope } = authedOf(req);
      const userId = dbUser.id;
      const accounts = await storage.getSocialAccounts(scope);
      
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
          
          const latest = await storage.getLatestSocialAnalytics(scope, account.provider);
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

  app.get("/api/analytics/:provider", requireDbUser, requirePermission("analytics:read:own"), async (req, res) => {
    try {
      const { dbUser, tenant: scope } = authedOf(req);
      const userId = dbUser.id;
      const { provider } = req.params;
      const daysBack = parseInt(req.query.days as string) || 30;
      
      if (!["linkedin", "twitter"].includes(provider)) {
        return res.status(400).json({ message: "Invalid provider" });
      }
      
      const account = await storage.getSocialAccountByProvider(scope, provider);
      if (!account) {
        return res.status(404).json({ message: `No ${provider} account connected` });
      }
      
      const analytics = await storage.getSocialAnalytics(scope, provider, daysBack);
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
}
