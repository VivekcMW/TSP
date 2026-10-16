import { storage, type TenantScope } from "../../storage";
import { readMedia } from "../mediaStorage";
import { decryptStoredCredential } from "../webhookSecrets";

const GRAPH_API = "https://graph.facebook.com/v25.0";

/** Publish to the connected Facebook Page (page-scoped token obtained at connect time). */
export async function publishToFacebook(scope: TenantScope, _draftId: string, content: string, media: Array<{ id: string }> = []) {
  if (process.env.PUBLISHING_MODE !== "live") return { success: true, status: "simulated" };
  const account = await storage.getSocialAccountByProvider(scope, "facebook");
  if (!account?.accessToken || !account.providerAccountId) return { success: false, error: "Connect a Facebook Page before publishing" };
  try {
    const accessToken = decryptStoredCredential(account.accessToken);
    const pageId = account.providerAccountId;
    const [firstImage] = media;
    if (firstImage) {
      const asset = await storage.getMediaAsset(scope, firstImage.id);
      if (!asset?.contentType.startsWith("image/")) throw new Error("Attached image unavailable");
      const form = new FormData();
      form.append("source", new Blob([await readMedia(asset.storageKey)], { type: asset.contentType }), asset.fileName);
      form.append("caption", content.slice(0, 63_206));
      form.append("access_token", accessToken);
      const response = await fetch(`${GRAPH_API}/${pageId}/photos`, { method: "POST", body: form });
      const json = await response.json().catch(() => ({})) as { post_id?: string; error?: { message?: string } };
      if (!response.ok || !json.post_id) return { success: false, error: json.error?.message || `Facebook publish failed (${response.status})` };
      return { success: true, postId: json.post_id, postUrl: `https://www.facebook.com/${json.post_id}` };
    }
    const response = await fetch(`${GRAPH_API}/${pageId}/feed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: content.slice(0, 63_206), access_token: accessToken }),
    });
    const json = await response.json().catch(() => ({})) as { id?: string; error?: { message?: string } };
    if (!response.ok || !json.id) return { success: false, error: json.error?.message || `Facebook publish failed (${response.status})` };
    return { success: true, postId: json.id, postUrl: `https://www.facebook.com/${json.id}` };
  } catch {
    return { success: false, error: "Facebook delivery could not be confirmed" };
  }
}
