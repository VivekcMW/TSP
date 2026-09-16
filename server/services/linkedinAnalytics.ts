import { storage, type TenantScope } from "../storage";
import { decryptStoredCredential } from "./webhookSecrets";

export async function syncLinkedInAnalytics(scope: TenantScope) {
  const account = await storage.getSocialAccountByProvider(scope, "linkedin");
  if (!account?.accessToken) throw new Error("LinkedIn is not connected");

  const response = await fetch("https://api.linkedin.com/v2/userinfo", {
    headers: { Authorization: `Bearer ${decryptStoredCredential(account.accessToken)}`, Accept: "application/json" },
  });
  const profile = await response.json().catch(() => ({})) as { sub?: string; name?: string; picture?: string };
  if (!response.ok || !profile.sub) throw new Error(`LinkedIn profile sync failed (${response.status})`);

  await storage.updateSocialAccount(scope, account.id, {
    accountName: profile.name || account.accountName,
    profileImageUrl: profile.picture || account.profileImageUrl,
    lastSyncAt: new Date(),
  });

  // LinkedIn's basic OIDC profile endpoint does not provide audience or
  // engagement metrics. Store a truthful snapshot rather than fake metrics;
  // organization/member analytics require separately approved API products.
  return storage.createSocialAnalytics(scope, {
    socialAccountId: account.id,
    provider: "linkedin",
    snapshotDate: new Date(),
    metrics: { followers: 0, following: 0, posts: 0, impressions: 0, engagements: 0, engagementRate: 0, likes: 0, comments: 0, shares: 0, clicks: 0 },
    topPosts: [],
  });
}
