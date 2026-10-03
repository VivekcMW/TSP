import { storage, type TenantScope } from "../../storage";
import { readMedia } from "../mediaStorage";
import { decryptStoredCredential } from "../webhookSecrets";

const MEDIUM_API = "https://api.medium.com/v1";

function titleFrom(content: string): string {
  const firstLine = content.split("\n").find((line) => line.trim())?.replace(/^#+\s*/, "").trim() || "The Social Pundit article";
  return firstLine.slice(0, 100);
}

/**
 * Verifies a self-issued integration token via Medium's own /v1/me endpoint,
 * used at connect time so a bad token is rejected immediately instead of only
 * failing at publish time. Medium no longer accepts new OAuth app
 * integrations; self-issued integration tokens remain the supported path for
 * new integrations (see Medium's own API documentation deprecation notice).
 */
export async function verifyMediumIntegrationToken(token: string): Promise<{ userId: string } | { error: string }> {
  try {
    const response = await fetch(`${MEDIUM_API}/me`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    const json = await response.json().catch(() => ({})) as { data?: { id?: string }; errors?: Array<{ message?: string }> };
    if (!response.ok || !json.data?.id) return { error: json.errors?.[0]?.message || `Medium rejected this integration token (${response.status})` };
    return { userId: json.data.id };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not reach Medium to verify this integration token" };
  }
}

export async function publishToMedium(scope: TenantScope, _draftId: string, content: string, media: Array<{ id: string }> = []) {
  if (process.env.PUBLISHING_MODE !== "live") return { success: true, status: "simulated" };
  const account = await storage.getSocialAccountByProvider(scope, "medium");
  if (!account?.accessToken || !account.providerAccountId) return { success: false, error: "Medium integration token is not connected" };
  try {
    const token = decryptStoredCredential(account.accessToken);
    let coverMarkdown = "";
    const [firstImage] = media;
    if (firstImage) {
      const asset = await storage.getMediaAsset(scope, firstImage.id);
      if (!asset?.contentType.startsWith("image/")) throw new Error("Attached image unavailable");
      const form = new FormData();
      form.append("image", new Blob([await readMedia(asset.storageKey)], { type: asset.contentType }), asset.fileName);
      const upload = await fetch(`${MEDIUM_API}/images`, { method: "POST", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, body: form });
      const image = await upload.json().catch(() => ({})) as { data?: { url?: string }; errors?: Array<{ message?: string }> };
      if (!upload.ok || !image.data?.url) return { success: false, error: image.errors?.[0]?.message || `Medium image upload failed (${upload.status})` };
      coverMarkdown = `![Cover image](${image.data.url})\n\n`;
    }
    const response = await fetch(`${MEDIUM_API}/users/${account.providerAccountId}/posts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, Accept: "application/json" },
      body: JSON.stringify({ title: titleFrom(content), contentFormat: "markdown", content: `${coverMarkdown}${content}`, publishStatus: "public" }),
    });
    const json = await response.json().catch(() => ({})) as { data?: { id?: string; url?: string }; errors?: Array<{ message?: string }> };
    if (!response.ok || !json.data?.id) return { success: false, error: json.errors?.[0]?.message || `Medium publish failed (${response.status})` };
    return { success: true, postId: json.data.id, postUrl: json.data.url };
  } catch {
    return { success: false, error: "Medium delivery could not be confirmed" };
  }
}
