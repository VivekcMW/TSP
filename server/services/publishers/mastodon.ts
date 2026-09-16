import { storage, type TenantScope } from "../../storage";
import { decryptWebhookUrl } from "../webhookSecrets";
import { readMedia } from "../mediaStorage";

/** Verifies an instance URL + access token via Mastodon's own verify_credentials endpoint, used at connect time so a bad token is rejected immediately instead of only failing at publish time. */
export async function verifyMastodonAccessToken(instanceUrl: string, accessToken: string): Promise<{ ok: true } | { error: string }> {
  try {
    const response = await fetch(`${instanceUrl}/api/v1/accounts/verify_credentials`, {
      headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": "TheSocialPundit/1.0" },
    });
    const account = (await response.json().catch(() => ({}))) as { id?: string; error?: string };
    if (!response.ok || !account.id) {
      return { error: account.error || `Mastodon rejected this access token (${response.status})` };
    }
    return { ok: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not reach this Mastodon instance to verify the token" };
  }
}

export async function publishToMastodon(scope: TenantScope, _draftId: string, content: string, media: Array<{ id: string }> = []) {
  if (process.env.PUBLISHING_MODE !== "live") return { success: true, postId: `sandbox_mastodon_${Date.now()}` };
  const account = await storage.getSocialAccountByProvider(scope, "mastodon");
  if (!account?.accessToken || !account.providerAccountId) return { success: false, error: "Connect your Mastodon instance and access token before publishing" };
  try {
    const instanceUrl = new URL(account.providerAccountId).origin;
    const accessToken = decryptWebhookUrl(account.accessToken);
    const mediaIds = await Promise.all(media.map(async (item) => {
      const asset = await storage.getMediaAsset(scope, item.id);
      if (!asset || !/^(image|video|audio)\//.test(asset.contentType)) return null;
      const form = new FormData();
      form.append("file", new Blob([await readMedia(asset.storageKey)], { type: asset.contentType }), asset.fileName);
      const upload = await fetch(`${instanceUrl}/api/v2/media`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": "TheSocialPundit/1.0" }, body: form });
      const uploaded = await upload.json().catch(() => ({})) as { id?: string };
      if (!upload.ok || !uploaded.id) throw new Error(`Mastodon media upload failed (${upload.status})`);
      return uploaded.id;
    }));
    const response = await fetch(`${instanceUrl}/api/v1/statuses`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", "User-Agent": "TheSocialPundit/1.0" },
      body: JSON.stringify({ status: content.slice(0, 500), visibility: "public", media_ids: mediaIds.filter((id): id is string => Boolean(id)) }),
    });
    const post = await response.json().catch(() => ({})) as { id?: string; url?: string; error?: string };
    if (!response.ok || !post.id) return { success: false, error: post.error || `Mastodon publish failed (${response.status})` };
    return { success: true, postId: post.id, postUrl: post.url };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Mastodon publish failed" };
  }
}
