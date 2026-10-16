import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSocialAccountByProvider } = vi.hoisted(() => ({ getSocialAccountByProvider: vi.fn() }));

vi.mock("../../storage", () => ({ storage: { getSocialAccountByProvider } }));
vi.mock("../webhookSecrets", () => ({ decryptStoredCredential: () => "threads-access-token" }));

import { publishToThreads } from "./threads";

const scope = { tenantId: "tenant", userId: "user" };

function connectedAccount(overrides: Record<string, unknown> = {}) {
  return { isActive: true, accessToken: "threads-access-token", providerAccountId: "threads-user-1", ...overrides };
}

describe("Threads publisher", () => {
  beforeEach(() => {
    process.env.PUBLISHING_MODE = "live";
    getSocialAccountByProvider.mockResolvedValue(connectedAccount());
    vi.stubGlobal("fetch", vi.fn());
  });

  it("simulates when live publishing is not enabled", async () => {
    process.env.PUBLISHING_MODE = "sandbox";
    const result = await publishToThreads(scope, "draft-1", "A thread");
    expect(result).toEqual({ success: true, status: "simulated" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("requires a connected account before publishing", async () => {
    getSocialAccountByProvider.mockResolvedValue(undefined);
    const result = await publishToThreads(scope, "draft-1", "A thread");
    expect(result.success).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("creates a media container, then publishes it", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "container-1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "media-1" }), { status: 200 }));

    const result = await publishToThreads(scope, "draft-1", "A useful thread");

    expect(result).toEqual({ success: true, postId: "media-1" });
    expect(fetch).toHaveBeenNthCalledWith(1, "https://graph.threads.net/v1.0/threads-user-1/threads", expect.objectContaining({ method: "POST" }));
    expect(fetch).toHaveBeenNthCalledWith(2, "https://graph.threads.net/v1.0/threads-user-1/threads_publish", expect.objectContaining({ method: "POST" }));
  });

  it("stops before publishing if the container could not be created", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: { message: "Invalid parameter" } }), { status: 400 }));

    const result = await publishToThreads(scope, "draft-1", "A thread");

    expect(result).toEqual({ success: false, error: "Invalid parameter" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
