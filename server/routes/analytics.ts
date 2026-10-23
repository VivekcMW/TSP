import type { Express } from "express";
import { authedOf, requireDbUser } from "../middlewares/requireDbUser";
import { requirePermission } from "../middlewares/requirePermission";
import { storage } from "../storage";
import { analyticsInstant, combineAnalytics, normalizeAnalytics, unavailableAnalytics, type AnalyticsProviderSummary, type AnalyticsSummary } from "@shared/analytics-availability";
import type { SocialAccount, SocialAnalyticsSnapshot } from "@shared/schema";

function accountView(account: SocialAccount) {
  return { id: account.id, name: account.accountName, handle: account.accountHandle, lastSync: analyticsInstant(account.lastSyncAt) };
}

function snapshotView(account: SocialAccount, snapshot?: SocialAnalyticsSnapshot): AnalyticsProviderSummary {
  const matches = !snapshot || (snapshot.tenantId === account.tenantId && snapshot.userId === account.userId &&
    snapshot.socialAccountId === account.id && snapshot.provider === account.provider);
  return {
    account: accountView(account),
    ...(matches ? normalizeAnalytics(snapshot) : unavailableAnalytics("account_mismatch")),
    snapshotDate: matches ? analyticsInstant(snapshot?.snapshotDate) : null,
    topPosts: null,
  };
}

export function registerAnalyticsRoutes(app: Express) {
  app.get("/api/analytics/summary", requireDbUser, requirePermission("analytics:read:own"), async (req, res) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      const { tenant: scope } = authedOf(req);
      const accounts = await storage.getSocialAccounts(scope);
      if (!Array.isArray(accounts)) throw new Error("Invalid account result");
      const empty = combineAnalytics([]);
      const summary: AnalyticsSummary = { connected: { linkedin: false, twitter: false }, combined: empty.metrics,
        availability: empty.availability, linkedin: null, twitter: null, lastSync: null };
      const results: AnalyticsProviderSummary[] = [];
      for (const provider of ["linkedin", "twitter"] as const) {
        const owned = accounts.filter(account => account.provider === provider && account.isActive &&
          account.tenantId === scope.tenantId && account.userId === scope.userId);
        if (!owned.length) continue;
        summary.connected[provider] = true;
        for (const account of owned) {
          let view: AnalyticsProviderSummary;
          try {
            view = snapshotView(account, await storage.getLatestSocialAnalytics(scope, provider));
          } catch {
            view = { ...snapshotView(account), ...unavailableAnalytics("fetch_failed") };
          }
          results.push(view);
          // The connection UI has one row per provider. Coverage still includes all accounts.
          summary[provider] ??= view;
          if (view.account.lastSync && (!summary.lastSync || view.account.lastSync > summary.lastSync)) summary.lastSync = view.account.lastSync;
        }
      }
      const combined = combineAnalytics(results);
      summary.combined = combined.metrics;
      summary.availability = combined.availability;
      res.json(summary);
    } catch {
      console.error("Error fetching analytics summary");
      res.status(500).json({ message: "Failed to fetch analytics summary" });
    }
  });

  // Get provider-specific analytics with history

  app.get("/api/analytics/:provider", requireDbUser, requirePermission("analytics:read:own"), async (req, res) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      const { tenant: scope } = authedOf(req);
      const { provider } = req.params;
      const rawDays = req.query.days;
      if (rawDays !== undefined && (typeof rawDays !== "string" || !/^\d+$/.test(rawDays) || Number(rawDays) < 1 || Number(rawDays) > 365)) {
        return res.status(400).json({ message: "days must be an integer from 1 to 365" });
      }
      const daysBack = rawDays === undefined ? 30 : Number(rawDays);
      
      if (!["linkedin", "twitter"].includes(provider)) {
        return res.status(400).json({ message: "Invalid provider" });
      }
      
      const account = await storage.getSocialAccountByProvider(scope, provider);
      if (!account?.isActive || account.tenantId !== scope.tenantId || account.userId !== scope.userId || account.provider !== provider) {
        return res.status(404).json({ message: `No ${provider} account connected` });
      }
      
      const analytics = await storage.getSocialAnalytics(scope, provider, daysBack);
      if (!Array.isArray(analytics)) throw new Error("Invalid analytics result");
      const now = new Date();
      const history = analytics.filter(snapshot => snapshot.tenantId === scope.tenantId && snapshot.userId === scope.userId &&
        snapshot.socialAccountId === account.id && snapshot.provider === provider)
        .map(snapshot => snapshotView(account, snapshot))
        .filter(snapshot => snapshot.snapshotDate !== null && snapshot.snapshotDate <= now.toISOString())
        .sort((a, b) => b.snapshotDate!.localeCompare(a.snapshotDate!));
      res.json({
        account: { ...accountView(account), isActive: account.isActive },
        current: history[0] ?? { ...snapshotView(account), ...unavailableAnalytics(analytics.length ? "invalid_provenance" : "no_snapshot") },
        history: history.map(({ account: _account, snapshotDate, ...snapshot }) => ({ ...snapshot, date: snapshotDate })),
        historyCoverage: { days: daysBack, returnedSnapshots: history.length, excludedSnapshots: analytics.length - history.length },
      });
    } catch {
      console.error("Error fetching provider analytics");
      res.status(500).json({ message: "Failed to fetch analytics" });
    }
  });
}
