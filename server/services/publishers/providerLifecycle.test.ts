import { describe, expect, it } from "vitest";
import { assessProviderConnection, buildPublishSafetyKey } from "./providerLifecycle";

describe("provider lifecycle", () => {
  it("marks a provider as connected when token and required scopes are present", () => {
    const result = assessProviderConnection("linkedin", {
      provider: "linkedin",
      isActive: true,
      accessToken: "token",
      scopes: ["w_member_social"],
      tokenExpiresAt: new Date(Date.now() + 60_000 * 60 * 24),
    } as any);

    expect(result.status).toBe("connected");
    expect(result.canPublish).toBe(true);
  });

  it("flags expired tokens before publishing", () => {
    const result = assessProviderConnection("twitter", {
      provider: "twitter",
      isActive: true,
      accessToken: "token",
      scopes: ["tweet.write", "tweet.read", "users.read"],
      tokenExpiresAt: new Date(Date.now() - 60_000),
    } as any);

    expect(result.status).toBe("expired");
    expect(result.canPublish).toBe(false);
  });

  it("builds a stable publish safety key for dedupe", () => {
    const key1 = buildPublishSafetyKey("draft-1", "linkedin", "tenant-1");
    const key2 = buildPublishSafetyKey("draft-1", "linkedin", "tenant-1");
    const key3 = buildPublishSafetyKey("draft-2", "linkedin", "tenant-1");

    expect(key1).toBe(key2);
    expect(key1).not.toBe(key3);
  });
});
