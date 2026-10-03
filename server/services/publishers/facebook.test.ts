import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSocialAccountByProvider, getMediaAsset, readMedia } = vi.hoisted(() => ({
  getSocialAccountByProvider: vi.fn(),
  getMediaAsset: vi.fn(),
  readMedia: vi.fn(),
}));

vi.mock("../../storage", () => ({ storage: { getSocialAccountByProvider, getMediaAsset } }));
vi.mock("../mediaStorage", () => ({ readMedia }));
vi.mock("../webhookSecrets", () => ({ decryptStoredCredential: () => "facebook-page-token" }));

import { publishToFacebook } from "./facebook";

const scope = { tenantId: "tenant", userId: "user" };

function connectedAccount(overrides: Record<string, unknown> = {}) {
  return { isActive: true, accessToken: "facebook-page-token", providerAccountId: "page-123", ...overrides };
}

describe("Facebook publisher", () => {
  beforeEach(() => {
    process.env.PUBLISHING_MODE = "live";
    getSocialAccountByProvider.mockResolvedValue(connectedAccount());
    getMediaAsset.mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn());
  });

  it("simulates when live publishing is not enabled", async () => {
    process.env.PUBLISHING_MODE = "sandbox";
    const result = await publishToFacebook(scope, "draft-1", "A Facebook post");
    expect(result).toEqual({ success: true, status: "simulated" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("requires a connected Page before publishing", async () => {
    getSocialAccountByProvider.mockResolvedValue(undefined);
    const result = await publishToFacebook(scope, "draft-1", "A Facebook post");
    expect(result.success).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("publishes a text post to the connected Page's feed", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ id: "page-123_456" }), { status: 200 }));

    const result = await publishToFacebook(scope, "draft-1", "A useful Facebook post");

    expect(result).toEqual({ success: true, postId: "page-123_456", postUrl: "https://www.facebook.com/page-123_456" });
    expect(fetch).toHaveBeenCalledWith("https://graph.facebook.com/v25.0/page-123/feed", expect.objectContaining({
      method: "POST",
      body: expect.stringContaining('"message":"A useful Facebook post"'),
    }));
  });

  it("uploads a single attached image as a photo post", async () => {
    getMediaAsset.mockResolvedValue({ fileName: "proof.png", contentType: "image/png", storageKey: "tenant/user/image" });
    readMedia.mockResolvedValue(Buffer.from("image"));
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ id: "photo-1", post_id: "page-123_789" }), { status: 200 }));

    const result = await publishToFacebook(scope, "draft-1", "A post with an image", [{ id: "11111111-1111-4111-8111-111111111111" }]);

    expect(result).toEqual({ success: true, postId: "page-123_789", postUrl: "https://www.facebook.com/page-123_789" });
    expect(fetch).toHaveBeenCalledWith("https://graph.facebook.com/v25.0/page-123/photos", expect.objectContaining({ method: "POST" }));
  });

  it("surfaces the provider's error message on failure", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: { message: "Invalid OAuth access token" } }), { status: 401 }));

    const result = await publishToFacebook(scope, "draft-1", "A post");

    expect(result).toEqual({ success: false, error: "Invalid OAuth access token" });
  });
});
