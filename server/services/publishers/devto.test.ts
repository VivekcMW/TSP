import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSocialAccountByProvider, getMediaAsset, decryptWebhookUrl, readMedia } = vi.hoisted(() => ({ getSocialAccountByProvider: vi.fn(), getMediaAsset: vi.fn(), decryptWebhookUrl: vi.fn(), readMedia: vi.fn() }));
vi.mock("../../storage", () => ({ storage: { getSocialAccountByProvider, getMediaAsset } }));
vi.mock("../webhookSecrets", () => ({ decryptWebhookUrl }));
vi.mock("../mediaStorage", () => ({ readMedia }));

import { publishToDevTo } from "./devto";

describe("Dev.to publisher", () => {
  beforeEach(() => {
    process.env.PUBLISHING_MODE = "live";
    getSocialAccountByProvider.mockResolvedValue({ accessToken: "encrypted-key" });
    getMediaAsset.mockResolvedValue(undefined);
    decryptWebhookUrl.mockReturnValue("devto-secret-key");
    vi.stubGlobal("fetch", vi.fn());
  });

  it("publishes markdown with an encrypted per-user API key", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ id: 42, url: "https://dev.to/example/article" }), { status: 201 }));
    const result = await publishToDevTo({ tenantId: "tenant", userId: "user" }, "draft", "# A real article\n\nBody text");
    expect(result).toEqual({ success: true, postId: "42", postUrl: "https://dev.to/example/article" });
    expect(fetch).toHaveBeenCalledWith("https://dev.to/api/articles", expect.objectContaining({ headers: expect.objectContaining({ "api-key": "devto-secret-key" }) }));
  });

  it("uploads an attached image and uses it as the article cover", async () => {
    getMediaAsset.mockResolvedValue({ fileName: "cover.png", contentType: "image/png", storageKey: "tenant/user/cover" });
    readMedia.mockResolvedValue(Buffer.from("image"));
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ url: "https://dev.to/remote-images/cover.png" }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 43, url: "https://dev.to/example/with-cover" }), { status: 201 }));
    const result = await publishToDevTo({ tenantId: "tenant", userId: "user" }, "draft", "# Article with media", [{ id: "11111111-1111-4111-8111-111111111111" }]);
    expect(result).toMatchObject({ success: true, postId: "43" });
    expect(fetch).toHaveBeenNthCalledWith(1, "https://dev.to/api/images", expect.objectContaining({ method: "POST" }));
    expect(fetch).toHaveBeenNthCalledWith(2, "https://dev.to/api/articles", expect.objectContaining({ body: expect.stringContaining('"main_image":"https://dev.to/remote-images/cover.png"') }));
  });
});
