import { storage, type TenantScope } from "../../storage";
import { decryptWebhookUrl } from "../webhookSecrets";
import { readMedia } from "../mediaStorage";

const BSKY_PDS = "https://bsky.social/xrpc";

/** Verifies a handle + app password by actually logging in, used at connect time so bad credentials are rejected immediately instead of only failing at publish time. */
export async function verifyBlueskyAppPassword(handle: string, appPassword: string): Promise<{ ok: true } | { error: string }> {
  try {
    const response = await fetch(`${BSKY_PDS}/com.atproto.server.createSession`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "TheSocialPundit/1.0" },
      body: JSON.stringify({ identifier: handle, password: appPassword }),
    });
    const session = (await response.json().catch(() => ({}))) as { accessJwt?: string; did?: string; message?: string };
    if (!response.ok || !session.accessJwt || !session.did) {
      return { error: session.message || `Bluesky rejected this handle/app password (${response.status})` };
    }
    return { ok: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not reach Bluesky to verify credentials" };
  }
}

export async function publishToBluesky(scope: TenantScope, _draftId: string, content: string, media: Array<{ id: string }> = []) {
  if (process.env.PUBLISHING_MODE !== "live") return { success: true, status: "simulated" };

  const account = await storage.getSocialAccountByProvider(scope, "bluesky");
  if (!account?.accessToken || !account.providerAccountId) {
    return { success: false, error: "Connect Bluesky with your handle and app password before publishing" };
  }

  try {
    const password = decryptWebhookUrl(account.accessToken);
    const sessionResponse = await fetch(`${BSKY_PDS}/com.atproto.server.createSession`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "TheSocialPundit/1.0" },
      body: JSON.stringify({ identifier: account.providerAccountId, password }),
    });
    const session = await sessionResponse.json().catch(() => ({})) as { accessJwt?: string; did?: string; message?: string };
    if (!sessionResponse.ok || !session.accessJwt || !session.did) {
      return { success: false, error: session.message || `Bluesky authentication failed (${sessionResponse.status})` };
    }

    const images = await Promise.all(media.map(async (item) => {
      const asset = await storage.getMediaAsset(scope, item.id);
      if (!asset?.contentType.startsWith("image/")) throw new Error("Attached image unavailable");
      const upload = await fetch(`${BSKY_PDS}/com.atproto.repo.uploadBlob`, { method: "POST", headers: { Authorization: `Bearer ${session.accessJwt}`, "Content-Type": asset.contentType, "User-Agent": "TheSocialPundit/1.0" }, body: await readMedia(asset.storageKey) });
      const result = await upload.json().catch(() => ({})) as { blob?: Record<string, unknown> };
      if (!upload.ok || !result.blob) throw new Error(`Bluesky media upload failed (${upload.status})`);
      return { alt: asset.fileName, image: result.blob };
    }));
    const uploadedImages = images.filter((image): image is { alt: string; image: Record<string, unknown> } => image !== null);
    const record: Record<string, unknown> = { $type: "app.bsky.feed.post", text: content.slice(0, 300), createdAt: new Date().toISOString() };
    if (uploadedImages.length) record.embed = { $type: "app.bsky.embed.images", images: uploadedImages };
    const response = await fetch(`${BSKY_PDS}/com.atproto.repo.createRecord`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.accessJwt}`, "Content-Type": "application/json", "User-Agent": "TheSocialPundit/1.0" },
      body: JSON.stringify({ repo: session.did, collection: "app.bsky.feed.post", record }),
    });
    const post = await response.json().catch(() => ({})) as { uri?: string; cid?: string; message?: string };
    if (!response.ok || !post.uri) return { success: false, error: post.message || `Bluesky publish failed (${response.status})` };
    return { success: true, postId: post.uri, postUrl: `https://bsky.app/profile/${account.providerAccountId}/post/${post.uri.split("/").pop()}` };
  } catch (error) {
    return { success: false, error: "Bluesky delivery could not be confirmed" };
  }
}
