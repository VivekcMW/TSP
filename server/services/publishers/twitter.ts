import { storage, type TenantScope } from "../../storage";
import { decryptStoredCredential } from "../webhookSecrets";

/**
 * Twitter/X API v2 integration for publishing posts.
 */

export interface TwitterPublishResult {
  success: boolean;
  postId?: string;
  error?: string;
}

/**
 * Publish article to Twitter/X. Requires the account to be connected via
 * /auth/twitter/connect (server/services/twitterAuth.ts).
 */
export async function publishToTwitter(
  scope: TenantScope,
  draftId: string,
  content: string,
  platform: string
): Promise<TwitterPublishResult> {
  try {
    if (process.env.PUBLISHING_MODE !== "live") {
      return { success: true, postId: `sandbox_twitter_${Date.now()}` };
    }
    const account = await storage.getSocialAccountByProvider(scope, "twitter");
    if (!account?.accessToken) return { success: false, error: "X account is not connected" };
    const accessToken = decryptStoredCredential(account.accessToken);

    const response = await fetch("https://api.x.com/2/tweets", { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ text: content }) });
    if (!response.ok) return { success: false, error: `X publish failed (${response.status})` };
    const body = await response.json() as { data?: { id?: string } };
    const tweetId = body.data?.id;
    if (!tweetId) return { success: false, error: "X did not return a post identifier" };
    const postId = account.accountHandle ? `https://x.com/${encodeURIComponent(account.accountHandle.replace(/^@/, ""))}/status/${tweetId}` : tweetId;

    console.log(`[publisher:twitter] Published to Twitter: ${postId}`);

    return {
      success: true,
      postId,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[publisher:twitter] Error publishing to Twitter:", message);
    return {
      success: false,
      error: message,
    };
  }
}
