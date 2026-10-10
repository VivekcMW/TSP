import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSocialAccountByProvider, getMediaAsset, readMedia } = vi.hoisted(() => ({
  getSocialAccountByProvider: vi.fn(),
  getMediaAsset: vi.fn(),
  readMedia: vi.fn(),
}));

vi.mock("../../storage", () => ({ storage: { getSocialAccountByProvider, getMediaAsset } }));
vi.mock("../mediaStorage", () => ({ readMedia }));
vi.mock("../webhookSecrets", () => ({ decryptStoredCredential: () => "medium-integration-token" }));

import { publishToMedium, verifyMediumIntegrationToken } from "./medium";

const scope = { tenantId: "tenant", userId: "user" };

function connectedAccount(overrides: Record<string, unknown> = {}) {
  return { isActive: true, accessToken: "medium-integration-token", providerAccountId: "medium-user-1", ...overrides };
}

describe("Medium publisher", () => {
  beforeEach(() => {
    process.env.PUBLISHING_MODE = "live";
    getSocialAccountByProvider.mockResolvedValue(connectedAccount());
    getMediaAsset.mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn());
  });

  it("simulates when live publishing is not enabled", async () => {
    process.env.PUBLISHING_MODE = "sandbox";
    const result = await publishToMedium(scope, "draft-1", "An article");
    expect(result).toEqual({ success: true, status: "simulated" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("requires a connected integration token before publishing", async () => {
    getSocialAccountByProvider.mockResolvedValue(undefined);
    const result = await publishToMedium(scope, "draft-1", "An article");
    expect(result.success).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("publishes a post using the connected user ID", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ data: { id: "post-1", url: "https://medium.com/@user/post-1" } }), { status: 201 }));

    const result = await publishToMedium(scope, "draft-1", "# A useful article\n\nBody text.");

    expect(result).toEqual({ success: true, postId: "post-1", postUrl: "https://medium.com/@user/post-1" });
    expect(fetch).toHaveBeenCalledWith("https://api.medium.com/v1/users/medium-user-1/posts", expect.objectContaining({
      method: "POST",
      body: expect.stringContaining('"contentFormat":"markdown"'),
    }));
  });

  it("uploads an attached image as a cover before publishing", async () => {
    getMediaAsset.mockResolvedValue({ fileName: "cover.png", contentType: "image/png", storageKey: "tenant/user/image" });
    readMedia.mockResolvedValue(Buffer.from("image"));
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { url: "https://images.medium.com/cover.png" } }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: "post-2", url: "https://medium.com/@user/post-2" } }), { status: 201 }));

    const result = await publishToMedium(scope, "draft-1", "Body text.", [{ id: "11111111-1111-4111-8111-111111111111" }]);

    expect(result).toEqual({ success: true, postId: "post-2", postUrl: "https://medium.com/@user/post-2" });
    expect(fetch).toHaveBeenNthCalledWith(1, "https://api.medium.com/v1/images", expect.objectContaining({ method: "POST" }));
    expect(fetch).toHaveBeenNthCalledWith(2, "https://api.medium.com/v1/users/medium-user-1/posts", expect.objectContaining({
      body: expect.stringContaining("https://images.medium.com/cover.png"),
    }));
  });

  it("rejects a bad integration token at connect time", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ errors: [{ message: "Invalid token" }] }), { status: 401 }));
    const result = await verifyMediumIntegrationToken("bad-token");
    expect(result).toEqual({ error: "Invalid token" });
  });

  it("resolves the user ID for a valid integration token", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ data: { id: "medium-user-1" } }), { status: 200 }));
    const result = await verifyMediumIntegrationToken("good-token");
    expect(result).toEqual({ userId: "medium-user-1" });
  });
});
