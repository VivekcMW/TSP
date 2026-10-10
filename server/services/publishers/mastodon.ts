import { storage, type TenantScope } from "../../storage";
import { decryptWebhookUrl } from "../webhookSecrets";
import { readMedia } from "../mediaStorage";
import { Blob, FormData } from "node-fetch";
import { publicHttpsInstanceOrigin, safeOutboundJson } from "../safeOutbound";

/** Verifies an instance URL + access token via Mastodon's own verify_credentials endpoint, used at connect time so a bad token is rejected immediately instead of only failing at publish time. */
export async function verifyMastodonAccessToken(instanceUrl: string, accessToken: string): Promise<{ ok: true } | { error: string }> {
  try {
    const origin = publicHttpsInstanceOrigin(instanceUrl);
    const response = await safeOutboundJson<{ id?: string }>(`${origin}/api/v1/accounts/verify_credentials`, {
      origin,
      headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": "TheSocialPundit/1.0" },
    });
    const account = response.data;
    if (!response.ok || !account.id) {
      return { error: `Mastodon rejected this access token (${response.status})` };
    }
    return { ok: true };
  } catch {
    return { error: "Could not reach this Mastodon instance to verify the token" };
  }
}

export async function publishToMastodon(scope: TenantScope, _draftId: string, content: string, media: Array<{ id: string }> = []) {
  if (process.env.PUBLISHING_MODE !== "live") return { success: true, status: "simulated" };
  const account = await storage.getSocialAccountByProvider(scope, "mastodon");
  if (!account?.accessToken || !account.providerAccountId) return { success: false, error: "Connect your Mastodon instance and access token before publishing" };
  try {
    const instanceUrl = publicHttpsInstanceOrigin(account.providerAccountId);
    const accessToken = decryptWebhookUrl(account.accessToken);
    const mediaIds = await Promise.all(media.map(async (item) => {
      const asset = await storage.getMediaAsset(scope, item.id);
      if (!asset || !/^(image|video|audio)\//.test(asset.contentType)) throw new Error("Attached media unavailable");
      const form = new FormData();
      form.append("file", new Blob([await readMedia(asset.storageKey)], { type: asset.contentType }), asset.fileName);
      const upload = await safeOutboundJson<{ id?: string }>(`${instanceUrl}/api/v2/media`, { origin: instanceUrl, method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": "TheSocialPundit/1.0" }, body: form });
      const uploaded = upload.data;
      if (!upload.ok || !uploaded.id) throw new Error(`Mastodon media upload failed (${upload.status})`);
      return uploaded.id;
    }));
    const response = await safeOutboundJson<{ id?: string; url?: string }>(`${instanceUrl}/api/v1/statuses`, {
      origin: instanceUrl,
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", "User-Agent": "TheSocialPundit/1.0" },
      body: JSON.stringify({ status: content.slice(0, 500), visibility: "public", media_ids: mediaIds.filter((id): id is string => Boolean(id)) }),
    });
    const post = response.data;
    if (!response.ok || !post.id) return { success: false, error: `Mastodon publish failed (${response.status})` };
    return { success: true, postId: post.id, postUrl: post.url };
  } catch {
    return { success: false, error: "Mastodon delivery could not be confirmed" };
  }
}
