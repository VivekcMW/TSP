import { type TenantScope } from "../../storage";
import { publishToLinkedIn } from "./linkedin";
import { publishToTwitter } from "./twitter";
import { publishToDevTo } from "./devto";
import { publishToReddit } from "./reddit";
import { publishToBluesky } from "./bluesky";
import { publishToMastodon } from "./mastodon";
import { publishToTelegram } from "./telegram";
import { publishToHashnode } from "./hashnode";
import { resolveProviderDefinition, runProviderSandbox } from "./providerSandbox";
import { getProviderAdapter } from "./adapter";
import { publishToWebhook, WEBHOOK_PROVIDERS, type WebhookProvider } from "../webhookPublisher";

/**
 * Generic publish result
 */
export interface PublishResult {
  success: boolean;
  postId?: string;
  externalId?: string;
  provider?: string;
  mode?: string;
  status?: string;
  error?: string;
}

/**
 * Platform-agnostic publisher that routes to platform-specific implementations
 * while ensuring provider identity and sandbox validation are centralized.
 */
export async function publishToPlatform(
  scope: TenantScope,
  draftId: string,
  content: string,
  platform: string,
  media: Array<{ id: string; name: string }> = [],
): Promise<PublishResult> {
  console.log(`[publisher] Publishing to ${platform}: ${draftId}`);

  const providerDefinition = resolveProviderDefinition(platform);
  const isLive = process.env.PUBLISHING_MODE === "live";
  const sandboxResult = await runProviderSandbox({
    provider: platform,
    content,
    mode: isLive ? "live" : "sandbox",
    metadata: { draftId, tenantId: scope.tenantId, userId: scope.userId },
  });

  if (!providerDefinition) {
    return {
      success: false,
      provider: platform,
      mode: sandboxResult.mode,
      status: sandboxResult.status,
      error: `Unsupported provider: ${platform}`,
    };
  }

  if (isLive && (providerDefinition.key !== "linkedin" && providerDefinition.key !== "twitter" && providerDefinition.key !== "devto" && providerDefinition.key !== "reddit" && providerDefinition.key !== "bluesky" && providerDefinition.key !== "mastodon" && providerDefinition.key !== "telegram" && providerDefinition.key !== "hashnode" && !WEBHOOK_PROVIDERS.includes(providerDefinition.key as WebhookProvider))) {
    return { success: false, provider: providerDefinition.key, mode: "live", status: "failed", error: `Live publishing is not implemented for ${providerDefinition.label}` };
  }

  try {
    switch (providerDefinition.key) {
      case "linkedin":
        return {
          ...(await publishToLinkedIn(scope, draftId, content, platform, media)),
          provider: providerDefinition.key,
          mode: isLive ? "live" : sandboxResult.mode,
          status: isLive ? undefined : sandboxResult.status,
          externalId: isLive ? undefined : sandboxResult.externalId,
        };

      case "twitter":
        return {
          ...(await publishToTwitter(scope, draftId, content, platform)),
          provider: providerDefinition.key,
          mode: isLive ? "live" : sandboxResult.mode,
          status: isLive ? undefined : sandboxResult.status,
          externalId: isLive ? undefined : sandboxResult.externalId,
        };

      case "devto":
        return { ...(await publishToDevTo(scope, draftId, content, media)), provider: providerDefinition.key, mode: isLive ? "live" : sandboxResult.mode, status: isLive ? undefined : sandboxResult.status, externalId: isLive ? undefined : sandboxResult.externalId };

      case "reddit":
        return { ...(await publishToReddit(scope, draftId, content)), provider: providerDefinition.key, mode: isLive ? "live" : sandboxResult.mode, status: isLive ? undefined : sandboxResult.status, externalId: isLive ? undefined : sandboxResult.externalId };

      case "bluesky":
        return { ...(await publishToBluesky(scope, draftId, content, media)), provider: providerDefinition.key, mode: isLive ? "live" : sandboxResult.mode, status: isLive ? undefined : sandboxResult.status, externalId: isLive ? undefined : sandboxResult.externalId };

      case "mastodon":
        return { ...(await publishToMastodon(scope, draftId, content, media)), provider: providerDefinition.key, mode: isLive ? "live" : sandboxResult.mode, status: isLive ? undefined : sandboxResult.status, externalId: isLive ? undefined : sandboxResult.externalId };

      case "telegram":
        return { ...(await publishToTelegram(scope, draftId, content)), provider: providerDefinition.key, mode: isLive ? "live" : sandboxResult.mode, status: isLive ? undefined : sandboxResult.status, externalId: isLive ? undefined : sandboxResult.externalId };

      case "hashnode":
        return { ...(await publishToHashnode(scope, draftId, content)), provider: providerDefinition.key, mode: isLive ? "live" : sandboxResult.mode, status: isLive ? undefined : sandboxResult.status, externalId: isLive ? undefined : sandboxResult.externalId };

      case "discord":
      case "slack":
        return {
          ...(await publishToWebhook(providerDefinition.key as WebhookProvider, scope, content, media)),
          provider: providerDefinition.key,
          mode: isLive ? "live" : sandboxResult.mode,
          status: isLive ? undefined : sandboxResult.status,
          externalId: isLive ? undefined : sandboxResult.externalId,
        };

      default: {
        const adapter = getProviderAdapter(providerDefinition.key);
        const result = await adapter.publish(content, { draftId, tenantId: scope.tenantId, userId: scope.userId, platform: providerDefinition.key });
        return {
          success: result.success,
          postId: result.postId,
          provider: providerDefinition.key,
          mode: sandboxResult.mode,
          status: result.status ?? sandboxResult.status,
          externalId: sandboxResult.externalId,
          error: result.error,
        };
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[publisher] Error publishing to ${platform}:`, message);
    return {
      success: false,
      provider: providerDefinition.key,
      mode: sandboxResult.mode,
      status: "failed",
      error: message,
    };
  }
}
