import { type TenantScope } from "../../storage";
import { publishToLinkedIn } from "./linkedin";
import { publishToTwitter } from "./twitter";
import { publishToDevTo } from "./devto";
import { publishToReddit } from "./reddit";
import { publishToBluesky } from "./bluesky";
import { publishToMastodon } from "./mastodon";
import { publishToTelegram } from "./telegram";
import { publishToHashnode } from "./hashnode";
import { publishingCapability, type PublishingMode } from "@shared/publishing-capabilities";
import { publishToWebhook } from "../webhookPublisher";

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
  receiptKind?: "provider_id" | "unavailable" | "none";
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
  mode: PublishingMode = "sandbox",
): Promise<PublishResult> {
  const capability = publishingCapability(platform);
  const base = { provider: platform, mode };
  if (!capability?.live) return { ...base, success: false, status: "failed", error: "Direct publishing is unavailable for this platform." };
  if (mode !== "live") return { ...base, success: true, status: "simulated", receiptKind: "none" };
  if (process.env.PUBLISHING_MODE !== "live") return { ...base, success: false, status: "failed", error: "Live publishing is disabled." };
  try {
    let result: { success: boolean; postId?: string; error?: string };
    switch (platform) {
      case "linkedin": result = await publishToLinkedIn(scope, draftId, content, platform, media); break;
      case "twitter": result = await publishToTwitter(scope, draftId, content, platform); break;
      case "devto": result = await publishToDevTo(scope, draftId, content, media); break;
      case "reddit": result = await publishToReddit(scope, draftId, content); break;
      case "bluesky": result = await publishToBluesky(scope, draftId, content, media); break;
      case "mastodon": result = await publishToMastodon(scope, draftId, content, media); break;
      case "telegram": result = await publishToTelegram(scope, draftId, content); break;
      case "hashnode": result = await publishToHashnode(scope, draftId, content); break;
      case "discord": case "slack": result = await publishToWebhook(platform, scope, content, media); break;
      default: return { ...base, success: false, status: "failed", error: "Adapter unavailable." };
    }
    if (!result.success) return { ...base, success: false, status: "unknown", error: "Provider did not confirm delivery. Reconciliation is required." };
    if (capability.receipt === "unavailable") return { ...base, success: true, status: "accepted_unverified", receiptKind: "unavailable" };
    if (!result.postId || /^(sandbox_|mock_|dryrun_)/.test(result.postId)) return { ...base, success: false, status: "unknown", error: "Provider receipt is unavailable. Reconciliation is required." };
    return { ...base, success: true, status: "published", receiptKind: "provider_id", postId: result.postId };
  } catch {
    console.error("[publisher] Delivery could not be confirmed");
    return { ...base, success: false, status: "unknown", error: "Delivery could not be confirmed. Reconciliation is required." };
  }
}
