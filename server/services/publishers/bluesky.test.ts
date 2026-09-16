import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSocialAccountByProvider, decryptWebhookUrl } = vi.hoisted(() => ({ getSocialAccountByProvider: vi.fn(), decryptWebhookUrl: vi.fn() }));
vi.mock("../../storage", () => ({ storage: { getSocialAccountByProvider } }));
vi.mock("../webhookSecrets", () => ({ decryptWebhookUrl }));

import { publishToBluesky } from "./bluesky";

describe("Bluesky publisher", () => {
  beforeEach(() => {
    process.env.PUBLISHING_MODE = "live";
    getSocialAccountByProvider.mockResolvedValue({ providerAccountId: "alice.bsky.social", accessToken: "encrypted" });
    decryptWebhookUrl.mockReturnValue("app-password");
    vi.stubGlobal("fetch", vi.fn());
  });

  it("creates a session then writes a text post", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ accessJwt: "jwt", did: "did:plc:alice" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ uri: "at://did:plc:alice/app.bsky.feed.post/abc" }), { status: 200 }));
    const result = await publishToBluesky({ tenantId: "tenant", userId: "user" }, "draft", "A Bluesky post");
    expect(result).toMatchObject({ success: true, postId: "at://did:plc:alice/app.bsky.feed.post/abc" });
    expect(fetch).toHaveBeenNthCalledWith(2, "https://bsky.social/xrpc/com.atproto.repo.createRecord", expect.objectContaining({ body: expect.stringContaining('"collection":"app.bsky.feed.post"') }));
  });
});
