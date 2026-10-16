import { storage, type TenantScope } from "../storage";
import { decryptStoredCredential } from "./webhookSecrets";
import { linkedInProfileOnlySnapshot, parseLinkedInAnalyticsProfile } from "./linkedinAnalyticsProfile";

export async function syncLinkedInAnalytics(scope: TenantScope) {
  const account = await storage.getSocialAccountByProvider(scope, "linkedin");
  if (!account?.accessToken || !account.isActive) throw new Error("LinkedIn is not connected");

  const response = await fetch("https://api.linkedin.com/v2/userinfo", {
    headers: { Authorization: `Bearer ${decryptStoredCredential(account.accessToken)}`, Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`LinkedIn profile sync failed (${response.status})`);
  const profile = parseLinkedInAnalyticsProfile(await response.json().catch(() => null));
  if (profile.sub !== account.providerAccountId) throw new Error("LinkedIn profile does not match the connected account");
  const syncedAt = new Date();

  await storage.updateSocialAccount(scope, account.id, {
    accountName: profile.name || account.accountName,
    profileImageUrl: profile.picture || account.profileImageUrl,
    lastSyncAt: syncedAt,
  });

  // Profile synchronization is not a metric measurement.
  return storage.createSocialAnalytics(scope, linkedInProfileOnlySnapshot(account.id, syncedAt));
}
