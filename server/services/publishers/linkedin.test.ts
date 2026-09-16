import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSocialAccountByProvider, getMediaAsset, readMedia } = vi.hoisted(() => ({
  getSocialAccountByProvider: vi.fn(),
  getMediaAsset: vi.fn(),
  readMedia: vi.fn(),
}));

vi.mock("../../storage", () => ({ storage: { getSocialAccountByProvider, getMediaAsset } }));
vi.mock("../mediaStorage", () => ({ readMedia }));

import { publishToLinkedIn } from "./linkedin";

const scope = { tenantId: "tenant", userId: "user" };

function connectedAccount(overrides: Record<string, unknown> = {}) {
  return {
    isActive: true,
    accessToken: "linkedin-access-token",
    providerAccountId: "linkedin-member-id",
    scopes: ["w_member_social"],
    tokenExpiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  };
}

describe("LinkedIn publisher", () => {
  beforeEach(() => {
    process.env.PUBLISHING_MODE = "live";
    delete process.env.LINKEDIN_API_VERSION;
    getSocialAccountByProvider.mockResolvedValue(connectedAccount());
    getMediaAsset.mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn());
  });

  it("publishes a text post with the connected member URN", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, {
      status: 201,
      headers: { "x-restli-id": "urn:li:share:123" },
    }));

    const result = await publishToLinkedIn(scope, "draft-1", "A useful LinkedIn post", "linkedin");

    expect(result).toEqual({ success: true, postId: "urn:li:share:123" });
    expect(fetch).toHaveBeenCalledWith("https://api.linkedin.com/rest/posts", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({
        Authorization: "Bearer linkedin-access-token",
        "Linkedin-Version": "202601",
      }),
      body: expect.stringContaining('"author":"urn:li:person:linkedin-member-id"'),
    }));
  });

  it("does not call LinkedIn when publishing consent is missing", async () => {
    getSocialAccountByProvider.mockResolvedValue(connectedAccount({ scopes: ["openid"] }));

    const result = await publishToLinkedIn(scope, "draft-1", "A useful LinkedIn post", "linkedin");

    expect(result.success).toBe(false);
    expect(result.error).toContain("w_member_social");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("asks the user to reconnect after LinkedIn rejects authorization", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 401 }));

    const result = await publishToLinkedIn(scope, "draft-1", "A useful LinkedIn post", "linkedin");

    expect(result).toEqual({
      success: false,
      error: "LinkedIn authorization has expired or was revoked. Reconnect LinkedIn and try again.",
    });
  });

  it("uploads an attached image and attaches its LinkedIn image URN to the post", async () => {
    getMediaAsset.mockResolvedValue({ fileName: "proof.png", contentType: "image/png", storageKey: "tenant/user/image" });
    readMedia.mockResolvedValue(Buffer.from("image"));
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ value: { uploadUrl: "https://upload.linkedin.test/image", image: "urn:li:image:123" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 201, headers: { "x-restli-id": "urn:li:share:media" } }));

    const result = await publishToLinkedIn(scope, "draft-1", "A post with an image", "linkedin", [{ id: "11111111-1111-4111-8111-111111111111" }]);

    expect(result).toEqual({ success: true, postId: "urn:li:share:media" });
    expect(fetch).toHaveBeenNthCalledWith(1, "https://api.linkedin.com/rest/images?action=initializeUpload", expect.anything());
    expect(fetch).toHaveBeenNthCalledWith(2, "https://upload.linkedin.test/image", expect.objectContaining({ method: "PUT" }));
    expect(fetch).toHaveBeenNthCalledWith(3, "https://api.linkedin.com/rest/posts", expect.objectContaining({ body: expect.stringContaining('"id":"urn:li:image:123"') }));
  });
});
