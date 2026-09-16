import { storage, type TenantScope } from "../../storage";
import { assessProviderConnection } from "./providerLifecycle";
import { readMedia } from "../mediaStorage";
import { decryptStoredCredential } from "../webhookSecrets";

/** LinkedIn REST Posts publisher for authenticated member accounts. */

export interface LinkedInPublishResult {
  success: boolean;
  postId?: string;
  error?: string;
}

function linkedInPublishError(status: number): string {
  if (status === 401) return "LinkedIn authorization has expired or was revoked. Reconnect LinkedIn and try again.";
  if (status === 403) return "LinkedIn denied publishing. Reconnect LinkedIn and approve the w_member_social permission.";
  if (status === 429) return "LinkedIn rate limit reached. Please try publishing again later.";
  return `LinkedIn publish failed (${status})`;
}

/** Publish a draft, optionally with one attached image, to the connected LinkedIn member account. */
export async function publishToLinkedIn(
  scope: TenantScope,
  draftId: string,
  content: string,
  _platform: string,
  media: Array<{ id: string }> = [],
): Promise<LinkedInPublishResult> {
  try {
    if (process.env.PUBLISHING_MODE !== "live") {
      return { success: true, postId: `sandbox_linkedin_${Date.now()}` };
    }
    const account = await storage.getSocialAccountByProvider(scope, "linkedin");
    const connection = assessProviderConnection("linkedin", account);
    if (!connection.canPublish) {
      return { success: false, error: connection.reason || "LinkedIn is not ready to publish. Reconnect LinkedIn and try again." };
    }
    if (!account?.providerAccountId) return { success: false, error: "LinkedIn connection is missing its member identity. Reconnect LinkedIn and try again." };
    const accessToken = decryptStoredCredential(account.accessToken!);
    const author = account.providerAccountId.startsWith("urn:") ? account.providerAccountId : `urn:li:person:${account.providerAccountId}`;
    const firstImage = await (async () => {
      for (const item of media) {
        const asset = await storage.getMediaAsset(scope, item.id);
        if (!asset?.contentType.startsWith("image/")) continue;
        const initialize = await fetch("https://api.linkedin.com/rest/images?action=initializeUpload", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", "Linkedin-Version": process.env.LINKEDIN_API_VERSION || "202601", "X-Restli-Protocol-Version": "2.0.0" },
          body: JSON.stringify({ initializeUploadRequest: { owner: author } }),
        });
        const init = await initialize.json().catch(() => ({})) as { value?: { uploadUrl?: string; image?: string } };
        if (!initialize.ok || !init.value?.uploadUrl || !init.value.image) throw new Error(`LinkedIn image upload could not be initialized (${initialize.status})`);
        const upload = await fetch(init.value.uploadUrl, { method: "PUT", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": asset.contentType }, body: await readMedia(asset.storageKey) });
        if (!upload.ok) throw new Error(`LinkedIn image upload failed (${upload.status})`);
        return init.value.image;
      }
      return undefined;
    })();
    const response = await fetch("https://api.linkedin.com/rest/posts", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", "Linkedin-Version": process.env.LINKEDIN_API_VERSION || "202601", "X-Restli-Protocol-Version": "2.0.0" },
      body: JSON.stringify({ author, commentary: content, visibility: "PUBLIC", distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] }, lifecycleState: "PUBLISHED", isReshareDisabledByAuthor: false, ...(firstImage ? { content: { media: { id: firstImage } } } : {}) }),
    });
    if (!response.ok) return { success: false, error: linkedInPublishError(response.status) };
    const postId = response.headers.get("x-restli-id") || (await response.json().catch(() => ({})) as { id?: string }).id;
    if (!postId) return { success: false, error: "LinkedIn did not return a post identifier" };

    console.log(`[publisher:linkedin] Published to LinkedIn: ${postId}`);

    return { success: true, postId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[publisher:linkedin] Error publishing to LinkedIn:", message);
    return {
      success: false,
      error: message,
    };
  }
}
