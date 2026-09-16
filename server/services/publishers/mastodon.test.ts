import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSocialAccountByProvider, getMediaAsset, decryptWebhookUrl, readMedia } = vi.hoisted(() => ({ getSocialAccountByProvider: vi.fn(), getMediaAsset: vi.fn(), decryptWebhookUrl: vi.fn(), readMedia: vi.fn() }));
vi.mock("../../storage", () => ({ storage: { getSocialAccountByProvider, getMediaAsset } }));
vi.mock("../webhookSecrets", () => ({ decryptWebhookUrl }));
vi.mock("../mediaStorage", () => ({ readMedia }));

import { publishToMastodon } from "./mastodon";

describe("Mastodon publisher", () => {
  beforeEach(() => { process.env.PUBLISHING_MODE = "live"; getSocialAccountByProvider.mockResolvedValue({ providerAccountId: "https://mastodon.social", accessToken: "encrypted" }); decryptWebhookUrl.mockReturnValue("token"); vi.stubGlobal("fetch", vi.fn()); });
  it("publishes to the connected instance", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ id: "post-id", url: "https://mastodon.social/@user/post-id" }), { status: 200 }));
    const result = await publishToMastodon({ tenantId: "tenant", userId: "user" }, "draft", "A Mastodon post");
    expect(result).toEqual({ success: true, postId: "post-id", postUrl: "https://mastodon.social/@user/post-id" });
    expect(fetch).toHaveBeenCalledWith("https://mastodon.social/api/v1/statuses", expect.objectContaining({ method: "POST", headers: expect.objectContaining({ Authorization: "Bearer token" }) }));
  });
  it("uploads video and attaches it to the status", async () => {
    getMediaAsset.mockResolvedValue({ fileName: "demo.mp4", contentType: "video/mp4", storageKey: "tenant/user/video" });
    readMedia.mockResolvedValue(Buffer.from("video"));
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ id: "media-id" }), { status: 200 })).mockResolvedValueOnce(new Response(JSON.stringify({ id: "post-id" }), { status: 200 }));
    await publishToMastodon({ tenantId: "tenant", userId: "user" }, "draft", "A video post", [{ id: "11111111-1111-4111-8111-111111111111" }]);
    expect(fetch).toHaveBeenNthCalledWith(1, "https://mastodon.social/api/v2/media", expect.objectContaining({ method: "POST" }));
    expect(fetch).toHaveBeenNthCalledWith(2, "https://mastodon.social/api/v1/statuses", expect.objectContaining({ body: expect.stringContaining('"media_ids":["media-id"]') }));
  });
});
