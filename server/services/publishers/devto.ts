import { storage, type TenantScope } from "../../storage";
import { decryptWebhookUrl } from "../webhookSecrets";
import { readMedia } from "../mediaStorage";

/** Verifies a personal API key via Dev.to's own users/me endpoint, used at connect time so a bad/typo'd key is rejected immediately instead of only failing at publish time. */
export async function verifyDevToApiKey(apiKey: string): Promise<{ ok: true } | { error: string }> {
  try {
    const response = await fetch("https://dev.to/api/users/me", {
      headers: { "api-key": apiKey, "User-Agent": "TheSocialPundit/1.0" },
    });
    if (!response.ok) {
      return { error: response.status === 401 ? "Dev.to rejected this API key" : `Dev.to rejected this API key (${response.status})` };
    }
    return { ok: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not reach Dev.to to verify this API key" };
  }
}

function titleFrom(content: string): string {
  const firstLine = content.split("\n").find((line) => line.trim())?.replace(/^#+\s*/, "").trim() || "The Social Pundit article";
  return firstLine.slice(0, 128);
}

export async function publishToDevTo(scope: TenantScope, draftId: string, content: string, media: Array<{ id: string }> = []) {
  if (process.env.PUBLISHING_MODE !== "live") return { success: true, postId: `sandbox_devto_${Date.now()}` };
  const account = await storage.getSocialAccountByProvider(scope, "devto");
  if (!account?.accessToken) return { success: false, error: "Dev.to API key is not connected" };
  try {
    const apiKey = decryptWebhookUrl(account.accessToken);
    let coverImage: string | undefined;
    for (const item of media) {
      const asset = await storage.getMediaAsset(scope, item.id);
      if (!asset?.contentType.startsWith("image/")) continue;
      const form = new FormData();
      form.append("image", new Blob([await readMedia(asset.storageKey)], { type: asset.contentType }), asset.fileName);
      const upload = await fetch("https://dev.to/api/images", { method: "POST", headers: { "api-key": apiKey, "User-Agent": "TheSocialPundit/1.0" }, body: form });
      const image = await upload.json().catch(() => ({})) as { url?: string; error?: string };
      if (!upload.ok || !image.url) return { success: false, error: image.error || `Dev.to image upload failed (${upload.status})` };
      coverImage = image.url;
      break;
    }
    const response = await fetch("https://dev.to/api/articles", {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": apiKey, "User-Agent": "TheSocialPundit/1.0" },
      body: JSON.stringify({ article: { title: titleFrom(content), body_markdown: content, published: true, tags: ["socialmedia"], ...(coverImage ? { main_image: coverImage } : {}) } }),
    });
    const article = await response.json().catch(() => ({})) as { id?: number; url?: string; error?: string };
    if (!response.ok) return { success: false, error: article.error || `Dev.to publish failed (${response.status})` };
    if (!article.id) return { success: false, error: "Dev.to did not return an article ID" };
    return { success: true, postId: String(article.id), postUrl: article.url };
  } catch (error) { return { success: false, error: error instanceof Error ? error.message : "Dev.to publish failed" }; }
}
