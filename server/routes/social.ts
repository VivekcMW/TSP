import type { Express } from "express";
import { toSafeSocialAccount } from "../lib/sanitize";
import { authedOf, requireDbUser } from "../middlewares/requireDbUser";
import { requirePermission } from "../middlewares/requirePermission";
import { storage } from "../storage";
import { users } from "@shared/models/auth";
import { syncLinkedInAnalytics } from "../services/linkedinAnalytics";

export function registerSocialRoutes(app: Express) {
  app.get("/api/social/connections", requireDbUser, requirePermission("social:read:own"), async (req, res) => {
    try {
      const { dbUser, tenant: scope } = authedOf(req);
      const userId = dbUser.id;
      const accounts = await storage.getSocialAccounts(scope);
      res.json(accounts.map(toSafeSocialAccount));
    } catch (error) {
      console.error("Error fetching social connections:", error);
      res.status(500).json({ message: "Failed to fetch social connections" });
    }
  });

  // Disconnect a social account

  app.delete("/api/social/disconnect/:provider", requireDbUser, requirePermission("social:connect:own"), async (req, res) => {
    try {
      const { dbUser, tenant: scope } = authedOf(req);
      const userId = dbUser.id;
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

  app.post("/api/social/sync/:provider", requireDbUser, requirePermission("social:connect:own"), async (req, res) => {
    try {
      const { dbUser, tenant: scope } = authedOf(req);
      const userId = dbUser.id;
      const { provider } = req.params;
      
      const account = await storage.getSocialAccountByProvider(scope, provider);
      if (!account) {
        return res.status(404).json({ message: `No ${provider} account connected` });
      }
      
      if (provider !== "linkedin") return res.status(400).json({ message: `Real analytics sync is not implemented for ${provider}` });
      const analytics = await syncLinkedInAnalytics(scope);
      
      res.json({ 
        success: true, 
        analytics,
        message: "LinkedIn profile synced successfully. Engagement metrics require additional LinkedIn API access." 
      });
    } catch (error) {
      console.error("Error syncing social analytics:", error);
      res.status(500).json({ message: "Failed to sync analytics" });
    }
  });

  // Get combined analytics summary
}
