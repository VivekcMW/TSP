import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { mediaAssets, platformIntegrations, publishingRules, socialAccounts, userProfiles, type Draft } from "@shared/schema";
import { publishingCapability, type PublishingIntent, type PublishingMode } from "@shared/publishing-capabilities";
import type { db } from "../db";
import type { TenantScope } from "../storage";
import { assertTenantEntitlement, EntitlementError } from "./entitlements";
import { assessProviderConnection } from "./publishers/providerLifecycle";
import { decryptStoredCredential } from "./webhookSecrets";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export class PublishingPolicyError extends Error {
  constructor(message: string, public readonly statusCode = 403, public readonly code = "publishing_policy") { super(message); }
}
export function configuredPublishingMode(): PublishingMode {
  const mode = process.env.PUBLISHING_MODE;
  if (!mode || mode === "sandbox") return "sandbox";
  if (mode === "live" || mode === "dry-run") return mode;
  throw new PublishingPolicyError("Publishing mode is unavailable.", 503);
}
export function reviewFingerprint(draft: Pick<Draft, "content" | "media" | "platformPublishRules">): string {
  return createHash("sha256").update(JSON.stringify([draft.content, draft.media ?? [], draft.platformPublishRules ?? {}])).digest("hex");
}

/** Called under the owned draft lock at admission and again after worker claim.
 * Entitlement resolution remains authoritative in billing; no invented tier rules.
 */
export async function assertPublishingPolicy(tx: Tx, scope: TenantScope, draft: Draft, platforms: string[], intent: PublishingIntent, mode: PublishingMode): Promise<void> {
  if (draft.tenantId !== scope.tenantId || draft.userId !== scope.userId) throw new PublishingPolicyError("Draft is unavailable.", 404);
  if (!platforms.length || platforms.length > 4 || new Set(platforms).size !== platforms.length) throw new PublishingPolicyError("Choose one to four distinct platforms.", 400);
  if (mode !== configuredPublishingMode()) throw new PublishingPolicyError("Publishing mode changed. Create a new explicit attempt.", 409);
  try {
    await assertTenantEntitlement(scope.tenantId, "publish", { transaction: tx });
    if (intent === "schedule") await assertTenantEntitlement(scope.tenantId, "schedule", { transaction: tx });
  } catch (error) {
    if (error instanceof EntitlementError) throw new PublishingPolicyError(error.message, 403, error.code);
    throw new PublishingPolicyError("Plan access could not be verified. Try again later.", 503);
  }
  const [profile] = await tx.select().from(userProfiles).where(and(eq(userProfiles.tenantId, scope.tenantId), eq(userProfiles.userId, scope.userId)));
  if (!profile) throw new PublishingPolicyError("Publishing preferences are unavailable.");
  if (profile.requirePublishReview && (!draft.publishApprovedAt || draft.publishApprovalHash !== reviewFingerprint(draft))) throw new PublishingPolicyError("Review and approve this exact draft before publishing.");
  const integrations = await tx.select().from(platformIntegrations).where(inArray(platformIntegrations.key, platforms));
  for (const platform of platforms) {
    const capability = publishingCapability(platform);
    if (!capability?.live) throw new PublishingPolicyError("This platform has no direct publishing adapter.");
    if (!integrations.find(row => row.key === platform)?.enabled) throw new PublishingPolicyError("Platform is unavailable globally.");
    if (!profile.enabledPlatforms.includes(platform)) throw new PublishingPolicyError("Platform is disabled in publishing preferences.");
    const [rule] = await tx.select().from(publishingRules).where(and(eq(publishingRules.tenantId, scope.tenantId), eq(publishingRules.userId, scope.userId), eq(publishingRules.platform, platform)));
    if (rule?.enabled === false || draft.platformPublishRules?.[platform] === false) throw new PublishingPolicyError("Publishing is disabled by a rule.");
    if (!draft.content.trim() || draft.content.length < (rule?.minCharacters ?? 1) || draft.content.length > Math.min(capability.maxCharacters, rule?.maxCharacters ?? Infinity)) throw new PublishingPolicyError("Draft does not meet platform character limits.");
    const media = draft.media ?? [];
    if (media.length > capability.maxMedia || new Set(media.map(item => item.id)).size !== media.length) throw new PublishingPolicyError("Attached media exceeds this adapter's supported capability.");
    for (const item of media) {
      const [asset] = await tx.select().from(mediaAssets).where(and(eq(mediaAssets.id, item.id), eq(mediaAssets.tenantId, scope.tenantId), eq(mediaAssets.userId, scope.userId)));
      if (!asset || asset.deletionRequestedAt || !capability.mediaTypes.includes(asset.contentType) || asset.sizeBytes <= 0 || asset.sizeBytes > capability.maxMediaBytes || !asset.contentType.startsWith(`${item.type}/`)) throw new PublishingPolicyError("Attached media is unavailable or unsupported for this platform.");
      if (platform === "mastodon" && !asset.contentType.startsWith("image/") && media.length > 1) throw new PublishingPolicyError("Mastodon audio/video must be a single attachment.");
    }
    const [account] = await tx.select().from(socialAccounts).where(and(eq(socialAccounts.tenantId, scope.tenantId), eq(socialAccounts.userId, scope.userId), eq(socialAccounts.provider, platform)));
    if (!assessProviderConnection(platform, account).canPublish || !account?.providerAccountId) throw new PublishingPolicyError("Connect or reconnect this platform before publishing.");
    try { if (!decryptStoredCredential(account.accessToken!)) throw new Error("Credential unavailable"); }
    catch { throw new PublishingPolicyError("Stored credentials are unavailable. Reconnect this platform."); }
  }
}